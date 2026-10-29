# Universe Inspector: notes for Claude

General working style, git, and model rules live in `~/.claude/CLAUDE.md` (the claude-config repo).

Procedural universe sim in a retro Windows inspection-tool window. TypeScript + Vite, web-first.
Read `README.md` for architecture and `ROADMAP.md` for the idea backlog. Add new ideas to the
Roadmap Inbox when the user mentions them.

## Rules of the codebase

- `src/core/` is pure: no DOM, no theme words. It emits ids (`temperate`, `home`, `birth`) and name keys
  (numbers); packs in `src/packs/` turn those into words and names.
- Everything generated is a pure function of `(seed, path)`. Never use `Math.random()` in core.
  Only changes are stored (`DeltaStore`).
- The sim only knows ticks. Speed buttons just call `step()` more often.
- Never call the rng inside a `sort` comparator, or depend on engine-specific ordering: Node and browsers call
  comparators in different orders, so one seed gives different worlds. Shuffle with Fisher-Yates.
- `core/life.ts` (people) and `core/town.ts` (district layout) are pure too: functions of (seed, path[, week]), so
  looking late equals watching all along. The selftest enforces it; keep it passing. `Math.random()` is allowed
  in `src/ui/` only (the dialog's Random button).
- Skin (CSS variables) vs content pack vs feature sets are three separate things; keep them separate.
- Keep kinds of state separate: world state (seed + deltas), settings (skin, pack, features), transient UI state.
- Extend through packs/skins/feature sets (adapter style), not hardwired branching in core.
- Sim rules and their constants are recorded in the Wiki's Model notes page (`../universe-inspector.wiki/Model-Notes.md`)
  as sourced (a published model), observation, or stand-in. When a rule or constant changes, update that page in the same push.

## Commands

- `npm run dev` dev server, `npm test` core invariants, `npm run build` typecheck + static build.
- Run `npm test` and `npm run build` after changes to `src/core/`.
- Scope follow-ups go in `ROADMAP.md`.

## Versions

- Run everything through `scripts/run.cmd` (Windows) or `scripts/run.sh`, which use the repo-local Node in
  `.node/` (made by `scripts/setup.*`). Don't rely on or install a system Node. `.nvmrc` holds the exact
  version and is the single source of truth; `.devcontainer/` must follow its major.
- Node is pinned to the current LTS line (24, `.nvmrc` + `engines`). Dependencies are exact versions
  (`.npmrc` has `save-exact`); `@types/node` tracks the Node major, not latest.

## Subagents

- Brief a subagent as a colleague with no memory: don't commit, don't touch README/ROADMAP, never wipe
  shared temp dirs.

## Git and commits

- Before each commit, in order: tests for the changed behavior -> `npm test` + `npm run build` -> update docs
  -> commit. If too small for a test, say why.
- Docs ride with the code: README / ROADMAP updates go in the same commit as the change, unasked. Say which
  docs changed.
- Docs-only changes go straight to `main`: no review, Issue or PR.
- Push that sha explicitly (`git log --oneline origin/<branch>..<sha>` first), never a local `main` that may be ahead.
  If the user allows a direct push to `main` once, that covers that push only.
- Remote: GitHub `joshg253/universe-inspector` (`origin`). Commits are SSH-signed with a repo-local, passphrase-less
  key (`user.signingkey` in `.git/config`; the private key lives in `~/.ssh`, never in the repo; add the public key on
  GitHub as a *signing* key so commits show Verified). The author email is GitHub's noreply address (global config).
  Push over HTTPS through `gh` if the SSH key is not registered for pushing. Never put tokens in the repo or in chat:
  `gh` keeps its login in the OS keyring (or `GH_TOKEN` in the environment).
- User-testable work: commit locally -> build -> user tests -> push -> PR. A commit is not a build: after
  `npm run build`, grep `dist/` for a new symbol before telling the user to test.

## Issues and pull requests

The owner reports bugs and ideas in the session, so the public view is clean: one Issue, one branch, one PR each.

1. **When the owner says it is ready (or just "push"), run the whole sequence, in order, without further prompts:**
   1. Tests for the changed behavior added or updated; `npm test` and `npm run build` green.
   2. Docs updated in the same change and listed at the end: README, ROADMAP, CLAUDE.md, and the Wiki (a separate clone,
      `../universe-inspector.wiki`) where behavior, controls or screenshots changed. Retake screenshots that changed.
   3. Independent review (step 2), findings verified and fixed, the fixes re-tested.
   4. An Issue written after the fact (what was reported, expected vs actual, cause, fix, how it was verified; no chat
      narrative, no private names), a `fix/<slug>` or `feat/<slug>` branch, signed commit(s) with `Closes #N`, push the
      branch, open the PR (same facts, how to test, a line that it was AI-reviewed), then read the checks.
   5. Push the matching Wiki commit last.
   The owner's "push" covers exactly this: that branch, its Issue and PR, and its Wiki commit. Nothing else.
2. **Independent review before the PR.** Spawn a fresh-context reviewer subagent (`model: opus`; give it only the diff,
   the Issue text and the relevant rules, not the conversation) and ask for correctness bugs, determinism breaks,
   missing tests and docs drift. Verify each finding, fix what is valid, say what was declined and why. State in the
   PR that this was an AI review, not an external one. Use the `code-review` skill when the owner asks for it.
3. **Drive it with `gh`**: `gh issue create`, `gh pr create`, `gh pr checks`, `gh run view --log-failed`,
   `gh pr view --comments`, `gh pr comment`. Never `gh pr merge`.
4. **Watch CI and review comments** after opening: failed job logs via `gh run view --log-failed`, comments via `gh pr view`. Fix what
   is valid on the same branch with a regression test, reply, then resolve the thread (`resolveReviewThread` through `gh api graphql`,
   thread ids from `reviewThreads`).
5. Ideas that are not concrete work go in `ROADMAP.md`, not the issue tracker.

## Docs conventions

- `README.md`: user-visible behavior and architecture overview. `ROADMAP.md`: open ideas and deferred work
  only, no investigation narrative. Finished items get ticked or removed.
- Be terse: docs are re-read into context every session. State the trap, the fix, and the one constraint that
  stops someone undoing it. Tables and code beat prose. One fact stated once.

## Debugging and verification

- Edit scripts: read, apply all replacements in memory, write once at the end.
- Be a polite client when calling external endpoints in ad-hoc debugging: paced requests, no looped probing.
- Don't `pkill` by name pattern or wipe shared temp dirs; use the project's own cleanup.
- For determinism bugs, reproduce with a fixed seed in `scripts/selftest.ts` first, then fix.

## Screenshots

- With the dev server up, `scripts/run.cmd node scripts/shot.mjs "<url>" out.png` takes a screenshot via headless Edge.
  URL params pick the state: `?skin=beos&pack=fantasy&seed=abc&view=s0/b0&ticks=2000`, plus `&sel=<path>&tab=results`
  to open a record, `&menu=1` for the Start menu and `&dialog=new` for the New universe dialog. `SHOT_TEXT=1` also
  prints the active panel's text. Send results with SendUserFile.
  Quote the URL (it contains `&`).

## Caveat

The UI is checked by screenshots (see above), not by automated tests: `npm test` covers `src/core/` only. Of the
skins, Amiga, Classic Mac, Windows 3.1 and BeOS were matched against reference screenshots; 2000, XP and Flat were not.
