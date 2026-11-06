#!/usr/bin/env node
/**
 * PreToolUse hook for Bash.
 *
 * Purpose: stop agents sitting idle until the Bash timeout. Blocks:
 *   - any pipe into `tail` or `head` (`cmd | tail -n 20`, `cmd |& head`)
 *   - `tail -f` / `tail -F` in any position
 *
 * Why: tail and head print once the pipe reaches end of file, and the pipe
 * stays open while any writer is alive. A command that leaves a background
 * child behind (test runner, dev server, watcher) holds the pipe open, so the
 * call hangs long after the command itself has finished. `timeout cmd | tail`
 * does not help: timeout covers only `cmd` and does not kill detached children.
 *
 * Escape hatch:
 *   - `# tail-guard: allow` appended to the command force-allows it.
 *
 * Failure mode:
 *   - Any JSON parse error fails open. Heredocs fail open (body text is not
 *     shell syntax).
 */

const fs = require('fs');
const { firstCommandWord, tokenize, splitTopLevelPreserving } = require('./lib/bash-parse');

const ADVICE =
  'Redirect to a file instead, e.g. `cmd > "$TMPDIR/out.log" 2>&1`, then use the Read tool on that file. ' +
  'Or drop the pipe: the Bash tool already truncates long output. For long-running commands use run_in_background. ' +
  'To follow a log as it grows, use the Monitor tool.';

function allow() {
  process.exit(0);
}

function block(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `guard-pipe-tail: ${reason} ${ADVICE} Append "# tail-guard: allow" for a one-off exception.`,
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

  const cmd = (input.tool_input && input.tool_input.command) || '';
  if (!cmd.trim()) return allow();
  if (/#\s*tail-guard:\s*allow\b/.test(cmd)) return allow();
  if (cmd.includes('<<')) return allow();

  const parts = splitTopLevelPreserving(cmd);
  for (let i = 0; i < parts.length; i += 2) {
    // `|&` splits as `|` then a segment starting with `&`.
    const seg = parts[i].replace(/^\s*&/, '');
    const word = firstCommandWord(seg);
    if (word !== 'tail' && word !== 'head') continue;

    if (word === 'tail' && tokenize(seg).some((t) => /^-[a-zA-Z]*[fF]/.test(t))) {
      return block('tail -f never exits.');
    }
    if (parts[i - 1] === '|') {
      return block(`Piping into ${word} hangs until timeout if the command leaves a background process holding the pipe open.`);
    }
  }
  allow();
}

main();
