#!/usr/bin/env node
/**
 * PreToolUse and PostToolUse hook for Write, Edit, and NotebookEdit.
 *
 * Purpose: prevent output-token waste from full-file rewrites via the Write tool
 * when an Edit would do.
 *
 * Rule (PreToolUse, decide only):
 *   Block a Write when ALL of the following hold:
 *     1. The target file was actually written earlier in this session
 *        (a Write/Edit/NotebookEdit that ran to completion).
 *     2. The content being written is larger than THRESHOLD_CHARS.
 *     3. The exact same (file_path, content) Write was not previously blocked
 *        in this session (kill-switch: a second identical attempt goes through).
 *
 *   Otherwise: allow. In particular, the *first* Write of a file in a session is
 *   always allowed. The rule only kicks in on repeat full rewrites.
 *
 *   Edit and NotebookEdit are never blocked. NotebookEdit is inherently per-cell
 *   rather than a full-file rewrite, so the concern does not apply.
 *
 * Touch recording (PostToolUse, record only):
 *   A PreToolUse hook cannot know whether the tool ran. Claude Code runs every
 *   matching PreToolUse hook and blocks if any one of them blocks, so a peer
 *   hook or a user denying the permission prompt can reject a call this hook
 *   allowed. Recording the touch in PreToolUse made the retry look like a repeat
 *   rewrite and blocked it, and because the retry usually has different content
 *   the kill-switch did not apply either. Touches are recorded in PostToolUse
 *   instead, which only runs after the tool actually succeeded.
 *
 * State is kept per session_id in $TMPDIR/claude-write-guard/<session_id>.json.
 * Old state files are GC'd probabilistically (see STATE_TTL_MS / GC_PROBABILITY).
 * Any error in the hook fails open (allows the tool).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const THRESHOLD_CHARS = 3000;
const STATE_DIR = path.join(process.env.TMPDIR || '/tmp', 'claude-write-guard');
const MAX_BLOCKED_HASHES = 200;
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GC_PROBABILITY = 0.05; // ~1 in 20 invocations runs cleanup

function allow() {
  // Exit 0 with no stdout = allow
  process.exit(0);
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function loadState(sessionId) {
  try {
    const file = path.join(STATE_DIR, `${sessionId}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { touched: {}, blockedHashes: [] };
  }
}

function saveState(sessionId, state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const file = path.join(STATE_DIR, `${sessionId}.json`);
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch {
    // Ignore state-save failures; correctness is not critical here.
  }
}

function shortHash(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function gcOldState() {
  // Best-effort: remove session state files older than STATE_TTL_MS. Swallow
  // all errors — this is housekeeping, not correctness.
  try {
    const now = Date.now();
    const entries = fs.readdirSync(STATE_DIR);
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(STATE_DIR, name);
      try {
        const st = fs.statSync(file);
        if (now - st.mtimeMs > STATE_TTL_MS) fs.unlinkSync(file);
      } catch {
        // per-file errors ignored
      }
    }
  } catch {
    // dir doesn't exist yet, or unreadable — fine
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return allow();
  }

  if (Math.random() < GC_PROBABILITY) gcOldState();

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const sessionId = input.session_id || 'no-session';
  // Write/Edit use file_path; NotebookEdit uses notebook_path.
  const filePath = toolInput.file_path || toolInput.notebook_path;

  if (!filePath) return allow();
  if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'NotebookEdit') return allow();

  const state = loadState(sessionId);
  const prevTouches = state.touched[filePath] || 0;

  // PostToolUse: the tool ran, so record the touch. Nothing to decide.
  if (input.hook_event_name === 'PostToolUse') {
    state.touched[filePath] = prevTouches + 1;
    saveState(sessionId, state);
    return allow();
  }

  // Everything below is the PreToolUse decision. It must not record a touch,
  // because a peer PreToolUse hook or the user can still reject this call.
  if (toolName === 'Edit' || toolName === 'NotebookEdit') return allow();

  // Write path.
  const content = typeof toolInput.content === 'string' ? toolInput.content : '';
  const contentHash = shortHash(content);
  const blockKey = `${filePath}:${contentHash}`;

  // Kill-switch: if we blocked this exact (file, content) before, let it through
  // now. Consume the switch so a third identical attempt blocks again.
  if (state.blockedHashes.includes(blockKey)) {
    state.blockedHashes = state.blockedHashes.filter((k) => k !== blockKey);
    saveState(sessionId, state);
    return allow();
  }

  // Allow the first write of a file regardless of size, and allow small writes
  // always.
  if (prevTouches === 0 || content.length <= THRESHOLD_CHARS) return allow();

  // Repeat large Write on a file already touched this session -> block.
  state.blockedHashes.push(blockKey);
  if (state.blockedHashes.length > MAX_BLOCKED_HASHES) {
    state.blockedHashes = state.blockedHashes.slice(-MAX_BLOCKED_HASHES);
  }
  // touched is only ever incremented by the PostToolUse path, so a rejected call
  // leaves the file's count alone.
  saveState(sessionId, state);

  const reason =
    `guard-write: blocked Write to '${filePath}' (${content.length} chars). ` +
    `This file was already touched earlier in the session, and full rewrites ` +
    `of existing files cost a lot of output tokens. ` +
    `Use the Edit tool with targeted changes instead. ` +
    `If you genuinely need to replace the entire file, retry the identical Write ` +
    `and the kill-switch will allow the second attempt through.`;
  block(reason);
}

main();
