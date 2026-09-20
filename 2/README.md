# Mental Calc — Game v2 (scaffold)

Work-in-progress graphical/3D rewrite of the mental-math practice game. The original
console-style game at the repo root is untouched and still lives there.

Currently this folder only contains:

- A Vite + TypeScript + Babylon.js scaffold (`src/main.ts`) rendering a placeholder
  rotating cube and one sample question overlay, proving the toolchain and the
  ported question-generation module are wired together.
- `src/questions.ts`: the question-bank generation and mode-parsing algorithm
  ported unchanged from the root `game.js`'s `Game` class. No scoring, highscore,
  timer, or UI logic was ported.

Game mechanics are not designed yet.

## Dev

npm install
npm run dev

## Build

npm run build
