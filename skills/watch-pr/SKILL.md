---
name: watch-pr
description: Use when waiting for a GitHub pull request's CI checks or reviews, when asked to monitor, watch, or babysit a PR, before merging a PR once CI passes, or when tempted to run gh pr checks --watch, gh run watch, or a sleep loop on CI.
---

# Watch PR

Every PR wait has a measured deadline and ends the turn. You get woken when something happens. One watcher per PR, because every watcher on a GitHub account shares one rate limit.

```
W = python3 "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/skills/watch-pr/scripts/pr-wait <pr-url> --timeout-seconds <seconds>
```

`W` prints one line per real event: a failed check, a comment or review, a review bot finishing, base branch moves that touch this PR's files, the PR becoming BEHIND or DIRTY. The last line starts with a marker from the table below. `--until` picks when it stops:

- `ready` (default): checks green, Greptile or Macroscope reviewed the head, no unresolved threads. Ends with `READY`. Use it when the command below lists `greptile` or `macroscope`.
- `green`: checks only. Ends with `ALL_CHECKS_PASSED`. Use it in every other repo, or `ready` waits until the deadline.
- `registered`: stop once any CI check appears. Ends with `CHECKS_REGISTERED`. Only for the T3 path.

```bash
gh pr list -R OWNER/REPO --state all -L 10 --json comments,reviews \
  --jq '[.[] | (.comments[], .reviews[]) | .author.login] | unique'
```

## 1. Set the budget

Measure it from the longest recent completed run. Never guess it.

```bash
gh run list -R OWNER/REPO --status completed -L 20 --json createdAt,updatedAt \
  --jq 'map((.updatedAt|fromdate)-(.createdAt|fromdate)) | max'
```

The budget is twice that figure in seconds, capped at 7000. If it comes out under 200, use 200, so the script's 180 second no-checks window and one 20 second poll fit inside it. If the command prints `null` because the repo has no completed runs, ask the user for a budget. Then fix the deadline and note the number it prints:

```bash
echo $(( $(date +%s) + BUDGET ))
```

Every start of `W` passes `--timeout-seconds $(( DEADLINE - $(date +%s) ))` with that literal DEADLINE in place of `<seconds>`. Restarts keep the same DEADLINE. A push starts a new CI run, so set a new DEADLINE after each push. If the deadline has passed, treat it as `TIMED_OUT`.

## 2. Choose the path

Check your tool list, including deferred tools, for what exists. Do not assume. A deferred tool must be loaded with ToolSearch before you call it, for example `select:Monitor`. The T3 tools may carry a prefix such as `mcp__t3-code__`.

| Situation | Path |
|---|---|
| `watch_pull_request` exists and you are not a delegated child task | T3 |
| Otherwise, `Monitor` exists | Monitor |
| Neither | Background |

A delegated child task (reviewer, review round, any `delegate_task` child) never calls `watch_pull_request`, even when it pushed to the PR and even when the parent asks for it. The parent thread owns the PR. A child reports the final marker and summary to its parent. Nobody watches a PR they are not working on.

T3:
1. Bash `run_in_background`, `timeout: 7200000`: `W --until registered`. End the turn.
2. On `CHECKS_REGISTERED`: call `watch_pull_request` with the URL. End the turn. On any other marker, act on it from the table and do not watch.
3. A wake is news, not a merge decision. Before calling the PR ready, run the merge gate checks yourself. `watch_pull_request` reports conflicts but not BEHIND, review bots, or unresolved threads.

In testing, `watch_pull_request` sent no wake for a PR with no checks, which is why step 1 comes first.

Monitor: `Monitor` with `command: W --until ready` (or `green`), a description naming the repo and PR, and `timeout_ms: 1800000`. Higher values are capped to 1800000. Each stdout line wakes you. When the monitor expires without a marker, start it again with the remaining seconds.

Background: Bash `run_in_background` with `timeout: 7200000`, the tool's maximum, and `W --until ready` (or `green`). You get one wake when it exits. Read every line of the output, not only the marker, because events print on the way.

Start `W` again after you push, after you fix the cause of an exit 1, and after a resume. Do not restart it on a marker you only report, such as `NO_CHECKS_REGISTERED` or `TIMED_OUT`. It keeps state in `~/.local/state/pr-wait/`, so nothing that arrived in between is lost. If it says another pid already watches the PR, do not start a second one. Kill the old one only if its events do not reach you.

When an event needs no action, end your turn without a message. Never post or say "still waiting".

## 3. Act on the marker

