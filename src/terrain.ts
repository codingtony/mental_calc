import type { Vector3 } from "@babylonjs/core";
import type { Support } from "./centerline";
import type { Rgb } from "./look";
import type { PlanPoint, Scenery } from "./sceneries/types";

export interface Terrain {
  /** Ground height (m): the road's height beside ground sections, mountains further out, reshaped by water and cuts. */
  height(x: number, z: number): number;
  /** Plan distance to the nearest ground (not bridge/tunnel) centreline point; Infinity when none nearby. */
  groundDistance(x: number, z: number): number;
  /**
   * The nearest centreline sample when it is a tunnel sample within TUNNEL_STRIP m: its road height,
   * plan distance, and whether it lies ≥ 4 samples inside the tunnel. No ground is drawn where
   * `interior` holds (the tunnel's shell covers that strip).
   */
  tunnelAt(x: number, z: number): { roadY: number; distance: number; interior: boolean } | null;
  /** Signed plan distance (m) to the nearest shore or river bank: negative in the water; Infinity without water. */
  shoreDistance(x: number, z: number): number;
  /** In or within SHORE_MARGIN m of water, or on a cut's footprint (floor, walls, ridges): keep plants and props away. */
  reshaped(x: number, z: number): boolean;
  /** The cut whose floor contains (x, z): its floor height and the plan distance to the nearer floor edge (wall foot). */
  cutFloorAt(x: number, z: number): { floor: number; edgeDistance: number } | null;
  /** Colour of the cut's rock at (x, z): on a cut's floor, walls and mesas (where the cut moves the ground); else null. */
  rockAt(x: number, z: number): Rgb | null;
}

/** Ground follows the road height exactly up to EXACT_ZONE m from it, then blends over EXACT_BLEND m to the IDW surface. */
const EXACT_ZONE = 16;
const EXACT_BLEND = 8;
/** Mountains fade in from LAND_FROM m off the road over LAND_BLEND m. */
const LAND_FROM = 24;
const LAND_BLEND = 40;
/** Ground right beside the road sits this far below it (no z-fighting with road, curbs and lines). */
const ROAD_SINK = 0.05;
/** Inverse-distance weighting radius of road heights between road parts. */
const IDW_RADIUS = 100;
const BUCKET = 50;
const TUNNEL_STRIP = 14;
/** Water and cuts dig the ground from CARVE_FROM m off open road (barriers stand at 11 m), fully CARVE_BLEND m further. */
const CARVE_FROM = 12;
const CARVE_BLEND = 4;
/** Water bed: sinks BED_SLOPE m per m from the shore, at most WATER_DEPTH m below the surface. */
const BED_SLOPE = 0.3;
const WATER_DEPTH = 4;
/** Banks rise BANK_SLOPE m per m from the shore, steepening from BANK_STEEPEN m on so they meet any ground by WATER_REACH m. */
const BANK_SLOPE = 0.5;
const BANK_STEEPEN = 24;
const WATER_REACH = 48;
/** Cut walls rise WALL_SLOPE m per m from the floor's edge (near vertical). */
const WALL_SLOPE = 5;
/** Gorge mesas (Cut.wallHeight): a top MESA_TOP m wide (varying along the gorge), then an outer cliff falling CLIFF_SLOPE m per m. */
const MESA_TOP: readonly [number, number] = [3, 12];
const CLIFF_SLOPE = 3;
/** `rockAt` holds where a cut moves the ground by more than ROCK_EPS m (and on its floor). */
const ROCK_EPS = 0.3;
/** Natural cut walls: their foot steps out up to WALL_WOBBLE m (never in), their height varies by ±WALL_HEIGHT_VARY. */
const WALL_WOBBLE = 6;
const WALL_HEIGHT_VARY = 0.25;
/** Cell size (m) of the segment index of shores, rivers and cuts. */
const LINE_CELL = 16;
/** Catmull-Rom points per drawn segment of shores, rivers and cuts. */
const SMOOTH_STEPS = 8;
/** `reshaped` covers the banks up to SHORE_MARGIN m from the water's edge. */
const SHORE_MARGIN = 4;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Sample indices bucketed by BUCKET × BUCKET m cells. */
function bucketize(points: readonly Vector3[], indices: readonly number[]): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  for (const i of indices) {
    const key = bucketKey(Math.floor(points[i].x / BUCKET), Math.floor(points[i].z / BUCKET));
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  }
  return buckets;
}

