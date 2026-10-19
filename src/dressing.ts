import {
  Color3,
  Color4,
  DynamicTexture,
  Engine,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
  Vector4,
} from "@babylonjs/core";
import { place, type Prefab, type PrefabKey } from "./assets";
import { mulberry32 } from "./rng";
import type { Building, PlacedProp } from "./sceneries/types";
import type { Terrain } from "./terrain";

/** Minimum plan distance (m) from the centreline to a building footprint: road edge (8 m) + 12 m. */
export const BUILDING_CLEARANCE = 20;

/** Facade texture module: WINDOW_COLS × WINDOW_ROWS windows, each WINDOW_WIDTH m wide and FLOOR_HEIGHT m tall. */
const WINDOW_COLS = 4;
const WINDOW_ROWS = 4;
const WINDOW_WIDTH = 4;
const FLOOR_HEIGHT = 3.5;
const FACADE_PX = 512;
/** Share of the windows lit at night. */
const LIT_WINDOWS = 0.6;
/** Buildings sink this far under their lowest footprint corner (sloped ground). */
const BUILDING_SINK = 0.3;
const WALL_TINTS: readonly (readonly [number, number, number])[] = [
  [1, 0.95, 0.86],
  [0.86, 0.9, 1],
  [1, 0.85, 0.78],
  [0.88, 0.96, 0.88],
  [0.8, 0.8, 0.84],
  [1, 0.92, 0.7],
];

/** A street lamp's light: `bulb` under its head, `pool` the road point it lights, both world positions. */
export interface StreetLamp {
  bulb: Vector3;
  pool: Vector3;
  /** Road heading and pitch at the pool (radians, see TrackPose). */
  heading: number;
  pitch: number;
}

/** Plan distance (m) from (x, z) to a building footprint; 0 inside it. */
export function footprintDistance(b: Building, x: number, z: number): number {
  const yaw = b.rotY ?? 0;
  const dx = x - b.x;
  const dz = z - b.z;
  // World offset in the building's frame (Babylon yaw: local x → (cos, −sin), local z → (sin, cos)).
  const lx = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) - b.width / 2;
  const lz = Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)) - b.depth / 2;
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
}

/** (x, z) lies within `margin` m of a building footprint. */
export function insideBuildings(buildings: readonly Building[], x: number, z: number, margin: number): boolean {
  return buildings.some((b) => footprintDistance(b, x, z) < margin);
}

/** Wall/window facade module; `lit` = the night's emissive windows instead of the day's glass. */
function facadeTexture(scene: Scene, lit: boolean): DynamicTexture {
  const tex = new DynamicTexture(lit ? "facadeLitTex" : "facadeTex", { width: FACADE_PX, height: FACADE_PX }, scene, true);
  const ctx = tex.getContext();
  const cw = FACADE_PX / WINDOW_COLS;
  const ch = FACADE_PX / WINDOW_ROWS;
  ctx.fillStyle = lit ? "#000" : "#ebe7df";
  ctx.fillRect(0, 0, FACADE_PX, FACADE_PX);
  const rand = mulberry32(lit ? 11 : 12);
  for (let r = 0; r < WINDOW_ROWS; r++) {
    for (let c = 0; c < WINDOW_COLS; c++) {
      const x = c * cw + cw * 0.24;
      const y = r * ch + ch * 0.22;
      const w = cw * 0.52;
      const h = ch * 0.5;
      if (lit) {
        if (rand() > LIT_WINDOWS) continue;
        ctx.fillStyle = rand() < 0.75 ? "#ffd27a" : "#cfe4ff";
        ctx.fillRect(x, y, w, h);
        continue;
      }
      // Floor band under each row, frame, glass with a lighter reflection streak.
      ctx.fillStyle = "#c9c4ba";
      ctx.fillRect(c * cw, r * ch + ch * 0.9, cw, ch * 0.1);
      ctx.fillStyle = "#8d8a84";
      ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
      ctx.fillStyle = "#3d4a5c";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#5b6c82";
      ctx.fillRect(x + w * 0.15, y, w * 0.18, h);
    }
  }
  tex.update();
  // DynamicTexture clamps by default: the walls repeat the module.
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/**
 * Box buildings (one merged mesh) with a window-grid facade and a flat roof, standing on the
 * terrain; at night the windows light up.
 */
export function buildBuildings(scene: Scene, buildings: readonly Building[], terrain: Terrain, night: boolean): void {
  if (buildings.length === 0) return;
  const rand = mulberry32(21);
  const moduleW = WINDOW_COLS * WINDOW_WIDTH;
  const moduleH = WINDOW_ROWS * FLOOR_HEIGHT;
  // The roof samples one wall texel; a darker vertex colour turns it into roofing.
  const roofUV = new Vector4(0.01, 0.01, 0.01, 0.01);
  const boxes = buildings.map((b, k) => {
    const yaw = b.rotY ?? 0;
    const corners = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => {
        const lx = (sx * b.width) / 2;
        const lz = (sz * b.depth) / 2;
        return terrain.height(b.x + lx * Math.cos(yaw) + lz * Math.sin(yaw), b.z - lx * Math.sin(yaw) + lz * Math.cos(yaw));
      }),
    );
    const base = Math.min(...corners, terrain.height(b.x, b.z)) - BUILDING_SINK;
    const height = Math.max(...corners) + b.height - base;
    const [r, g, bl] = WALL_TINTS[Math.floor(rand() * WALL_TINTS.length)];
    const wall = new Color4(r, g, bl, 1);
    const roof = new Color4(0.45, 0.45, 0.48, 1);
    const box = MeshBuilder.CreateBox(
      `building${k}`,
      {
        width: b.width,
        height,
        depth: b.depth,
        wrap: true,
        // Faces: +z, −z, +x, −x, top, bottom. Walls repeat the module every moduleW × moduleH m.
        faceUV: [
          new Vector4(0, 0, b.width / moduleW, height / moduleH),
          new Vector4(0, 0, b.width / moduleW, height / moduleH),
          new Vector4(0, 0, b.depth / moduleW, height / moduleH),
          new Vector4(0, 0, b.depth / moduleW, height / moduleH),
          roofUV,
          roofUV,
        ],
        faceColors: [wall, wall, wall, wall, roof, roof],
      },
      scene,
    );
    box.bakeTransformIntoVertices(
      Matrix.Translation(0, height / 2, 0).multiply(Matrix.RotationY(yaw)).multiply(Matrix.Translation(b.x, base, b.z)),
    );
    return box;
  });
  const mesh = Mesh.MergeMeshes(boxes, true, true)!;
  mesh.name = "buildings";
  const mat = new StandardMaterial("buildingMat", scene);
  mat.diffuseTexture = facadeTexture(scene, false);
  mat.specularColor = Color3.Black();
  if (night) {
    // Lit windows are added after the diffuse term (not multiplied by the dark glass).
    mat.emissiveTexture = facadeTexture(scene, true);
    mat.useEmissiveAsIllumination = true;
  } else mat.emissiveColor = new Color3(0.2, 0.2, 0.2);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  mesh.freezeWorldMatrix();
}

