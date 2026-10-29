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
- [ ] Planet-level settlement lists show the tick-0 population, not the live one
- [ ] Towns hold 5 to 180 people (a district is 64x64 cells, at most 10 per building) while the size labels (city,
      metropolis) come from the notional generated size; bigger towns need a bigger or coarser district
- [ ] Narrow layout: the map comes first, then the controls, but it is not tuned for touch (small buttons, no gestures)
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
      grown children out faster, and a home full for a quarter takes one adjacent free cell (never road, water or beside
      another building; no pockets; a notch in the outline first, else the most square result; a grown home finishes
      its notches; decided in the fold; the map shows it). Left: a couple (not only grown children) pushed out by
      crowding; new buildings come after, under founding dates below.
- [ ] **Homelessness:** `residence` becomes optional (none = unhoused). People end up there when their home is lost (ruin),
      a household is pushed out, or migrants arrive with no vacancy; they leave by taking the next vacant home (or
      squatting a ruin). Higher mortality in winter and famine years, lower fertility, shown in streets and plaza.
      Money and eviction is a second route here. The unhoused count per district is a measurable stress signal that feeds economic pull.
- [~] **Footpaths and entrances:** done: every building has a derived door (an edge cell facing the plaza, else a road) drawn
      as a mark, and a building with no street beside it gets the shortest run of free cells to the nearest street
      (over land, else a bridge across the river, at most 40 cells); no random draws.
      A building walled in by other buildings (rare) is not built, which shifts the later `d<n>` indexes of that
      district. Carved paths are a separate cell type (track, drawn lighter), so roads are not widened; a building touching an existing
      track shares it (a track may cross other plots' yards and is carved at tick 0 even for a building finished later). Left: the access rule for any new building; shops and the hall may get several doors; routines walk
      door to door; a track that carries enough traffic becomes a road.
- [~] **Lots and outbuildings:** done: the layout claims a plot per building (footprint plus a yard that is deeper toward
      the edge of town, some left vacant), a home grows only inside its plot, the map draws plots (a Plots mark);
      nearly all of the district is plotted out at tick 0 (about 9% is left where zone bands meet; tiny plots downtown, larger outward, huge ones in the country, tiled in aligned
      blocks), farmsteads on a few of the huge plots reached by a track; some plots are cleared at tick 0 and built on
      later (`builtWeek`, spread over a few centuries; empty and not growing until then).
      Left, below: subdivision of plots as the town densifies, replacement, outbuildings, ownership. A lot is a parcel (cells, an owner later) that holds a main dwelling and any outbuildings
      (garage, shed, barn, workshop: no residents, own kind, own footprint). Growth happens inside the lot (its yard is
      the buffer, replacing the "never touch another building" rule); a lot has road access (footpath) or a lane.
      A building stays inside its lot (growth is bounded by the plot, not only by neighbors); going past it means
      acquiring more land: an adjacent free plot or a neighbor's, bought or leased once money and ownership exist.
      Town lots are small; lots outside the town are large (a farmstead, a cabin in the woods, an estate), so people
      live beyond the built-up edge and the district map shows scattered holdings. Ownership, rent and tax attach to
      lots. Paths: outbuildings must not shift existing `d<n>` indexes (appended after, or their own `o<n>` segment).
      A building holding several units (units per building) is a separate step.
      Plot lifecycle over the ages: early on, large plots outside the town (farms, steadings) and small ones downtown
      (shops, apartments); as the town ages plots are subdivided, more buildings go in, and old low buildings are
      replaced by denser ones under the age's zoning (the catalog decides what replaces what, and which plots
      subdivide, merge or change use). Plot size, subdivision and replacement are all folds of (seed, district,
      week), so the town's history is reproducible and late equals watching.

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
- [~] **Ages and what gets built:** done: a settlement has an age rung (0..5, `SiteLife.ageAt(week)`: start rung from the seed, a rung is left once `AGE_NEEDS` stand: people, shops, workplaces, works, and 6 to 8 buildings finished in the current rung itself)
      that gates when mills, quarries (rung 1), docks (2) and works (3) are built; shown as the Age field, named by the pack. Still open: the full building
      catalog (needs per building, not per count), resource deposits by age. Need-driven picks done for housing (a home first) and
      food (a farm first once the town outgrows what the land feeds; the 40 + 40 per farm threshold is flat, so it should scale with
      the land's `foodSupply`); still wanted: a shop when shops are few per head, a dock when trade needs one.
      Original idea: no calendar year (systems evolve separately). A fixed ordered ladder of ages
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
- [~] **New buildings (matters more than growing existing ones):** done: part of the plots are built on only later, on a
      schedule fixed at layout (the building exists in the list from the start with a `builtWeek`; the map hides it
      until then), and the households that arrive or found a home fill it; reserve plots (`built: -1`: about 40% of the in-town plots
      over, half of every big in-town plot split in two, and some country plots) are hidden, with their footpaths, until
      one is started (finished 20 to 51 weeks on, nearest first, a home first) when full homes that cannot grow
      outnumber what is under construction, so a town spreads outward; the dwelling list is fixed at layout, so the supply is
      bounded (at most 170 buildings per district; country plots within 2.2R are cut small and held in reserve). Places can fill
      every plot, or wither: about a quarter go into decline (fortune halves every 25 to 85 years from year 100 to 700:
      no arrivals, fewer births), empty homes fall into ruin, and plague years kill a third or more. Left (decline is a
      stand-in, not yet tied to a depleted resource or a crop failure): a kind chooser by need (shops and works, with the age catalog: a full
      town asks for a shop, not only a home); growth that continues once every reserve is used (a dwelling list that grows,
      so subdivision happens at run time rather than being planned at layout).
- [ ] **Resource-driven land use:** what a settlement farms or works comes from the planet map cells around it (soil and
      water for grain and animals, forest for timber, ore for mines), not a fixed share. Most towns start with farms of
      their own; one becomes a farm town where the farms take over the district, another drops most of its farms because
      it sits in forest and lives off that. A plot's open squares are then industry ground (grain, pasture, trees), not
      just a yard: farm plots show their crop, and a plot is rezoned as the economy moves.
      Order: this comes before more growth work. A lucky town keeps building out the whole map with what its land supports
      (farms and barns in a farm town, mines and smelters in a mine town, housing for the workers of each), so the dwelling
      list must grow at run time (the layout's fixed reserve of at most 170 stops a town at its pool; Vikir sat at 47 for
      28,000 years). An unlucky one goes to ruins, and a natural resource (soil, ore, forest) is finite and runs out,
      which replaces the random decline and plague stand-ins as the main cause. Ruined plots may be resettled later.
      Water is salt (ocean, sea: big connected regions) or fresh (lake, pond, river: small ones), nothing finer. Fresh
      feeds irrigation and drinking, salt gives fishing coast and salt works; a settlement reads both from the planet cells
      around it. Closed basins, dead seas and salt flats are a later refinement.
      Resources are a small fixed list with an age each becomes usable (pure ids, packs name them): soil, pasture, timber,
      fresh water, fish, stone from the first age; salt early; metal ore, coal later, then oil, silicon (sand and quartz: common, but worthless until the age that can use it), rare minerals. A deposit exists
      from tick 0 in the planet draw but is unseen and unused until its age. Stocks are finite (ore, coal, oil) or renew
      and can be overused (soil, timber); the draw-down is the only per-settlement state. First step: soil, timber, fresh
      water, fish, stone, with salt as a coast tag; the deposit kinds wait for Ages.
      Done so far (`core/resources.ts`): per-cell water (fresh/salt by connected size), soil, timber, stone on the planet; towns
      need water within 5 cells and prefer farmland; the district river chance comes from the fresh water nearby; the site
      record lists water, soil, timber, stone, fish. Towns get a mill, quarry or dock only where timber, stone or fish are around, farmsteads
      follow the soil, and a `food` figure (soil, fish, water) scales births, arrivals and new building. Still open: per-settlement
      draw-down, food as real stock (farm, mine and warehouse kinds are done, see Ages).
      A town dies when what it lives on is depleted or obsolete (flint, whale oil, a fuel an age moves past); the ruins stay
      on the map, and when a later age makes something there valuable (ore, silicon, oil) it is resettled: boom, bust,
      ghost town, boom. So a ruin keeps its plots as reserve, and a district's history has more than one founding.
      No town is tagged lucky or unlucky: how it ends comes out of the draw (its land, its stocks, the events it meets).
      The per-district `fortuneOf` flag in `life.ts` is a stand-in to remove once resources drive decline (food now shapes growth, not decline).
- [ ] **Founding dates and growth:** every settlement gets a `founded` tick (negative = already existed, so old towns
      are more built-out at tick 0; positive = appears later) and every building a `builtTick` from the town's plan
      order and a growth curve. People only live in buildings that exist, so households found new homes and
      population pressure becomes construction. New settlements appear on planet maps with a log line.
      Decisions open: maturity as a hidden roll or a visible record field; whether abandoned buildings become ruins.
      New settlements come from the candidate sites the planet already holds (placed by water and land, so there is no new
      randomness at run time): a full or thriving town founds a daughter at a nearby free site that is appealing, with a log line;
      an age that makes ore or silicon worth having resettles a ruin. A site is empty until its `founded` week.
      Prospecting: when an age gives the ability to find or use a resource (coal, oil, silicon), a settlement that lacks it
      does not just get it. It sends a survey over time (a search radius that grows, success a pure function of the week and the
      deposit), and only a found deposit becomes a reason to settle: a new settlement founded at the deposit, or a ruin there
      resettled. Deposits are in the planet draw from tick 0 but unknown until surveyed, which is also what the fog (known
      facts per observer) is for. Needs ages, the deposit layers, and a knowledge set per settlement.
- [ ] **Abandonment, ruins and replacement:** a building with no one left in it can be abandoned, then fall to ruin, then be
      replaced or cleared. Chance of abandoning rises with each abandoned building nearby, scaled by how long those
      have stood empty (decay spreads like blight), so a dying edge becomes a ruined quarter. A ruin is a state of
      the building (kept in the fold: pure function of the week, processed in index order), not a deletion, so paths and
      the people who lived there stay valid. A lot can be rebuilt as the age allows (an old hut replaced by a house).
      Condition is the state that drives it (0 to 100 per building, in the fold; the record's Condition is a static random
      roll today). Empty: slow wear, with now and then a spike when vandals get in (more when others stand empty nearby,
      or when the district has many young adults and little work). Lived in: it follows the household's care, a trait drawn
      per household from its path (keeps it up, lets it go, or wrecks it), moved by money once there is any; repairs
      lift it. Wear also follows who lives there: high turnover wears it fastest (short tenures, rentals), a family
      that stays for decades mostly keeps it up (not always), and a home left to old people only goes downhill when they
      lack the strength, skill or money to maintain it. At 0 it is a ruin. Replaces the "empty 8 years" ruin rule in `life.ts`.
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
- [~] **Roads between settlements:** done: a spanning forest over a planet's settlements (nearest first, never over water or past 70
      cells), drawn dashed on the planet map once both ends reach rung 2 (`ROAD_AGE`). Still open: trails, then roads, then highways
      by age; terrain-aware routes around water and steep ground (now a link that would cross water is left out); a link entering each
      district at the edge facing its neighbor, where the town's main road meets it. Links are what trade, migration and economic pull travel along (distance as
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
- [ ] **Case objectives (what the better view is for):** the upgrades are the means; the goal is a case to solve: find a
      specific person, a household, a place, or the cause of something, before the clock runs out (the person dies, the
      trail goes cold, the settlement changes). The deadline comes from the life model, so it is real and deterministic:
      `genRecord(path, tick)` already answers "who was where when". Families and households are the interesting level,
      so the endgame view resolves people; early views see only land and places. Cases are generated from the seed
      (a target path plus clues that need a given detail tier), never changing what the world generates.
