import type { PrefabKey } from "./assets";
import type { Rgb } from "./look";

/** Scenery themes; snow/desert later = another SceneryTheme object. */
export type ThemeId = "meadow";

export interface Vegetation {
  prefab: PrefabKey;
  count: number;
  /** Height range in metres (uniformly sampled). */
  height: [number, number];
  /** Minimum distance from every track centreline sample. */
  clearance: number;
}

export interface SceneryTheme {
  id: ThemeId;
  skyZenith: Rgb;
  /** Also the fog and clear colour. */
  skyHorizon: Rgb;
  grassBase: Rgb;
  grassSpeckles: readonly Rgb[];
  hill: Rgb;
  vegetation: readonly Vegetation[];
}

export const MEADOW: SceneryTheme = {
  id: "meadow",
  skyZenith: [0.24, 0.51, 0.86],
  skyHorizon: [0.75, 0.86, 0.96],
  grassBase: [0.34, 0.63, 0.24],
  grassSpeckles: [
    [0.27, 0.55, 0.2],
    [0.39, 0.69, 0.27],
    [0.47, 0.73, 0.31],
  ],
  hill: [0.3, 0.62, 0.25],
  vegetation: [
    { prefab: "treeRound", count: 50, height: [7, 11], clearance: 28 },
    { prefab: "treeTall", count: 40, height: [8, 12], clearance: 28 },
    { prefab: "treeSmall", count: 30, height: [5, 7], clearance: 28 },
    { prefab: "bush", count: 60, height: [1.2, 2], clearance: 14 },
    { prefab: "rock", count: 20, height: [1, 2.5], clearance: 14 },
  ],
};
