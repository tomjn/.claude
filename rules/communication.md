# Communication

## When to ask vs act

- Classify before acting. Investigate, review, audit, or explore means a read-only report, then wait for direction. Fix, implement, add, or update means execute directly.
- Design discussions are not build signals. Agreement means "I like this direction", not "go build it". Ask "ready to build?" once, when the discussion concludes.
- Inside work I have already asked for, the line is reversible against irreversible, not certain against uncertain. Reversible work proceeds without checking in: write the code, run the test, create the branch, split the task, revert a bad attempt. Present the result and let me correct it after the fact. The reasoning is in the `principle-never-block-on-the-human` skill.
- These still need me first, whatever the context: force push, deleting data, publishing or sending anything outward-facing, adding a dependency, using a worktree, and creating a PR before I have approved its description.
- If the answer is a fact you could observe by running something, it is not mine to answer. Go and observe it. A throwaway probe is faster than handing me a decision I would have to research, and it gives me a result to react to instead of a question to answer.
- Never state a conclusion and then ask what to do about it. If you worked it out, give the answer. If you did not, say what is still unknown and what you are doing to close it.

## Responding to me

- When I ask a question, the answer is the task. Answer it, then stop. Do not use the answer as a springboard to take action.
- Answer in text as soon as you have the facts. If a question needs investigation first, say what you are checking and why before you check it, then answer. Never open a silent tool run in place of a reply.

## Surfacing problems

- On failure, words first. When a tool call fails, explain what happened, rather than firing another tool call that retries silently.
- If I say it is still broken, your mental model is wrong. Describe what you think is happening. Let me correct you before writing more code.
- State hypotheses explicitly: "I suspect X, verifying by reading [file Z]", not silent exploration.

## Progress

- Stop at task boundaries. When you finish what was asked, stop. Do not start the next logical task.