/** Stands the scenery's drawn props on the terrain. Returns their ground positions. */
export function placeProps(prefabs: Record<PrefabKey, Prefab>, props: readonly PlacedProp[], terrain: Terrain): Vector3[] {
  const rand = mulberry32(31);
  return props.map((p) => {
    const y = terrain.height(p.x, p.z);
    const yaw = p.rotY ?? rand() * Math.PI * 2;
    place(prefabs[p.prefab], p.x, y, p.z, yaw, new Vector3(p.height, p.height, p.height));
    return new Vector3(p.x, y, p.z);
  });
}

/** Radial white → transparent texture for additive glows (lamp pools, headlights, sun halo). */
export function glowTexture(scene: Scene, name: string, stops: readonly (readonly [number, string])[]): DynamicTexture {
  const tex = new DynamicTexture(name, { width: 128, height: 128 }, scene, true);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Unlit additive material showing `tex` (rgb × alpha added to the frame). */
export function additiveMaterial(scene: Scene, name: string, tex: DynamicTexture, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = color;
  mat.opacityTexture = tex;
  mat.alphaMode = Engine.ALPHA_ADD;
  mat.backFaceCulling = false;
  return mat;
}

const LAMP_GLOW = new Color3(1, 0.82, 0.5);
/** Light pool on the road under each lamp: radius (m), additive strength. */
const POOL_RADIUS = 9;
const POOL_STRENGTH = 0.6;

/** Night: glowing bulbs under the lamp heads and warm light pools on the road. */
export function buildLampLights(scene: Scene, lamps: readonly StreetLamp[]): void {
  if (lamps.length === 0) return;
  const bulbMat = new StandardMaterial("lampBulbMat", scene);
  bulbMat.disableLighting = true;
  bulbMat.diffuseColor = Color3.Black();
  bulbMat.specularColor = Color3.Black();
  bulbMat.emissiveColor = new Color3(1, 0.93, 0.75);
  const bulb = MeshBuilder.CreateSphere("lampBulb", { diameter: 0.55, segments: 6 }, scene);
  bulb.scaling.y = 0.5;
  bulb.bakeCurrentTransformIntoVertices();
  bulb.material = bulbMat;
  bulb.isPickable = false;

  const pool = MeshBuilder.CreateGround("lampPool", { width: 2, height: 2 }, scene);
  pool.material = additiveMaterial(
    scene,
    "lampPoolMat",
    glowTexture(scene, "lampPoolTex", [
      [0, "rgba(255,255,255,1)"],
      [0.5, "rgba(255,255,255,0.55)"],
      [1, "rgba(255,255,255,0)"],
    ]),
    LAMP_GLOW.scale(POOL_STRENGTH),
  );
  (pool.material as StandardMaterial).zOffset = -4;
  pool.isPickable = false;

  const one = new Vector3(1, 1, 1);
  const poolScale = new Vector3(POOL_RADIUS, 1, POOL_RADIUS);
  for (const lamp of lamps) {
    bulb.thinInstanceAdd(Matrix.Compose(one, Quaternion.Identity(), lamp.bulb), false);
    const at = lamp.pool.add(new Vector3(0, 0.06, 0));
    pool.thinInstanceAdd(Matrix.Compose(poolScale, Quaternion.RotationYawPitchRoll(lamp.heading, -lamp.pitch, 0), at), false);
  }
  for (const m of [bulb, pool]) {
    m.thinInstanceBufferUpdated("matrix");
    m.thinInstanceRefreshBoundingInfo();
    m.freezeWorldMatrix();
  }
}
