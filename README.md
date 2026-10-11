# Universe Inspector

A procedurally generated universe in a retro desktop inspection-tool window.
Zoom from a field of star systems (the universe) to a system, a planet, and a settlement district, click a dwelling,
and open the record of the people inside. People age, are born, move house and die while you watch. Web-first:
TypeScript + Vite, no backend.

## Run it

Clone and go, nothing installed system-wide. `setup` downloads the Node version pinned in `.nvmrc` into
`./.node` (gitignored, checksum-verified) and installs dependencies; `run` uses it for that command only.

```
# Windows (cmd or PowerShell)          # Linux / macOS
scripts\setup.cmd                      ./scripts/setup.sh
scripts\run.cmd dev                    ./scripts/run.sh dev      # http://localhost:5173
scripts\run.cmd test                   ./scripts/run.sh test     # core invariants
scripts\run.cmd build                  ./scripts/run.sh build    # static site in dist/
scripts\run.cmd preview                ./scripts/run.sh preview  # serve dist/ on your LAN
scripts\run.cmd npm install <pkg>      ./scripts/run.sh npm install <pkg>
```

Or open the repo in a dev container / Codespaces (`.devcontainer/`); `npm ci` runs on creation.
If you already have Node 24, plain `npm ci` and `npm run dev` work too. To undo everything, delete `.node/` and `node_modules/`.

## Controls

- Click selects, double-click zooms in (or opens a record). Drag pans, wheel zooms. Click empty map to deselect;
  Results then describes the thing you are looking at.
- Left panel (drag the splitter to resize; double-click it to reset): Status (what is in view), Results (record of
  the selection, with charts and links to parents, children and home), Record (event log), Settings (skin, content
  pack, feature sets). Zoom, inspect, step and speed buttons stay visible under every tab.
- Space pause/resume (at 1x), `.` step, Backspace zoom out, `i` inspect the selection.
- Speeds: Pause, then Nx = N sim hours per real second: 1x, 24x (a day/s), 168x (a week/s), 720x, 8760x (a year/s).
  Step always advances one tick.
- Start menu (taskbar, top bar or the system-menu box, depending on the skin): New universe..., Settings, About.
  New universe hides the window and opens a dialog for seed, content pack and feature sets; Start restarts the sim.
- The seed is shown in the title bar and only changes through the New universe dialog.

### State in the URL

Query parameters override saved settings, for sharing a state or taking a screenshot of it:
`?skin=amiga&pack=fantasy&seed=abc&view=s0/b2/t1&ticks=20000` (`view=` empty is the universe, `ticks` runs the sim first).
`scripts/shot.mjs` screenshots the dev server this way through headless Edge.

## How it is put together

```
src/core/      pure simulation, no DOM, no theme words
  rng.ts       seeded RNG + stateless value noise
  generate.ts  seed + path -> universe / system / body / site / record
  town.ts      district layout: streets, plaza and hall, river, buildings packed along the streets
  life.ts      births, deaths, aging and moving house in a district, a pure function of (seed, path, week)
  sim.ts       tick loop (events) and per-tick view state (orbits, day/night, lit windows)
  deltas.ts    the only stored state: changes on top of the generated baseline
src/packs/     content packs: vocabulary, name generators, palettes, default feature sets
src/worker/    runs generation + ticks off the main thread
src/ui/        window shell (win.css skins), the canvas map (map.ts), line charts (chart.ts)
scripts/       setup/run (repo-local Node), selftest.ts, shot.mjs (screenshots)
```

Key ideas:

- **Paths address everything:** `s3/b2/t5/d17/p1` is system 3, body 2, site 5, dwelling 17, person 1.
  The empty path is the universe itself (a grid of systems; any system index still generates).
  Every object is a pure function of `(seed, path)`, generated only when you look at it.
- **Deltas, not saves:** only changes (currently the "inspected" flag) are stored. `DeltaStore.toJSON()`
  is the whole save file; seed + deltas reproduces your universe.
- **Core never says "planet" or "elf":** it emits ids (`temperate`, `home`, `birth`) and name keys
  (numbers). A pack turns those into words, so one seed renders as sci-fi or fantasy.
- **Skin vs pack vs feature sets:** skin = window chrome (CSS variables, plus layout where a skin needs it), pack =
  content theme, features = optional layers (anomalies, inhabitants, economy) a pack enables by default but you can toggle.
  Skins, oldest first: Amiga Workbench, Classic Mac, Windows 3.1, 95, BeOS, 98, 2000, XP, Flat.
- **Time:** the sim only knows ticks (1 tick = 1 hour). Speed buttons just call `step()` more often,
  so a seeded run is identical at any speed.
- **Towns:** a district is a 64x64 grid. The layout style (grid, radial, organic, village) comes from the seed and
  settlement size; packs only render it. Buildings are placed along the streets, densest near the hall.
- **Simulation LOD:** random events are only generated for the system you are watching. A district you view
  is folded forward from tick 0 to now (weekly steps, cheap), then advanced live. Births need a woman (18-49) and an
  eligible man (18-70, not recorded kin) in the same building; young adults move out; partners may move in.
  A person's path is the dwelling they started in, so moving house never breaks a link. The settlement population
  shows the generated number plus the district's net change.

## Adding things

- **A new pack** (e.g. modern/realistic): copy `src/packs/fantasy.ts`, change words, names, palette,
  and register it in `src/packs/index.ts`.
- **A new skin:** add a `.skin-xyz` block of CSS variables in `src/ui/win.css` and list it in `SKINS` in `src/ui/app.ts`.
  Skins can also move things with CSS alone (`skin-mac` and `skin-beos` turn the taskbar into a top bar, `skin-win31`
  hides it); use `#app.skin-xyz` to override `background`, since `#app` has id specificity, and redefine
  `--raised/--sunken/--pressed` to change the bevels.
- **A new generated field:** add it in `genRecord` (core/generate.ts), give it a `field.<label>` word in
  `src/packs/base.ts`. Tag it with a `feature` to make it toggleable.
- **A new zoom level:** add a path segment letter, a `gen*` function, a view type, and a draw function in `map.ts`.
- **A new chart:** add a `charts` entry to the record in `genRecord`; `src/ui/chart.ts` draws it.

## Not built yet

See `ROADMAP.md`. In short: people moving between settlements, buildings and settlements that appear over time,
goals/scoring (the original tool's planted-vs-found loop), save/load UI, eras that change rules rather than just
words, desktop packaging (Tauri would wrap this as-is).
