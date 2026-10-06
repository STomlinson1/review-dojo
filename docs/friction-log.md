# Workflow friction log

One entry per run of the feature workflow: what dragged, what it cost, and a proposed fix.

## 2026-10-05, TOM-41 end-to-end test harness

- **The plan stage built the feature.** "Complete code in every step" for a 4,000-line harness led the planner
  to write and run the whole suite in a scratch copy (about 70 minutes), and the critic ran it all again.
  Implementation then transcribed proven code through ten implementer and reviewer cycles. Proposed fix: when a
  plan's code has been executed end to end, let the workflow promote that code in a few coarse tasks, each
  still reviewed, instead of one task per plan section.
- **One named mutation per task was not enough.** The plan proved one or two tests per task could fail;
  reviewers raised the missing evidence for the rest on Tasks 3 and 5 until a coordinator ruling from Task 4 on
  required a mutation per new test. Proposed fix: plan doctrine requires a named mutation for every test in a
  suite that pins existing behaviour.
- **Keeping the plan identical to the code after approval.** Every fix wave edited the plan's embedded copy as
  well as the file, and one fix left a file unformatted because the plan copy was edited by hand. Proposed fix:
  after the critic approves, the plan is a record; fix waves change code only.
- **Run workspace split across checkouts.** `sdd-workspace` resolves per repository root, so briefs and reviews
  landed in the worktree's `.sdd` while research, spec and the ledger sat in the main checkout's. Proposed fix:
  resolve the workspace from the main checkout (`git rev-parse --git-common-dir`).
- **Orca environment.** The `orca` symlink on PATH was unreadable (fixed by the owner with `chmod -h`). The
  setup hook in new worktrees lost its first character to oh-my-zsh's update prompt and never ran
  `npm install`. One worker stopped on "Auto mode is unavailable: no safety verdict" and needed a nudge.
  `orchestration check --json` can emit raw control characters that `jq` rejects; parse it non-strictly.
  Proposed fix: record these in the project's working notes (TOM-43) and disable the shell's update prompt.
- **No cost total.** Orca workers do not report token use to the coordinator, so the ledger has no per-run
  number. Proposed fix: have each worker put its session cost in its completion message.
