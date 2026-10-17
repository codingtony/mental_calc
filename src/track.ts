import { Color3, Color4, Curve3, DynamicTexture, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { place, type Prefab, type PrefabKey } from "./assets";
import { mulberry32 } from "./rng";

const CONTROL_POINTS: readonly [number, number][] = [
  [-120, -40],
  [0, -60],
  [110, -50],
  [150, 0],
  [120, 60],
  [40, 50],
  [0, 90],
  [-60, 110],
  [-130, 80],
  [-150, 10],
];
const ROAD_HALF_WIDTH = 8;
const CURB_OUTER = 9.4;
const EDGE_LINE: readonly [number, number] = [7.3, 7.6]; // |lateral| of the white edge lines
const BARRIER_SPACING = 2.6;
/** Added to a prop's road-facing yaw when the model's front is −z instead of +z. */
const FRONT_YAW: Partial<Record<PrefabKey, number>> = {};

export interface TrackPose {
  pos: Vector3;
  heading: number;
}

function flatMaterial(name: string, color: Color3, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.25);
  mat.specularColor = Color3.Black();
  return mat;
}

/** Checkerboard texture with `cols`×`rows` squares (start line). */
function checkerTexture(scene: Scene, cols: number, rows: number): DynamicTexture {
  const cell = 32;
  const tex = new DynamicTexture("checker", { width: cols * cell, height: rows * cell }, scene, true);
  const ctx = tex.getContext();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? "#ffffff" : "#111111";
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
  tex.update();
  return tex;
}

export class Track {
  readonly length: number;
  /** Closed centerline samples (no duplicated end point), y = 0. */
  readonly points: readonly Vector3[];
  /** cum[i] = arc length at points[i]; cum[points.length] = length. */
  private readonly cum: number[];
  /** Unit tangent at each sample (central difference): smooth across segment joints. */
  private readonly tangents: readonly (readonly [number, number])[];

  constructor(scene: Scene) {
    const raw = Curve3.CreateCatmullRomSpline(
      CONTROL_POINTS.map(([x, z]) => new Vector3(x, 0, z)),
      40,
      true,
    ).getPoints();
    // A closed spline repeats its first point at the end; drop it so the loop wraps explicitly.
    const pts = raw[raw.length - 1].equalsWithEpsilon(raw[0], 1e-6) ? raw.slice(0, -1) : raw;
    const cum = [0];
    for (let i = 0; i < pts.length; i++) {
      cum.push(cum[i] + Vector3.Distance(pts[i], pts[(i + 1) % pts.length]));
    }
    this.points = pts;
    this.cum = cum;
    this.length = cum[pts.length];
    this.tangents = pts.map((_, i) => {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      const len = Math.hypot(next.x - prev.x, next.z - prev.z) || 1;
      return [(next.x - prev.x) / len, (next.z - prev.z) / len] as const;
    });
    this.buildMeshes(scene);
  }

  positionAt(distance: number, lateral: number): TrackPose {
    const n = this.points.length;
    let d = distance % this.length;
    if (d < 0) d += this.length;
    // Largest i with cum[i] <= d.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    const a = this.points[lo];
    const b = this.points[(lo + 1) % n];
    const seg = this.cum[lo + 1] - this.cum[lo];
    const f = seg > 0 ? (d - this.cum[lo]) / seg : 0;
    // Blend the joint tangents: a per-segment direction would make heading (and with it the
    // moto's yaw, lean and the chase camera) jump at every sample.
    const [ax, az] = this.tangents[lo];
    const [bx, bz] = this.tangents[(lo + 1) % n];
    const len = Math.hypot(ax + (bx - ax) * f, az + (bz - az) * f) || 1;
    const tx = (ax + (bx - ax) * f) / len;
    const tz = (az + (bz - az) * f) / len;
    return {
      pos: new Vector3(a.x + (b.x - a.x) * f + tz * lateral, 0, a.z + (b.z - a.z) * f - tx * lateral),
      heading: Math.atan2(tx, tz),
    };
  }

