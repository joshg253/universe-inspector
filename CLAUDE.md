# Universe Inspector: notes for Claude

Procedural universe sim in a retro Windows inspection-tool window. TypeScript + Vite, web-first.
Read `README.md` for architecture and `ROADMAP.md` for the idea backlog. Add new ideas to the
Roadmap Inbox when the user mentions them.

## Rules of the codebase

- `src/core/` is pure: no DOM, no theme words. It emits ids (`temperate`, `home`, `birth`) and name keys
  (numbers); packs in `src/packs/` turn those into words and names.
- Everything generated is a pure function of `(seed, path)`. Never use `Math.random()` in core.
  Only changes are stored (`DeltaStore`).
- The sim only knows ticks. Speed buttons just call `step()` more often.
- `core/life.ts` (people) and `core/town.ts` (district layout) are pure too: functions of (seed, path[, week]), so
  looking late equals watching all along. The selftest enforces it; keep it passing. `Math.random()` is allowed
  in `src/ui/` only (the dialog's Random button).
- Skin (CSS variables) vs content pack vs feature sets are three separate things; keep them separate.

## Commands

- `npm run dev` dev server, `npm test` core invariants, `npm run build` typecheck + static build.
- Run `npm test` and `npm run build` after changes to `src/core/`.

## Working style

- Act, don't ask. Ask first only when a wrong guess is expensive to undo; otherwise proceed and state the assumption.
- Finish multi-part requests end to end; no "want me to?" for work that plainly follows from the request.
- Confirm first for irreversible or outward-facing actions (deleting data, pushing, publishing).
- Be concise: short plain answers, no recap unless the change is multi-file or non-obvious. For multi-file or
  behavior-changing work, give a short plan before editing.
- Scope discipline: fix true blockers and small same-path, low-risk items. Everything else is a follow-up in
  `ROADMAP.md`, not folded into the current change. End with: requested / additionally fixed / deferred.
- American English spelling in prose, comments, docs, and commit messages.
- Prefer what Vite/TypeScript/the platform already provide over custom code. No new dependency without a reason.
- Keep kinds of state separate: world state (seed + deltas), settings (skin, pack, features), transient UI state.
- Extend through packs/skins/feature sets (adapter style), not hardwired branching in core.

## Versions

- Run everything through `scripts/run.cmd` (Windows) or `scripts/run.sh`, which use the repo-local Node in
  `.node/` (made by `scripts/setup.*`). Don't rely on or install a system Node. `.nvmrc` holds the exact
  version and is the single source of truth; `.devcontainer/` must follow its major.
- Node is pinned to the current LTS line (24, `.nvmrc` + `engines`). Dependencies are exact versions
  (`.npmrc` has `save-exact`); `@types/node` tracks the Node major, not latest.
- Don't bump Node or dependencies unprompted. Upgrade only for a concrete reason (security fix, needed
  feature, EOL) and say what the reason is.

## Models and subagents

- Work on the main session directly for normal implementation, refactors, tests, docs. Don't ask the user to
  switch models for one hard step; `/model` resends history and drops the prompt cache.
- Subagents start cold, so small tasks are cheaper inline. Delegate only to keep bulk reading out of the main
  context (broad searches, log trawls, bulk mechanical edits) or for a sub-task needing deeper reasoning.
- Always pass an explicit `model`: `haiku` for search/mechanical work, `sonnet` for implementation-sized
  sub-tasks, `opus` for architecture or gnarly debugging (return a plan/diagnosis, execute on the main thread).
  Never `fable` unless asked.
- Brief a subagent as a colleague with no memory: don't commit, don't touch README/ROADMAP, never wipe
  shared temp dirs.
- If the user says credits are low: batch work, skip exploratory greps, hand over copy-pasteable command
  blocks, keep prose short.

## Git and commits

- Commit messages: subject plus a few lines, one long line per paragraph, no hard wraps. Detail belongs in the diff.
- Before each commit, in order: tests for the changed behavior -> `npm test` + `npm run build` -> update docs
  -> commit. If too small for a test, say why.
- Docs ride with the code: README / ROADMAP updates go in the same commit as the change, unasked. Say which
  docs changed.
- Docs-only changes go straight to `main`, no MR. Never merge MRs or push a merge to `main`; merging is the
  user's call.
- Before any push, run `git log --oneline origin/<branch>..<what you push>` and confirm every commit is meant
  to go out.
- Never push without the user's explicit say-so, each time. Earlier approval doesn't carry over. If the user
  allows a direct push to `main` once, that covers that push only.
- During back-and-forth on one change (bug report, fix, retest), don't commit per round. Leave edits in the
  working tree until the user says the thought is done, then make one clean commit. If a commit already
  exists for that change and is unpushed, amend it instead of stacking fix-ups; never amend once pushed.
- Keep merge requests small and single-purpose. After opening one, watch CI and review comments; verify each
  comment, fix what is valid with a regression test, reply, resolve. Merging is the owner's call.
- Remote: GitLab `joshg253/universe-inspector` (`origin`). Commits are SSH-signed with a repo-local, passphrase-less
  key (`user.signingkey`, `core.sshCommand` in `.git/config`; the private key lives in `~/.ssh`, never in the repo).
  Author email is the GitLab noreply address, set locally; the global git config stays on GitHub's.
  Never put tokens in the repo or in chat: `glab` reads `GITLAB_TOKEN` from the environment.
- User-testable work: commit locally -> build -> user tests -> push -> PR. A commit is not a build: after
  `npm run build`, grep `dist/` for a new symbol before telling the user to test.

## Docs conventions

- `README.md`: user-visible behavior and architecture overview. `ROADMAP.md`: open ideas and deferred work
  only, no investigation narrative. Finished items get ticked or removed.
- Be terse: docs are re-read into context every session. State the trap, the fix, and the one constraint that
  stops someone undoing it. Tables and code beat prose. One fact stated once.
- Wrap prose at 140 columns; only rewrap paragraphs you edit.

## Debugging and verification

- A grep with zero matches may mean the file was never searched (binary, ignored, wrong path). Prove the
  search ran before claiming "nothing references X". Don't conclude a negative from `head`/top-N output.
- Measure first, then change. For layout/CSS bugs, use a real browser (`getBoundingClientRect`,
  `getComputedStyle`) against the real stylesheet and content, not reasoning about the CSS. Re-measure
  before saying it is fixed.
- Establish which of two similar things is wrong before changing anything (e.g. skin vs pack, main thread vs worker).
- Edit scripts: read, apply all replacements in memory, write once at the end.
- Be a polite client when calling external endpoints in ad-hoc debugging: paced requests, no looped probing.
- Don't `pkill` by name pattern or wipe shared temp dirs; use the project's own cleanup.
- For determinism bugs, reproduce with a fixed seed in `scripts/selftest.ts` first, then fix.

## Screenshots

- With the dev server up, `scripts/run.cmd node scripts/shot.mjs "<url>" out.png` takes a screenshot via headless Edge.
  URL params pick the state: `?skin=beos&pack=fantasy&seed=abc&view=s0/b0&ticks=2000`. Send results with SendUserFile.
  Look at a screenshot yourself before saying a UI change works. Quote the URL (it contains `&`).

## Caveat

The UI is checked by screenshots (see above), not by automated tests: `npm test` covers `src/core/` only. Of the
skins, Amiga, Classic Mac, Windows 3.1 and BeOS were matched against reference screenshots; 2000, XP and Flat were not.
