import { Color3, Color4, Curve3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";

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
const DASH_SPACING = 8;

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

/** Checkerboard texture with `cols`×`rows` squares (start line + arch banner). */
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
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const tx = seg > 0 ? dx / seg : 0;
    const tz = seg > 0 ? dz / seg : 1;
    return {
      pos: new Vector3(a.x + dx * f + tz * lateral, 0, a.z + dz * f - tx * lateral),
      heading: Math.atan2(tx, tz),
    };
  }

  /** Point at sample `i` shifted `lateral` along the smoothed (vertex) right vector. */
  private offsetSample(i: number, lateral: number, y: number): Vector3 {
    const n = this.points.length;
    const prev = this.points[(i - 1 + n) % n];
    const next = this.points[(i + 1) % n];
    const p = this.points[i];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    return new Vector3(p.x + tz * lateral, y, p.z - tx * lateral);
  }

  private edgePath(lateral: number, y: number, closeLoop: boolean): Vector3[] {
    const path = this.points.map((_, i) => this.offsetSample(i, lateral, y));
    if (closeLoop) path.push(path[0].clone());
    return path;
  }

  private buildMeshes(scene: Scene): void {
    // Road surface.
    const road = MeshBuilder.CreateRibbon(
      "road",
      {
        pathArray: [this.edgePath(-ROAD_HALF_WIDTH, 0.02, false), this.edgePath(ROAD_HALF_WIDTH, 0.02, false)],
        closePath: true,
      },
      scene,
    );
    const roadMat = flatMaterial("roadMat", new Color3(0.35, 0.35, 0.38), scene);
    // Flat layers sit a few cm apart; polygon offset keeps them above the ground when seen from far away.
    roadMat.zOffset = -1;
    road.material = roadMat;
    road.isPickable = false;
    road.freezeWorldMatrix();

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
      curb.freezeWorldMatrix();
    }

    // Center dashes.
    const dash = MeshBuilder.CreateBox("dash", { width: 0.3, height: 0.02, depth: 3 }, scene);
    const dashMat = new StandardMaterial("dashMat", scene);
    dashMat.diffuseColor = Color3.White();
    dashMat.emissiveColor = new Color3(0.6, 0.6, 0.6);
    dashMat.specularColor = Color3.Black();
    dashMat.zOffset = -3;
    dash.material = dashMat;
    dash.isPickable = false;
    const dashCount = Math.floor(this.length / DASH_SPACING);
    for (let k = 0; k < dashCount; k++) {
      const { pos, heading } = this.positionAt(k * DASH_SPACING + DASH_SPACING / 2, 0);
      const inst = k === 0 ? dash : dash.createInstance(`dash${k}`);
      inst.position.set(pos.x, 0.03, pos.z);
      inst.rotation.y = heading;
      inst.isPickable = false;
      inst.freezeWorldMatrix();
    }

    // Start line + arch.
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

    const poleMat = flatMaterial("poleMat", new Color3(0.9, 0.05, 0.1), scene);
    for (const lateral of [-10, 10]) {
      const p = this.positionAt(0, lateral).pos;
      const pole = MeshBuilder.CreateCylinder(`archPole${lateral}`, { diameter: 0.8, height: 7 }, scene);
      pole.material = poleMat;
      pole.position.set(p.x, 3.5, p.z);
      pole.isPickable = false;
      pole.freezeWorldMatrix();
    }
    const top = MeshBuilder.CreateBox("archTop", { width: 22, height: 1.5, depth: 1 }, scene);
    top.material = checkerMat;
    top.position.set(start.pos.x, 7.5, start.pos.z);
    top.rotation.y = start.heading;
    top.isPickable = false;
    top.freezeWorldMatrix();

    // Floating rainbow cubes.
    const cubes: { mesh: Mesh; mat: StandardMaterial; hue: number }[] = [];
    for (let k = 0; k < 6; k++) {
      for (const lateral of [-4, 0, 4]) {
        const { pos } = this.positionAt((this.length * k) / 6 + 30, lateral);
        const mesh = MeshBuilder.CreateBox(`itemCube${k}_${lateral}`, { size: 1.2 }, scene);
        const mat = new StandardMaterial(`itemCubeMat${k}_${lateral}`, scene);
        mat.diffuseColor = Color3.Black();
        mat.specularColor = Color3.Black();
        mat.disableLighting = true;
        mat.alpha = 0.85;
        mesh.material = mat;
        mesh.position.set(pos.x, 1.5, pos.z);
        mesh.isPickable = false;
        cubes.push({ mesh, mat, hue: (k * 60 + (lateral + 4) * 15) % 360 });
      }
    }
    let time = 0;
    scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      time += dt;
      for (const c of cubes) {
        c.mesh.rotation.y += dt * 1.5;
        c.mesh.rotation.x += dt * 0.9;
        c.mesh.position.y = 1.5 + 0.25 * Math.sin(time * 2 + c.hue);
        Color3.HSVtoRGBToRef((c.hue + time * 120) % 360, 0.9, 1, c.mat.emissiveColor);
      }
    });
  }
}
