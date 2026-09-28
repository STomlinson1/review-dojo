# Docent — design

Docent is a local macOS app that gives a guided, comprehension-first tour of a GitHub
pull request. The goal is that the reviewer *understands* the change, not that an agent
approves it.

## Principles

1. **Understanding before findings.** The tour explains; the reviewer judges. Predict-then-reveal
   ("Dojo mode") makes the reviewer commit to a reading before seeing the agent's.
2. **Grounded.** Every stop references concrete diff hunks and repo locations. The agent explores
   the checked-out repo (read-only) instead of reasoning from the diff alone.
3. **Complete.** Every hunk in the diff appears in exactly one stop. Hunks the agent forgets are
   collected into a trailing chapter by the engine, never dropped.
4. **The reviewer is the author.** Comments are drafted locally and submitted as a *pending*
   GitHub review that the reviewer finalizes.
5. **Local.** No server. Traffic leaves the machine only to GitHub and to the chosen LLM provider.

## Architecture

```
src/shared     Types shared by every layer (PR, diff, tour, review state, IPC contract).
src/engine     Pure Node library: gh/git access, diff parsing, stack detection, providers,
               tour prompting + normalization, persistence. No Electron imports.
src/cli.ts     `docent tour <pr-url>` — runs the engine headless and prints tour JSON.
src/main       Electron main: window, IPC handlers that delegate to the engine, key storage.
src/preload    contextBridge exposing the typed `DocentApi`.
src/renderer   React UI.
```

### Data flow

1. Resolve PR (`gh pr view --json`) and its stack: GitHub's native stack when present, otherwise the
   chain of open PRs linked by base/head branches.
2. Sync a managed blobless clone under app data; fetch the PR head and base; create a detached
   worktree at the head SHA.
3. Diff `merge-base(base, head)..head` (what GitHub shows), parse into files and hunks with
   stable ids.
4. Provider agent runs in the worktree with read-only tools and returns a `Tour` (JSON schema).
5. Engine normalizes the tour against the diff (drops unknown hunk ids, dedupes, appends
   uncovered hunks) and caches it by head SHA + provider.
6. Follow-up questions resume the same agent session.
7. Drafted comments become one pending review via `gh api`.

### Providers

Each provider runs a read-only agent in the worktree and supports both API-key and subscription
auth. See `src/engine/providers`.
