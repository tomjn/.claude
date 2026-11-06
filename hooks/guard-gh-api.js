#!/usr/bin/env node
/**
 * PreToolUse hook for Bash.
 *
 * Purpose: gate `gh api` writes without prompting on reads. Settings rules
 * cannot do this: GraphQL reads pass their query with -f, the same flag that
 * turns a REST call into a POST, and ask rules cannot exclude graphql.
 *
 * Asks for:
 *   - REST calls with a non-GET -X/--method
 *   - REST calls with -f/-F/--field/--raw-field/--input and no explicit GET,
 *     because gh sends those as POST
 *   - GraphQL mutations that delete something
 *   - GraphQL queries read from a file or stdin, since the hook cannot see them
 *   - gh issue/pr comment, gh pr review, and gh issue/pr close/reopen with -c,
 *     moved from settings.json ask rules so the opt-out below covers them
 * Everything else falls through to the normal permission rules.
 *
 * Per-project opt-out:
 *   - "env": { "CLAUDE_GH_API_GUARD": "off" } in a project's .claude/settings.json
 *
 * Failure mode:
 *   - Any JSON parse error fails open.
 */

const fs = require('fs');

const FIELD_FLAG = /(?:^|\s)(?:-[fF]|--(?:raw-)?field|--input)/;
const METHOD = /(?:^|\s)(?:-X\s*|--method[=\s]+)['"]?([A-Za-z]+)/;

function pass() {
  process.exit(0);
}

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `guard-gh-api: ${reason}`,
      },
    })
  );
  process.exit(0);
}

function main() {
  if (process.env.CLAUDE_GH_API_GUARD === 'off') return pass();

  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return pass();
  }

  const cmd = ((input.tool_input || {}).command || '').replace(/\\\n/g, ' ');

  // These were ask rules in settings.json. Here they share the opt-out.
  for (const segment of cmd.split(/\n|;|&&|\|\|?/)) {
    if (/\bgh\s+(?:issue\s+comment|pr\s+comment|pr\s+review)\b/.test(segment)) {
      return ask('gh comment or review, which publishes to GitHub.');
    }
    if (/\bgh\s+(?:issue|pr)\s+(?:close|reopen)\b.*-c/.test(segment)) {
      return ask('gh close or reopen with a comment, which publishes to GitHub.');
    }
  }

  if (!/\bgh\s+api\b/.test(cmd)) return pass();

  if (/\bgh\s+api\s+graphql\b/.test(cmd)) {
    if (/\bmutation\b/.test(cmd) && /delete/i.test(cmd)) {
      return ask('GraphQL delete mutation.');
    }
    if (/(?:-[fF]\s*|--(?:raw-)?field[=\s]+)['"]?query=@|--input\b/.test(cmd)) {
      return ask('GraphQL query read from a file or stdin, so its contents cannot be checked.');
    }
  }

  for (const segment of cmd.split(/\n|;|&&|\|\|?/)) {
    const m = segment.match(/\bgh\s+api\s+(.*)$/);
    if (!m || /^graphql\b/.test(m[1])) continue;
    const args = m[1];
    const method = (args.match(METHOD) || [])[1];
    if (method && method.toUpperCase() !== 'GET') {
      return ask(`REST ${method.toUpperCase()} request.`);
    }
    if (!method && FIELD_FLAG.test(args)) {
      return ask('REST request with fields, which gh sends as POST.');
    }
  }
  pass();
}

main();
