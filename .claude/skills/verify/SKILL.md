---
name: verify
description: Launch the built Review Dojo with every outside service replaced, drive a flow one shell command at a time, observe it, take a screenshot, and stop it. Use to verify a change in the real app, or whenever the feature workflow reaches its verify step.
---

# Verify a change in the running app

The app you start here is hermetic: a fake `gh`, local git remotes, a local mock of both model APIs, and a
`security` stand-in that keeps the login keychain out of reach. It never contacts GitHub or a model provider and
never uses your logins. Do not launch the app any other way (`npm run dev`, `npm start`) for verification.

## 1. Build and start

```sh
npm run build
RUN="$(mktemp -d)/run"
npm run --silent e2e:app -- start "$RUN"
```

`start` prints one JSON line and returns; the app keeps running in the background without taking focus. It
comes up signed in to GitHub as `octo-reviewer`, with Claude as the guide and the fixture pull request
`acme/widget#7` ready to open (3 files: `src/farewell.ts`, `src/greet.ts`, `src/util/math.ts`).

Rebuild and restart after every source change; `start` never builds. Do not run the suite while an agent
session is open; `npm run test:e2e` rebuilds the fixtures.

## 2. Drive it one step at a time

```sh
npm run --silent e2e:app -- step "$RUN" '<body of an async function>'
```

The body has `page` (a Playwright `Page`), `expect`, and the suite's helpers `diff` (`e2e/support/diff.ts`) and
`review` (`e2e/support/review.ts`) in scope. Whatever it returns is printed. A failing step exits 1 and prints
the locator it waited for; actions time out after 5 s.

```sh
# open the fixture pull request
npm run --silent e2e:app -- step "$RUN" "await page.getByLabel('Open a pull request').fill('acme/widget#7'); await page.getByRole('button', { name: 'Open', exact: true }).click(); await expect(page.getByRole('button', { name: 'Generate tour' })).toBeVisible()"

# see what is on screen
npm run --silent e2e:app -- step "$RUN" "return await page.locator('body').ariaSnapshot()"

# draft a comment on added line 3 of src/greet.ts
npm run --silent e2e:app -- step "$RUN" "const card = review.fileCard(page, 'src/greet.ts'); await diff.startComment(card, 'addition', 3); await diff.commentBox(card).fill('Why?'); await card.getByRole('button', { name: 'Add comment' }).click()"
```

Locate by role and accessible name, as the specs in `e2e/specs` do. Lines inside a diff live in a shadow root:
use the `diff` helpers for them, never your own selectors. A name that matches two elements is an error, not a
guess: scope the locator (`review.fileCard(page, path)`, `page.getByRole('dialog', { name: 'Review' })`).

## 3. Script what the outside world says

A model call with no scripted turn, and a `gh` call with no scripted reply, both fail on purpose.

```sh
# queue model turns (consumed in order; "expect" must appear in the request's last user or tool-output item)
npm run --silent e2e:app -- turns "$RUN" '[{"provider":"claude","expect":"Prepare a guided tour","text":"<tour JSON>"}]'

# set a fake gh reply for one route (see the route list in e2e/harness/gh-fake.ts)
npm run --silent e2e:app -- gh "$RUN" "submit acme/widget#7" '{"stdout":"{\"html_url\":\"https://github.com/acme/widget/pull/7#pullrequestreview-1\"}"}'
```

Prompt markers: a tour request contains `Prepare a guided tour`; a repair request `Your tour could not be used`;
a lessons request `Distill the recurring expectations`; a question, grade or polish request contains the text
you typed. For a full tour, copy the shape from `widgetTour` in `e2e/harness/tour.ts`; hunk ids are in
`e2e/.artifacts/manifest.json`. A turn with `"hold": true` stays open until
`npm run --silent e2e:app -- release "$RUN"`.

## 4. Observe

```sh
npm run --silent e2e:app -- step "$RUN" "await page.screenshot({ path: '$RUN/shot.png' })"
npm run --silent e2e:app -- state "$RUN"
```

Read the screenshot file to look at it. `state` prints every `gh` call with the stdin it received (the review
payload is the stdin of the `submit` call), the links the app tried to open, and three lists that must be empty
when you are done: `unexpected` (model requests nobody scripted), `ghUnscripted`, and `blocked` (connections
attempted beyond loopback; `avatars.githubusercontent.com:443` is the only expected entry, from the home
screen's avatars).

## 5. Stop

```sh
npm run --silent e2e:app -- stop "$RUN"
```

Always stop the app you started, also after a failed step. `pgrep -fl "$RUN"` must print nothing afterwards.

## What to report

The steps you ran, what `state` showed at the end, and the screenshot path. If the flow you verified is not
already covered by a spec in `e2e/specs`, say so: a verified step sequence pastes into a spec unchanged.
