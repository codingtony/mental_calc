# Mental Calc GP — Game v2

Motorcycle-racing version of the mental-math game, served at the site root `/`. The original console game (v1) lives in `1/`
and is served at `/1/`; `2/index.html` only redirects the old `/2/` URL (and its `?room=` QR codes) to `/`.
Vite + TypeScript + Babylon.js; the motos, riders and circuit props are free glTF models in `src/assets/models/`
(CC0 / CC-BY, see its `CREDITS.md`); the track, sky, music and sound effects are generated in code.

## How it plays

1. Intro animation (about 4.5 s; tap or press a key to skip).
2. Setup: driver name, number of questions (10 / 30 / 50 / 120), difficulty
   (Easy 10 s, Medium 5 s, Hard 3 s per question), music and sound on/off (both off by default), language
   (Swedish by default, English, French; pick with the flags).
3. Choose a cup: Plus (+), Plus-Minus (+ −), Times (×), Times-Divide (× ÷) or Star (all four).
4. Race against 7 rivals. Each rival keeps a fixed pace relative to the goal time
   (questions × seconds per question). "Max Plus" drives exactly at goal pace, so
   **finishing in the top 3 means you reached the goal**. Each correct answer boosts
   your moto forward; while you think, it creeps on at goal pace, then stalls.
   A wrong answer spins the moto and asks the same question again.
   You have 3 hearts: each wrong answer costs one, and losing the last one crashes the moto (DNF).
5. Results: position, time, goal and errors, plus "Last races" and "High scores"
   (high scores are per question count, cup and difficulty; crashed races are excluded).

Questions come from the v1 engine (`src/questions.ts`, ported from `1/game.js`) with v1's default operand ranges.

## Class race (multiplayer)

Up to 30 kids race each other on the same questions through a small WebSocket relay
(`relay/`, protocol in `relay/PROTOCOL.md`). Nothing is stored: multiplayer races never
appear in "Last races" or "High scores".

### Teacher guide

1. **Host**: open the game on the projected computer, press **Host a race** on the first screen.
   A 5-character code and a QR code appear.
2. **Share the code**: kids scan the QR code (it opens the game with the code filled in) or press
   **Join a race** and type the code, then their name. Their names show up in your list; ✕ removes one.
3. **Start**: pick the cup, number of questions and difficulty, then **Start the race**. Every kid
   gets the same questions. Wrong answers work as in solo: retry, and the 3rd one crashes the moto.
   Your screen shows the lanes of the top 5; tick **Show all players** to see everyone.
   The race ends by itself when everyone has finished or crashed, or when you press **End the race**.
4. **Rematch**: on the podium screen press **Rematch**: everyone goes back to the waiting room with
   new questions, nobody types the code again. Change the settings if you like and start again.

If you reload your tab, the room comes back (same code, same players) as long as you return
within 2 minutes. A kid whose Wi-Fi drops is shown as disconnected, keeps their place and
carries on automatically when the connection returns.

Ranking: finished kids by finish time, then racing kids by answers (ties: who got there first),
then crashed kids by answers (ties: who lasted longer). Each device times itself, so network lag
does not matter.

### Relay URL

Default `wss://mc-relay.learnsvenska.com/ws`. Override at build time with `VITE_RELAY_URL`, or per
tab with `?relay=ws://localhost:8010/ws` (the relay's `ALLOWED_ORIGINS` must include the page's host).

## Graphics quality

At load the game measures the frame rate for 2 s (during the intro) and, on a slow device, lowers
the quality: level 1 = smaller/softer moto shadows, 2 = also renders at ⅔ resolution, 3 = no moto
shadows and ½ resolution. It checks once more after a drop. The browser console logs the result
(`[quality] 60 fps → level 0`). Force a level per tab with `?quality=0` … `?quality=3`.

## Storage

localStorage keys `mcgp.prefs` (name, language, last settings, audio toggles) and `mcgp.games`
(the last 200 races). The first visit prefills the name from v1's `name` key; v1's own keys are never written.
sessionStorage keys `mcgp.mp.host` (room code, host token and race state) and `mcgp.mp.player`
(room code, player token) let a reloaded tab rejoin its class race.

## Source layout

| File | Role |
| - | - |
| `src/config.ts` | Categories, difficulties, cups, rivals and their paces |
| `src/race.ts` | Race rules (progress, positions, errors, finish/crash), no rendering |
| `src/world.ts`, `src/track.ts`, `src/moto.ts`, `src/helmet.ts` | Babylon scene, circuit, motos/riders, cameras and effects |
| `src/assets.ts`, `src/assets/models/` | glTF loading, prefabs (thin instances), moto template; models + `CREDITS.md` |
| `src/look.ts`, `src/theme.ts` | Rider look (bike/suit/helmet, sent to multiplayer rooms) and scenery theme data |
| `src/quality.ts` | Load-time frame-rate probe that lowers graphics quality on slow devices |
| `src/audio.ts` | `GameAudio`: master bus, song playback (menu, per-circuit race song, results jingles), sound effects, motorbike engine with gears |
| `src/music.ts`, `src/songs.ts` | Song notation compiler and the composed songs (`SONGS`); a circuit's `SceneryTheme.raceSong` picks its race music |
| `src/synth.ts` | WebAudio instrument voices, per-song mixer (reverb, delay) and noise/envelope helpers |
| `src/storage.ts`, `src/i18n.ts`, `src/ui.ts` | Persistence, translations, DOM rendering |
| `src/rng.ts` | Seeded PRNG (`mulberry32`): same seed → same questions on every device |
| `src/net/protocol.ts` | Relay message types (mirror of `relay/PROTOCOL.md`) |
| `src/net/connection.ts` | WebSocket wrapper: reconnect with backoff, ping, session tokens |
| `src/net/standings.ts` | Host-side ranking and the 2-per-second standings throttle |
| `src/net/room.ts` | Host room (authoritative standings) and player room state |
| `src/main.ts` | Screen state machine and render loop |

In dev mode, `window.__mc` exposes `session()`, `solve()`, `fail()`, `host()` and `player()` for console testing.

## Dev

npm install
npm run dev

## Build

npm run build

## Test

npm test