- [ ] **Scenarios:** hand-built or generated starting situations (a case, a settlement in trouble, a famine year, a lost
      person) that pick a seed, a starting tick, instrument tier and objective, so the sandbox can be played as
      one-off puzzles as well as an open watch. A scenario is data (seed, path, tick, tier, goal), not new rules.
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

- [~] Hosting: repo is on GitHub (`joshg253/universe-inspector`, moved from GitLab in October 2026; the Issue and MR history
      stays on GitLab), commits are SSH-signed
- [x] **CI on GitHub Actions:** `.github/workflows/ci.yml` runs install, `npm test`, `npm run build` and an advisory `npm audit`
      (Node from `.nvmrc`) on pushes to `main` and on pull requests. Open: a Pages job for the static build (`vite.config.ts` has a relative base)
- [~] **Review:** done: a fresh-context reviewer agent reviews every branch before its PR (see CLAUDE.md). Open: an
      external bot on pull requests (PR-Agent, Copilot review, or a CI job with an own API key).
      Keep PRs small and single-purpose; reviewers skip big diffs. Treat the diff as untrusted input to the reviewer.
- [x] **Security tooling on GitHub:** Dependabot alerts, security and version updates (`.github/dependabot.yml`: weekly npm,
      monthly Actions; PRs are proposals, never auto-merged), dependency review on PRs, secret scanning, CodeQL default setup
      (settings, no file), `SECURITY.md` for private vulnerability reporting.
