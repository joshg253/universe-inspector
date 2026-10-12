# Roadmap and ideas

Living list. New ideas go in the Inbox first, then get sorted into a section.
Status: `[ ]` idea, `[~]` in progress, `[x]` done.

## Direction


A world that plays itself: SimCity-style towns that grow and balance (housing, food, industry) with Age of Empires-style
progression through ages, all deterministic from the seed. You watch and inspect; the instruments come last.

## Status (what exists)

- [x] Seeded, path-addressed generation: universe, system, planet, settlement district, dwelling, person, anomaly
- [x] Tick sim (1 tick = 1 hour) with a Step size and five speeds that multiply the zoom level's default step, runs in a Web Worker
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
- [ ] A district's population can exceed the people shown: the count keeps the unmodeled remainder when the modeled
      residents die out (show it as its own line, or count simulated people only)
- [ ] Phone/narrow layout is only a stacked fallback, not tuned for touch
- [ ] Status and Record tabs don't react to selection (Results does)
- [ ] Open on the universe level instead of system 0?

## Simulation and world

- [~] **Living districts** (`core/life.ts`): done: aging, births (woman 18-49 and an eligible non-kin man 18-70 in the
      same building, per-person fertility and frailty, varied spacing, twins, infant mortality, epidemic/famine years),
      deaths, 18-30 year olds moving out (couples found households in vacant homes), partners and whole households
      arriving from outside into vacant homes, a crowding feedback that keeps a district near its starting population
      over centuries, links to parents/children/home, charts. Open: named newborn households, moves in the event log,
      population consistent above district level, saving life state as canon. Moves between settlements: see New
      settlements; ruins: Abandonment; couples and households beyond pairing: Partners.
      Cost: looking at a district folds its whole elapsed time, about 0.17 s per 1,000 years (linear in the living); after
      a very long run at a top speed that is seconds. A coarser fold for old history would cap it.
