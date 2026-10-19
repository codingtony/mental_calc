import type { Scenery } from "./types";

/**
 * From the ice world drawing (0.41 m per scan pixel), counter-clockwise on the scan: start line on the west
 * straight, south past the stand, east along the bottom, an S up the tongue between the snowmen's village
 * and the igloos, east on the road over the ice cap (12 m) along the mountain's south flank, north up the
 * east side and west through the tunnel in the mountain's north part, back down to the start.
 * The S and both its hairpins stay level at 4 m: the climb onto the ice cap starts after them.
 */
export const ICE: Scenery = {
  id: "ice",
  name: { sv: "Isvärlden", en: "Ice World", fr: "Monde de Glace" },
  controlPoints: [
    [-121.3, 1.6],
    [-136.2, -21.5, 0.3],
    [-143.5, -40.9, 0.8],
    [-145.9, -58.5, 1.4],
    [-143.5, -74.6, 1.9],
    [-137.5, -89.4, 2.5],
    [-128.3, -102.1, 3],
    [-115.5, -112.1, 3.5],
    [-100.3, -120.2, 3.8],
    [-79.8, -123.2, 4],
    [-54, -124.9, 4],
    [-28.9, -125, 4],
    [-10.7, -124.5, 4],
    [2.3, -120.9, 4],
    [10.9, -113.4, 4],
    [15.4, -103.7, 4],
    [15.6, -93.4, 4],
    [11.8, -83.7, 4],
    [5.5, -75.5, 4],
    [-1.3, -67.6, 4],
    [-6.3, -58.5, 4],
    [-7.7, -48.3, 4],
    [-4.9, -38.2, 4],
    [1.8, -29.8, 4],
    [12.5, -24.6, 4],
    [27.2, -23.8, 4.4],
    [48, -25.6, 6],
    [76.6, -28.2, 9.1],
    [102.4, -30.5, 11.4],
    [120.5, -31.1, 12],
    [134, -27.1, 12],
    [143.4, -18.4, 12],
    [148.4, -5.9, 11.9],
    [148.4, 10.5, 11.5],
    [145.9, 33.4, 10.6],
    [138, 62.5, 9.1],
    [126.9, 87.3, 7.7],
    [114.7, 104.8, 6.8],
    [99, 115.8, 6.2],
    [79.3, 122.1, 6],
    [54.2, 124.8, 5.9],
    [25.8, 123.8, 5.7],
    [-0.5, 119.3, 5.4],
    [-24.2, 107.7, 5.1],
    [-49.3, 88.9, 5],
    [-74.9, 61.6, 3.7],
    [-98.7, 30, 1.2],
  ],
  bridges: [],
  // "Tunnel" between the two portals drawn across the north road.
  tunnels: [{ from: 39, to: 44 }],
  // The central mountain (ice cap) and its north part over the tunnel.
  mountains: [
    { x: 57, z: 42, height: 50, radius: 120 },
    { x: 15, z: 130, height: 30, radius: 75 },
    { x: 75, z: 130, height: 30, radius: 75 },
  ],
  stands: "outside",
  lighting: "day",
  skyZenith: [0.45, 0.65, 0.88],
  skyHorizon: [0.85, 0.92, 0.98],
  grassBase: [0.88, 0.92, 0.97],
  grassSpeckles: [
    [0.8, 0.86, 0.94],
    [0.93, 0.96, 1],
    [0.75, 0.82, 0.92],
  ],
  hill: [0.78, 0.86, 0.95],
  // Cross-hatched ice cap: the mountain and the road over it.
  snowLine: { height: 9, color: [0.66, 0.84, 0.98] },
  // Igloos ("I") and snowmen ("S") where drawn.
  props: [
    { prefab: "igloo", x: -136.7, z: 92.5, height: 6 },
    { prefab: "snowman", x: -173.6, z: 59.7, height: 2.5 },
    { prefab: "igloo", x: -35.5, z: 26.9, height: 5 },
    { prefab: "snowman", x: -69.5, z: -48.2, height: 2.5 },
    { prefab: "snowman", x: -83.4, z: -69.9, height: 2.5 },
    { prefab: "igloo", x: -61.3, z: -81, height: 5 },
    { prefab: "snowman", x: -35.5, z: -94.5, height: 2.5 },
    { prefab: "snowman", x: 46.5, z: -81, height: 2 },
    { prefab: "igloo", x: 72.4, z: -98.2, height: 6 },
    { prefab: "snowman", x: 97, z: -78.1, height: 2.5 },
    { prefab: "igloo", x: 106, z: -103.5, height: 4.5 },
  ],
  vegetation: [
    { prefab: "treeSnow", count: 70, height: [7, 11], clearance: 28 },
    { prefab: "treeSnow", count: 40, height: [4, 6], clearance: 20 },
  ],
  raceSong: "iceRace",
};
