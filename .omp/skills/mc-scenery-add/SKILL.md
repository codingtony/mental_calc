---
name: mc-scenery-add
description: Add or change a mental_calc circuit (scenery) from a paper scan: transcribe the track, write the scenery file and its own race song, pass the geometry tests, record a player-view video for review; use when asked to add, import, fix or validate a race track, circuit or scenery.
---

# Adding a circuit (scenery) to mental_calc

All commands from the mental_calc repo root.

## 1. Files

- `src/sceneries/<id>.ts`: one `Scenery` per file. Copy `meadow.ts` (flat); `showcase.ts` (Bergsbanan, figure 8)
  uses heights, a bridge, a tunnel and mountains; `coast.ts` (sea, sunset), `desert.ts` (canyon, arches),
  `city.ts` (buildings), `forest.ts` (rivers, lake, dense trees), `ice.ts` (snow line, igloos), `night.ts`
  (night, street lamps) show the other features.
- `src/sceneries/types.ts`: add the id to `SceneryId`.
- `src/sceneries/index.ts`: add it to `SCENERIES`. The order is the championship order and the host dropdown
  order; `[0]` is the default circuit (intro, single races). Ask the user where the race goes. Race k's
  difficulty comes from `raceDifficulty` in `src/championship.ts` (25 × 6 s, then +5 questions and −1 s per race,
  never below 2 s).
- `src/songs.ts`: a new race song (section 4).

## 2. Transcribing a scan

- Axes: +x right and +z up on the paper, metres. Centre the drawing's bounding box on the origin and scale so
  the loop stays within 200 m of it (lap 700–1000 m is a good length; one lap ≈ 30 s at race speed).
- `controlPoints`: in driving order (ask when the scan has no arrow); `[0]` on the start/finish straight (start
  line, grand stands and gantry go there). One point at each corner entry, apex and exit, and every 40–80 m on
  straights: the Catmull-Rom spline passes through every point.
- Heights `[x, z, y]`: as written on the scan; otherwise propose them (hills 5–20 m) and list them for the user.
- Crossing (figure 8): the upper pass is a `bridges` span `{ from, to }` (control point indices) whose ends sit
  ≥ 50 m before and after the crossing, ≥ 7 m above the lower road. The lower road stays on the ground.
- Tunnel: a `tunnels` span plus a mountain over it (`height` ≥ 30, `radius` covering the span). The rock
  portals and the grass-covered top are generated.
- Hills and mountains drawn beside the track: `mountains` (Gaussian: `height` at the centre, 10 % of it at
  `radius`). They fade out within 24–64 m of open road, where the ground follows the road.
- Sea, lake, river: `water: { level, color, areas, rivers, shore? }`. One flat surface at `level` (m; below the
  road and the land around, e.g. −0.6 to −1.5). `areas`: closed shore outlines `[x, z][]` (smoothed; a sea may
  run past the map edge, ±800 m); `rivers`: `{ points, width }` open centre lines (smoothed, `width` m between
  the banks; extend them past the map edge). The ground is dug below the surface inside them (bed down to 4 m,
  banks rising 1:2) but never within 12 m of open road: the road crosses water only on `bridges` (deck ≥ 1.7 m
  over `level`). `shore`: ground colour within ~14–24 m of the water (beach sand).