/** Cells span ±1000 cells on each axis: far beyond any circuit. */
function bucketKey(bx: number, bz: number): number {
  return (bx + 1000) * 2048 + (bz + 1000);
}

/** Smoothed polyline (shore outline, river or cut centre line), indexed for queries up to `reach` m away. */
interface Line {
  xs: number[];
  zs: number[];
  /** Arc length (m) at each point. */
  cum: number[];
  closed: boolean;
  reach: number;
  /** Segment k joins points k and k + 1 (wrapping when closed): indices of the segments within `reach` of each LINE_CELL cell. */
  cells: Map<number, number[]>;
  /** Closed lines: indices of the segments overlapping each LINE_CELL band of z (inside test). */
  bands: Map<number, number[]>;
}

/** Catmull-Rom curve through `pts` (a closed outline or an open line, ends kept), indexed up to `reach` m. */
function smoothLine(pts: readonly PlanPoint[], closed: boolean, reach: number): Line {
  const n = pts.length;
  const at = (i: number): PlanPoint => (closed ? pts[(i + n) % n] : pts[Math.min(n - 1, Math.max(0, i))]);
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < SMOOTH_STEPS; s++) {
      const t = s / SMOOTH_STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      for (const [c, out] of [[0, xs], [1, zs]] as const) {
        out.push(
          0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3),
        );
      }
    }
  }
  if (!closed) {
    xs.push(pts[n - 1][0]);
    zs.push(pts[n - 1][1]);
  }
  const cells = new Map<number, number[]>();
  const bands = new Map<number, number[]>();
  const add = (map: Map<number, number[]>, key: number, k: number): void => {
    const list = map.get(key);
    if (list) list.push(k);
    else map.set(key, [k]);
  };
  const segments = closed ? xs.length : xs.length - 1;
  for (let k = 0; k < segments; k++) {
    const k2 = (k + 1) % xs.length;
    const [x0, x1] = [Math.min(xs[k], xs[k2]), Math.max(xs[k], xs[k2])];
    const [z0, z1] = [Math.min(zs[k], zs[k2]), Math.max(zs[k], zs[k2])];
    for (let cx = Math.floor((x0 - reach) / LINE_CELL); cx <= Math.floor((x1 + reach) / LINE_CELL); cx++) {
      for (let cz = Math.floor((z0 - reach) / LINE_CELL); cz <= Math.floor((z1 + reach) / LINE_CELL); cz++) add(cells, bucketKey(cx, cz), k);
    }
    if (closed) for (let b = Math.floor(z0 / LINE_CELL); b <= Math.floor(z1 / LINE_CELL); b++) add(bands, b, k);
  }
  const cum = [0];
  for (let k = 1; k < xs.length; k++) cum.push(cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]));
  return { xs, zs, cum, closed, reach, cells, bands };
}

/** Plan distance from (x, z) to `line`, at most `line.reach`. */
function lineDistance(line: Line, x: number, z: number): number {
  const { xs, zs } = line;
  let best = line.reach * line.reach;
  for (const k of line.cells.get(bucketKey(Math.floor(x / LINE_CELL), Math.floor(z / LINE_CELL))) ?? []) {
    const k2 = (k + 1) % xs.length;
    const ex = xs[k2] - xs[k];
    const ez = zs[k2] - zs[k];
    const t = Math.min(1, Math.max(0, ((x - xs[k]) * ex + (z - zs[k]) * ez) / (ex * ex + ez * ez || 1)));
    const dSq = (xs[k] + ex * t - x) ** 2 + (zs[k] + ez * t - z) ** 2;
    if (dSq < best) best = dSq;
  }
  return Math.sqrt(best);
}

