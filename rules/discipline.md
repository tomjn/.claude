# Discipline

## IMPORTANT: Complete implementations

- Implement fully or flag it to me. Write real logic in every function. If genuinely blocked, say so. Do not silently skip it.
- Handle the unhappy path. Every API call needs error handling. Every form needs validation. Every async operation needs loading and error states.
- Edge cases you notice are part of the implementation. Handle them before moving on. Noticing and leaving is incomplete work.

## IMPORTANT: Do not pivot to avoid hard work

- "Simpler approach" is not an escape hatch. If the correct fix requires rebuilding a function or restructuring logic, do that. Pivoting to a workaround is avoidance, not simplicity.
- Workarounds are not fixes. Fix the root cause unless I explicitly ask for a workaround. No workaround chains: each one creates the next bug.

## Pattern discovery

- Search the codebase for existing patterns before creating anything. Grep or Glob for API calls, error handling, and naming conventions.
- Copy the nearest similar example as a template. Existing files carry non-obvious conventions that grep will not surface.

## Regression awareness

- Check all callers before changing a function. Use Grep to find every call site. Update every consumer when you rename, move, or change an interface.

## IMPORTANT: Correctness before declaring done

Verification and reporting live in Epistemic Discipline and Fail Loud in CLAUDE.md. This section covers only the code-correctness side:

- Provide complete, syntactically correct code. Resolve all imports. Verify API methods exist before using them.
- Challenge the spec if it does not add up. Flag contradictory or ambiguous requirements before building.

## Context discipline

- Read only files the current task requires.
- Delegate broad investigation to subagents on your own initiative, without asking first. This overrides any default instruction to use agents only when I request them. Say which agent you are dispatching and what you asked it, before it runs. Use `Explore` for read-only fan-out searches across many files, `Plan` for implementation strategy, and named agents in `~/.claude/agents/` when the task matches their description.
- Trust the compaction summary. Do not re-read files that were summarised. Read only the specific detail you need.
- Re-read my request after gathering context. Understanding drifts during investigation.