- Canyon or gorge: `cuts: [{ points, width, floor, wallHeight?, color? }]`, an open centre line (smoothed) with
  a flat floor `width` m wide at height `floor`, closed at both ends by rounded end walls around the end points
  (extend it past the map edge for an open-ended canyon). Without `wallHeight` the walls (5:1) climb only to
  the surrounding ground (a trench). With `wallHeight` they rise to about `floor + wallHeight` at the floor's
  edges, then a mesa top 3–12 m wide ends in a steep outer cliff (3:1) down to the plain: a gorge through a
  rock massif, so `floor` can stay at road level. The walls are natural rock: their foot steps out by 0–6 m
  (never in) and their height varies ±25 % along the gorge (deterministic noise). With a `color`, the floor,
  walls and mesa are a separate flat-shaded, jittered rock mesh (facets like the arches, crisp edge on the
  sand) and arches in the gorge get the same rock. Red-rock desert gorge: width ~34, floor 0, wallHeight 28,
  color [0.58, 0.27, 0.14] (darker values turn near-black under day light). Make the centre line follow the
  road (within ±5 m: ≥ 12 m from both wall feet); where the road enters or leaves (through an end wall or a
  side wall, roughly at right angles) the ground within 12 m of open road follows the road, so the wall opens
  there: put an `arches` point on that gap.
- Ice cap, snowy peaks: `snowLine: { height, color }` colours ground above `height` m (soft over ±3 m),
  including mountains over tunnels.
- Not supported yet (tell the user): a road over a tunnel, three levels, banked turns, a road across water
  without a bridge.

## 3. Rules (`src/sceneries/sceneries.test.ts`, run for every circuit in `PREVIEW_SCENERIES`)

| Rule | Usual fix |
| - | - |
| ≥ 4 control points; the first sample is `controlPoints[0]` | — |
| Every sample ≤ 200 m from the origin | scale down or recentre |
| Bend radius ≥ 15 m (barriers stand at 11 m) | spread the corner's points, add one at the apex |
| Grade ≤ 15 % | lengthen the climb (move points apart) or lower the top |
| Spans: `1 ≤ from < to ≤ last`; bridges and tunnels share no point; ≥ 40 m from the start | move `[0]` or the span |
| Parts ≥ 100 m apart along the track and < 30 m apart in plan only where the higher one is on a bridge ≥ 7 m above | add a bridge span or raise it; spread parallel roads |
| Climbing hairpins: ground parts < 48 m apart in plan that come back beside each other stay level (≤ 0.5 m) | widen the hairpin (≥ 24 m radius) or flatten it |
| Ground under bridges below the deck | raise the bridge or lengthen the span |
| No other road < 30 m from a tunnel, except within 40 m of its portals | move the road or shorten the tunnel |
| Ground within 9.4 m of open road (curbs) within 0.25 m of the road height | engine invariant: report a failure |
| `water`: every sample ≥ `level` + 0.5, bridge samples ≥ `level` + 1.7, open road ≥ 12 m from any shore or river bank | move the road or the shore, lengthen the bridge over the river, lower `level` |
| `cuts`: open road on a cut's floor at `floor` (± 0.5 m) and ≥ 12 m from both wall feet, except within 30 m (along the track) of where it enters or leaves the floor | move the cut's centre line onto the road, widen it, or make the road cross the wall more squarely |
| `buildings` footprints ≥ 20 m from the centreline (12 m beyond the road edge) | move or shrink the building |
| `arches` on control points `1…last`, over open road (not on a bridge/tunnel), ≥ 40 m from the start | pick another control point |

## 4. Theme and music

- Colours are `Rgb` 0–1 (`skyZenith`, `skyHorizon` = fog, `grassBase`, `grassSpeckles`, `hill`).
- `vegetation`: `PrefabKey`s from `src/assets.ts`, each `{ prefab, count, height, clearance, spacing? }`:
  `clearance` = minimum distance from the centreline, `spacing` = minimum distance to every other plant or prop
  (default 12 m; 6–8 m packs a dense forest: thousands of thin instances stay cheap). Plants are scattered
  within ±300 m, never in water, within 4 m of it, or on a cut's floor, walls or ridges. New glTF models go to
  `src/assets/models/`, `PREFAB_URLS` and `CREDITS.md` (CC0 / CC-BY only).