- [x] Issues, pull requests, check status and review comments from the terminal: the `gh` CLI (login in the OS keyring);
      Claude never merges, merging stays with the owner
- [ ] Save/load UI: seed + `DeltaStore.toJSON()` is the whole save; export/import file, IndexedDB
- [x] Wiki: Home, Using the inspector, Skins, Simulation, Architecture, Development, with screenshots. The README
      is the short version. Keep the Wiki in step with behavior changes.
- [ ] License: undecided; none while the repo is private (decide before it goes public)
- [ ] Shareable seeds / URLs (state parameters exist; a proper share link and save format do not)
- [ ] Self-host the static build on the VPS
- [ ] Desktop packaging for Windows/Linux (Tauri wraps the current build as-is)
- [ ] If the sim gets heavy: port hot loops to Rust/WASM

## Inbox

- [ ] **Later settlements away from water:** first towns now stand at fresh water (or the sea with fresh water near); towns farther
      out should arrive later as expansions or neighbors, reached by road to a fresh source. Rivers are real (`carveRivers` in `core/resources.ts`:
      sources on high wet ground drain downhill, their cells are fresh water in the layer, so towns settle along them). Rivers follow a priority-flood drainage, so each reaches the sea, a lake or the map edge. Open: they wiggle
      on flat ground; count by rainfall instead of a flat number per kind.
