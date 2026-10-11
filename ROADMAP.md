# Roadmap and ideas

Living list. New ideas go in the Inbox first, then get sorted into a section.
Status: `[ ]` idea, `[~]` in progress, `[x]` done.

## Status (what exists)

- [x] Seeded, path-addressed generation: universe, system, planet, settlement district, dwelling, person, anomaly
- [x] Tick sim (1 tick = 1 hour) with Step and speeds 1x to 8760x, runs in a Web Worker
- [x] Living districts: aging, births, deaths, moving out (see Simulation and world)
- [x] Town generator: four street styles, plaza and hall, rivers with bridges, buildings along the streets
- [x] Nine skins (Amiga, Classic Mac, Windows 3.1/95/98/2000/XP, BeOS, Flat); sci-fi and fantasy content packs;
      feature-set toggles
- [x] Start menu, New Universe dialog, resizable left panel, charts, parent/child/residence links
- [x] URL state parameters and a screenshot script; the UI has been checked in a real browser
- [x] Inspect flag stored as a delta; settings persisted in localStorage
- [x] Core self-test (`npm test`): determinism, every level generates, packs rename without regenerating, life model
      (jump equals step, late equals watched, kin rules, moves, series, records)

## Known issues / tuning

- [ ] Settlements can sit right on a shoreline of a world with water; nudge placement inland (changes generation)
- [ ] Planet-level settlement lists show the generated population, not the live one
- [ ] Phone/narrow layout is only a stacked fallback, not tuned for touch
- [ ] Status and Record tabs don't react to selection (Results does)
- [ ] Open on the universe level instead of system 0?

## Simulation and world

- [~] **Living districts** (`core/life.ts`): done: aging, births (woman 18-49 and an eligible non-kin man 18-70 in the
      same building, per-person fertility and frailty, varied spacing, twins, infant mortality, epidemic/famine years),
      deaths, 18-30 year olds moving out, partners moving in, links to parents/children/home, charts. Open: moving between
      settlements, marriage/household formation beyond pairing, named newborn households, moves in the event log,
      population consistent above district level, saving life state as canon.
- [ ] **Founding dates and growth:** every settlement gets a `founded` tick (negative = already existed, so old towns
      are more built-out at tick 0; positive = appears later) and every building a `builtTick` from the town's plan
      order and a growth curve. People only live in buildings that exist, so households found new homes and
      population pressure becomes construction. New settlements appear on planet maps with a log line.
      Decisions open: maturity as a hidden roll or a visible record field; whether abandoned buildings become ruins.
- [ ] Live per-entity simulation beyond districts: inflate a settlement's population number into consistent people,
      collapse back to summaries when not watched
- [ ] Zoom deeper than the district: individual building interiors, trees, animals, people
- [ ] Universe is a fixed 7x7 grid; galaxy/sector structure, more systems, pan-to-discover
- [ ] Eras that change rules, not just words (medieval vs modern vs future pick default pack + mechanics)
- [ ] Time scale that follows zoom (galaxy tick = years, street tick = minutes)
- [ ] Moons, stations, resources, climate, weather

## Gameplay

- [ ] **Instrument upgrades:** the inspector's tools limit how much detail is visible. Generator still
      produces everything; a tier decides max zoom depth, which layers show, and how precise record
      fields are (e.g. "Population ~2,000" early on). Tier stored with the deltas.
- [ ] Planted-vs-found loop from the original wafer tool: scans produce findings, a report scores them
      against ground truth (missed / extra / echoes), reusing the Status / Results / Record tabs
- [ ] Scan cost (time or resources) tied to resolution and coverage
- [ ] Goals and progression; keep a pure sandbox mode

## UI