- [~] **Planet calendar and seasons:** done: a body's period follows Kepler (orbit^1.5 over the square root of the star's
      mass; orbit 50 around a mass-1 star is one standard year), it has a signed sidereal spin (slow ones and
      retrograde ones exist), and its solar day is derived: `1 / |1/spin - 1/orbit|`, so a day can exceed a year
      (Venus). Open: (1) seasons from axial tilt and orbit phase, stronger with latitude (the site's y), driving
      temperature, then death and birth rates and later crops (random epidemic and famine years stay on top);
      (2) eccentric orbits: e, argument of periapsis, speed from Kepler's equation, insolation `L / r^2` swinging over
      the year, orbits spaced by periapsis and apoapsis so they do not cross; (3) inclination and node per orbit,
      which matter for what an observer can see (transits, alignments) more than for the top-down map; (4) star
      luminosity from class (L ~ M^3.5) and a habitable zone at sqrt(L) of the reference orbit, so a planet's kind
      comes from its insolation instead of from which third of the orbit list it is in. The tick and the standard year
      stay the universal clock (ages, speed ladder, `core/time.ts`); a planet's local day and year are for light,
      local time and seasons only. Calendars with month names are a pack concern.
- [~] **Housing capacity and growth:** done: capacity from the footprint (2 + area/2, cap 10), a full home pushes its
      grown children out faster, and a home full for a quarter takes one adjacent free cell (never road, water or
      beside another building, so shapes bend but leave no pockets; decided in the fold; the map shows it). Left: a couple (not only grown
      children) pushed out by crowding; new buildings come after, under founding dates below.
- [ ] **Homelessness:** `residence` becomes optional (none = unhoused). People end up there when their home is lost (ruin),
      a household is pushed out, or migrants arrive with no vacancy; they leave by taking the next vacant home (or
      squatting a ruin). Higher mortality in winter and famine years, lower fertility, shown in streets and plaza.
      Money and eviction is a second route here. The unhoused count per district is a measurable stress signal that feeds economic pull.
- [ ] **Footpaths:** every building touches a road or the plaza. Today about 5% (back lots) do not. A short run of
      road cells is carved from each landlocked building to the nearest road through free ground (never over a
      building or water); layout draws kept so the rest of the town is unchanged. Test: every building touches a road.
      Later a path cell type separate from road, and the access rule for any new building.
      Entrances: each building has one door, an edge cell facing a road, plaza or path cell (derived, not stored: a
      pure function of building and grid, nearest road or plaza first, fixed scan order as the tie-break; growth never
      covers it). Drawn as a door mark on the map; daily routines later walk door to door, shops and the hall may get
      several. Test: every building has an entrance cell that is road, plaza or path.
- [ ] **Lots and outbuildings:** a lot is a parcel (cells, an owner later) that holds a main dwelling and any outbuildings
      (garage, shed, barn, workshop: no residents, own kind, own footprint). Growth happens inside the lot (its yard is
      the buffer, replacing the "never touch another building" rule); a lot has road access (footpath) or a lane.
      A building stays inside its lot (growth is bounded by the plot, not only by neighbors); going past it means
      acquiring more land: an adjacent free plot or a neighbor's, bought or leased once money and ownership exist.
      Town lots are small; lots outside the town are large (a farmstead, a cabin in the woods, an estate), so people
      live beyond the built-up edge and the district map shows scattered holdings. Ownership, rent and tax attach to
      lots. Paths: outbuildings must not shift existing `d<n>` indexes (appended after, or their own `o<n>` segment).
      Needs footpaths first; a building holding several units (units per building) is still a separate step.

- [ ] **Partners:** an explicit `partner` link on a person, never inferred from sharing a home (housemates and
      roommates stay unlinked), one partner at most (a single nullable id, no larger groups), any pair of adults
      including same-sex couples, so a couple without children is shown (the `+` under their other half) and a widowed
      survivor is distinct. Set only for generated couples: the couple shape at tick 0, arriving couples, partners who
      move in and founding pairs. Partnership and children are separate: a birth needs a recorded partner pair that
      includes a fertile woman and a man (roommates never have a child), and a same-sex couple's children come by
      adoption or a child arriving with them. `mother`/`father` then become "parents" so a child can have two mothers
      or two fathers (the tree already keys the `+` on the other parent). `canPair` (opposite sex, not kin) stays the
      test for who can conceive, not for who can be together. Partners need not share a home: a couple living in
      two buildings (or two towns) is a link between two people in different dwellings, shown in the record and
      in the list as a link rather than a `+` row. A partnership can end (a weekly chance; distance
      (different building, town, planet) moves it up for most couples and down for some, by a per-person
      disposition such as independent or clingy, so no flat rule; separation and a quarrel are the same event with a
      reason on each person's record), after which both are unlinked and either can partner again. Needs a Model-notes entry.
- [ ] **Ages and what gets built:** no calendar year (systems evolve separately). A fixed ordered ladder of ages
      (about 6, no skipping); each settlement has a starting rung and a pace from the seed, `ageAt(site, tick)` is
      pure, core knows only the rung number, packs name ages and may stop short. A building catalog (data: age it
      unlocks, footprint, staff, produces/consumes, key-for-age flag). Each build step picks the next building by
      weighted roll over catalog entries of the current and earlier ages: base weight, steep penalty per one already
      standing, overridden by need (farms with food short of population, homes with crowding, workshops with
      unstaffed demand). An age advances once its key buildings stand, so settlements that never roll one stall:
      uneven pace for free. One pure fold with population (extends `SiteLife`; housing and population depend on
      each other). Buildings keep the type of the age they were built in, so towns are layered. Later, trade pulls
      neighbors up (see economic pull).
- [ ] **Units per building:** dense multi-unit buildings downtown early, larger single homes further out as ages
      pass. Storeys: a building has a floor count (from its age and place: tall downtown, low outside); capacity comes
      from footprint x floors, so a building can grow up instead of out (cheaper than buying land, see Lots), drawn as a
      height number or shading on the map, with units stacked per floor. A building holds several households; capacity
      and vacancy are per unit; a person gets a unit number beside their dwelling (paths and identity unchanged).
      Needs housing capacity first.
- [ ] **Founding dates and growth:** every settlement gets a `founded` tick (negative = already existed, so old towns
      are more built-out at tick 0; positive = appears later) and every building a `builtTick` from the town's plan
      order and a growth curve. People only live in buildings that exist, so households found new homes and
      population pressure becomes construction. New settlements appear on planet maps with a log line.
      Decisions open: maturity as a hidden roll or a visible record field; whether abandoned buildings become ruins.
- [ ] **Abandonment, ruins and replacement:** a building with no one left in it can be abandoned, then fall to ruin, then be
      replaced or cleared. Chance of abandoning rises with each abandoned building nearby, scaled by how long those
      have stood empty (decay spreads like blight), so a dying edge becomes a ruined quarter. A ruin is a state of
      the building (kept in the fold: pure function of the week, processed in index order), not a deletion, so paths and
      the people who lived there stay valid. A lot can be rebuilt as the age allows (an old hut replaced by a house).
      The tick-0 ruins in "New settlements" are the same state. Tied to the age ladder: early ages have trails and
      huts, later ages paths and structures, and the catalog says what replaces what.

- [ ] **Money, ownership and eviction:** `wealth` is a random record field with no effect today. Households earn at
      their workplace, pay for food and upkeep, and owe rent, a mortgage or property tax (form per age and pack). Every
      building has an owner (a household, a landlord with several buildings, or the settlement); tenants pay owners,
      owners pay the town. Arrears long enough mean eviction and an unhoused household (second route to homelessness
      next to ruins). A per-person disposition (greed, generosity: the trait list already has some) changes how
      landlords price and evict and how neighbors share. Inspector: owner and rent in a building's record, arrears and
      reason for eviction in a person's. Needs daily routines, housing capacity and the age ladder first.
- [ ] **New settlements and migration:** a planet's sites are all generated up front (stable paths) with a `foundedTick`;
      unfounded candidates exist on the map but are empty until a full settlement (crowded, food short, the age's
      pressure) sends settlers to the best free one nearby, so the founding tick comes out of the fold. Emptied
      districts become ruins. Settlements then depend on their neighbors, so the fold becomes one per planet
      (pure in seed, body, week; a handful of sites, so cheap) with moves between settlements recorded on the person.
      Between planets and systems is a much later, separate mechanism (ships, trade).
      Ruins exist at tick 0 too: a site with a negative `foundedTick` and a negative `abandonedTick` is already
      empty (buildings of the age it was built in, poor condition, resettled later through the founding trigger).
      Inside living towns, homes left vacant for years decay vacant -> derelict -> ruin.
      Individuals move too, not only households: for school or a job in another town, to follow a partner, or with
      their family when it moves. A move is an event with a reason, a destination and a tick, so a person's record shows
      where they went and why. It needs people to belong to the world and not to one district's fold (one fold per
      planet, above), and a person's path stays the dwelling they started in. Cross-town couples need Partners.
- [ ] **Roads between settlements:** trails, then roads, then highways connect towns on the planet map, by age (the same
      ladder as footpaths and huts). A link is a pure function of the two sites and the age (terrain-aware: around
      water and steep ground), drawn on the body map and entering each district at the edge facing its neighbor, where
      the town's main road meets it. Links are what trade, migration and economic pull travel along (distance as
      cost), and what the observer can follow first (a road shows what lies at its end). Needs ages and the new
      settlements/migration items first.

