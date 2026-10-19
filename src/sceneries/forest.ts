import type { Scenery } from "./types";

/** Water surface under the river bridges (decks 1.5–3 m high: 3–4.5 m over the water). */
const WATER_LEVEL = -1.5;

export const FOREST: Scenery = {
  id: "forest",
  name: { sv: "Skogsbanan", en: "Forest Circuit", fr: "Circuit de la Forêt" },
  // Scan page 5 at 0.27 m/px. Figure 8: the west loop clockwise (start on its west side, heading north), the
  // east lobe counter-clockwise. The "up"/"down" pass climbs over the middle crossing on a bridge (8.5 m deck, ≥ 7 m
  // over the lower pass); low bridges hop over the river on the west ("bridge") and south ("brige") of the west loop.
  controlPoints: [
    [-138.5, -28], // 0 start line
    [-143, -6],
    [-146.5, 15, 1.5], // 2 west river bridge
    [-145, 40, 3],
    [-133, 64, 1.5],
    [-116.6, 76.1], // 5
    [-81.5, 85.1, 1],
    [-57.2, 77.5, 3.5], // 7 "up": crossing bridge
    [-39.7, 55.9, 6.5],
    [-22.1, 20.8, 8.5], // 9 over the crossing
    [-4.6, -8.9, 7.2], // 10
    [15.7, -33.2, 3.5], // 11 "down"
    [42.7, -58.9, 1],
    [72.4, -79.1],
    [106.1, -85.9],
    [137.2, -73.7], // 15
    [148.0, -41.3],
    [138.5, 1.9],
    [127.7, 42.4],
    [118.3, 74.8],
    [94.0, 88.3], // 20
    [58.9, 81.5],
    [26.5, 64.0],
    [2.2, 42.4],
    [-23.5, 18.1], // 24 under the crossing bridge
    [-43.7, -3.5], // 25
    [-59.9, -27.8],
    [-67, -50, 1.5], // 27 south river bridge
    [-80, -68, 3],
    [-99, -76, 3],
    [-119, -67, 1.5], // 30
    [-132, -47],
  ],
  bridges: [
    { from: 2, to: 4 },
    { from: 7, to: 11 },
    { from: 27, to: 30 },
  ],
  tunnels: [],
  mountains: [],
  water: {
    level: WATER_LEVEL,
    color: [0.14, 0.32, 0.36],
    areas: [
      // The lake south of the crossing.
      [
        [-69.4, -106.1],
        [-62.6, -91.3],
        [-41.0, -84.5],
        [-32.9, -52.1],
        [-20.8, -33.2],
        [-7.3, -46.7],
        [2.2, -76.4],
        [23.8, -92.6],
        [37.3, -103.4],
        [34.6, -115.6],
        [7.6, -121.0],
        [-22.1, -115.6],
        [-46.4, -118.3],
        [-66.7, -116.9],
      ],
    ],
    rivers: [
      {
        // From the north-west, under the west bridge, along the stands, under the south bridge, out to the south.
        points: [
          [-780, 330],
          [-500, 200],
          [-235.4, 77.5],
          [-194.9, 58.6],
          [-165, 48],
          [-146, 42],
          [-124, 32],
          [-106, 6],
          [-97, -22],
          [-93, -49],
          [-89.6, -72.4],
          [-95.0, -103.4],
          [-97.7, -138.5],
          [-100, -400],
          [-110, -780],
        ],
        width: 14,
      },
    ],
  },
  skyZenith: [0.3, 0.52, 0.78],
  skyHorizon: [0.7, 0.8, 0.82],
  grassBase: [0.2, 0.4, 0.16],
  grassSpeckles: [
    [0.16, 0.33, 0.12],
    [0.25, 0.46, 0.18],
    [0.33, 0.4, 0.17],
  ],
  hill: [0.12, 0.3, 0.13],
  // A tall, dense forest right outside the barriers (11 m): pines packed 7 m apart.
  vegetation: [
    { prefab: "pineTall", count: 1700, height: [20, 30], clearance: 17, spacing: 7 },
    { prefab: "pineRound", count: 500, height: [16, 24], clearance: 17, spacing: 7 },
    { prefab: "treeTall", count: 250, height: [14, 20], clearance: 17, spacing: 7 },
    { prefab: "treeRound", count: 120, height: [10, 14], clearance: 17, spacing: 7 },
    { prefab: "bush", count: 150, height: [1.2, 2.2], clearance: 14, spacing: 4 },
    { prefab: "rock", count: 30, height: [1, 2.5], clearance: 14 },
  ],
  raceSong: "forestRace",
  lighting: "day",
  stands: "inside",
};