| Marker | Exit | Action |
|---|---|---|
| `READY`, `ALL_CHECKS_PASSED`, or a T3 pass wake | 0 | Merge if asked, using the merge gate. Otherwise report the PR is ready |
| `CHECKS_REGISTERED` | 0 | T3 step 2 |
| `MERGED` | 0 | Report it |
| `CHECKS_DONE_WITH_FAILURES`, or a T3 fail wake | 1 | The first failure ends the wait, so other checks may still run. Read `gh run view <id> --log-failed`. If that says the run is in progress, use `gh api repos/OWNER/REPO/actions/jobs/<job-id>/logs`, where the job ID ends the check link. Tell repository failures from infrastructure flakes. Do not merge |
| `NO_CHECKS_REGISTERED` | 1 | Report that CI never ran and why. Look for the reason in the `on:` triggers of `.github/workflows/*`, for example `paths-ignore` or a branch filter. Do not merge without the user's say-so |
| `CHECKS_BLOCKED_BY_REVIEW_GATE` | 1 | Report the human gate |
| `UNRESOLVED_THREADS` | 1 | Handle the threads under Reviews, then restart |
| `BEHIND`, `CONFLICTS` | 1 | Rebase, push, restart |
| `TIMED_OUT` | 1 | Report it as still pending, with the summary. Do not merge |
| `CLOSED` | 1 | Report it |
| `STOPPED` | 1 | GitHub error. Check the rate limit (below) before restarting |
| `pr-wait:` line | 2 | Bad input or a second watcher. Read the message |

## Reviews

Only act on checks and comments newer than the latest push. Verify every bot finding against the source before changing code. Fix real findings and CI failures. Reply with a written reason when dismissing a false positive, and resolve the comment. Use the `leaving-pr-comments` skill for every comment posted on the user's behalf.

If the repo has `.macroscope/check-run-agents/*.md`, read those rules before you reply to a Macroscope finding. Its findings cite them. CodeRabbit is advisory. Treat its findings like any other, but never wait for it and never hold a merge for it.

Keep the PR at the size the user's goal needs. Review loops tend to grow a PR one cheap-looking fix at a time. Fix real bugs in the intended case. Decline the rest with a written reason and list them as follow-ups: unneeded tests, guards for edge cases that do not matter, extra integration or compatibility, small performance costs. Prefer the fix that deletes or narrows code.

If an overlapping PR makes this one obsolete, stop watching, report it, and ask before closing the PR unless closure was explicitly authorized.

## Merge gate

Run these checks before calling a PR ready, and again right before a merge:

1. In a clone, run `git fetch`.
2. Run `gh pr view N -R OWNER/REPO --json mergeStateStatus,headRefOid`. The status must be `CLEAN`. BEHIND or DIRTY means rebase, push, and wait for green again. So do base commits that landed after the last green run and touch this PR's files.
3. After `ALL_CHECKS_PASSED` or a T3 wake, count unresolved threads. It must print 0:

```bash
gh api graphql -F n=N -f query='query($n:Int!){repository(owner:"OWNER",name:"REPO"){pullRequest(number:$n){reviewThreads(last:100){nodes{isResolved}}}}}' \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)] | length'
```

Merge only when the user asked for it, with `gh pr merge N -R OWNER/REPO --match-head-commit <headRefOid>` and the merge method recent merged PRs in the repo used. Otherwise report that the PR is ready.

If `gh api repos/OWNER/REPO --jq .allow_auto_merge` is true and the user wants a merge, also run `gh pr merge N -R OWNER/REPO --auto --match-head-commit <sha>` as soon as you start watching. Still wait, so failures get reported.

Stop watching when you hand off: ready, blocked, or asking the user a question. In T3, call `unwatch_pull_request` if you called `watch_pull_request`. A watched thread stays in Working and out of the user's inbox. A merge or close ends the watch on its own. On the Monitor path, stop a monitor that is still running with `TaskStop`.

## GitHub rate limits

`gh pr create`, `gh pr view`, and `gh pr checks` use GraphQL. When GraphQL is used up, the REST limit is separate and usually still has room. Read a PR with `gh api repos/OWNER/REPO/pulls/N` and checks with `gh api repos/OWNER/REPO/commits/<sha>/check-runs`.

"Stopped watching, could not read it" from T3, or `STOPPED` from `W`, usually means the GraphQL limit is used up. Run `gh api rate_limit --jq .resources.graphql`. If `remaining` is near 0, wait for `reset` with one background command, then watch again. Never watch again in a tight loop.

## Never

| Pattern | Why it fails |
|---|---|
| Foreground `gh pr checks --watch` or `gh run watch` | No deadline. Blocks the turn and streams pending lines into context |
| `W` in the foreground | Blocks the turn. The `guard-ci-wait` hook denies it |
| `until ...; do sleep N; done`, or polling a background task's output file | Blocks the turn and duplicates the notification you already get |
| `watch_pull_request` and `W` on the same PR | Two watchers, double the rate limit use |
| `timeout_ms: 3600000` on Monitor | Capped to 1800000. Plan to re-arm instead |
| `sleep 10` before watching, `timeout 1500`, or any invented deadline | Use the measured budget |
| Treating exit 1 from `gh pr checks` as failure | It also means "no checks yet" |
| Merging with no checks because nothing failed | No CI is not a pass |