  /** Point at sample `i` shifted `lateral` along the smoothed (vertex) right vector. */
  private offsetSample(i: number, lateral: number, y: number): Vector3 {
    const p = this.points[i];
    const [tx, tz] = this.tangents[i];
    return new Vector3(p.x + tz * lateral, y, p.z - tx * lateral);
  }

  private edgePath(lateral: number, y: number, closeLoop: boolean): Vector3[] {
    const path = this.points.map((_, i) => this.offsetSample(i, lateral, y));
    if (closeLoop) path.push(path[0].clone());
    return path;
  }

  private buildMeshes(scene: Scene): void {
    // Asphalt: grey base with fine speckles.
    const rand = mulberry32(7);
    const asphalt = new DynamicTexture("asphaltTex", { width: 256, height: 256 }, scene, true);
    const actx = asphalt.getContext();
    actx.fillStyle = "rgb(70,72,76)";
    actx.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 3000; k++) {
      const g = Math.round(50 + rand() * 60);
      actx.fillStyle = `rgb(${g},${g},${g + 3})`;
      actx.fillRect(Math.floor(rand() * 256), Math.floor(rand() * 256), 1, 1);
    }
    asphalt.update();
    // Ribbon UVs: u across the road (2 paths), v along it.
    asphalt.uScale = 2;
    asphalt.vScale = Math.round(this.length / 10);

    // Road surface.
    const road = MeshBuilder.CreateRibbon(
      "road",
      {
        pathArray: [this.edgePath(-ROAD_HALF_WIDTH, 0.02, false), this.edgePath(ROAD_HALF_WIDTH, 0.02, false)],
        closePath: true,
      },
      scene,
    );
    const roadMat = flatMaterial("roadMat", Color3.White(), scene);
    roadMat.diffuseTexture = asphalt;
    roadMat.emissiveColor = new Color3(0.15, 0.15, 0.15);
    // Flat layers sit a few cm apart; polygon offset keeps them above the ground when seen from far away.
    roadMat.zOffset = -1;
    road.material = roadMat;
    road.isPickable = false;
    road.receiveShadows = true;
    road.freezeWorldMatrix();

    // White edge lines.
    const lineMat = flatMaterial("edgeLineMat", Color3.White(), scene);
    lineMat.emissiveColor = new Color3(0.5, 0.5, 0.5);
    lineMat.zOffset = -2;
    for (const s of [-1, 1]) {
      const line = MeshBuilder.CreateRibbon(
        `edgeLine${s}`,
        { pathArray: [this.edgePath(s * EDGE_LINE[0], 0.025, true), this.edgePath(s * EDGE_LINE[1], 0.025, true)] },
        scene,
      );
      line.material = lineMat;
      line.isPickable = false;
      line.receiveShadows = true;
      line.freezeWorldMatrix();
    }

    // Red/white curbs (explicitly closed paths so the vertex-color count is exact).
    const red = new Color4(0.9, 0.1, 0.1, 1);
    const white = new Color4(1, 1, 1, 1);
    const curbMat = new StandardMaterial("curbMat", scene);
    curbMat.diffuseColor = Color3.White();
    curbMat.emissiveColor = new Color3(0.25, 0.25, 0.25);
    curbMat.specularColor = Color3.Black();
    curbMat.zOffset = -2;
    const sampleCount = this.points.length + 1;
    const pathColors: Color4[] = [];
    for (let i = 0; i < sampleCount; i++) pathColors.push(Math.floor(i / 3) % 2 === 0 ? red : white);
    const curbColors = [...pathColors, ...pathColors];
    for (const [side, inner, outer] of [
      ["L", -CURB_OUTER, -ROAD_HALF_WIDTH],
      ["R", ROAD_HALF_WIDTH, CURB_OUTER],
    ] as const) {
      const curb = MeshBuilder.CreateRibbon(
        `curb${side}`,
        { pathArray: [this.edgePath(inner, 0.03, true), this.edgePath(outer, 0.03, true)], colors: curbColors },
        scene,
      );
      curb.material = curbMat;
      curb.isPickable = false;
      curb.receiveShadows = true;
      curb.freezeWorldMatrix();
    }

