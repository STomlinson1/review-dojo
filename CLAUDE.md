# Review Dojo

A local macOS Electron app that tours a GitHub pull request so the reviewer understands it before reviewing
it. [README.md](README.md) says what it does; [docs/DESIGN.md](docs/DESIGN.md) says how it is built.

## Commands

```sh
npm run typecheck
npm test                  # unit
npm run test:e2e          # builds the app, then drives it with every outside service replaced
npm run test:e2e:watched  # the same suite under an outbound-connection watcher
npm run format
```

In a fresh worktree run `npm install` and then `node node_modules/electron/install.js` yourself; the Orca setup
hook is unreliable (see Snags).

Launch the app only through the `verify` skill (`.claude/skills/verify/SKILL.md`). Tests and verification never
contact GitHub or a model provider and never use the owner's `gh`, `claude` or `codex` logins.

## How work is run

Tracking is in Linear: project "Review Dojo" (P-TOM-2), team "Tomlinson projects" (key TOM). Orca's own Linear
connection is not set up; use the Linear MCP tools.

- **One ticket, one run.** A ticket is one `feature-workflow` run in its own Orca worktree, led by its own
  orchestrator session. Move the ticket to In Progress when the run starts, publish the spec as its description,
  set In Review at handoff with the evidence summary, and close it only after the owner approves the merge.
- **The main session coordinates.** The owner talks to the orchestrator in the main checkout. A ticket
  orchestrator's hard stops (grill questions, plan approval, merge) go to the owner through that session, each
  with a recommendation. An answer that arrives by relay is listed again at plan approval for the owner to
  confirm.
- **All subagent work is a supervised Orca worker**, never the built-in Agent tool. Load the guides first
  (`orca skills get orca-cli`, `orca skills get orchestration`). Name the model and effort on every dispatch, using the
  tiers in the `feature-workflow` skill. One implementer at a time per worktree; reviewers are read-only. Panel
  reviewers are plain workers told to follow `~/.claude/agents/<correctness|architecture|polish>-reviewer.md`.
- **Tickets that change the renderer store or the engine's storage are implemented one at a time.** Research
  and planning for the next ticket may overlap the current one's implementation.
- **A brief is self-contained.** A session in another worktree sees this file but none of the main session's
  memory or conversation.

### Records

- `.sdd/` is git-ignored and exists per checkout. The ledger (`.sdd/progress.md`) and the cost record
  (`.sdd/costs.tsv`) are the main checkout's; a run's briefs, reports and reviews are in its worktree's
  `.sdd/<ticket>/`. Append to the ledger one line per completed task and per verify, panel and merge outcome.
  After a compaction or a resume, trust the ledger and `git log` over recollection.
- Keep the worktree comment current: `orca worktree set --worktree active --comment "<ticket>: <state>"`.
- Each run appends a dated entry to `docs/friction-log.md` at handoff.

### Helpers

`tools/orca/` holds the parts of the coordinator loop that are the same for every run:

- `wait [timeout-ms]` blocks until a worker finishes, asks or escalates, acknowledging heartbeats on the way.
- `settle TICKET LABEL DISPATCH DELIVERY HANDLE` records the worker's session cost, releases it and
  acknowledges its delivery. Settle every worker this way; a released terminal exits and its cost is gone.
- `cost [TICKET]` totals the record. Put the ticket's total in the ledger and the friction log at handoff.

The cost is the figure on the worker's Claude Code status line, so it depends on a status line that prints
`total_cost_usd`; on a subscription sign-in it is an API-price estimate, not a charge.

### Snags

- `orca ... --json` output can contain raw control characters. Parse it with `json.loads(text, strict=False)`
  (`tools/orca/lib.py` does); `jq` rejects it.
- A new terminal can open on the oh-my-zsh update prompt, which swallows the first keystrokes sent to it,
  including the worktree setup hook. Answer `n` and relaunch.
- A worker can stop on "Auto mode is unavailable". Nudge it:
  `orca terminal send --terminal <handle> --text "please continue" --enter`
- An open Claude Code dialog in a worker's terminal swallows input until dismissed with Escape. Read the
  terminal before sending to it: an unsent draft in its input box is submitted along with your text.
- `worker-release` can answer `retained` with reason `user_takeover` when the owner has opened that terminal.
  Nothing is owed if `orca orchestration worker-list --terminal-state reclaimable` is empty.
- Only one `check --wait` can hold a run at a time; a second returns `waitInterrupted: waiter_exists`.

## Changes to the feature workflow for this project

These override the `feature-workflow` skill's plan doctrine where they differ.

- **A plan does not build the feature.** "Complete code in every code step" applies to interfaces, signatures,
  schemas and any logic whose correctness is the point of the task. It does not license writing and running
  the whole change in a scratch copy at plan time. For a refactor or a move, describe the move exactly (from,
  to, what the callers see) instead of embedding the code.
- **Tasks are coarse.** A task is the smallest unit that carries its own test cycle and deserves a fresh
  reviewer; three to six per ticket is normal. If a spike has already proven code end to end, promote it in a
  few reviewed tasks instead of one task per plan section.
- **After the critic approves, the plan is a record.** Fix waves change code only and never edit the plan to
  match.
- **Every test that pins existing behaviour names its mutation** in the plan: the one-line break of `src/`
  that makes it fail. The implementer shows the failure.
- **For a behaviour-preserving refactor the existing suites are the tests.** Add a test only for state the
  move touches and no suite observes.
