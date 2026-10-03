---
name: file-pr
description: File a concise pull request. Use when filing, opening, or creating a PR.
metadata:
  harness: [claude, codex]
  platform: [darwin, linux]
---

# File PR

A PR is written for a technical human reviewer who will read the diff. Keep it short.

## Before filing

- Check whether a PR for this branch already exists.
- Review the diff locally against `origin/main` to make sure its contents match the goal.
- Look for a GitHub PR template in the repo and use it as the basis for the body.
- Look for GitHub issues that fit and link those.
- Check recent PR titles and commit messages for a ticket or issue prefix convention. When there is one, prefix the PR title, e.g. `ABC-1: Title goes here`, and use the same prefix on the branch's commits.
- Show me the description and get my approval before creating the PR. The only exception is a run that has pre-approved PR creation up front, such as a milestone orchestration.

PR titles usually become commit messages, so follow the repository's title
conventions. Look at recently merged PRs and Git history for examples.
Prefer a concise, human-readable title that explains why the change matters:

BAD
> ❌ perf (server): negotiate permessage-deflate on the websocket

GOOD
> ✅ perf (server): cut websocket frame size by 70%+ with gzipping

Open the description with a simple explanation of the problem based on the user's original prompt, then briefly explain the solution. Do not lead with an implementation inventory:

BAD
> ❌ Removed implicit workspace carry-over from every "new thread" entry point ( cmd+n / cd+shiftto, sidebar v1/v2 buttons, command palette). New threads inherit only the project from context; branch, worktree, and env mode always come from the configured defaults. Deleted buildContextualThreadOptions, startNewThreadInProjectFromContext, and the v1 sidebar's seed-context machinery.

GOOD
> ✅ My "new worktree" default was ignored when starting new threads on existing worktrees. Super unintuitive. Now your preferences always apply.

These examples show the principle, not a voice to copy. Match the repository's own tone.

## Important

- Don't mention other clients in a client repository. E.g. A PR on acme corp can never mention XYZ Ltd even if a component was shared or copied from XYZ's repository.
- Clearly state under a header at the end any follow up actions such as running a command that need to happen _after_ the PR is merged.
- Don't repeat technical details in the description that the user can learn by looking at the diff. This is especially true if a sentence has to mention a filename.
- Spend the words on what the diff cannot show: why this approach, the tradeoffs considered, how it fits the broader project, and any effect on user behaviour. Often a single sentence of intent is enough. Where there is no non-obvious context, a short title plus a one-line why is complete. A correct, accurate change is reason enough, so do not manufacture justification or dramatise impact.
- Never generate an acceptance criteria section of checkbox bullets. It reads as AI-written. Where the ticket or issue defines acceptance criteria, link to it so the criteria have a single source.
- Test status is the reviewer's and the author's job to describe. Do not guess at it and do not state what is or is not tested.
- Wrap literal HTML tags in backticks, e.g. `` `<video>` `` not `<video>`. GitHub renders allowlisted tags as real elements, which silently swallows the rest of the line.
- State the full PR URL in the chat after filing, so it can be clicked.
