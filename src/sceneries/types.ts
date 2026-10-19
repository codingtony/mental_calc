import type { PrefabKey } from "../assets";
import type { Lang } from "../i18n";
import type { Rgb } from "../look";
import type { SongId } from "../songs";

/** One id per file in src/sceneries/; extend when adding a scenery. */
export type SceneryId = "meadow" | "showcase" | "coast" | "night" | "ice" | "desert" | "city" | "forest";

/** Centreline point in metres: +x = right on the scan, +z = up on the scan, y = road height (default 0). */
export type ControlPoint = readonly [x: number, z: number, y?: number];

/** Plan point in metres, same axes as ControlPoint. */
export type PlanPoint = readonly [x: number, z: number];

/** Sea, lakes and rivers share one flat water surface; the ground is dug below it inside them. */
export interface Water {
  /** Surface height (m); keep it below the road and the surrounding ground. */
  level: number;
  color: Rgb;
  /** Closed shore outlines (sea, lake), smoothed; may reach beyond the map edge (±800 m). */
  areas: readonly (readonly PlanPoint[])[];
  /** Open centre lines, smoothed, `width` m between the banks. The road crosses them only on bridges. */
  rivers: readonly { points: readonly PlanPoint[]; width: number }[];
  /** Ground colour along the shores (beach sand); default: the scenery's grass. */
  shore?: Rgb;
}

/**
 * Dry trench (canyon, gorge): open centre line, floor at height `floor` (m), `width` m wide at the floor,
 * near-vertical walls. The road runs on the floor ≥ 12 m from both walls, or crosses a wall (the ground
 * within 12 m of open road always follows the road: the wall opens there).
 */
export interface Cut {
  points: readonly PlanPoint[];
  width: number;
  floor: number;
  /**
   * Walls rise to floor + wallHeight at the floor's edges, then a ridge falls back to the surrounding
   * ground: a gorge between rock ridges standing above the plain. Default: the walls climb only to the
   * surrounding ground (a trench dug into it).
   */
  wallHeight?: number;
  /** Rock colour of the floor, walls and ridges; default: the scenery's grass. */
  color?: Rgb;
}

/** A prop at a drawn position (igloo, snowman, palm…), standing on the terrain. */
export interface PlacedProp {
  prefab: PrefabKey;
  x: number;
  z: number;
  /** Height in metres. */
  height: number;
  /** Yaw in radians (default: random). */
  rotY?: number;
}

/** Box building with lit windows: footprint centred on (x, z), sizes in metres, yaw in radians. */
export interface Building {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotY?: number;
}

/** Day: bright sun. Sunset: low warm sun at `sunAzimuth`. Night: dark, lit by street lamps and the riders' headlights. */
export type Lighting = "day" | "sunset" | "night";

/** Control points from..to (indices, 1 ≤ from < to ≤ last) carried by a bridge / inside a tunnel. */
export interface Span {
  from: number;
  to: number;
}

/** Gaussian relief: `height` m at (x, z), 10 % of it `radius` m away. */
export interface Mountain {
  x: number;
  z: number;
  height: number;
  radius: number;
}

export interface Vegetation {
  prefab: PrefabKey;
  count: number;
  /** Height range in metres (uniformly sampled). */
  height: [number, number];
  /** Minimum distance from every track centreline sample. */
  clearance: number;
  /** Minimum distance (m) from this plant to every other placed prop or plant; default 12. */
  spacing?: number;
}

export interface Scenery {
  id: SceneryId;
  /** Shown in the HUD and in the host's dropdown. */
  name: Record<Lang, string>;
  /** Closed loop in driving order; controlPoints[0] is the start/finish line. */
  controlPoints: readonly ControlPoint[];
  /** Upper passes (crossings, viaducts): the road runs on a deck with pillars. */
  bridges: readonly Span[];
  /** Covered sections: a tube under a rock shell; put a mountain over them. */
  tunnels: readonly Span[];
  /** Relief: fades out within ~24–64 m of open road (the ground there follows the road); tunnels pass under it. */
  mountains: readonly Mountain[];
  skyZenith: Rgb;
  /** Also the fog and clear colour. */
  skyHorizon: Rgb;
  grassBase: Rgb;
  grassSpeckles: readonly Rgb[];
  hill: Rgb;
  vegetation: readonly Vegetation[];
  /** Race music; every scenery in SCENERIES has its own. */
  raceSong: SongId;
  /** Default "day". */
  lighting?: Lighting;
  /** Where the sun stands (degrees clockwise from +z, i.e. up on the scan); used by "sunset" (sun disc low on the horizon). */
  sunAzimuth?: number;
  water?: Water;
  cuts?: readonly Cut[];
  /** Control point indices where a natural rock arch spans the road. */
  arches?: readonly number[];
  props?: readonly PlacedProp[];
  buildings?: readonly Building[];
  /** Street lamps on both sides of the road every `streetLamps` m (lit at night). */
  streetLamps?: number;
  /** Side of the start straight with the grand stands; default "outside" of the loop. */
  stands?: "inside" | "outside";
  /** Ground higher than `height` m takes `color` (ice cap, snowy peaks). */
  snowLine?: { height: number; color: Rgb };
}
