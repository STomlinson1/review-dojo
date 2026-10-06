# Review Dojo — design

Review Dojo is a local macOS app that gives a guided, comprehension-first tour of a GitHub
pull request. The goal is that the reviewer _understands_ the change, not that an agent
approves it.

## Principles

1. **Understanding before findings.** The tour explains; the reviewer judges. Predict-then-reveal
   ("Dojo mode") makes the reviewer commit to a reading before seeing the agent's.
2. **Grounded.** Every stop references concrete diff hunks and repo locations. The agent explores
   the checked-out repo (read-only) instead of reasoning from the diff alone.
3. **Complete.** Every hunk in the diff appears in exactly one stop. Hunks the agent forgets are
   collected into a trailing chapter by the engine, never dropped.
4. **The reviewer is the author.** Comments are drafted locally and submitted as a _pending_
   GitHub review that the reviewer finalizes.
5. **Local.** No server. Traffic leaves the machine only to GitHub and to the chosen LLM provider.

## Architecture

```
src/shared     Types shared by every layer (PR, diff, tour, review state, IPC contract).
src/engine     Pure Node library: gh/git access, diff parsing, stack detection, providers,
               tour prompting + normalization, persistence. No Electron imports.
src/cli.ts     `review-dojo tour <pr-url>` — runs the engine headless and prints tour JSON.
src/main       Electron main: window, IPC handlers that delegate to the engine, key storage.
src/preload    contextBridge exposing the typed `DojoApi`.
src/renderer   React UI.
e2e/harness    Hermetic launcher and stand-ins for every process boundary (gh, git remotes, model APIs, keychain).
e2e/support    Playwright fixture and page helpers.
e2e/specs      End-to-end specs (*.e2e.ts), one file per flow group.
e2e/cli.ts     `npm run e2e:app` — the same hermetic app, driven one shell command at a time by an agent.
```

### Data flow

1. Resolve PR (`gh pr view --json`) and its stack: GitHub's native stack when present, otherwise the
   chain of open PRs linked by base/head branches.
2. Sync a managed blobless clone under app data; fetch the PR head and base; create a detached
   worktree at the head SHA.
3. Diff `merge-base(base, head)..head` (what GitHub shows), parse into files and hunks with
   stable ids.
4. Before the first tour of a repository (then every 14 days, or on demand from the Overview), the
   provider distills team review lessons from its recent review comments. The tour prompt carries those lessons, open review
   threads, and the files changed since the reviewer's last review of the PR.
5. Provider agent runs in the worktree with read-only tools and returns a `Tour` (JSON schema). The
   JSON streams; the engine closes the truncated document and previews every fully written stop.
6. Engine normalizes the tour against the diff (drops unknown hunk ids, dedupes, appends
   uncovered hunks) and caches it by head SHA + provider.
7. Follow-up questions resume the same agent session and stream their answers.
8. Drafted comments become one pending review via `gh api`. Each review records a content digest per
   file, so a later push can report exactly which files changed since the reviewer looked.

### Providers

Each provider runs a read-only agent in the worktree and supports both API-key and subscription
auth. See `src/engine/providers`.

### End-to-end tests

The suite launches the built app (never the dev server, so the `app://` origin and the IPC sender check are
real) and replaces what lies beyond each process boundary, through the environment and a per-test user data
directory only; `src/` has no test-only branch.

- **GitHub:** a fake `gh` first on `PATH` replays replies scripted per test, keyed on the exact argument shape,
  logs every call with its stdin, and fails anything unscripted. `SHELL` is a stub so login-shell `PATH`
  adoption cannot reorder it.
- **Git:** real `git`; `https://github.com/` is rewritten to bare repositories built for the run.
- **Models:** the real bundled `claude` and `codex` binaries talk to one local mock of both APIs, scripted as a
  queue of turns. The mock is also the proxy for every process, so any connection beyond loopback is refused,
  recorded, and fails the test.
- **Keychain:** a `security` stand-in on `PATH` finds nothing, so the Claude CLI's credential lookup never
  reaches the login keychain.
- **Main process:** two preloads keep the window from taking focus and record `shell.openExternal` calls.

Every test gets its own run directory and asserts what the user sees and what reached `gh`. `npm run e2e:app`
runs the same launcher detached for agent-driven verification.