- [ ] **Land and water over long time (erosion, drying, volcanoes):** today the planet is a fixed function of the seed. Make it a
      function of (seed, week) at a coarse step (centuries to millennia, a fold like the others, never per tick). Erosion: rivers
      cut their beds and shift, deltas build at the mouth, soil washes downstream (soil falls on slopes, rises on flood plains).
      Drying: a lake or river shrinks when the climate is dry (lower rainfall, a body turning arid) and fills in a wet spell; a
      lake with no inflow dries first, and a drained bed leaves salt flat or fertile soil. Volcanoes: a peak that erupts now and
      then (rare, seeded by the week), burying cells in rock, then enriching soil and stone around it over the next centuries;
      lava damming a river makes a lake. All three must reach the settlements that depend on them (a town whose water dries
      declines or moves; see Resource-driven land use and Abandonment), and `canFound` and the per-body caches must read the
      layers at a week. Needs the resource layers to be rebuilt per era, so decide the step size and cache first.
- [ ] **District view fits the town:** the view frames what is built at the current tick (a minimum of about 24 cells, up to the whole
      grid) instead of a fixed 64x64, so a hamlet is not a few buildings in a field. UI only first.
      Footprint and population are separate: density follows the local industry (present or past: farms spread, mills and works pack workers in) and the settlement's
      age rung, with terrain limiting it (unresearched, a stand-in until sourced; a sprawling town can hold fewer people than a
      compact one), so the view fits the footprint, not the head count. Then, for towns that fill their block, a larger
      grid (say 128) laid out center-out with outer rings as later reserve plots; touches `layoutTown`, `SITE_N`, the plot logic and the town selftests.