- Time of day, `lighting`: `"day"` (default), `"sunset"` (low warm sun, sun disc and halo low on the sky at
  `sunAzimuth`, degrees clockwise from up on the scan, default 45; pick a warm `skyHorizon`), `"night"` (stars,
  dimmed scenery, headlights on every moto, a real headlight beam on the player's; pick dark `skyZenith` /
  `skyHorizon`, add `streetLamps` so the road stays readable for kids). `sunAzimuth` also turns the day's
  shadows; at night the moon stands there.
- `streetLamps: N`: lamps on both sides every N m (25–40 looks right), none near the start, on/near bridges and
  tunnels or at arches; they replace the circuit flood lights; at night they glow and light pools on the road.
- `stands`: grand stands on the `"outside"` (default) or `"inside"` of the start straight (tents opposite).
- `arches`: control point indices where a natural rock arch spans the road, across it: a thick irregular
  slab with a 25 m wide, 12 m high opening, legs 20 m out, its top flush with the highest ground beside it.
  Where the road cuts through a gorge ridge (`wallHeight`), put the point on the ridge crest, at
  `width/2 + wallHeight/5 + 2` m from the cut's centre line, so the arch fills the ridge's gap; it takes the
  nearest cut's `color` (else grey rock).
- `buildings`: boxes `{ x, z, width, depth, height, rotY? }` (footprint centred on x/z, width along x, depth
  along z before the yaw `rotY`, radians, default 0) with a window-grid facade and flat roof, standing on the
  terrain; windows light up at night.
- `props`: drawn prefabs `{ prefab, x, z, height, rotY? }` (igloos, snowmen, palms…) standing on the terrain;
  `rotY` default random (seeded). Vegetation keeps clear of props and buildings.
- Compose a new race song with the notation at the top of `src/music.ts` (model on `MEADOW_RACE` in
  `src/songs.ts`), add its id to `SongId` and `SONGS`, set `raceSong`. Never reuse another scenery's song
  (a test checks it).

## 5. Validate

`npm test` and `npm run build`.

## 6. Preview and video

1. Vite as a supervised service (no relay needed): `npx vite --port 5173 --strictPort --host 127.0.0.1`. If the
   port is taken by another checkout, use another port and adjust the URLs.
2. Browser as in `skill://mc-race-recording` §2: `browser.open({name, headed: true, persist: true, url,
   viewport: {width: 1440, height: 810}})`, then the rAF sanity check.
3. Open `http://localhost:5173/?preview=<id>&audio=0`; poll `document.body.dataset.preview` for `ready`
   (`unknown` = wrong id; the console logs `[scenery] <id> built in N ms`).
4. Screenshot and compare the minimap (top right) with the scan: shape, orientation, driving direction (the
   yellow dot leaves the red start dot), tunnels dashed, bridges yellow on top.
5. `tab.recordStart("/tmp/mc-scenery/<id>.mp4")`, wait 2 s, `tab.click("#renderCanvas")`, poll for `done`
   (lap length / 30 m/s + 3 s; the rider keeps the chase view past the line), `tab.recordStop()`.
   When the machine is loaded, `recordStop()` can time out and lose the video. Fallback: after the click, loop
   `page.screenshot({encoding: "base64", type: "jpeg", quality: 70})` via `tab.run` into numbered files until
   `done` (about 7–9 frames/s), then `ffmpeg -framerate <frames/seconds> -i f%03d.jpg -pix_fmt yuv420p <id>.mp4`.
6. Inspect: `read <file>.mp4` gives a frame grid; check bridges, portals and bends at full resolution with
   `ffmpeg -ss <t> -i <file>.mp4 -frames:v 1 frame.png` (grids are downscaled and hide small defects). Look
   for ground or props poking through road, deck or tube, holes in the ground, flickering surfaces.
   `tab.screenshot({path})` does not save the file: use `tab.run(({page}) => page.screenshot({encoding:
   "base64"}))` and write it yourself for full-resolution stills.
7. Give the user the video (`open <file>`), the minimap screenshot and a table of control points, heights and
   spans; iterate on their feedback.