    // Start line.
    const checkerMat = new StandardMaterial("checkerMat", scene);
    checkerMat.diffuseTexture = checkerTexture(scene, 8, 2);
    checkerMat.emissiveColor = new Color3(0.3, 0.3, 0.3);
    checkerMat.specularColor = Color3.Black();
    checkerMat.zOffset = -3;
    const start = this.positionAt(0, 0);
    const line = MeshBuilder.CreateGround("startLine", { width: 16, height: 2 }, scene);
    line.material = checkerMat;
    line.position.set(start.pos.x, 0.04, start.pos.z);
    line.rotation.y = start.heading;
    line.isPickable = false;
    line.freezeWorldMatrix();
  }

  /**
   * Circuit dressing from Kenney prefabs (grand stands, barriers, gantry…). Returns the ground
   * positions of the bulky props so scenery can keep clear of them.
   */
  buildProps(prefabs: Record<PrefabKey, Prefab>): Vector3[] {
    const L = this.length;
    const centroid = this.points.reduce((acc, p) => acc.addInPlace(p), Vector3.Zero()).scaleInPlace(1 / this.points.length);
    const outsideSign = (d: number): number =>
      Vector3.DistanceSquared(this.positionAt(d, 10).pos, centroid) > Vector3.DistanceSquared(this.positionAt(d, -10).pos, centroid) ? 1 : -1;
    const bulky: Vector3[] = [];
    /** Stands a prop at `lateral` (signed) facing the road, uniformly scaled to `height` metres. */
    const standFacing = (key: PrefabKey, d: number, lateral: number, height: number): void => {
      const { pos, heading } = this.positionAt(d, lateral);
      const yaw = heading - Math.sign(lateral) * (Math.PI / 2) + (FRONT_YAW[key] ?? 0);
      place(prefabs[key], pos.x, pos.z, yaw, new Vector3(height, height, height));
      bulky.push(pos);
    };

    for (let k = -3; k <= 2; k++) standFacing("grandStand", k * 10, outsideSign(k * 10) * 24, 9);
    for (const d of [-25, 0, 25]) standFacing("tent", d, -outsideSign(d) * 20, 4);
    for (let k = 0; k * 50 < L; k++) standFacing("lightPost", k * 50, (k % 2 === 0 ? 1 : -1) * 12.5, 9);
    for (let k = 0; k < 8; k++) {
      const d = (k * L) / 8 + L / 16;
      standFacing("bannerTower", d, outsideSign(d) * 14, 8);
    }
    for (let k = 0; k < 4; k++) {
      const d = (k * L) / 4 + L / 8;
      standFacing("billboard", d, outsideSign(d) * 18, 5);
    }
    for (const s of [-1, 1]) standFacing("flagCheckers", 0, s * 10, 4);

    // Barriers along both edges, length along the road.
    const count = Math.floor(L / BARRIER_SPACING);
    for (let k = 0; k < count; k++) {
      const prefab = prefabs[k % 2 === 0 ? "barrierRed" : "barrierWhite"];
      const scale = new Vector3(BARRIER_SPACING / prefab.size.x, 0.8, 0.5 / prefab.size.z);
      for (const s of [-1, 1]) {
        const { pos, heading } = this.positionAt(k * BARRIER_SPACING, s * 11);
        place(prefab, pos.x, pos.z, heading + Math.PI / 2, scale);
      }
    }

    // Start gantry spanning the road (its long axis is x, so yaw = heading puts x across the road).
    const gantry = prefabs.gantry;
    const start = this.positionAt(0, 0);
    place(gantry, start.pos.x, start.pos.z, start.heading, new Vector3(24 / gantry.size.x, 7.5, 1.2 / gantry.size.z));
    return bulky;
  }
}
