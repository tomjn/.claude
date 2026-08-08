#!/usr/bin/env bun

/**
 * Stop hook: extract usage stats from the Claude Code transcript.
 *
 * Reads the hook payload from stdin (provides transcript_path and session_id),
 * parses all assistant messages in the transcript, and writes cumulative +
 * latest-turn usage to ~/.claude/usage.json.
 *
 * Output format:
 * {
 *   session_id, updated_at, turns,
 *   totals: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens },
 *   last_turn: { ... same fields ... }
 * }
 */

import { readFileSync } from 'node:fs';

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  stop_hook_active: boolean;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

const USAGE_PATH = `${process.env.HOME}/.claude/usage.json`;

async function main() {
  const raw = readFileSync('/dev/stdin', 'utf-8');
  const hook: HookInput = JSON.parse(raw);

  // Don't recurse if this Stop was triggered by the hook itself
  if (hook.stop_hook_active) return;

  const transcript = readFileSync(hook.transcript_path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const assistantMessages = transcript.filter(
    (entry: { type: string }) => entry.type === 'assistant',
  );

  if (assistantMessages.length === 0) return;

  const totals: Usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  let lastTurn: Usage = { ...totals };

  for (const entry of assistantMessages) {
    const u = entry.message?.usage;
    if (!u) continue;

    totals.input_tokens += u.input_tokens ?? 0;
    totals.output_tokens += u.output_tokens ?? 0;
    totals.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    totals.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;

    lastTurn = {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    };
  }

  const output = {
    session_id: hook.session_id,
    updated_at: new Date().toISOString(),
    turns: assistantMessages.length,
    totals,
    last_turn: lastTurn,
  };

  await Bun.write(USAGE_PATH, JSON.stringify(output, null, 2) + '\n');
}

main().catch(() => {
  // Hooks must never crash or block the session
});