- [ ] **Economic pull and migration:** whether a settlement grows or dies is mostly what draws people in, not births and
      deaths (a boomtown near big employers grows 2%+ a year at any price; a bypassed town with no industry shrinks or
      stalls). Give each settlement a `pull` from the seed, its size and its building mix (works/shops as the industry
      proxy), drifting over centuries (booms and busts). Pull drives net migration: positive means more arrivals and
      fewer departures, negative means households leave the district and homes empty. Housing is the ceiling: growth
      beyond the existing homes needs construction (see founding dates and growth) or more people per home up to the
      cap, which is where cost and congestion would come from once there is an economy. Replaces the crowding feedback in
      `life.ts`, which pulls every district back to its starting size. Later: squatters living in vacant buildings,
      abandoned buildings and ruins.
- [ ] **Terrain resources and industry as the cause of pull** (sits under economic pull, before construction): per-cell
      resource values on the planet map derived from seed + terrain (fertility, ore/stone, water/coast, timber); a
      settlement's catchment (cells within a radius, plus river/coast/pass) decides which industries are possible; works
      buildings get a type (farm, mine, mill, market) and a size that can grow or move; pull = catchment richness +
      industry + connectivity - congestion. All observable in the inspector (a mining town booms when its mine grows).
      Player verbs (found a settlement, fund an industry, build a road, ...) are deliberately undecided: build the world
      first, watch it live, then choose. Open question: inspector (investigate, scan, score) vs ruler (nudge, build).