/**
 * Nearest point of the open `line` to (x, z): plan distance `d` (at most `line.reach`) and its place `p` (m)
 * on the outline of a band `radius` m wide around the line, going up the left side, round the end, back down
 * the right side and round the start (perimeter 2 · length + 2π · radius): continuous all round, ends included.
 */
function outlineAt(line: Line, x: number, z: number, radius: number): { d: number; p: number } {
  const { xs, zs, cum } = line;
  let best = line.reach * line.reach;
  let bk = -1;
  let bt = 0;
  for (const k of line.cells.get(bucketKey(Math.floor(x / LINE_CELL), Math.floor(z / LINE_CELL))) ?? []) {
    const ex = xs[k + 1] - xs[k];
    const ez = zs[k + 1] - zs[k];
    const t = ((x - xs[k]) * ex + (z - zs[k]) * ez) / (ex * ex + ez * ez || 1);
    const tc = Math.min(1, Math.max(0, t));
    const dSq = (xs[k] + ex * tc - x) ** 2 + (zs[k] + ez * tc - z) ** 2;
    if (dSq < best) [best, bk, bt] = [dSq, k, t];
  }
  if (bk < 0) return { d: line.reach, p: 0 };
  const length = cum[cum.length - 1];
  const seg = Math.hypot(xs[bk + 1] - xs[bk], zs[bk + 1] - zs[bk]) || 1;
  // Forward direction, left normal and the offset from the nearest point.
  const [fx, fz] = [(xs[bk + 1] - xs[bk]) / seg, (zs[bk + 1] - zs[bk]) / seg];
  const tc = Math.min(1, Math.max(0, bt));
  const [vx, vz] = [x - (xs[bk] + fx * seg * tc), z - (zs[bk] + fz * seg * tc)];
  const ahead = vx * fx + vz * fz;
  const left = vz * fx - vx * fz;
  const d = Math.sqrt(best);
  if (bk === xs.length - 2 && bt >= 1) return { d, p: length + Math.atan2(ahead, left) * radius };
  if (bk === 0 && bt <= 0) return { d, p: 2 * length + Math.PI * radius + Math.atan2(-ahead, -left) * radius };
  const u = cum[bk] + seg * tc;
  return { d, p: left >= 0 ? u : 2 * length + Math.PI * radius - u };
}

