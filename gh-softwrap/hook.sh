#!/usr/bin/env python3
# gh-softwrap: PreToolUse hook for Claude Code
# Blocks gh commands whose PR, issue, release or comment body is hard wrapped.
#
# Bodies must use soft wrap, meaning one line per paragraph with no newlines
# inserted at a fixed column width. Markdown structure such as lists, tables,
# headings, fenced code and explicit two-space line breaks stays exempt.
#
# Covers:
#   gh pr create/edit/comment, gh issue create/edit/comment,
#   gh release create/edit, gh gist create, gh api -f body=...
#   via --body/-b, --body=, --body-file/-F, and heredocs.
#
# Escape hatch:
#   append "# softwrap: allow" to the command, or set GH_SOFTWRAP_DISABLED=1

import json
import os
import re
import shlex
import sys

# A line at least this long followed by more body text reads as a wrap point.
MIN_WRAP_WIDTH = 45

FENCE = re.compile(r"^\s*(```|~~~)")
# Markdown structures that are legitimately one per line.
STRUCT = re.compile(r"^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||\[[^\]]+\]:|<|---+$|===+$)")
BODY_SUBCOMMAND = re.compile(r"\bgh\s+(pr|issue|release|gist|api)\b")
HEREDOC = re.compile(r"<<-?\s*[\"']?(\w+)[\"']?\s*\n(.*?)\n[ \t]*\1\b", re.DOTALL)


def emit_allow():
    sys.exit(0)


def emit_deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def is_paragraph_text(line):
    """True if the line is plain paragraph content rather than markdown structure."""
    if not line.strip():
        return False
    if FENCE.match(line) or STRUCT.match(line):
        return False
    if line.startswith("    ") or line.startswith("\t"):
        return False
    # Two trailing spaces is an explicit markdown line break, so it is deliberate.
    if line.endswith("  "):
        return False
    return True


def find_hard_wrap(body):
    """Return (line_number, text) of the first hard wrapped line, or None."""
    lines = body.split("\n")
    in_fence = False
    for i in range(len(lines) - 1):
        line = lines[i]
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if not is_paragraph_text(line) or len(line.rstrip()) < MIN_WRAP_WIDTH:
            continue
        if is_paragraph_text(lines[i + 1]):
            return i + 1, line.strip()
    return None


def collect_bodies(command):
    """Return a list of (source_label, text) for every body value in the command."""
    bodies = []

    for match in HEREDOC.finditer(command):
        bodies.append(("heredoc <<%s" % match.group(1), match.group(2)))
    remainder = HEREDOC.sub(" HEREDOC ", command)

    try:
        tokens = shlex.split(remainder)
    except ValueError:
        # Unbalanced quotes once heredocs are removed, so fall back to a regex.
        for match in re.finditer(r"--body(?:=|\s+)(['\"])(.*?)\1", remainder, re.DOTALL):
            bodies.append(("--body", match.group(2)))
        return bodies

    i = 0
    while i < len(tokens):
        token = tokens[i]
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None

        if token in ("--body", "-b") and nxt is not None:
            bodies.append(("--body", nxt))
            i += 2
            continue
        if token.startswith("--body="):
            bodies.append(("--body", token[len("--body="):]))
            i += 1
            continue
        if token in ("--body-file", "--notes-file") and nxt is not None:
            bodies.extend(read_body_file(nxt))
            i += 2
            continue
        if token.startswith("--body-file="):
            bodies.extend(read_body_file(token[len("--body-file="):]))
            i += 1
            continue
        if token in ("--notes", "-n") and nxt is not None:
            bodies.append(("--notes", nxt))
            i += 2
            continue
        # -F is --body-file on gh pr/issue and --field on gh api.
        if token in ("-f", "-F", "--field", "--raw-field") and nxt is not None:
            if nxt.startswith("body="):
                bodies.append(("field body=", nxt[len("body="):]))
            elif token == "-F":
                bodies.extend(read_body_file(nxt))
            i += 2
            continue
        i += 1

    return bodies


def read_body_file(path):
    """Return a single (path, contents) pair, or an empty list if unreadable."""
    if path == "-" or not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return [(path, handle.read())]
    except OSError:
        return []


def main():
    if os.environ.get("GH_SOFTWRAP_DISABLED") == "1":
        emit_allow()

    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        emit_allow()

    if payload.get("tool_name") != "Bash":
        emit_allow()

    command = payload.get("tool_input", {}).get("command") or ""
    if "gh " not in command or not BODY_SUBCOMMAND.search(command):
        emit_allow()
    if re.search(r"#\s*softwrap:\s*allow", command):
        emit_allow()

    for label, body in collect_bodies(command):
        hit = find_hard_wrap(body)
        if hit is None:
            continue
        line_number, text = hit
        emit_deny(
            "gh-softwrap: the body passed via %s is hard wrapped at line %d.\n\n"
            "  %s\n\n"
            "That line is followed by more paragraph text with no blank line "
            "between them, which means a newline was inserted mid-paragraph. "
            "GitHub soft wraps for you, so hard wrapping makes the rendered text "
            "ragged and the diff noisy when the body is edited.\n\n"
            "Rewrite the body so each paragraph is a single continuous line, then "
            "retry. Separate paragraphs with a blank line. Lists, tables, headings "
            "and fenced code blocks are fine as they are.\n\n"
            "If the wrapping is deliberate, for example quoting text that must keep "
            "its line breaks, append '# softwrap: allow' to the command."
            % (label, line_number, text[:120])
        )

    emit_allow()


if __name__ == "__main__":
    main()
