# Mental Calc GP — Game v2

Kart-racing version of the mental-math game, served at `/2/` (the v1 start page links to it).
Vite + TypeScript + Babylon.js; all 3D geometry, music and sound effects are generated in code (no asset files).

## How it plays

1. Intro animation (about 4.5 s; tap or press a key to skip).
2. Setup: driver name, number of questions (10 / 30 / 50 / 120), difficulty
   (Easy 10 s, Medium 5 s, Hard 3 s per question), music and sound on/off, language
   (Swedish by default, English, French; pick with the flags).
3. Choose a cup: Plus (+), Plus-Minus (+ −), Times (×), Times-Divide (× ÷) or Star (all four).
4. Race against 7 rivals. Each rival keeps a fixed pace relative to the goal time
   (questions × seconds per question). "Max Plus" drives exactly at goal pace, so
   **finishing in the top 3 means you reached the goal**. Each correct answer boosts
   your kart forward; while you think, it creeps on at goal pace, then stalls.
   A wrong answer spins the kart and asks the same question again.
   The 4th wrong answer crashes the kart (DNF).
5. Results: position, time, goal and errors, plus "Last races" and "High scores"
   (high scores are per question count, cup and difficulty; crashed races are excluded).

Questions come from the v1 engine (`src/questions.ts`, ported from the root `game.js`) with v1's default operand ranges.

## Storage

localStorage keys `mcgp.prefs` (name, language, last settings, audio toggles) and `mcgp.games`
(the last 200 races). The first visit prefills the name from v1's `name` key; v1's own keys are never written.

## Source layout

| File | Role |
| - | - |
| `src/config.ts` | Categories, difficulties, cups, rivals and their paces |
| `src/race.ts` | Race rules (progress, positions, errors, finish/crash), no rendering |
| `src/world.ts`, `src/track.ts`, `src/kart.ts` | Babylon scene, circuit, karts, cameras and effects |
| `src/audio.ts` | WebAudio music sequencer and sound effects |
| `src/storage.ts`, `src/i18n.ts`, `src/ui.ts` | Persistence, translations, DOM rendering |
| `src/main.ts` | Screen state machine and render loop |

In dev mode, `window.__mc` exposes `session()`, `solve()` and `fail()` for console testing.

## Dev

npm install
npm run dev

## Build

npm run build