/** Smooth value noise in [0, 1] around a loop of `cells` random values (seeded); `x` in cells, wraps. */
function loopNoise(seed: number, cells: number, x: number): number {
  const value = (i: number): number => {
    let h = Math.imul((((i % cells) + cells) % cells) ^ Math.imul(seed, 0x9e3779b1), 0x27d4eb2d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
  const i = Math.floor(x);
  const f = x - i;
  return value(i) + (value(i + 1) - value(i)) * f * f * (3 - 2 * f);
}

/** Even-odd test: (x, z) inside the closed `line`. */
function insideLine(line: Line, x: number, z: number): boolean {
  const { xs, zs } = line;
  let inside = false;
  for (const i of line.bands.get(Math.floor(z / LINE_CELL)) ?? []) {
    const j = (i + 1) % xs.length;
    if (zs[i] > z !== zs[j] > z && x < ((xs[j] - xs[i]) * (z - zs[i])) / (zs[j] - zs[i]) + xs[i]) inside = !inside;
  }
  return inside;
}

/**
 * Ground height field around a circuit. Only ground samples shape it: a crossing's lower road keeps
 * its ground under the bridge, and mountains stay over tunnels. Water (sea, lakes, rivers) and cuts
 * (canyons) then dig it, except within CARVE_FROM m of open road.
 */
export function createTerrain(
  points: readonly Vector3[],
  support: readonly Support[],
  scenery: Pick<Scenery, "mountains" | "water" | "cuts">,
): Terrain {
  const { mountains, water } = scenery;
  const n = points.length;
  const h0 = points[0].y;
  // Level road without relief: the ground is the road's plane (exactly, no ROAD_SINK) wherever nothing digs it.
  const flatRoad = mountains.length === 0 && points.every((p) => p.y === h0);
  const flat =
    flatRoad &&
    (water?.areas.length ?? 0) === 0 &&
    (water?.rivers.length ?? 0) === 0 &&
    (scenery.cuts?.length ?? 0) === 0;
  // Above `top` there is no ground (roads and every mountain stacked): banks and walls reaching it end there.
  const top = Math.max(...points.map((p) => p.y)) + mountains.reduce((s, m) => s + Math.max(0, m.height), 0) + 1;
  const level = water?.level ?? 0;
  const steepen = Math.max(0, top - level - BANK_SLOPE * WATER_REACH) / (WATER_REACH - BANK_STEEPEN) ** 2;
  const areas = (water?.areas ?? []).map((a) => smoothLine(a, true, WATER_REACH));
  const rivers = (water?.rivers ?? []).map((r) => ({ line: smoothLine(r.points, false, r.width / 2 + WATER_REACH), halfWidth: r.width / 2 }));
  const lowest = Math.min(...points.map((p) => p.y));
  const cuts = (scenery.cuts ?? []).map((c, k) => {
    const halfWidth = c.width / 2;
    const tallest = (c.wallHeight ?? 0) * (1 + WALL_HEIGHT_VARY);
    // Reach: the ridge's outer foot on the lowest ground, or the wall's top under the highest ground.
    const reach =
      halfWidth +
      WALL_WOBBLE +
      (c.wallHeight === undefined
        ? Math.max(0, top - c.floor) / WALL_SLOPE
        : tallest / WALL_SLOPE + MESA_TOP[1] + Math.max(0, c.floor + tallest - lowest) / CLIFF_SLOPE) +
      1;
    const line = smoothLine(c.points, false, reach);
    const perimeter = 2 * line.cum[line.cum.length - 1] + 2 * Math.PI * halfWidth;
    // Noise octaves round the outline: [seed, cells] with cells ≈ perimeter / wavelength.
    const octave = (seed: number, wavelength: number): [number, number] => [8 * k + seed, Math.max(3, Math.round(perimeter / wavelength))];
    return {
      ...c,
      line,
      halfWidth,
      perimeter,
      foot: [octave(1, 28), octave(2, 11)],
      rise: [octave(3, 36), octave(4, 13)],
      mesa: [octave(5, 32), octave(6, 12)],
    };
  });
  /** Two octaves (weights 0.65, 0.35) of loop noise at outline place `p` of `cut`: 0–1. */
  const wallNoise = (cut: (typeof cuts)[number], octaves: [number, number][], p: number): number =>
    octaves.reduce((s, [seed, cells], o) => s + (o === 0 ? 0.65 : 0.35) * loopNoise(seed, cells, (p / cut.perimeter) * cells), 0);

  const cutFloorAt = (x: number, z: number): { floor: number; edgeDistance: number } | null => {
    for (const c of cuts) {
      const d = lineDistance(c.line, x, z);
      if (d <= c.halfWidth) return { floor: c.floor, edgeDistance: c.halfWidth - d };
    }
    return null;
  };
  const groundIdx = points.map((_, i) => i).filter((i) => support[i] === "ground");
  // Road on a cut's floor shapes the ground beside it only (exact zone), not the land around the cut.
  const shapes = points.map((p, i) => support[i] === "ground" && cutFloorAt(p.x, p.z) === null);
  const ground = bucketize(points, groundIdx);
  const all = bucketize(
    points,
    points.map((_, i) => i),
  );
  const shapingIdx = groundIdx.filter((i) => shapes[i]);
  const meanIdx = shapingIdx.length > 0 ? shapingIdx : groundIdx;
  const hMean = meanIdx.length > 0 ? meanIdx.reduce((s, i) => s + points[i].y, 0) / meanIdx.length : h0;
  const relief = mountains.map((m) => ({ ...m, twoSigmaSq: 2 * (m.radius / 2.146) ** 2 }));

  const land = (x: number, z: number): number =>
    relief.reduce((s, m) => s + m.height * Math.exp(-((x - m.x) ** 2 + (z - m.z) ** 2) / m.twoSigmaSq), 0);

  /** How far (m) (x, z) lies inside the water (negative: outside), between ±WATER_REACH. */
  const intoWater = (x: number, z: number): number => {
    let s = -WATER_REACH;
    for (const a of areas) {
      const d = lineDistance(a, x, z);
      s = Math.max(s, insideLine(a, x, z) ? d : -d);
    }
    for (const r of rivers) s = Math.max(s, r.halfWidth - lineDistance(r.line, x, z));
    return s;
  };

  /** Water and cuts hold the ground at (x, z) between `lo` and `hi` (−∞/+∞ where none reaches; `hi` wins). */
  const bounds = (x: number, z: number): { lo: number; hi: number } => {
    let lo = -Infinity;
    let hi = Infinity;
    for (const c of cuts) {
      const { d, p } = outlineAt(c.line, x, z, c.halfWidth);
      if (d >= c.line.reach) continue;
      // Natural rock: the wall foot steps out (never in: the road keeps its clearance) and the height varies.
      const over = Math.max(0, d - c.halfWidth - WALL_WOBBLE * wallNoise(c, c.foot, p));
      const wall = c.floor + over * WALL_SLOPE;
      hi = Math.min(hi, wall);
      if (c.wallHeight !== undefined) {
        // A mesa: the wall's top, then a steep outer cliff down to the plain.
        const height = c.wallHeight * (1 + WALL_HEIGHT_VARY * (2 * wallNoise(c, c.rise, p) - 1));
        const mesaTop = MESA_TOP[0] + (MESA_TOP[1] - MESA_TOP[0]) * wallNoise(c, c.mesa, p);
        const cliff = c.floor + height - Math.max(0, over - height / WALL_SLOPE - mesaTop) * CLIFF_SLOPE;
        lo = Math.max(lo, Math.min(wall, cliff));
      }
    }
    if (areas.length > 0 || rivers.length > 0) {
      const s = intoWater(x, z);
      if (s >= 0) hi = Math.min(hi, level - Math.min(WATER_DEPTH, s * BED_SLOPE));
      else if (s > -WATER_REACH) hi = Math.min(hi, level - s * BANK_SLOPE + steepen * Math.max(0, -s - BANK_STEEPEN) ** 2);
    }
    return { lo, hi };
  };

  /** dG/hG: distance to and height of the nearest ground road point; base: IDW blend of shaping sample heights. */
  const probe = (x: number, z: number): { dG: number; hG: number; base: number } => {
    const bx = Math.floor(x / BUCKET);
    const bz = Math.floor(z / BUCKET);
    let nearest = -1;
    let nearestSq = Infinity;
    let sw = 0;
    let swh = 0;
    const rSq = IDW_RADIUS * IDW_RADIUS;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (const i of ground.get(bucketKey(bx + dx, bz + dz)) ?? []) {
          const p = points[i];
          const dSq = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (dSq < nearestSq) {
            nearestSq = dSq;
            nearest = i;
          }
          if (shapes[i] && dSq < rSq) {
            const w = (1 - dSq / rSq) ** 4 / (dSq * dSq + 1);
            sw += w;
            swh += w * p.y;
          }
        }
      }
    }
    // hMean takes over seamlessly far from the road.
    const base = (swh + 1e-9 * hMean) / (sw + 1e-9);
    if (nearest < 0) return { dG: Infinity, hG: base, base };
    const a = points[nearest];
    let dG = Math.sqrt(nearestSq);
    let hG = a.y;
    for (const j of [(nearest - 1 + n) % n, (nearest + 1) % n]) {
      if (support[j] !== "ground") continue;
      const b = points[j];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const t = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
      const d = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
      if (d < dG) {
        dG = d;
        hG = a.y + (b.y - a.y) * t;
      }
    }
    return { dG, hG, base };
  };

  /** Ground height with water and cuts (`shaped`, held within `b`) and without them (`natural`). */
  const surface = (x: number, z: number, b: { lo: number; hi: number }): { shaped: number; natural: number } => {
    const shape = (h: number): number => Math.min(Math.max(h, b.lo), b.hi);
    const { dG, hG, base } = probe(x, z);
    if (dG === Infinity) {
      const natural = base + land(x, z);
      return { shaped: shape(natural), natural };
    }
    const e = smoothstep(EXACT_ZONE, EXACT_ZONE + EXACT_BLEND, dG);
    const k = smoothstep(LAND_FROM, LAND_FROM + LAND_BLEND, dG);
    const rise = flatRoad ? 0 : k * land(x, z) - ROAD_SINK * (1 - k);
    const natural = hG + (base - hG) * e + rise;
    // Shaping the far surface first keeps canyon walls steep where they come within the blend zone.
    const near = hG + (shape(base) - hG) * e + rise;
    const c = smoothstep(CARVE_FROM, CARVE_FROM + CARVE_BLEND, dG);
    return { shaped: near + c * (shape(near) - near), natural };
  };

  return {
    height(x, z) {
      if (flat) return h0;
      const b = bounds(x, z);
      if (b.lo === -Infinity && b.hi === Infinity) return flatRoad ? h0 : surface(x, z, b).natural;
      return surface(x, z, b).shaped;
    },
    groundDistance(x, z) {
      return probe(x, z).dG;
    },
    tunnelAt(x, z) {
      const bx = Math.floor(x / BUCKET);
      const bz = Math.floor(z / BUCKET);
      let nearest = -1;
      let nearestSq = TUNNEL_STRIP * TUNNEL_STRIP;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const i of all.get(bucketKey(bx + dx, bz + dz)) ?? []) {
            const dSq = (points[i].x - x) ** 2 + (points[i].z - z) ** 2;
            if (dSq < nearestSq) {
              nearestSq = dSq;
              nearest = i;
            }
          }
        }
      }
      if (nearest < 0 || support[nearest] !== "tunnel") return null;
      // Within four samples (~7 m) of a portal it is not `interior`: dropping ground there (4 m cells)
      // would open holes in front of the portal.
      const interior = [-4, -3, -2, -1, 1, 2, 3, 4].every((k) => support[(nearest + k + n) % n] === "tunnel");
      return { roadY: points[nearest].y, distance: Math.sqrt(nearestSq), interior };
    },
    shoreDistance(x, z) {
      return areas.length > 0 || rivers.length > 0 ? -intoWater(x, z) : Infinity;
    },
    reshaped(x, z) {
      if ((areas.length > 0 || rivers.length > 0) && intoWater(x, z) > -SHORE_MARGIN) return true;
      return cuts.some((c) => lineDistance(c.line, x, z) < c.line.reach);
    },
    cutFloorAt,
    rockAt(x, z) {
      let moved: boolean | null = null;
      for (const c of cuts) {
        if (!c.color) continue;
        const { d, p } = outlineAt(c.line, x, z, c.halfWidth);
        if (d >= c.line.reach) continue;
        if (d <= c.halfWidth + WALL_WOBBLE * wallNoise(c, c.foot, p)) return c.color;
        if (moved === null) {
          const s = surface(x, z, bounds(x, z));
          moved = Math.abs(s.shaped - s.natural) > ROCK_EPS;
        }
        if (moved) return c.color;
      }
      return null;
    },
  };
}