- [~] **Sea routes and ports:** done (`core/sea.ts`): ports are settlements with salt water within 2 cells; a spanning tree of boat lanes over
      water between ports of one sea (at most 90 cells), and a lane from each port to the richest deep-water spot within 18 cells (a
      fishing ground); drawn dashed and dotted once the settlement reaches rung 2. Open: require an actual dock (not just the age);
      the catch feeding the town's `food` instead of the flat per-cell fish count; a town without a port reaching one by road;
      trade; island and far-coast links beyond 90 cells; fresh-water lanes on lakes and rivers.

- [ ] **Investigate: long days and settlements:** a day longer than the year (down to 0.25 days per year, as Mercury is at 0.5) is
      allowed but only shades the map. Look into whether a slow spin should cost food or growth, or favor a twilight band, and
      whether settlements would migrate with the sun. Unknown for real planets (exoplanet spins are almost entirely unmeasured).


- [ ] **Parent maps show what is known below them, and later only what you learned:** a planet's tooltips show its settlements'
      resources and population, a system's bodies their water and settlements, and so on up. Today everything is shown at once (all of
      it is known); in the game it becomes fog: each fact has a known/unknown state per observer, learned by inspecting and limited
      by equipment and age. Keep the data a plain per-path fact set so the view can filter it later. Done so far: planet map
      tooltips for cells, settlements (people, water, soil, timber, stone, fish), bodies on the system map (kind, water share, sites) and systems on the universe map (star, bodies). A tooltip shows one level down only; deeper detail (e.g. a system's settled count) waits until it is inspected.

- [ ] **Anomalies:** the owner is not sure yet what they are for. Decide their role (hazard, find, quest hook, resource
      oddity) once Resources and Ages exist, so they can tie into those.


(new ideas land here)

- [ ] **More UI tools (left over):** condition on the hover card once buildings have it; graph hover and aria-label
      should also read the running average and the overlay; lens bin colors and the overlay color should come from the pack
      palette / skin variables (hard-coded now); a settlement record rebuilds four series in separate passes over everyone who
      ever lived (share one pass if records get slow on long runs).

- [ ] **More building types:** today a district has ten kinds (home, shop, works, mill, quarry, dock, farm, mine, warehouse, hall). Still wanted: workshop, school, shrine, and so on, each tied to the resource or need that wants it (a farm town gets farms,
      a mine town mines plus housing for the workers). The kind registry (`DwellingKind`, pack palette, legend, lens colors) is the one place to
      extend; do it with Resources step 1 so a kind exists because something asks for it.

- [ ] **Map views (more lenses):** By kind, age and occupancy exist (one registry in `ui/map.ts`: `LENSES`, a bin table and a color function). Planet map has Terrain, Water, Soil, Timber, Stone (`PLANET_LENSES`). Still to add as their features land: Condition, Land use, and district-level water.

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
