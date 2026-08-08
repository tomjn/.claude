#!/usr/bin/env node
/**
 * Hook integration tests.
 *
 * Each case feeds a Bash PreToolUse JSON payload to a guard via stdin and
 * checks whether the guard emitted a `permissionDecision` of `deny` (block) or
 * exited silently (allow). No external test framework — keep deps zero so
 * `node test/guards.test.js` works on any machine that can run the hooks.
 *
 * Run from repo root:
 *   node test/guards.test.js
 *
 * Exit code is 0 on pass, 1 on any failure.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOKS = path.resolve(__dirname, '..', 'hooks');
const GUARD_PUSH = path.join(HOOKS, 'guard-git-push.js');
const GUARD_BASH = path.join(HOOKS, 'guard-bash-substitutes.js');
const NORMALIZE = path.join(HOOKS, 'normalize-bash.js');
const GUARD_WRITE = path.join(HOOKS, 'guard-write.js');

function run(hook, command) {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const r = spawnSync('node', [hook], { input, encoding: 'utf8' });
  return { stdout: r.stdout || '', status: r.status };
}

function parseNormalize(stdout) {
  // normalize-bash emits {hookSpecificOutput: {...}} or nothing.
  if (!stdout.trim()) return { rewritten: null, allowed: false };
  try {
    const obj = JSON.parse(stdout);
    const out = obj.hookSpecificOutput || {};
    return {
      rewritten: out.updatedInput ? out.updatedInput.command : null,
      allowed: out.permissionDecision === 'allow',
    };
  } catch {
    return { rewritten: null, allowed: false };
  }
}

// [hook, command, expected: 'block' | 'allow', label]
const cases = [
  // ─── guard-git-push: rtk passthrough subcommands ──────────────────────
  [GUARD_PUSH, 'rtk proxy git push -X origin foo', 'block', 'rtk proxy passthrough'],
  [GUARD_PUSH, 'rtk run git push -X origin foo', 'block', 'rtk run passthrough'],
  [GUARD_PUSH, 'rtk err git push -X origin foo', 'block', 'rtk err passthrough'],
  [GUARD_PUSH, 'rtk summary git push origin feature', 'block', 'rtk summary passthrough'],
  [GUARD_PUSH, 'rtk test git push origin feature', 'block', 'rtk test passthrough'],

  // ─── guard-git-push: shell-runner -c payloads ─────────────────────────
  [GUARD_PUSH, 'bash -c "git push -X origin foo"', 'block', 'bash -c'],
  [GUARD_PUSH, 'sh -c "git push -X origin foo"', 'block', 'sh -c'],
  [GUARD_PUSH, 'rtk bash -c "git push -X origin foo"', 'block', 'rtk bash -c'],
  [GUARD_PUSH, 'rtk sh -c "git push origin feature"', 'block', 'rtk sh -c'],
  [GUARD_PUSH, 'eval "git push -X origin foo"', 'block', 'eval'],

  // ─── guard-git-push: composed wrappers ────────────────────────────────
  [GUARD_PUSH, 'env FOO=1 rtk proxy git push origin feature', 'block', 'env + rtk proxy'],
  [GUARD_PUSH, 'command rtk proxy git push origin feature', 'block', 'command + rtk proxy'],
  [GUARD_PUSH, '/usr/bin/git push -X origin foo', 'block', 'absolute-path git'],
  [GUARD_PUSH, '"git" push -X origin foo', 'block', 'quoted git'],
  [GUARD_PUSH, '\\git push -X origin foo', 'block', 'backslash-escape git'],
  [GUARD_PUSH, 'true && git push -X origin foo', 'block', '&& chain'],

  // ─── guard-git-push: legitimate forms must still pass ─────────────────
  [GUARD_PUSH, 'git push', 'allow', 'bare git push'],
  [GUARD_PUSH, 'git push origin main', 'allow', 'safe explicit form'],
  [GUARD_PUSH, 'rtk gain', 'allow', 'rtk meta subcommand'],
  [GUARD_PUSH, 'rtk discover', 'allow', 'rtk meta subcommand'],
  [GUARD_PUSH, 'rtk grep foo', 'allow', 'rtk tool wrapper (not git)'],
  [GUARD_PUSH, 'rtk proxy ls', 'allow', 'rtk proxy non-git command'],
  [GUARD_PUSH, 'bash -c "echo hello"', 'allow', 'bash -c non-git payload'],
  [GUARD_PUSH, 'rtk bash -c "echo hello"', 'allow', 'rtk bash -c non-git'],
  [GUARD_PUSH, 'rtk proxy git status', 'allow', 'rtk proxy + git non-push'],
  [GUARD_PUSH, 'git push -X origin foo # git-push-guard: allow', 'allow', 'escape hatch'],
  [GUARD_PUSH, 'echo "git push -f"', 'allow', 'string content not command'],

  // ─── guard-bash-substitutes: closures ─────────────────────────────────
  // (cat is the representative blocked substitute; grep family is no longer blocked)
  [GUARD_BASH, 'rtk proxy cat foo', 'block', 'rtk proxy cat'],
  [GUARD_BASH, 'rtk run cat foo', 'block', 'rtk run cat'],
  [GUARD_BASH, 'rtk bash -c "cat bar.txt"', 'block', 'rtk bash -c cat'],
  [GUARD_BASH, 'bash -c "cat bar.txt"', 'block', 'bash -c cat'],
  [GUARD_BASH, 'sh -c "cat /etc/hosts"', 'block', 'sh -c cat'],
  [GUARD_BASH, 'eval "cat bar.txt"', 'block', 'eval cat'],
  [GUARD_BASH, 'rtk err cat /etc/hosts', 'block', 'rtk err cat'],

  // ─── guard-bash-substitutes: legitimate forms ─────────────────────────
  [GUARD_BASH, 'grep foo bar.txt', 'allow', 'grep no longer blocked'],
  [GUARD_BASH, 'rg foo', 'allow', 'rg no longer blocked'],
  [GUARD_BASH, 'egrep foo bar.txt', 'allow', 'egrep no longer blocked'],
  [GUARD_BASH, 'fgrep foo bar.txt', 'allow', 'fgrep no longer blocked'],
  [GUARD_BASH, 'ps aux | grep claude', 'allow', 'pipe downstream grep'],
  [GUARD_BASH, 'ls -la', 'allow', 'ls'],
  [GUARD_BASH, 'echo hello', 'allow', 'echo'],
  [GUARD_BASH, 'rtk gain', 'allow', 'rtk meta'],
  [GUARD_BASH, 'find . -mtime -1', 'allow', 'find with non-name predicate'],
  [GUARD_BASH, 'cat bar.txt # tool-guard: allow', 'allow', 'escape hatch'],
  // The token used to be `# bash-guard: allow`, which collided with the Boucle
  // bash-guard hook in ~/.claude/bash-guard. That hook requires an operation
  // name after allow, so `# bash-guard: allow inplace-edit` satisfied both and
  // switched this guard off as a side effect. The old token must not work now.
  [GUARD_BASH, 'cat bar.txt # bash-guard: allow', 'block', 'old colliding token is inert'],
  [GUARD_BASH, 'cat bar.txt # bash-guard: allow inplace-edit', 'block', 'Boucle token does not leak through'],
];

let pass = 0;
let fail = 0;
for (const [hook, cmd, expected, label] of cases) {
  const { stdout } = run(hook, cmd);
  const got = stdout.includes('"permissionDecision":"deny"') ? 'block' : 'allow';
  const ok = got === expected;
  const tag = path.basename(hook).replace('.js', '').replace('guard-', '');
  if (ok) {
    pass++;
    console.log(`OK   [${tag}] ${expected.padEnd(5)} ${label}`);
  } else {
    fail++;
    console.log(`FAIL [${tag}] expected=${expected} got=${got}: ${label}`);
    console.log(`     cmd: ${cmd}`);
    if (stdout) console.log(`     stdout: ${stdout.slice(0, 240)}`);
  }
}

// ─── normalize-bash: rewrites + auto-allow behavior ──────────────────────
// [command, expectedRewrite|null, label]
// expectedRewrite === null means "no rewrite expected" (output may be empty
// or contain only permissionDecision). The escape-hatch case is the
// regression we just fixed: it MUST rewrite even with the comment present.
const normalizeCases = [
  ['/bin/ls -la', 'ls -la', 'abs-path on PATH rewritten (same file)'],
  ['"grep" foo bar', 'grep foo bar', 'quoted cmd-word rewritten'],
  ['/bin/ls -la | "head" -n 3', 'ls -la | head -n 3', 'compound rewrite'],
  [
    '/bin/ls -la # tool-guard: allow',
    'ls -la # tool-guard: allow',
    'escape hatch does NOT skip rewrite (regression fix)',
  ],
  // Regression: a path to a binary NOT on PATH (e.g. a project-local tool) must
  // be left intact, or the rewritten command runs the wrong thing / nothing.
  [
    '/tmp/proj-xyz/uberstress list-scenarios',
    null,
    'abs-path NOT on PATH left intact (project-local binary)',
  ],
  [
    '"/tmp/proj-xyz/uberstress" list-scenarios',
    '/tmp/proj-xyz/uberstress list-scenarios',
    'quoted off-PATH abs-path: strip quotes, keep path',
  ],
  ['ls -la', null, 'no rewrite needed'],
  ['echo hello', null, 'plain command unchanged'],
  // Regression: a pipe (or other separator) INSIDE a quoted argument is not a
  // top-level separator. A naive split mis-parses the post-pipe fragment as a
  // new command word and strips the string's closing quote, mangling the
  // command. jq filters with `|` are the canonical victim.
  [
    "jq '.items[] | .name' data.json",
    null,
    'single-quoted pipe in jq filter not split (no mangling)',
  ],
  [
    'jq ".items[] | .name" data.json',
    null,
    'double-quoted pipe in jq filter not split (no mangling)',
  ],
  [
    "awk '{print $1; print $2}' file",
    null,
    'quoted semicolon in awk program not split',
  ],
  // A real top-level pipe must STILL split and rewrite (regression guard for
  // the quote-aware splitter not over-correcting).
  [
    '/bin/ls -la | jq ".a | .b"',
    'ls -la | jq ".a | .b"',
    'real pipe splits, quoted pipe preserved, cmd-word rewritten',
  ],
];

for (const [cmd, want, label] of normalizeCases) {
  const { stdout } = run(NORMALIZE, cmd);
  const { rewritten } = parseNormalize(stdout);
  const got = rewritten;
  const ok = want === null ? got === null : got === want;
  if (ok) {
    pass++;
    console.log(`OK   [normalize-bash] rewrite ${label}`);
  } else {
    fail++;
    console.log(`FAIL [normalize-bash] expected=${JSON.stringify(want)} got=${JSON.stringify(got)}: ${label}`);
    console.log(`     cmd: ${cmd}`);
    if (stdout) console.log(`     stdout: ${stdout.slice(0, 240)}`);
  }
}

// ─── lib/bash-parse: pure-function unit tests ────────────────────────────
// These don't spawn a hook or read the live allowlist, so they're stable
// regardless of the machine's settings.json.
const lib = require('../hooks/lib/bash-parse');

function libCheck(label, fn) {
  let ok = false;
  let detail = '';
  try {
    ok = fn();
  } catch (e) {
    detail = ` (threw: ${e.message})`;
  }
  if (ok) {
    pass++;
    console.log(`OK   [lib] ${label}`);
  } else {
    fail++;
    console.log(`FAIL [lib] ${label}${detail}`);
  }
}

// splitTopLevelPreserving: a separator inside a command/process substitution is
// not a top-level separator.
const noSplit = (cmd) => {
  const p = lib.splitTopLevelPreserving(cmd);
  return p.length === 1 && p[0] === cmd;
};
libCheck('cmd subst $() not split', () => noSplit('echo $(foo | bar)'));
libCheck('backtick subst not split', () => noSplit('echo `foo | bar`'));
libCheck('process subst <() not split', () => noSplit('diff <(a|b) <(c|d)'));
libCheck('nested subst not split', () => noSplit('echo $(a | (b | c))'));
// A bare subshell group is NOT a substitution; its contents must STILL split so
// each inner command word is checked (no regression vs. the prior behavior).
libCheck('bare subshell still splits', () => lib.splitTopLevelPreserving('(a | b)').length === 3);
// Lossless reconstruction must hold even with substitutions present.
libCheck('subst lossless join', () => lib.splitTopLevelPreserving('x $(a|b) | y `c|d`').join('') === 'x $(a|b) | y `c|d`');
// A redirect `<`/`>` (not followed by `(`) is not a substitution.
libCheck('redirect not treated as subst', () => lib.splitTopLevelPreserving('a < f | b').length === 3);

// matchesRule: an allowlist prefix matches on a token boundary, not as a raw
// string prefix — `cat` must not match `catalog-build`.
libCheck('matchesRule exact', () => lib.matchesRule('cat', 'cat') === true);
libCheck('matchesRule arg follows', () => lib.matchesRule('cat foo', 'cat') === true);
libCheck('matchesRule word-boundary reject', () => lib.matchesRule('catalog-build now', 'cat') === false);
libCheck('matchesRule multiword', () => lib.matchesRule('git push origin', 'git push') === true);
libCheck('matchesRule multiword reject', () => lib.matchesRule('git pushfoo', 'git push') === false);

// hasSubstitution: detect command/process substitution so the auto-allow path
// can refuse to grant on commands whose inner commands it cannot vet.
libCheck('hasSubstitution $()', () => lib.hasSubstitution('echo $(ls | wc)') === true);
libCheck('hasSubstitution backtick', () => lib.hasSubstitution('echo `ls`') === true);
libCheck('hasSubstitution <()', () => lib.hasSubstitution('diff <(a) <(b)') === true);
libCheck('hasSubstitution none', () => lib.hasSubstitution("jq '.a | .b' f.json") === false);
libCheck('hasSubstitution plain parens', () => lib.hasSubstitution('(cd x && y)') === false);

// ─── normalize-bash: auto-allow must fail closed ─────────────────────────
// These assert the ABSENCE of an auto-allow, which holds on any machine. A
// positive case would depend on the local allowlist, so it is not asserted.
//
// Regression: a segment that is only a launcher word (env, command, exec) had
// its whole command word consumed by stripPrefix, leaving an empty effective
// that was silently skipped. The verdict then rested on the other segments, so
// `env | wc -l` was auto-allowed on the strength of `wc -l` alone. Bare env
// dumps the environment, and the Boucle bash-guard blocks it for that reason.
const noAllowCases = [
  ['env | wc -l', 'bare launcher segment vetoes auto-allow'],
  ['/usr/bin/env | wc -l', 'absolute-path launcher segment vetoes auto-allow'],
  ['command | wc -l', 'other bare launcher words veto too'],
];

for (const [cmd, label] of noAllowCases) {
  const { allowed } = parseNormalize(run(NORMALIZE, cmd).stdout);
  if (!allowed) {
    pass++;
    console.log(`OK   [normalize-bash] no-allow ${label}`);
  } else {
    fail++;
    console.log(`FAIL [normalize-bash] expected no auto-allow, got allow: ${label}`);
    console.log(`     cmd: ${cmd}`);
  }
}

// ─── guard-write: session-state sequences ────────────────────────────────
// guard-write is stateful, so each case is an ordered sequence of hook calls
// against one throwaway session id. A step with event 'Post' models the tool
// actually running. Omitting the Post step models a call that a peer PreToolUse
// hook (humanize, read-before-edit) or the user rejected.
const WRITE_STATE_DIR = path.join(process.env.TMPDIR || '/tmp', 'claude-write-guard');
const BIG_A = 'a'.repeat(4000);
const BIG_B = 'b'.repeat(4000);
const SMALL = 'small content';

function runWrite(sessionId, step) {
  const isNotebook = step.tool === 'NotebookEdit';
  const input = JSON.stringify({
    session_id: sessionId,
    hook_event_name: step.event === 'Post' ? 'PostToolUse' : 'PreToolUse',
    tool_name: step.tool,
    tool_input: isNotebook
      ? { notebook_path: step.file }
      : { file_path: step.file, content: step.content },
  });
  const r = spawnSync('node', [GUARD_WRITE], { input, encoding: 'utf8' });
  return r.stdout || '';
}

const F = '/tmp/guard-write-test/ORCHESTRATION.md';

// [label, steps] where each step is {event, tool, content, want}. want is only
// checked on Pre steps.
const writeCases = [
  [
    'peer hook blocks first Write, fixed retry still allowed (regression)',
    [
      { tool: 'Write', content: BIG_A, want: 'allow' },
      // No Post step: humanize blocked it, so the file was never written.
      { tool: 'Write', content: BIG_B, want: 'allow' },
    ],
  ],
  [
    'repeat large Write after a real write blocks',
    [
      { tool: 'Write', content: BIG_A, want: 'allow' },
      { event: 'Post', tool: 'Write', content: BIG_A },
      { tool: 'Write', content: BIG_B, want: 'block' },
    ],
  ],
  [
    'kill-switch lets an identical retry through',
    [
      { tool: 'Write', content: BIG_A, want: 'allow' },
      { event: 'Post', tool: 'Write', content: BIG_A },
      { tool: 'Write', content: BIG_B, want: 'block' },
      { tool: 'Write', content: BIG_B, want: 'allow' },
    ],
  ],
  [
    'blocked Write does not count as a touch',
    [
      { tool: 'Write', content: BIG_A, want: 'allow' },
      { event: 'Post', tool: 'Write', content: BIG_A },
      { tool: 'Write', content: BIG_B, want: 'block' },
      // Third distinct content: the block above must not have bumped the count,
      // and the kill-switch for BIG_B must not cover BIG_A's key either.
      { tool: 'Write', content: BIG_A, want: 'block' },
    ],
  ],
  [
    'small Write allowed after a real write',
    [
      { event: 'Post', tool: 'Write', content: BIG_A },
      { tool: 'Write', content: SMALL, want: 'allow' },
    ],
  ],
  [
    'Edit records a touch, so a later large Write blocks',
    [
      { event: 'Post', tool: 'Edit', content: SMALL },
      { tool: 'Write', content: BIG_A, want: 'block' },
    ],
  ],
  [
    'Edit is never blocked',
    [
      { event: 'Post', tool: 'Write', content: BIG_A },
      { tool: 'Edit', content: BIG_A, want: 'allow' },
    ],
  ],
  [
    'NotebookEdit is never blocked',
    [
      { event: 'Post', tool: 'Write', content: BIG_A },
      { tool: 'NotebookEdit', want: 'allow' },
    ],
  ],
];

writeCases.forEach(([label, steps], i) => {
  const sessionId = `test-guard-write-${i}`;
  const stateFile = path.join(WRITE_STATE_DIR, `${sessionId}.json`);
  try {
    fs.unlinkSync(stateFile);
  } catch {
    // No prior state for this session id, which is the normal case.
  }

  let ok = true;
  let detail = '';
  steps.forEach((step, s) => {
    const stdout = runWrite(sessionId, { ...step, file: F });
    if (!step.want) return;
    const got = stdout.includes('"permissionDecision":"deny"') ? 'block' : 'allow';
    if (got !== step.want) {
      ok = false;
      detail += ` [step ${s + 1} ${step.tool}: expected=${step.want} got=${got}]`;
    }
  });

  try {
    fs.unlinkSync(stateFile);
  } catch {
    // Best-effort cleanup.
  }

  if (ok) {
    pass++;
    console.log(`OK   [write] ${label}`);
  } else {
    fail++;
    console.log(`FAIL [write] ${label}${detail}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
