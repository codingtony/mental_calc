import { describe, expect, it } from "vitest";
import { SAMPLES_PER_SEGMENT, sampleCenterline, sampleSupport } from "../centerline";
import { BUILDING_CLEARANCE, footprintDistance } from "../dressing";
import { createTerrain } from "../terrain";
import { DEFAULT_SCENERY, PREVIEW_SCENERIES, SCENERIES, sceneryById } from "./index";

describe("scenery registry", () => {
  it("has unique ids that sceneryById resolves", () => {
    expect(new Set(SCENERIES.map((s) => s.id)).size).toBe(SCENERIES.length);
    for (const s of SCENERIES) expect(sceneryById(s.id)).toBe(s);
  });

  it("falls back to the default scenery for unknown or missing ids", () => {
    expect(sceneryById("nope")).toBe(DEFAULT_SCENERY);
    expect(sceneryById(undefined)).toBe(DEFAULT_SCENERY);
  });

  it("gives every scenery its own race song", () => {
    expect(new Set(SCENERIES.map((s) => s.raceSong)).size).toBe(SCENERIES.length);
  });
});

// Geometry rules every circuit must pass (see .omp/skills/mc-scenery-add for the usual fixes).
describe.each(PREVIEW_SCENERIES.map((s) => [s.id, s] as const))("circuit %s", (_, scenery) => {
  const points = sampleCenterline(scenery.controlPoints);
  const n = points.length;
  const support = sampleSupport(n, scenery.bridges, scenery.tunnels);
  const terrain = createTerrain(points, support, scenery);
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const length = cum[n];
  const along = (i: number, j: number): number => {
    const d = Math.abs(cum[j] - cum[i]);
    return Math.min(d, length - d);
  };
  const plan = (i: number, j: number): number => Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z);
  const prev = (i: number): number => (i - 1 + n) % n;
  const next = (i: number): number => (i + 1) % n;
  const spanSamples = (spans: readonly { from: number; to: number }[]): number[][] =>
    spans.map(({ from, to }) => Array.from({ length: (to - from) * SAMPLES_PER_SEGMENT + 1 }, (_, k) => from * SAMPLES_PER_SEGMENT + k));

  it("has at least 4 control points and starts on the first one", () => {
    expect(scenery.controlPoints.length).toBeGreaterThanOrEqual(4);
    const [x, z, y = 0] = scenery.controlPoints[0];
    expect(points[0].x).toBeCloseTo(x, 6);
    expect(points[0].z).toBeCloseTo(z, 6);
    expect(points[0].y).toBeCloseTo(y, 6);
  });

  it("stays within 200 m of the origin (decor hills, menu camera orbit)", () => {
    const far = Math.max(...points.map((p) => Math.hypot(p.x, p.z)));
    expect(far).toBeLessThanOrEqual(200);
  });

  it("bends no tighter than a 15 m radius (barriers stand at 11 m)", () => {
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      const a = points[prev(i)];
      const b = points[i];
      const c = points[next(i)];
      const h1 = Math.atan2(b.x - a.x, b.z - a.z);
      const h2 = Math.atan2(c.x - b.x, c.z - b.z);
      const turn = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
      const seg = (plan(prev(i), i) + plan(i, next(i))) / 2;
      if (turn > 0) min = Math.min(min, seg / turn);
    }
    expect(min).toBeGreaterThanOrEqual(15);
  });

  it("climbs no steeper than 15 %", () => {
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(points[next(i)].y - points[prev(i)].y) / plan(prev(i), next(i)));
    expect(max).toBeLessThanOrEqual(0.15);
  });

  it("has valid bridge and tunnel spans away from the start", () => {
    const last = scenery.controlPoints.length - 1;
    for (const { from, to } of [...scenery.bridges, ...scenery.tunnels]) {
      expect(from).toBeGreaterThanOrEqual(1);
      expect(to).toBeGreaterThan(from);
      expect(to).toBeLessThanOrEqual(last);
    }
    const bridgeSet = new Set(spanSamples(scenery.bridges).flat());
    for (const i of spanSamples(scenery.tunnels).flat()) expect(bridgeSet.has(i), `sample ${i} on a bridge and in a tunnel`).toBe(false);
    for (const i of [...bridgeSet, ...spanSamples(scenery.tunnels).flat()]) {
      expect(Math.min(along(0, i), plan(0, i)), `span sample ${i} too close to the start`).toBeGreaterThanOrEqual(40);
    }
  });

  it("only comes near itself where a bridge passes ≥ 7 m over the other road", () => {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (along(i, j) < 100 || plan(i, j) >= 30) continue;
        const [hi, lo] = points[i].y >= points[j].y ? [i, j] : [j, i];
        const ok = support[hi] === "bridge" && points[hi].y - points[lo].y >= 7;
        expect(ok, `samples ${i} and ${j} are ${plan(i, j).toFixed(1)} m apart without a bridge 7 m over`).toBe(true);
      }
    }
  });

  it("keeps hairpins level where the road comes back beside itself", () => {
    for (let i = 0; i < n; i++) {
      if (support[i] !== "ground") continue;
      for (let j = i + 1; j < n; j++) {
        if (support[j] !== "ground") continue;
        const d = plan(i, j);
        if (d >= 48 || along(i, j) < 1.5 * d) continue;
        expect(Math.abs(points[i].y - points[j].y), `hairpin samples ${i} and ${j}`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("keeps the ground under bridges below the deck", () => {
    for (const i of spanSamples(scenery.bridges).flat()) {
      const a = points[prev(i)];
      const b = points[next(i)];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const [tx, tz] = [(b.x - a.x) / len, (b.z - a.z) / len];
      for (const lateral of [-12, 0, 12]) {
        const x = points[i].x + tz * lateral;
        const z = points[i].z - tx * lateral;
        expect(terrain.height(x, z), `ground at bridge sample ${i}, lateral ${lateral}`).toBeLessThanOrEqual(points[i].y - 0.05);
      }
    }
  });

  it("runs no other road over or beside a tunnel", () => {
    for (const tunnel of spanSamples(scenery.tunnels)) {
      const inside = new Set(tunnel);
      const [first, last] = [tunnel[0], tunnel[tunnel.length - 1]];
      for (let j = 0; j < n; j++) {
        if (support[j] === "tunnel" || !tunnel.some((i) => plan(i, j) < 30)) continue;
        expect(inside.has(j)).toBe(false);
        expect(Math.min(along(j, first), along(j, last)), `sample ${j} passes near the tunnel`).toBeLessThanOrEqual(40);
      }
    }
  });

  it("keeps the ground flush with open road", () => {
    for (let i = 0; i < n; i++) {
      if (support[i] !== "ground") continue;
      const a = points[prev(i)];
      const b = points[next(i)];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const [tx, tz] = [(b.x - a.x) / len, (b.z - a.z) / len];
      for (const lateral of [-9.4, 0, 9.4]) {
        const ground = terrain.height(points[i].x + tz * lateral, points[i].z - tx * lateral);
        expect(Math.abs(ground - points[i].y), `ground at sample ${i}, lateral ${lateral}`).toBeLessThanOrEqual(0.25);
      }
    }
  });

  it.runIf(scenery.water)("keeps the road out of and above the water", () => {
    const level = scenery.water!.level;
    for (let i = 0; i < n; i++) {
      expect(points[i].y, `sample ${i} under the water level`).toBeGreaterThanOrEqual(level + 0.5);
      // The deck's underside (1.2 m) clears the water.
      if (support[i] === "bridge") expect(points[i].y, `bridge sample ${i} in the water`).toBeGreaterThanOrEqual(level + 1.7);
      // Road, curbs and barriers (11 m) stay on dry land: only bridges cross water.
      if (support[i] === "ground") expect(terrain.shoreDistance(points[i].x, points[i].z), `sample ${i} near the water`).toBeGreaterThanOrEqual(12);
    }
  });

  it.runIf(scenery.cuts?.length)("runs open road on a cut's floor, ≥ 12 m from its walls", () => {
    const onFloor = points.map((p) => terrain.cutFloorAt(p.x, p.z));
    for (let i = 0; i < n; i++) {
      const floor = onFloor[i];
      if (support[i] !== "ground" || floor === null) continue;
      expect(Math.abs(points[i].y - floor.floor), `sample ${i} in a cut, off its floor`).toBeLessThanOrEqual(0.5);
      if (floor.edgeDistance >= 12) continue;
      // Closer to a wall only where the road enters or leaves the floor (through a gap in the wall).
      const entry = onFloor.some((f, j) => f === null && along(i, j) <= 30);
      expect(entry, `sample ${i} runs ${floor.edgeDistance.toFixed(1)} m from a cut's wall foot`).toBe(true);
    }
  });

  it.runIf(scenery.buildings?.length)(`keeps buildings ≥ ${BUILDING_CLEARANCE} m from the centreline (12 m beyond the road)`, () => {
    for (const [k, b] of (scenery.buildings ?? []).entries()) {
      const nearest = Math.min(...points.map((p) => footprintDistance(b, p.x, p.z)));
      expect(nearest, `building ${k} at (${b.x}, ${b.z}): ${nearest.toFixed(1)} m from the centreline`).toBeGreaterThanOrEqual(BUILDING_CLEARANCE);
    }
  });

  it.runIf(scenery.arches?.length)("puts arches over open road away from the start", () => {
    const last = scenery.controlPoints.length - 1;
    for (const a of scenery.arches ?? []) {
      expect(a, `arch ${a}`).toBeGreaterThanOrEqual(1);
      expect(a, `arch ${a}`).toBeLessThanOrEqual(last);
      const i = a * SAMPLES_PER_SEGMENT;
      expect(support[i], `arch ${a} on a bridge or in a tunnel`).toBe("ground");
      expect(along(0, i), `arch ${a} too close to the start`).toBeGreaterThanOrEqual(40);
    }
  });
});