- [ ] Selection drives every tab: Status shows a selection summary, Record filters events to the selection
- [ ] Per-item history in the Record tab
- [ ] Screenshots tab (from the original tool's layout) for saved views
- [ ] Phone-friendly layout and touch gestures (pinch zoom, tap/long-press)
- [ ] Skin polish: only BeOS, Amiga, Win 3.1 and Mac have been matched against reference screenshots;
      2000, XP and Flat have not
- [ ] Optional sound/system-bell flavor
- [ ] Third content pack (modern/realistic)

## Platform and infra

- [~] Hosting: repo is on GitLab (`joshg253/universe-inspector`), commits are SSH-signed
- [ ] **CI in GitLab:** `.gitlab-ci.yml` running install, `npm test` and `npm run build` on every push (Node 24), later
      a Pages job for the static build
- [ ] **Automated review:** Sourcery or similar on merge requests (keep MRs small and single-purpose; reviewers skip
      big diffs and have shared budgets). Check what each supports on GitLab before choosing.
- [ ] GitLab CLI (`glab`) + a project access token (Developer role, `main` protected) so merge requests can be
      opened from the terminal; merging stays with the owner
- [ ] Save/load UI: seed + `DeltaStore.toJSON()` is the whole save; export/import file, IndexedDB
- [ ] Shareable seeds / URLs (state parameters exist; a proper share link and save format do not)
- [ ] Self-host the static build on the VPS
- [ ] Desktop packaging for Windows/Linux (Tauri wraps the current build as-is)
- [ ] If the sim gets heavy: port hot loops to Rust/WASM

## Inbox

(new ideas land here)

- [ ] **Canon vs provisional (observation persistence):** inspecting something commits it. Today "inspect"
      only stores a boolean flag and the content is regenerated from the seed each time, so a generator
      change would silently alter things you already inspected. Idea: on inspect, snapshot the record into
      the delta store ("canon"); anything not inspected stays provisional (lazily generated, may change if
      the generator improves). Open questions: snapshot ancestors too so a canon child never contradicts a
      provisional parent; whether provisional things are only "sketched" until inspected (tie to instrument
      tiers: coarse scans give fuzzy values, a direct inspection fixes exact ones); whether the live
      simulation only runs on canon or watched things; a `genVersion` in saves; UI marker for
      provisional vs canon.
- [ ] **Living world / divergence:** seed = initial conditions only; worlds are allowed to diverge from the
      same seed through the sim and player interaction. Design notes:
      - A world is `seed + ruleset (pack, enabled feature sets, version) + action log (or snapshots)`.
        Sharing a seed shares the starting point; sharing a save shares the outcome.
      - Enabled feature sets become rule modules that drive growth (e.g. economy drives settlement
        growth, anomalies spawn events). The sim loop becomes a list of enabled systems.
      - Features are currently display-only toggles. Once they affect growth they are rules: decide whether
        they lock at world creation or can change mid-run (logged as an action). Skins and map-layer toggles
        stay free.
      - Unwatched areas are not simulated tick by tick; the district life model already folds forward on view.
      - Keep the determinism tests: same seed + ruleset + action log must give the same world.
- [ ] **Generation timing (open question):** generate each zoom level on first inspection, then store it
      (canon). Options: (a) pure function of seed + path, as now: order-independent, never diverges;
      (b) true randomness at inspection: diverges, but no replay, tests, bug repro or sharing;
      (c) hybrid: derive from seed + path + a salt from world context (tick of first inspection, parent's
      current state). Deterministic given the same history, different if the history differs. Leaning (c),
      with children generated conditioned on the parent's current state. Never use `Math.random()` in core;
      "never the same game" comes from a random seed at world creation.
      **Tentative decision:** let the player choose at world creation (see next item) instead of picking one now.
- [~] **New World dialog:** done: Start menu > New universe... hides the window and shows a dialog with seed + Random,
      content pack and feature sets; Start restarts the sim at tick 0; the seed is display-only in the title bar.
      Open: the Reproducible/Varied modes, opening it at first launch, locking features per world, later era.
      - Reproducible: generation depends only on seed + path. Same seed = same starting world for anyone;
        play still diverges through the sim and your actions.
      - Varied: also mixes in a per-world random salt and inspection-time context. Results are stored as
        canon once seen, so the world is stable and savable; the seed alone no longer re-creates it.
      Store `mode`, `salt`, pack, and features in the world file.
- [ ] **Kin check beyond the district:** pairing currently only knows kin recorded since tick 0 and within one
      building; original residents' parents are unknown. A fuller family model comes with moves between settlements.
- [ ] **Town style by pack:** styles are chosen from the seed (packs only render them). If a pack should prefer
      tidy grids or sprawl, that has to be a rendering concern or an explicit world setting, not a regeneration.
