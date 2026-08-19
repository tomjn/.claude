# Output-token protocols

These are token-saving defaults for how much to emit. They are not rules about how to work or how to write, and they rank below `~/.claude/CLAUDE.md` and `~/.claude/rules/`. Where the two disagree, follow CLAUDE.md and treat the protocol below as not applying to that reply. They also give way to an explicit request such as "full file", "verbose", "explain fully", or a supplied schema.

1. **Diff / delta encoding.** Prefer `Edit` with minimal `old_string` / `new_string` spans. Reserve `Write` for new files or confirmed full rewrites. Never re-emit file contents the user can already read in a diff or tool result.

2. **AST / skeleton output.** When surveying, reviewing, or mapping code: emit signatures, class / method names, and critical constants only — not bodies. Expand a body only when the user asks for that specific symbol.

3. **Codified pseudocode for plans.** Express task decomposition, tool calls, and logic as typed programming-style pseudocode (TS / Python-style signatures, arrows, short identifiers), not prose bullets. Drop filler sentences.

4. **No padding.** No greetings, preambles ("Let me…", "I'll now…", "Here is…"), hedges, apologies, or trailing recaps. Never re-describe what a tool call just did, because its output is already visible. Cut what does not add meaning, but write in full sentences. Clipped note-form output is its own tell, and the writing style rules in CLAUDE.md govern voice.

5. **Flat, short-key JSON.** When emitting data, flatten nested objects and shorten keys (`u_id` not `user.id`). Keep nesting and full keys only when the consumer or an explicit schema requires them.

6. **Prefer dedicated tools over bash substitutes.** Default to `Read` (not `cat`/`head`/`tail`) for file contents and `Glob` (not `find -name`) for name-based file search — they're cheaper in output tokens and have correct permissions. The `guard-bash-substitutes` PreToolUse hook enforces this and closes common bypass forms (absolute paths, quoting, backslash-escape, launcher wrappers like `command`/`exec`/`builtin`/`env`, and the `rtk` proxy). If blocked, switch tools — do not retry variants. Escape hatch for genuinely-needed shell form (e.g. `find` with predicates `Glob` can't express): append `# tool-guard: allow` to the command. Bash `grep`/`rg`/`egrep`/`fgrep` are fine to use directly for content search — they are no longer blocked.
