import { MEADOW } from "./meadow";
import type { Scenery } from "./types";

/** Bergsbanan: the figure 8 that first used heights, a bridge and a tunnel (the skill's reference circuit). */
export const SHOWCASE: Scenery = {
  ...MEADOW,
  id: "showcase",
  name: { sv: "Bergsbanan", en: "Mountain Circuit", fr: "Circuit de la Montagne" },
  raceSong: "showcaseRace",
  // Figure 8 (lemniscate, a = 170 m): start on a 9 m crest, crossing 1 on a bridge 9 m above crossing 2,
  // a curved tunnel through the west mountain.
  controlPoints: [
    [170, 0, 9],
    [117.8, 58.9, 6],
    [48.6, 42.1, 6],
    [0, 0, 9],
    [-48.6, -42.1, 6],
    [-117.8, -58.9, 2],
    [-170, 0, 2],
    [-117.8, 58.9, 2],
    [-48.6, 42.1, 0],
    [0, 0, 0],
    [48.6, -42.1, 0],
    [117.8, -58.9, 6],
  ],
  bridges: [{ from: 2, to: 4 }],
  tunnels: [{ from: 5, to: 7 }],
  mountains: [
    { x: -200, z: 0, height: 70, radius: 140 },
    { x: 60, z: 150, height: 30, radius: 90 },
    { x: 110, z: 0, height: 15, radius: 45 },
  ],
};
