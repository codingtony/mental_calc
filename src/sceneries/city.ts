import type { Scenery } from "./types";

/** Pretzel through town: a park loop, then a loop around a block that comes back over itself on a viaduct (drawing "city"). */
export const CITY: Scenery = {
  id: "city",
  name: { sv: "Stadsbanan", en: "City Circuit", fr: "Circuit de la Ville" },
  // Drawing at 0.21 m/px. Start on the west side heading south (the east side's arrow points north): round the
  // park's south side, north-east between the two tree rows, south down the east side (under the viaduct), round
  // the south-east block clockwise, then up onto the viaduct, over the first pass (9 m above it), round the
  // south-east corner and back to the ground on the east side, north and west over the top, west past the park.
  // The viaduct is long because every road beside its ramps must stay level.
  controlPoints: [
    [-125.1, -13.1],
    [-122.3, -32],
    [-112.9, -47.8],
    [-96.1, -56.2],
    [-73, -50.9],
    [-49.9, -38.3],
    [-30.6, -23.2],
    [-12.9, -6.8],
    [8.9, 12.1],
    [25.7, 31],
    [46.7, 37.3],
    [67.7, 35.2],
    [84.5, 24.7],
    [91.9, 10],
    [91.9, -6.8],
    [88.7, -21.5],
    [81.4, -38.3],
    [76.1, -55.1],
    [63.5, -70.9],
    [42.5, -77.8],
    [23.6, -76.5],
    [12.1, -67.7],
    [7.9, -51.3],
    [13.1, -30.3, 2.4],
    [25.7, -17.3, 4.9],
    [44.6, -11.4, 7.3],
    [63.5, -14.4, 8.6],
    [76.1, -19.8, 9],
    [95, -29.5, 9],
    [105.9, -32, 8.8],
    [117.1, -28.9, 8.4],
    [125.5, -20.5, 7.8],
    [128.6, -7.9, 6.8],
    [128.2, 10, 5],
    [121.3, 29.9, 2.6],
    [109.7, 49.9],
    [92.9, 66.7],
    [67.7, 77.2],
    [46.7, 77.2],
    [21.5, 66.7],
    [4.7, 54.1],
    [-12.1, 39.4],
    [-37.3, 35.2],
    [-68.8, 36.2],
    [-100.3, 34.1],
    [-119.2, 24.7],
    [-127.6, 7.9],
  ],
  bridges: [{ from: 22, to: 35 }],
  tunnels: [],
  mountains: [],
  skyZenith: [0.56, 0.68, 0.8],
  skyHorizon: [0.85, 0.87, 0.88],
  grassBase: [0.42, 0.52, 0.38],
  grassSpeckles: [
    [0.37, 0.47, 0.34],
    [0.46, 0.55, 0.42],
    [0.5, 0.56, 0.47],
  ],
  hill: [0.44, 0.5, 0.42],
  vegetation: [
    { prefab: "treeRound", count: 12, height: [7, 10], clearance: 28 },
    { prefab: "treeSmall", count: 12, height: [5, 7], clearance: 24 },
    { prefab: "bush", count: 30, height: [1.2, 2], clearance: 16 },
  ],
  raceSong: "cityRace",
  lighting: "day",
  streetLamps: 40,
  stands: "inside",
  // Drawn blocks as footprint rectangles, kept 20 m from the centreline (moved out or shrunk where the
  // drawing has them closer); taller towards the edge of town. The small block between the middle tree
  // rows is left out: that strip is too narrow for a building.
  buildings: [
    { x: -120.8, z: 61.7, width: 56.7, depth: 22.1, height: 34, rotY: -0.36 }, // north-west
    { x: -69.8, z: 80.3, width: 40.9, depth: 36.8, height: 30 }, // north, square block
    { x: -33.5, z: 73.4, width: 30, depth: 21, height: 18 }, // north, next to it
    { x: 22.6, z: 102.8, width: 50.4, depth: 17.8, height: 26, rotY: -0.27 }, // curved north-east row, west part
    { x: 76.1, z: 110.4, width: 54.6, depth: 14.7, height: 38, rotY: 0.05 }, // curved north-east row, middle
    { x: 128.6, z: 85.6, width: 42, depth: 18.9, height: 42, rotY: 0.9 }, // curved north-east row, east end
    { x: 141, z: -52.5, width: 40, depth: 16, height: 36, rotY: -0.35 }, // east, past the viaduct's corner
    { x: 136, z: -82, width: 36, depth: 20, height: 40, rotY: 0.03 }, // south-east corner
    { x: 99.8, z: -73.7, width: 26, depth: 15, height: 28, rotY: -0.86 }, // south-east, tilted
    { x: 44, z: -44, width: 19, depth: 16.5, height: 14, rotY: -0.4 }, // inside the south-east loop
    { x: -36.7, z: -76.6, width: 53.5, depth: 23.1, height: 20, rotY: -0.2 }, // south, long block
    { x: -89.1, z: -86.3, width: 29.4, depth: 17.2, height: 24 }, // south, small
    { x: -141.4, z: -74.2, width: 25.2, depth: 37.8, height: 45, rotY: -0.35 }, // south-west corner
  ],
  props: [
    // Trees drawn west of the start, in the north-east tree row and in the middle tree row.
    { prefab: "treeRound", x: -142.3, z: 25.7, height: 9 },
    { prefab: "treeRound", x: -145.4, z: 3.7, height: 9 },
    { prefab: "treeRound", x: -149, z: -18.4, height: 9 },
    { prefab: "treeRound", x: 45.7, z: 56.2, height: 9 },
    { prefab: "treeRound", x: 63.5, z: 56.2, height: 9 },
    { prefab: "treeRound", x: 77.2, z: 49.9, height: 9 },
    { prefab: "treeSmall", x: 33.1, z: 10.4, height: 6 },
    { prefab: "treeSmall", x: 49.9, z: 14.6, height: 6 },
    { prefab: "treeSmall", x: 63.5, z: 6.8, height: 6 },
    { prefab: "treeSmall", x: -5.4, z: -19.8, height: 6 },
    { prefab: "treeSmall", x: -15.2, z: -35.2, height: 6 },
    { prefab: "treeSmall", x: -24.7, z: 7.9, height: 6 },
    // The park inside the west loop.
    { prefab: "bush", x: -82.4, z: 5.8, height: 1.6 },
    { prefab: "bush", x: -66.7, z: 8.9, height: 1.6 },
    { prefab: "bush", x: -48.8, z: 6.8, height: 1.6 },
    { prefab: "bush", x: -39.4, z: -6.8, height: 1.6 },
    { prefab: "bush", x: -86.6, z: -13.1, height: 1.6 },
    { prefab: "bush", x: -70.9, z: -8.9, height: 1.6 },
    { prefab: "bush", x: -54.1, z: -11, height: 1.6 },
    { prefab: "bush", x: -75.1, z: -21.5, height: 1.6 },
    { prefab: "bush", x: -62.5, z: -21.5, height: 1.6 },
    { prefab: "bush", x: -79.3, z: -0.5, height: 1.6 },
    { prefab: "bush", x: -58.3, z: -0.5, height: 1.6 },
  ],
};
