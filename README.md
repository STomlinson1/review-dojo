# Docent

A local macOS app that walks you through a GitHub pull request so you actually understand it before
you review it. Built for the era of agent-written code, where review, not authoring, is the bottleneck.

Docent checks out the PR, lets an agent (Claude or Codex) explore the repository read-only, and turns
the diff into a guided tour:

- **Chapters ordered by how the change works**, not by file name. Each stop groups the hunks you need
  to understand together, explains what changed and why, and links to the code outside the diff you
  should read.
- **Every hunk is covered.** Anything the agent skips lands in a "Not covered" chapter.
- **Intent check.** What the PR claims to do, whether it does it, and which changes nothing in the
  description justifies, the scope creep that agent-written PRs are prone to.
- **Convention radar.** Places where the change departs from how the repository already solves the
  same problem, with precedents.
- **Specific checks and a comprehension question per stop.** Dojo mode hides the analysis until you
  commit to your own reading, then grades it and names your blind spots.
- **Ask about the current stop.** Follow-ups resume the agent session that built the tour, so answers
  draw on everything it already explored.
- **You stay the author.** Draft comments on diff lines, optionally polish them, and submit them as a
  pending GitHub review that you finalize on GitHub.
- **Stack-aware.** Uses GitHub's native stacked PRs when present, otherwise reconstructs the stack
  from branch bases.

Nothing runs on a server. Traffic goes only to GitHub and to the model provider you choose.

## Requirements

- macOS on Apple silicon or Intel, Node 22+.
- [GitHub CLI](https://cli.github.com), signed in: `gh auth login`.
- One model provider, either:
  - **Claude** with an Anthropic API key, or your own Claude subscription via `claude auth login`.
  - **Codex** with an OpenAI API key, or your ChatGPT plan via `npx @openai/codex login`.

Subscription sign-in is for your own individual use on your own machine; Anthropic requires API keys
for anything offered to other people.

## Run

```sh
npm install
npm run dev          # development
npm run package      # builds dist/mac-*/Docent.app (unsigned; drag it to /Applications)
```

If `npm run dev` reports that Electron failed to install, its download step was skipped; run
`node node_modules/electron/install.js`.

Headless, for scripting or CI:

```sh
npm run cli -- tour https://github.com/owner/repo/pull/123 --provider claude > tour.json
```

## How it works

See [docs/DESIGN.md](docs/DESIGN.md). Clones, worktrees, tours and review progress live in
`~/Library/Application Support/Docent`. API keys are encrypted with the macOS keychain.

```sh
npm test             # unit tests
npm run typecheck
```
