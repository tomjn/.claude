/**
 * Shared bash-command parsing helpers for PreToolUse hooks.
 *
 * The hooks are narrow regex-based guards, not real shell parsers. These
 * helpers centralize the small amount of tokenization, unwrapping, and
 * segment-splitting they need so that bypass-closure work happens in one
 * place.
 *
 * Limitations (shared across consumers):
 *   - No quoting awareness: a literal `;`/`&&`/`||` inside a quoted arg will
 *     over-split. Acceptable — consumers only flag matches.
 *   - No full POSIX expansion: backticks, $( ), $VAR, glob expansion are not
 *     interpreted. A determined bypass via `$(echo grep) ...` is out of scope.
 *   - `sudo`/`nice`/`time` are NOT unwrapped. Their flag/arg semantics vary
 *     and would create false positives. Document this limitation in block
 *     reasons rather than trying to parse it.
 */

const fs = require('fs');
const path = require('path');

// Transparent command-launcher wrappers: `command`, `exec`, `builtin`, `env`,
// `eval` all replace themselves with their first non-flag arg. `rtk` is
// included because it proxies the command after it (`rtk grep foo` runs grep
// through the rtk token-saver; semantically equivalent to `grep foo`).
// Unwrapping these closes common bypasses like `command grep`, `\grep`,
// `env FOO=1 grep`, `rtk grep`, `eval "grep foo"`.
const LAUNCHER = /^(command|exec|builtin|env|eval|rtk)$/;

// rtk subcommands that take an arbitrary command and run it (versus tool-
// specific wrappers like `rtk grep` where the next token IS the command).
// `proxy`/`run` are documented bypass paths (`run` even uses `sh -c`).
// `err`/`test`/`summary` run [COMMAND]... per `rtk <sub> --help`.
// `bash`/`sh` are not real rtk subcommands — rtk falls through to the system
// binary, so `rtk bash -c '...'` is identical to `bash -c '...'`.
const RTK_PASSTHROUGH = /^(proxy|run|err|test|summary|bash|sh)$/;

// Shell binaries that take a `-c <string>` shell payload. We naive-tokenize
// the payload (whitespace-split, edge-quote-strip), which is enough to catch
// the common `bash -c "git push -f"` form. Payloads containing `;`/`&&`
// over-split at splitTopLevel time, which still tends to surface the inner
// command in one of the resulting segments — a partial closure, not perfect.
const SHELL_RUNNER = /^(bash|sh)$/;

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

function normalize(token) {
  // Strip surrounding quotes, leading backslash-escape, and any path prefix so
  // `"/usr/bin/grep"`, `\grep`, and `/bin/grep` all canonicalize to `grep`.
  return token
    .replace(/^["']+|["']+$/g, '')
    .replace(/^\\/, '')
    .split('/')
    .pop();
}

function tokenize(segment) {
  return segment.trim().split(/\s+/);
}

function resolveOnPath(name) {
  // First executable named `name` (no slash) found on $PATH, or null. Mirrors
  // how the shell would resolve a bare command word.
  if (!name || name.includes('/')) return null;
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* not here — keep looking */
    }
  }
  return null;
}

