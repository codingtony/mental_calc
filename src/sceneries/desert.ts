import type { Scenery } from "./types";

/**
 * From the desert drawing (0.3 m per scan pixel), clockwise on the scan: start line bottom-left, up the west
 * side past the stand, along the winding north side, under the first arch into the red-rock canyon on the
 * east, south between its high walls, out under the second arch and back west along the south straight.
 * The whole road stays at plain level: the canyon walls rise above the sand.
 */
export const DESERT: Scenery = {
  id: "desert",
  name: { sv: "Ökenbanan", en: "Desert Circuit", fr: "Circuit du Désert" },
  controlPoints: [
    [-140, -60],
    [-158, -24],
    [-161.5, 24],
    [-154.9, 60],
    [-138.4, 85.5],
    [-115.9, 95.4],
    [-86, 91.5],
    [-58.9, 77.4],
    [-28.9, 62.4],
    [-4, 65],
    [19, 75],
    [46, 87],
    [73, 76],
    [88, 58],
    [100, 42],
    [117, 32],
    [136.5, 27.4],
    [152, 19],
    [162, 3],
    [162, -28],
    [161, -56],
    [156, -76],
    [140.2, -93.2],
    [118, -99],
    [80, -95],
    [25.1, -90.6],
    [-19.9, -93.6],
    [-65, -90.6],
    [-101, -82.5],
    [-118, -78],
  ],
  bridges: [],
  tunnels: [],
  mountains: [],
  // The canyon follows the road's east side and is closed at both ends; its centre line is the road's own
  // centreline, starting and ending 24.6 m (the end walls' ridge) from the arches.
  cuts: [
    {
      points: [
        [156.4, 14.5],
        [162.4, 0.5],
        [162.6, -15.1],
        [162, -30.2],
        [161.7, -45.5],
        [160.5, -60.5],
        [155.7, -76.5],
      ],
      width: 34,
      floor: 0,
      wallHeight: 28,
      // Dark red-brown rock as rendered in the desert's sunlight (darker values turn black-maroon).
      color: [0.58, 0.27, 0.14],
    },
  ],
  // "Arch in canyon": on the end walls' ridge, where the road enters (north) and leaves (south) the canyon.
  arches: [16, 22],
  stands: "inside",
  lighting: "day",
  skyZenith: [0.42, 0.66, 0.9],
  skyHorizon: [0.97, 0.91, 0.78],
  grassBase: [0.87, 0.74, 0.5],
  grassSpeckles: [
    [0.82, 0.67, 0.43],
    [0.92, 0.8, 0.58],
    [0.78, 0.6, 0.38],
  ],
  hill: [0.83, 0.62, 0.4],
  // Cacti drawn on the scan ("c" circles; big circles = tall cacti).
  props: [
    { prefab: "cactusTall", x: -50, z: 133.5, height: 6 },
    { prefab: "cactusShort", x: -21.5, z: 97.5, height: 3.5 },
    { prefab: "cactusShort", x: -194, z: 75, height: 3.5 },
    { prefab: "cactusShort", x: -200.5, z: 28.5, height: 3 },
    { prefab: "cactusTall", x: -198.5, z: -31.5, height: 5.5 },
    { prefab: "cactusShort", x: -188, z: -76.5, height: 3.5 },
    { prefab: "cactusTall", x: -104, z: 42, height: 4.5 },
    { prefab: "cactusShort", x: -91.5, z: 38.5, height: 2 },
    { prefab: "cactusTall", x: -78.5, z: 3.5, height: 5 },
    { prefab: "cactusShort", x: -84.5, z: -26.5, height: 3.5 },
    { prefab: "cactusShort", x: -36, z: -52.5, height: 4 },
    { prefab: "cactusTall", x: 9.5, z: 12.5, height: 5 },
    { prefab: "cactusTall", x: 49.5, z: 36.5, height: 4.5 },
    { prefab: "cactusTall", x: 95.5, z: -20.5, height: 5 },
    { prefab: "cactusTall", x: -59, z: -139.5, height: 5 },
    { prefab: "cactusShort", x: -74, z: -147, height: 2.5 },
    { prefab: "cactusShort", x: -41.5, z: -152, height: 2.5 },
  ],
  vegetation: [
    { prefab: "cactusTall", count: 40, height: [3.5, 6], clearance: 20 },
    { prefab: "cactusShort", count: 60, height: [2, 3.5], clearance: 16 },
    { prefab: "rock", count: 50, height: [1, 3.5], clearance: 14 },
  ],
  raceSong: "desertRace",
};