- [ ] **Daily routines (work and school):** works and the hall are empty at tick 0 and shops only hold a keeper's
      household, so nobody goes anywhere. Give each person an assigned place (working-age: a works, shop or the hall;
      children: school, which needs a building kind or the hall; elders and the unemployed: home) and derive where
      they are from the tick of day and day of the week (`whereAt(person, tick)`: pure, nothing stored, so looking
      late still equals watching). Visible as dots moving between buildings on the district map and as "at: X" in the
      person's record. Needs: a `workplace` link on Person (stable per person, changes on job moves), staffing
      numbers per building from its size and kind, local solar time (already there) so night shifts follow the day.
      Rosters fall out of the same assignment: a building's staff, or a school's students and teachers, are the people
      assigned there (derived, not stored), shown in its record next to its residents; a person's record gets
      "works at" / "attends" beside "lives in". Understaffing is then measurable.
      Ties into terrain resources and industry (what a works makes decides its staff).
- [~] **Starting households:** done: tick-0 homes hold couples with children, single parents, older parents with grown
      children, step-parent families, three generations and housemates; parents are recorded only inside the dwelling (no ancestors before
      tick 0), every parent was an adult at each birth, and the residents list shows couples with children indented
      (partner marked +, family name omitted when it is the household's). Open: siblings who have left home, twins
      sharing a birth year.
- [ ] **Kin check beyond the district:** pairing only knows kin recorded since tick 0 and within one building (original
      residents' parents are unknown). A fuller family model comes with Partners and moves between settlements.
- [ ] Live per-entity simulation beyond districts: inflate a settlement's population number into consistent people,
      collapse back to summaries when not watched
- [ ] Zoom deeper than the district: individual building interiors, trees, animals, people
- [ ] Universe is a fixed 7x7 grid; galaxy/sector structure, more systems, pan-to-discover
- [ ] Eras that change rules, not just words (medieval vs modern vs future pick default pack + mechanics)
- [ ] Time scale that follows zoom (galaxy tick = years, street tick = minutes)
- [ ] Moons, stations, resources, climate, weather

## Gameplay

- [ ] **Instrument upgrades** (do this after the simulation is fleshed out; it is a filter on records and views, never
      a change to generation): the inspector's tools limit how much detail is visible. Generator still
      produces everything; a tier decides max zoom depth, which layers show, and how precise record
      fields are (e.g. "Population ~2,000" early on). Tier stored with the deltas.
- [ ] **Observer game (fog of war, drones, scouts):** the sandbox is a semi-realistic world; the game is the observer
      on a ship at the middle of the universe who starts seeing a planet or two and upgrades equipment to see more.
      Design constraints: (1) the sim never knows it is watched; the only stored state is a map path -> knowledge
      level (unseen, detected, surveyed, detailed; per field if needed), next to `inspected` in the deltas.
      (2) A report is the world as of the tick the probe looked: `genRecord(path, tick)` already answers that for any
      past tick (looking late equals watching), so stale data, light lag and relays are the same call with different
      ticks. (3) Actions cost ticks: survey, launch a drone, wait for its return (a job with a duration and a return
      tick on the same clock); later drones relay data back instead of returning. (4) The Universe view shows only
      what is known; upgrades are range, resolution (fields and detail per record) and relay. (5) Scout ships fill in
      the map slowly on their own. Guard: observation filters what you see and never changes what generates.
      Fog applies on every map, not only the Universe: planet maps and town districts get a revealed-cells mask (bits
      per body or site, keyed by path, stored with the knowledge levels). A pass reveals a footprint whose radius is
      the resolution upgrade; in a town, roads and plaza show first, then footprints, then building kinds, then
      residents (a building seen only from above is a grey block). The mask only filters drawing and lists.
      Progression by detail tier: land only (a lone scout wanders and jots an overview) -> places (settlements,
      anomalies, roads) -> structures (footprints, kinds) -> people (records, households). A closer look at a place is
      a directed pass. Cost is area x detail / speed, so upgrades divide the time and endgame is the same job
      finishing in one tick: click a planet, then a person. The wandering scout is a pure function of (seed, unit,
      tick), so only player orders add state (an order log, position derived from it) and waiting is free.
- [ ] Planted-vs-found loop: scans produce findings, a report scores them
      against ground truth (missed / extra / echoes), reusing the Status / Results / Record tabs
- [ ] Scan cost (time or resources) tied to resolution and coverage
- [ ] Goals and progression; keep a pure sandbox mode

## UI

- [ ] Selection drives every tab: Status shows a selection summary, Record filters events to the selection
- [ ] Per-item history in the Record tab
- [ ] Screenshots tab for saved views
- [ ] Phone-friendly layout and touch gestures (pinch zoom, tap/long-press)
- [ ] Skin polish: only BeOS, Amiga, Win 3.1 and Mac have been matched against reference screenshots;
      2000, XP and Flat have not
- [ ] Optional sound/system-bell flavor
- [ ] Third content pack (modern/realistic)

## Platform and infra

- [~] Hosting: repo is on GitLab (`joshg253/universe-inspector`), commits are SSH-signed
- [x] **CI in GitLab:** `.gitlab-ci.yml` runs install, `npm test`, `npm run build` and an advisory `npm audit` (Node 24)
      on every branch push and merge request. Open: a Pages job for the static build (`vite.config.ts` has a relative base)
- [~] **Review:** done: a fresh-context reviewer agent reviews every branch before its MR (see CLAUDE.md). Open: an
      external bot on merge requests (PR-Agent or a CI job with an own API key; Sourcery's free tier is public-repo only).
      Keep MRs small and single-purpose; reviewers skip big diffs. Treat the diff as untrusted input to the reviewer.
- [x] Issues, merge requests, pipeline status and review comments from the terminal: `scripts/gl.mjs` with a project
      access token (Developer role, `main` protected); there is no merge command, merging stays with the owner
- [ ] Save/load UI: seed + `DeltaStore.toJSON()` is the whole save; export/import file, IndexedDB
- [x] Wiki: Home, Using the inspector, Skins, Simulation, Architecture, Development, with screenshots. The README
      is the short version. Keep the Wiki in step with behavior changes.
- [ ] License: undecided; none while the repo is private (decide before it goes public)
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
- [ ] **Town style by pack:** styles are chosen from the seed (packs only render them). If a pack should prefer
      tidy grids or sprawl, that has to be a rendering concern or an explicit world setting, not a regeneration.