function rewriteCmdWord(token) {
  // Safe executable form of a command-word token for *rewriting the command
  // that actually runs* (distinct from normalize(), which is for matching):
  //   - always strip surrounding quotes and a leading backslash-escape
  //   - additionally collapse an absolute/relative path prefix to the basename
  //     ONLY when $PATH resolves that basename to the very same file. So
  //     `/bin/ls` → `ls`, but a project-local `/Users/me/proj/uberstress` (not
  //     on PATH) or `/proj/python` (a different file than `/usr/bin/python`) is
  //     left intact and still runs the binary the caller intended.
  const dequoted = token.replace(/^["']+|["']+$/g, '').replace(/^\\/, '');
  if (!dequoted.includes('/')) return dequoted; // bare word: quote/escape strip only
  const base = dequoted.split('/').pop();
  const onPath = resolveOnPath(base);
  if (!onPath) return dequoted; // basename not runnable as-is → keep the path
  try {
    if (fs.realpathSync(onPath) === fs.realpathSync(dequoted)) return base;
  } catch {
    /* given path missing/unreadable → keep it verbatim */
  }
  return dequoted; // same name, different file → keep the explicit path
}

function stripPrefix(tokens) {
  // Advance past leading env assignments, launcher wrappers, rtk passthrough
  // subcommands, and shell `-c` runners. Composable: the loop continues until
  // no rule fires, so chains like `env FOO=1 rtk proxy bash -c "..."` unwrap
  // fully.
  let i = 0;
  let advanced = true;
  while (advanced && i < tokens.length) {
    advanced = false;

    // Env assignments first (FOO=bar, BAR=baz before a launcher).
    while (i < tokens.length && ENV_ASSIGN.test(tokens[i])) {
      i++;
      advanced = true;
    }
    if (i >= tokens.length) break;

    const cur = normalize(tokens[i]);
    const next = i + 1 < tokens.length ? normalize(tokens[i + 1]) : null;
    const after = i + 2 < tokens.length ? normalize(tokens[i + 2]) : null;

    // `bash -c <payload>` / `sh -c <payload>` — strip the runner+flag and
    // treat the payload tokens as the real command.
    if (SHELL_RUNNER.test(cur) && next === '-c') {
      i += 2;
      advanced = true;
      continue;
    }

    // Launcher word (command|exec|builtin|env|eval|rtk).
    if (LAUNCHER.test(cur)) {
      // `rtk bash -c ...` / `rtk sh -c ...` — eat all three.
      if (cur === 'rtk' && next && SHELL_RUNNER.test(next) && after === '-c') {
        i += 3;
        advanced = true;
        continue;
      }
      // `rtk <passthrough> <cmd>...` — eat rtk and the subcommand.
      // (For `bash`/`sh` without `-c`, this also fires — fine; the next token
      // is treated as the real command, matching how rtk falls through.)
      if (cur === 'rtk' && next && RTK_PASSTHROUGH.test(next)) {
        i += 2;
        advanced = true;
        continue;
      }
      // Plain single-word launcher.
      i++;
      advanced = true;
      continue;
    }
  }
  return i;
}

function firstCommandWord(segment) {
  const tokens = tokenize(segment);
  const i = stripPrefix(tokens);
  if (i >= tokens.length) return '';
  return normalize(tokens[i]);
}

function commandTokens(segment) {
  // Return [cmd, ...args], all normalized. Normalizing args (stripping quotes,
  // path prefix) means `git "push" "origin" "main"` still matches an allow-list
  // of `[git, push, origin, main]`.
  const tokens = tokenize(segment);
  const i = stripPrefix(tokens);
  if (i >= tokens.length) return [];
  return tokens.slice(i).map(normalize);
}

function splitTopLevel(cmd) {
  // Split on top-level compound operators. Does not track quoting (see header).
  return cmd.split(/(?:&&|\|\||;)/).map((s) => s.trim()).filter(Boolean);
}

function splitTopLevelPreserving(cmd) {
  // Quote-aware split into an alternating [segment, separator, segment, ...]
  // array. Even indices are segments, odd indices are the separators between
  // them; joining the whole array with '' reconstructs `cmd` byte-for-byte, so
  // a consumer can rewrite individual segments and rejoin without disturbing
  // anything it didn't touch.
  //
  // Separators are top-level `&&`, `||`, `;`, and `|` (single pipe). A separator
  // is NOT top-level when it sits inside any of:
  //   - single OR double quotes — stops a `|` in a jq filter (`jq '.a | .b'` or
  //     `jq ".a | .b"`) from being mis-split, which previously stripped the
  //     closing quote;
  //   - a command/process substitution `$( … )`, `<( … )`, `>( … )` (paren-
  //     depth tracked, so nesting works), or a backtick `` ` … ` `` — stops a
  //     `|` in `echo $(a | b)` from being mis-split.
  // A *bare* subshell group `( … )` is intentionally NOT a no-split zone: its
  // inner commands should still be checked individually, matching prior
  // behavior (analyzeSegment strips the leading `(`).
  const parts = [];
  let seg = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let substDepth = 0; // open parens belonging to $()/<()/>() substitutions
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (inSingle) {
      // Bash single quotes are fully literal — only another `'` ends them.
      seg += c;
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      // Inside double quotes a backslash escapes the next char; `"` ends them.
      if (c === '\\' && i + 1 < cmd.length) { seg += c + cmd[++i]; continue; }
      seg += c;
      if (c === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      // Backtick substitution: a backslash escapes the next char; `` ` `` ends it.
      if (c === '\\' && i + 1 < cmd.length) { seg += c + cmd[++i]; continue; }
      seg += c;
      if (c === '`') inBacktick = false;
      continue;
    }
    // Outside quotes/backticks (possibly inside a paren substitution).
    if (c === '\\' && i + 1 < cmd.length) { seg += c + cmd[++i]; continue; }
    if (c === "'") { inSingle = true; seg += c; continue; }
    if (c === '"') { inDouble = true; seg += c; continue; }
    if (c === '`') { inBacktick = true; seg += c; continue; }
    const two = cmd.slice(i, i + 2);
    if (two === '$(' || two === '<(' || two === '>(') {
      substDepth++;
      seg += two;
      i++; // second char consumed
      continue;
    }
    if (substDepth > 0) {
      // Inside a substitution: track nested parens, never split.
      if (c === '(') substDepth++;
      else if (c === ')') substDepth--;
      seg += c;
      continue;
    }
    if (two === '&&' || two === '||') {
      parts.push(seg, two);
      seg = '';
      i++; // second operator char consumed
      continue;
    }
    if (c === ';' || c === '|') {
      parts.push(seg, c);
      seg = '';
      continue;
    }
    seg += c;
  }
  parts.push(seg);
  return parts;
}

function upstreamOfPipe(segment) {
  // First pipe component: `a | b | c` -> `a`. `||` is not a pipe.
  return segment.split(/\|(?!\|)/)[0].trim();
}

function isMultilineOrHeredoc(cmd) {
  return cmd.includes('\n') || cmd.includes('<<');
}

function hasSubstitution(cmd) {
  // True if the command contains a command/process substitution — `$( … )`,
  // backtick `` ` … ` ``, `<( … )`, or `>( … )`. Used by the auto-allow path to
  // refuse granting on commands whose substitutions hide inner commands the
  // allowlist never sees. A *bare* subshell group `( … )` is NOT a substitution
  // (its commands are still split and checked individually). Deliberately
  // simple/over-conservative: a substitution-looking token inside single quotes
  // (which would not actually execute) still trips this — at worst that costs
  // one extra permission prompt, never a missed check.
  return (
    cmd.includes('$(') ||
    cmd.includes('`') ||
    cmd.includes('<(') ||
    cmd.includes('>(')
  );
}

function matchesRule(effective, prefix) {
  // Whether an allowlist `prefix` (a Bash() rule with its trailing `:*`/`*`
  // already stripped) matches a segment's `effective` "cmd args..." string.
  // Match is on a TOKEN boundary, not a raw string prefix: `cat` matches `cat`
  // and `cat foo` but NOT `catalog-build`, and `git push` does not match
  // `git pushfoo`. Prevents allow/deny/ask rules from bleeding across word
  // boundaries.
  return effective === prefix || effective.startsWith(prefix + ' ');
}

module.exports = {
  LAUNCHER,
  RTK_PASSTHROUGH,
  SHELL_RUNNER,
  ENV_ASSIGN,
  normalize,
  resolveOnPath,
  rewriteCmdWord,
  tokenize,
  stripPrefix,
  firstCommandWord,
  commandTokens,
  splitTopLevel,
  splitTopLevelPreserving,
  upstreamOfPipe,
  isMultilineOrHeredoc,
  matchesRule,
  hasSubstitution,
};
