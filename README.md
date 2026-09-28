# Review Dojo

A local macOS app that walks you through a GitHub pull request so you actually understand it before
you review it. Built for the era of agent-written code, where review, not authoring, is the bottleneck.

Review Dojo checks out the PR, lets an agent (Claude or Codex) explore the repository read-only, and turns
the diff into a guided tour:

- **Chapters ordered by how the change works**, not by file name. Each stop groups the hunks you need
  to understand together, explains what changed and why, and links to the code outside the diff you
  should read.
- **Every hunk is covered.** Anything the agent skips lands in a "Not covered" chapter.
- **Intent check.** What the PR claims to do, whether it does it, and which changes nothing in the
  description justifies, the scope creep that agent-written PRs are prone to.
- **Convention radar.** Places where the change departs from how the repository already solves the
  same problem, with precedents, including its contributor guidance (CONTRIBUTING, AGENTS.md,
  CLAUDE.md).
- **Team review lessons.** Recurring expectations distilled from the repository's own past review
  comments ("use the shared test utilities", "fix bundler issues upstream"), cached per repository and
  applied to every tour.
- **Specific checks and a comprehension question per stop.** Dojo mode hides the analysis until you
  commit to your own reading, then grades it and names your blind spots.
- **Side by side.** The whole PR diff next to the narration, every hunk labeled with the stop that
  explains it; selecting a stop scrolls to it, and scrolling shows which stop you're reading.
- **Readable while it's written.** Stops appear as soon as the agent finishes writing them.
- **Ask about the current stop or selected lines.** Follow-ups resume the agent session that built the
  tour, so answers draw on everything it already explored, and stream in as they're written.
- **Existing discussion inline.** GitHub review threads appear in the diff, and the tour avoids
  repeating what reviewers already raised.
- **What changed since your last review.** When the author pushes again, the files whose changes
  differ from what you saw are flagged, and unsent drafts carry over.
- **Shareable.** Copy the tour as a Markdown reviewer's guide.
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
npm run package      # builds dist/mac-*/Review Dojo.app (unsigned; drag it to /Applications)
```

If `npm run dev` reports that Electron failed to install, its download step was skipped; run
`node node_modules/electron/install.js`.

Headless, for scripting or CI:

```sh
npm run cli -- tour https://github.com/owner/repo/pull/123 --provider claude > tour.json
```

## How it works

See [docs/DESIGN.md](docs/DESIGN.md). Clones, worktrees, tours and review progress live in
`~/Library/Application Support/Review Dojo`. API keys are encrypted with the macOS keychain.

```sh
npm test             # unit tests
npm run typecheck
```
