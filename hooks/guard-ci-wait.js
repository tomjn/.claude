#!/usr/bin/env node
/**
 * PreToolUse hook for Bash.
 *
 * Purpose: route every PR and CI wait through the watch-pr skill. Blocks the
 * patterns that hang, block the turn, or misread "no checks yet" as a failure:
 *   - `gh run watch`
 *   - `gh pr checks ... --watch`
 *   - until/while loops that sleep and poll gh or a background task's output file
 *   - the skill's pr-wait script run in the foreground
 *
 * Only Bash calls reach this hook, so pr-wait under the Monitor tool is allowed.
 *
 * This guards a habit, not a security boundary, so it matches the raw command
 * text, multi-line commands included, rather than parsing it.
 *
 * Escape hatch:
 *   - `# ci-wait-guard: allow` appended to the command force-allows it.
 *
 * Failure mode:
 *   - Any JSON parse error fails open.
 */

const fs = require('fs');

const SKILL = 'Use the watch-pr skill instead.';
// pr-wait run through python3 or uv run, or executed directly by path.
const PR_WAIT = /(\b(python3?|uv\s+run)(\s+-\S+)*\s+[^\s;&|]*pr-wait|(^|[;&|(]\s*|\n\s*)[^\s;&|]*\/pr-wait)(?=\s|$|['"])/;

function allow() {
  process.exit(0);
}

function block(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `guard-ci-wait: ${reason} ${SKILL} Append "# ci-wait-guard: allow" for a one-off exception.`,
      },
    })
  );
  process.exit(0);
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return allow();
  }

  const toolInput = input.tool_input || {};
  const cmd = toolInput.command || '';
  if (!cmd.trim()) return allow();
  if (/#\s*ci-wait-guard:\s*allow\b/.test(cmd)) return allow();

  if (/\bgh\s+run\s+watch\b/.test(cmd)) {
    return block('gh run watch has no deadline.');
  }
  if (/\bgh\s+pr\s+checks\b[^\n;&|]*--watch\b/.test(cmd)) {
    return block('gh pr checks --watch has no deadline and exits 1 when no checks are registered yet.');
  }
  if (/\b(until|while)\b/.test(cmd) && /\bsleep\b/.test(cmd) && /\bgh\s+(pr|run|api)\b/.test(cmd)) {
    return block('A sleep loop polling gh blocks the turn.');
  }
  if (/\b(until|while)\b/.test(cmd) && /\bsleep\b/.test(cmd) && /\/tasks\/[^\s'"]*\.output\b/.test(cmd)) {
    return block('A sleep loop polling a background task output file blocks the turn; its completion notification is already on the way.');
  }
  if (PR_WAIT.test(cmd) && toolInput.run_in_background !== true) {
    return block('pr-wait in the foreground blocks the turn. Run it with the Monitor tool, or Bash run_in_background, then end the turn.');
  }
  allow();
}

main();
