import {
  Color3,
  Color4,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { place, STREET_LAMP_BULB, STREET_LAMP_POLE_Z, type Prefab, type PrefabKey } from "./assets";
import { SAMPLES_PER_SEGMENT, sampleCenterline, sampleSupport, type Support } from "./centerline";
import type { StreetLamp } from "./dressing";
import { mulberry32 } from "./rng";
import type { Rgb } from "./look";
import type { Cut, Scenery, Span } from "./sceneries/types";
import { createTerrain, type Terrain } from "./terrain";

const ROAD_HALF_WIDTH = 8;
const CURB_OUTER = 9.4;
const EDGE_LINE: readonly [number, number] = [7.3, 7.6]; // |lateral| of the white edge lines
const BARRIER_SPACING = 2.6;
/** Added to a prop's road-facing yaw when the model's front is −z instead of +z. */
const FRONT_YAW: Partial<Record<PrefabKey, number>> = { streetLamp: Math.PI };
/** Street lamps: pole |lateral| (m), prefab height (m), |lateral| of the light pool on the road. */
const LAMP_POLE = 12.5;
const LAMP_HEIGHT = 8;
const LAMP_POOL = 5;
/** No street lamps within this distance (m) of the start line (grand stands, gantry). */
const LAMP_START_CLEAR = 35;
/**
 * Rock arches: opening half width at the road (m, barriers stand at 11), opening height over the road,
 * leg thickness beside the opening, minimum rock above the opening, half depth along the road (crown, feet).
 */
const ARCH_OPENING = 12.5;
const ARCH_HEIGHT = 12;
const ARCH_LEG = 8;
const ARCH_CROWN = 5;
const ARCH_DEPTH: readonly [number, number] = [5, 7];
/** An arch is painted like a cut's ground when the cut's centre line passes within its reach plus this (m). */
const ARCH_CUT_REACH = 40;
/** Street lamps and roadside props keep this far (m, along the track) from an arch. */
const ARCH_KEEP_CLEAR = 14;
const ROCK_COLOR = new Color3(0.5, 0.47, 0.43);
/** Bridge deck cross-section [lateral, height over road]: top strips beside the curbs, sides, underside. */
const DECK_PROFILE: readonly (readonly [number, number])[] = [
  [-9.4, 0.01],
  [-12, 0.01],
  [-12, -1.2],
  [12, -1.2],
  [12, 0.01],
  [9.4, 0.01],
];
const DECK_DEPTH = 1.2;
const PILLAR_SPACING = 24;
/** Tunnel tube cross-section [lateral, height over road]: floor strips beside the curbs, walls, flat arch. */
const TUBE_PROFILE: readonly (readonly [number, number])[] = [
  [-9.4, 0.01],
  [-12, 0.01],
  [-12, 5],
  [-10.39, 6.5],
  [-6, 7.6],
  [0, 8],
  [6, 7.6],
  [10.39, 6.5],
  [12, 5],
  [12, 0.01],
  [9.4, 0.01],
];
/** Laterals of the rock shell over a tunnel (same point count as TUBE_PROFILE, for the portal caps). */
const SHELL_LATERALS = [-28, -20, -14, -10, -5, 0, 5, 10, 14, 20, 28];

/** What buildProps placed: ground positions of the bulky props (kept clear of vegetation) and the street lamps. */
export interface CircuitProps {
  bulky: Vector3[];
  lamps: StreetLamp[];
}

export interface TrackPose {
  pos: Vector3;
  heading: number;
  /** Radians, + = uphill in the driving direction. */
  pitch: number;
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
  /** Closed centerline samples (no duplicated end point); y = road height. */
  readonly points: readonly Vector3[];
  /** What carries the road at each sample. */
  readonly support: readonly Support[];
  readonly terrain: Terrain;
  /** Meshes that cast sun shadows (bridges, tunnels); World adds them to its shadow generator. */
  readonly casters: Mesh[] = [];
  /** cum[i] = arc length at points[i]; cum[points.length] = length. */
  private readonly cum: number[];
  /** Unit tangent at each sample (central difference): smooth across segment joints. */
  private readonly tangents: readonly (readonly [number, number])[];
  /** Slope angle at each sample (central difference). */
  private readonly pitches: readonly number[];
  /** Arc-length ranges of bridge and tunnel spans. */
  private readonly spanArcs: readonly (readonly [number, number])[];
  private readonly bridgePoints: readonly Vector3[];
  /** Arc lengths of the rock arches. */
  private readonly archArcs: readonly number[];
  private readonly stands: "inside" | "outside";
  /** Street lamp spacing (m), 0 = none. */
  private readonly lampSpacing: number;
  /** Shells over tunnels, UV-mapped like the ground: World gives them the ground's material and tint. */
  readonly groundCovers: Mesh[] = [];
  /** Arches in canyons with their cut's rock colour (null: the ground's): World paints them like the canyon's rock. */
  readonly rockCovers: { mesh: Mesh; color: Rgb | null }[] = [];

  constructor(scene: Scene, scenery: Scenery) {
    const pts = sampleCenterline(scenery.controlPoints);
    const n = pts.length;
    const cum = [0];
    for (let i = 0; i < n; i++) {
      cum.push(cum[i] + Vector3.Distance(pts[i], pts[(i + 1) % n]));
    }
    this.points = pts;
    this.cum = cum;
    this.length = cum[n];
    this.tangents = pts.map((_, i) => {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const len = Math.hypot(next.x - prev.x, next.z - prev.z) || 1;
      return [(next.x - prev.x) / len, (next.z - prev.z) / len] as const;
    });
    this.pitches = pts.map((_, i) => {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      return Math.atan2(next.y - prev.y, Math.hypot(next.x - prev.x, next.z - prev.z));
    });
    this.support = sampleSupport(n, scenery.bridges, scenery.tunnels);
    this.spanArcs = [...scenery.bridges, ...scenery.tunnels].map(
      ({ from, to }) => [cum[from * SAMPLES_PER_SEGMENT], cum[to * SAMPLES_PER_SEGMENT]] as const,
    );
    this.bridgePoints = pts.filter((_, i) => this.support[i] === "bridge");
    this.terrain = createTerrain(pts, this.support, scenery);
    this.buildMeshes(scene);
    for (const span of scenery.bridges) this.buildBridge(scene, span);
    for (const span of scenery.tunnels) this.buildTunnel(scene, span);
    this.archArcs = (scenery.arches ?? []).map((i) => cum[i * SAMPLES_PER_SEGMENT]);
    this.archArcs.forEach((d, k) => {
      // An arch in or at a canyon is painted like the canyon's rock (see buildArch).
      const at = this.positionAt(d, 0).pos;
      const cutDistance = (cut: Cut): number => Math.min(...cut.points.map(([x, z]) => Math.hypot(x - at.x, z - at.z)));
      const cut = (scenery.cuts ?? []).find((c) => cutDistance(c) < c.width / 2 + (c.wallHeight ?? 0) / 5 + ARCH_CUT_REACH);
      this.buildArch(scene, d, k, cut);
    });
    this.stands = scenery.stands ?? "outside";
    this.lampSpacing = scenery.streetLamps ?? 0;
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
    const pa = this.pitches[lo];
    const pb = this.pitches[(lo + 1) % n];
    return {
      pos: new Vector3(a.x + (b.x - a.x) * f + tz * lateral, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f - tx * lateral),
      heading: Math.atan2(tx, tz),
      pitch: pa + (pb - pa) * f,
    };
  }

  /** `distance` (mod length) lies on a bridge or tunnel span, or within `margin` m of one. */
  onSpan(distance: number, margin: number): boolean {
    let d = distance % this.length;
    if (d < 0) d += this.length;
    return this.spanArcs.some(([a, b]) =>
      [d - this.length, d, d + this.length].some((x) => x >= a - margin && x <= b + margin),
    );
  }

  /** A bridge sample lies within `radius` m (in plan) of (x, z). */
  nearBridge(x: number, z: number, radius: number): boolean {
    return this.bridgePoints.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < radius * radius);
  }

  /** Point at sample `i` shifted `lateral` along the smoothed (vertex) right vector, `y` above the road. */
  private offsetSample(i: number, lateral: number, y: number): Vector3 {
    const p = this.points[i];
    const [tx, tz] = this.tangents[i];
    return new Vector3(p.x + tz * lateral, p.y + y, p.z - tx * lateral);
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
    line.position.set(start.pos.x, start.pos.y + 0.04, start.pos.z);
    // A positive x rotation dips the +z (forward) edge: uphill is a negative one.
    line.rotation.set(-start.pitch, start.heading, 0);
    line.isPickable = false;
    line.freezeWorldMatrix();
  }

  /** Sample indices of a span (inclusive). */
  private spanSamples({ from, to }: Span): number[] {
    const out: number[] = [];
    for (let i = from * SAMPLES_PER_SEGMENT; i <= to * SAMPLES_PER_SEGMENT; i++) out.push(i);
    return out;
  }

  /** One ribbon path per [lateral, height over road] profile point, along the given samples. */
  private profileRibbon(
    name: string,
    samples: readonly number[],
    profile: readonly (readonly [number, number])[],
    scene: Scene,
  ): Mesh {
    const mesh = MeshBuilder.CreateRibbon(
      name,
      {
        pathArray: profile.map(([lateral, y]) => samples.map((i) => this.offsetSample(i, lateral, y))),
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene,
    );
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  /** Concrete deck under the road plus pillars down to the ground (clear of the road below). */
  private buildBridge(scene: Scene, span: Span): void {
    const mat = flatMaterial("bridgeMat", new Color3(0.62, 0.62, 0.6), scene);
    const deck = this.profileRibbon("bridgeDeck", this.spanSamples(span), DECK_PROFILE, scene);
    deck.material = mat;
    this.casters.push(deck);

    const pillar = MeshBuilder.CreateBox("bridgePillar", { width: 2.5, height: 1, depth: 2 }, scene);
    pillar.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    pillar.material = mat;
    pillar.isPickable = false;
    pillar.receiveShadows = true;
    const start = this.cum[span.from * SAMPLES_PER_SEGMENT];
    const end = this.cum[span.to * SAMPLES_PER_SEGMENT];
    for (let d = start + PILLAR_SPACING / 2; d <= end - PILLAR_SPACING / 2; d += PILLAR_SPACING) {
      const { pos, heading } = this.positionAt(d, 0);
      const bottom = this.terrain.height(pos.x, pos.z) - 0.5;
      const height = pos.y - DECK_DEPTH - bottom;
      if (height < 1.5 || this.terrain.groundDistance(pos.x, pos.z) < 14) continue;
      pillar.thinInstanceAdd(
        Matrix.Compose(new Vector3(1, height, 1), Quaternion.RotationYawPitchRoll(heading, 0, 0), new Vector3(pos.x, bottom, pos.z)),
        false,
      );
    }
    if (pillar.thinInstanceCount === 0) {
      pillar.setEnabled(false);
      return;
    }
    pillar.thinInstanceBufferUpdated("matrix");
    pillar.thinInstanceRefreshBoundingInfo();
    pillar.freezeWorldMatrix();
    this.casters.push(pillar);
  }

  /**
   * Tube around the road under a rock shell. The shell follows the terrain (or arches over the
   * tube where the mountain is lower) and covers the ground strip the terrain leaves out over the tunnel.
   */
  private buildTunnel(scene: Scene, span: Span): void {
    const samples = this.spanSamples(span);
    const tube = this.profileRibbon("tunnelTube", samples, TUBE_PROFILE, scene);
    tube.material = flatMaterial("tunnelMat", new Color3(0.42, 0.42, 0.45), scene);
    this.casters.push(tube);

    const n = this.points.length;
    const shellPoint = (i: number, lateral: number): Vector3 => {
      // On the inside of a bend tighter than the shell is wide, the offset paths would fold over
      // themselves (stair-like artefacts at the portals): keep them within 3/4 of the bend radius.
      const [ax, az] = this.tangents[(i - 1 + n) % n];
      const [bx, bz] = this.tangents[(i + 1) % n];
      const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
      const prev = this.points[(i - 1 + n) % n];
      const next = this.points[(i + 1) % n];
      const radius = Math.hypot(next.x - prev.x, next.z - prev.z) / Math.max(Math.abs(turn), 1e-6);
      // Heading grows in a right-hand bend: its inside is +lateral.
      const inside = Math.sign(lateral) === -Math.sign(turn);
      const p = this.offsetSample(i, inside ? Math.sign(lateral) * Math.min(Math.abs(lateral), 0.75 * radius) : lateral, 0);
      const t = this.terrain.height(p.x, p.z);
      const roadY = this.points[i].y;
      const side = Math.abs(lateral);
      p.y = side >= 28 ? t - 3 : Math.max(t + 0.5, roadY + (side >= 20 ? 6 : 9.5));
      return p;
    };
    const shell = MeshBuilder.CreateRibbon(
      "tunnelShell",
      { pathArray: SHELL_LATERALS.map((lat) => samples.map((i) => shellPoint(i, lat))), sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    // Same world-space UVs as the ground (16 m per texture repeat): World paints it with the grass.
    const positions = shell.getVerticesData(VertexBuffer.PositionKind)!;
    const uvs: number[] = [];
    for (let k = 0; k < positions.length; k += 3) uvs.push(positions[k] / 16, positions[k + 2] / 16);
    shell.setVerticesData(VertexBuffer.UVKind, uvs);
    this.groundCovers.push(shell);
    // Portals: rock between the shell and the tube at both ends. The tube's floor strips start at the
    // curbs (±9.4); pairing them with the shell's outer points would fold the cap over itself.
    const rockMat = flatMaterial("rockMat", ROCK_COLOR, scene);
    for (const i of [samples[0], samples[samples.length - 1]]) {
      const cap = MeshBuilder.CreateRibbon(
        "tunnelPortal",
        {
          pathArray: [
            SHELL_LATERALS.map((lat) => shellPoint(i, lat)),
            TUBE_PROFILE.map(([lat, y]) => this.offsetSample(i, Math.abs(lat) === CURB_OUTER ? Math.sign(lat) * 12 : lat, y)),
          ],
          sideOrientation: Mesh.DOUBLESIDE,
        },
        scene,
      );
      cap.material = rockMat;
      cap.isPickable = false;
      cap.receiveShadows = true;
      cap.freezeWorldMatrix();
    }
    shell.isPickable = false;
    shell.receiveShadows = true;
    shell.freezeWorldMatrix();
  }

  /**
   * Natural rock arch across the road at arc length `d`: a thick, irregular slab with an elliptic opening
   * over the road. Its top reaches the ground beside it (a canyon ridge the road cuts through) and its
   * square outer sides fill the ridge's gap, so it reads as part of the wall. In or at a `cut`: painted
   * like the canyon's rock (World, rockCovers); else grey rock.
   */
  private buildArch(scene: Scene, d: number, k: number, cut: Cut | undefined): void {
    const { pos: road, heading } = this.positionAt(d, 0);
    const [rx, rz] = [Math.cos(heading), -Math.sin(heading)];
    const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
    const outer = ARCH_OPENING + ARCH_LEG;
    /** World point `lateral` m right of the road point, `along` m ahead, at height `y`. */
    const at = (lateral: number, along: number, y: number): Vector3 =>
      new Vector3(road.x + rx * lateral + fx * along, y, road.z + rz * lateral + fz * along);
    // Top: flush with the highest ground just beyond the legs (the ridge), at least ARCH_CROWN over the opening.
    let top = road.y + ARCH_HEIGHT + ARCH_CROWN;
    let foot = road.y;
    for (const s of [-1, 1]) {
      for (const along of [-ARCH_DEPTH[1], 0, ARCH_DEPTH[1]]) {
        const p = at(s * (outer + 3), along, 0);
        top = Math.max(top, this.terrain.height(p.x, p.z));
        const q = at(s * ARCH_OPENING, along, 0);
        foot = Math.min(foot, this.terrain.height(q.x, q.z));
      }
    }
    foot -= 3;
    const rand = mulberry32(97 + k);
    const steps = 24;
    /** Per station: inner (opening) and outer surface points as [lateral, y], and the half depth. */
    const stations: { inner: [number, number]; outer: [number, number]; depth: number }[] = [];
    const wobble = rand() * Math.PI * 2;
    for (let s = -1; s <= steps + 1; s++) {
      const theta = Math.PI * (1 - Math.min(Math.max(s, 0), steps) / steps);
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      // Square-ish outer outline: vertical sides into the wall, a flat top.
      const ol = outer * Math.sign(c) * Math.abs(c) ** 0.4;
      const depth = (ARCH_DEPTH[0] + (ARCH_DEPTH[1] - ARCH_DEPTH[0]) * (1 - sn)) * (1 + 0.15 * Math.sin(3 * theta + wobble));
      const buried = s < 0 || s > steps;
      stations.push({
        inner: [ARCH_OPENING * c, buried ? foot : road.y + ARCH_HEIGHT * sn],
        outer: [ol, buried ? foot : road.y + (top - road.y) * sn ** 0.35],
        depth,
      });
    }
    // Chamfered section (8 corners): opening face, front face, outer face, back face.
    const corners: readonly (readonly [number, number])[] = [
      [0, -0.7],
      [0, 0.7],
      [0.25, 1],
      [0.75, 1],
      [1, 0.7],
      [1, -0.7],
      [0.75, -1],
      [0.25, -1],
    ];
    const pathArray = corners.map(([u, v]) =>
      stations.map(({ inner, outer: o, depth }) =>
        at(inner[0] + (o[0] - inner[0]) * u, v * depth, inner[1] + (o[1] - inner[1]) * u),
      ),
    );
    const arch = MeshBuilder.CreateRibbon(`rockArch${k}`, { pathArray, closeArray: true, sideOrientation: Mesh.DOUBLESIDE }, scene);
    // Irregular rock: move every vertex by a hash of its (rounded) position, so duplicated vertices
    // (the closed section's seam) move together, then facet it.
    const positions = arch.getVerticesData(VertexBuffer.PositionKind)!;
    for (let v = 0; v < positions.length; v += 3) {
      const [x, y, z] = [positions[v], positions[v + 1], positions[v + 2]].map((c) => Math.round(c * 20) / 20);
      for (let c = 0; c < 3; c++) {
        const h = Math.sin(x * (12.9898 + c) + y * (78.233 - c) + z * (37.719 + 2 * c)) * 43758.5453;
        positions[v + c] += (h - Math.floor(h) - 0.5) * 1.4;
      }
    }
    arch.setVerticesData(VertexBuffer.PositionKind, positions);
    arch.convertToFlatShadedMesh();
    if (cut) this.rockCovers.push({ mesh: arch, color: cut.color ?? null });
    else arch.material = flatMaterial("archMat", ROCK_COLOR, scene);
    arch.isPickable = false;
    arch.receiveShadows = true;
    arch.freezeWorldMatrix();
    this.casters.push(arch);
  }

  /**
   * Circuit dressing from Kenney prefabs (grand stands, barriers, gantry, street lamps…). Returns
   * the ground positions of the bulky props (scenery keeps clear of them) and the street lamps.
   */
  buildProps(prefabs: Record<PrefabKey, Prefab>): CircuitProps {
    const L = this.length;
    const centroid = this.points.reduce((acc, p) => acc.addInPlace(p), Vector3.Zero()).scaleInPlace(1 / this.points.length);
    const outsideSign = (d: number): number =>
      Vector3.DistanceSquared(this.positionAt(d, 10).pos, centroid) > Vector3.DistanceSquared(this.positionAt(d, -10).pos, centroid) ? 1 : -1;
    const standSign = this.stands === "inside" ? -1 : 1;
    const bulky: Vector3[] = [];
    const lamps: StreetLamp[] = [];
    const nearArch = (d: number): boolean =>
      this.archArcs.some((a) => {
        const gap = (((d - a) % L) + L) % L;
        return Math.min(gap, L - gap) < ARCH_KEEP_CLEAR;
      });
    /** Stands a prop at `lateral` (signed) facing the road, uniformly scaled to `height` metres; false when skipped. */
    const standFacing = (key: PrefabKey, d: number, lateral: number, height: number): boolean => {
      const { pos, heading } = this.positionAt(d, lateral);
      // Nothing in tunnels, on bridges or under them, inside an arch's legs, in water or a canyon.
      if (this.onSpan(d, 20) || this.nearBridge(pos.x, pos.z, 16) || nearArch(d) || this.terrain.reshaped(pos.x, pos.z)) return false;
      const yaw = heading - Math.sign(lateral) * (Math.PI / 2) + (FRONT_YAW[key] ?? 0);
      place(prefabs[key], pos.x, this.terrain.height(pos.x, pos.z), pos.z, yaw, new Vector3(height, height, height));
      bulky.push(pos);
      return true;
    };

    for (let k = -3; k <= 2; k++) standFacing("grandStand", k * 10, standSign * outsideSign(k * 10) * 24, 9);
    for (const d of [-25, 0, 25]) standFacing("tent", d, -standSign * outsideSign(d) * 20, 4);
    // Street lamps replace the circuit's flood lights.
    if (this.lampSpacing === 0) {
      for (let k = 0; k * 50 < L; k++) standFacing("lightPost", k * 50, (k % 2 === 0 ? 1 : -1) * 12.5, 9);
    }
    for (let k = 0; k < 8; k++) {
      const d = (k * L) / 8 + L / 16;
      standFacing("bannerTower", d, outsideSign(d) * 14, 8);
    }
    for (let k = 0; k < 4; k++) {
      const d = (k * L) / 4 + L / 8;
      standFacing("billboard", d, outsideSign(d) * 18, 5);
    }
    for (const s of [-1, 1]) standFacing("flagCheckers", 0, s * 10, 4);

    // Street lamps on both sides, arm over the curb; the prefab's origin sits between pole and bulb.
    const origin = LAMP_POLE - STREET_LAMP_POLE_Z * LAMP_HEIGHT;
    const bulbLateral = origin + STREET_LAMP_BULB.z * LAMP_HEIGHT;
    for (let d = LAMP_START_CLEAR; this.lampSpacing > 0 && d <= L - LAMP_START_CLEAR; d += this.lampSpacing) {
      for (const s of [-1, 1]) {
        if (!standFacing("streetLamp", d, s * origin, LAMP_HEIGHT)) continue;
        const base = this.positionAt(d, s * origin).pos;
        const bulb = this.positionAt(d, s * bulbLateral).pos;
        bulb.y = this.terrain.height(base.x, base.z) + STREET_LAMP_BULB.y * LAMP_HEIGHT;
        const { pos, heading, pitch } = this.positionAt(d, s * LAMP_POOL);
        lamps.push({ bulb, pool: pos, heading, pitch });
      }
    }
    for (const d of this.archArcs) for (const s of [-1, 1]) bulky.push(this.positionAt(d, s * (ARCH_OPENING + ARCH_LEG / 2)).pos);

    // Barriers along both edges, length along the road.
    const count = Math.floor(L / BARRIER_SPACING);
    for (let k = 0; k < count; k++) {
      const prefab = prefabs[k % 2 === 0 ? "barrierRed" : "barrierWhite"];
      const scale = new Vector3(BARRIER_SPACING / prefab.size.x, 0.8, 0.5 / prefab.size.z);
      for (const s of [-1, 1]) {
        const { pos, heading } = this.positionAt(k * BARRIER_SPACING, s * 11);
        // At road height: on bridges they are the railings.
        place(prefab, pos.x, pos.y, pos.z, heading + Math.PI / 2, scale);
      }
    }

    // Start gantry spanning the road (its long axis is x, so yaw = heading puts x across the road).
    const gantry = prefabs.gantry;
    const start = this.positionAt(0, 0);
    place(gantry, start.pos.x, start.pos.y, start.pos.z, start.heading, new Vector3(24 / gantry.size.x, 7.5, 1.2 / gantry.size.z));
    return { bulky, lamps };
  }
}
