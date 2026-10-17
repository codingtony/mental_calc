import {
  AssetContainer,
  Color3,
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  PBRMaterial,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import type { RiderBody } from "./look";
import motoUrl from "./assets/models/moto.glb?url&no-inline";
import riderGirlUrl from "./assets/models/rider-girl.glb?url&no-inline";
import riderBoyUrl from "./assets/models/rider-boy.glb?url&no-inline";
import treeRoundUrl from "./assets/models/tree-round.glb?url&no-inline";
import treeTallUrl from "./assets/models/tree-tall.glb?url&no-inline";
import treeSmallUrl from "./assets/models/tree-small.glb?url&no-inline";
import bushUrl from "./assets/models/bush.glb?url&no-inline";
import rockUrl from "./assets/models/rock.glb?url&no-inline";
import grandStandUrl from "./assets/models/grand-stand.glb?url&no-inline";
import tentUrl from "./assets/models/tent.glb?url&no-inline";
import lightPostUrl from "./assets/models/light-post.glb?url&no-inline";
import bannerTowerUrl from "./assets/models/banner-tower.glb?url&no-inline";
import billboardUrl from "./assets/models/billboard.glb?url&no-inline";
import flagCheckersUrl from "./assets/models/flag-checkers.glb?url&no-inline";
import barrierRedUrl from "./assets/models/barrier-red.glb?url&no-inline";
import barrierWhiteUrl from "./assets/models/barrier-white.glb?url&no-inline";
import gantryUrl from "./assets/models/gantry.glb?url&no-inline";

// Lazy-loads the glTF plugin chunk on first use.
registerBuiltInLoaders();

const PREFAB_URLS = {
  treeRound: treeRoundUrl,
  treeTall: treeTallUrl,
  treeSmall: treeSmallUrl,
  bush: bushUrl,
  rock: rockUrl,
  grandStand: grandStandUrl,
  tent: tentUrl,
  lightPost: lightPostUrl,
  bannerTower: bannerTowerUrl,
  billboard: billboardUrl,
  flagCheckers: flagCheckersUrl,
  barrierRed: barrierRedUrl,
  barrierWhite: barrierWhiteUrl,
  gantry: gantryUrl,
} as const;

export type PrefabKey = keyof typeof PREFAB_URLS;

/** Static model merged into one mesh, normalised to height 1 with its base centred on the origin. */
export interface Prefab {
  mesh: Mesh;
  /** Extents of the normalised mesh (y = 1). */
  size: Vector3;
  placed: number;
}

export interface MotoTemplate {
  body: Mesh;
  frontWheel: Mesh;
  rearWheel: Mesh;
  wheelRadius: number;
  /** Seat dip top, moto-local. */
  seat: Vector3;
  /** Handlebar grips [left, right], moto-local. */
  grips: [Vector3, Vector3];
  length: number;
}

export interface Assets {
  prefabs: Record<PrefabKey, Prefab>;
  moto: MotoTemplate;
  riders: Record<RiderBody, AssetContainer>;
}

/** Moto length in metres (nose to tail). */
const MOTO_LENGTH = 2.4;

// Measured on moto.glb in raw glTF units (see CREDITS.md for the source).
const RAW_AXLE_Y = 18.4;
const RAW_FRONT_AXLE_INSET = 18.3; // behind the front end
const RAW_REAR_AXLE_INSET = 18.5; // ahead of the rear end
const RAW_WHEEL_REACH = 19.2; // tyre/rim vertices lie within this of the axle (y/z plane)
const RAW_WHEEL_HALF_WIDTH = 5.1; // fork legs / swing arm sit further out
const RAW_SEAT = new Vector3(0, 41, 20); // raw glTF, front = −z
const RAW_GRIP = new Vector3(18, 47.5, -28);

function load(url: string, scene: Scene): Promise<AssetContainer> {
  // StandardMaterial expects gamma-space texels; sRGB GPU buffers would hand it linear (dark) ones.
  return LoadAssetContainerAsync(url, scene, { pluginExtension: ".glb", pluginOptions: { gltf: { useSRGBBuffers: false } } });
}

/**
 * Kenney's exporter writes sRGB values into baseColorFactor (glTF says linear), so those
 * colours are used as-is instead of being converted to gamma space.
 */
const SRGB_FACTORS: Partial<Record<PrefabKey, true>> = {
  grandStand: true,
  tent: true,
  lightPost: true,
  bannerTower: true,
  billboard: true,
  flagCheckers: true,
  barrierRed: true,
  barrierWhite: true,
  gantry: true,
};

export async function loadAssets(scene: Scene): Promise<Assets> {
  const keys = Object.keys(PREFAB_URLS) as PrefabKey[];
  const [moto, girl, boy, ...props] = await Promise.all([
    load(motoUrl, scene),
    load(riderGirlUrl, scene),
    load(riderBoyUrl, scene),
    ...keys.map((k) => load(PREFAB_URLS[k], scene)),
  ]);
  standardizeMaterials(girl, scene, false);
  standardizeMaterials(boy, scene, false);
  const prefabs = {} as Record<PrefabKey, Prefab>;
  keys.forEach((k, i) => {
    standardizeMaterials(props[i], scene, SRGB_FACTORS[k] === true);
    prefabs[k] = buildPrefab(props[i], k);
  });
  return { prefabs, moto: buildMotoTemplate(moto), riders: { girl, boy } };
}

/**
 * Swaps PBR materials for flat StandardMaterials of the same name: there is no environment
 * map in this game, and PBR without one renders dark next to the procedural track.
 */
function standardizeMaterials(container: AssetContainer, scene: Scene, srgbFactors: boolean): void {
  for (const pbr of container.materials.slice()) {
    if (!(pbr instanceof PBRMaterial)) continue;
    const mat = new StandardMaterial(pbr.name, scene);
    scene.removeMaterial(mat); // belongs to the container, not the scene, until added
    mat.diffuseColor = srgbFactors ? pbr.albedoColor.clone() : pbr.albedoColor.toGammaSpace();
    mat.diffuseTexture = pbr.albedoTexture;
    mat.specularColor = Color3.Black();
    mat.emissiveColor = mat.diffuseColor.scale(0.15);
    for (const mesh of container.meshes) if (mesh.material === pbr) mesh.material = mat;
    container.materials.splice(container.materials.indexOf(pbr), 1, mat);
    pbr.dispose();
  }
}

function buildPrefab(container: AssetContainer, name: string): Prefab {
  container.addAllToScene();
  const parts = container.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
  mesh.name = name;
  for (const m of container.meshes) if (!m.isDisposed()) m.dispose(false, false);
  for (const n of container.transformNodes) n.dispose();
  const { minimum: min, maximum: max } = mesh.getBoundingInfo().boundingBox;
  const s = 1 / (max.y - min.y);
  mesh.bakeTransformIntoVertices(
    Matrix.Translation(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2).multiply(Matrix.Scaling(s, s, s)),
  );
  mesh.refreshBoundingInfo();
  mesh.isPickable = false;
  return { mesh, size: max.subtract(min).scale(s), placed: 0 };
}

/** Adds one thin instance of a prefab standing on the ground; `scale` is in prefab units (height 1). */
export function place(prefab: Prefab, x: number, z: number, rotY: number, scale: Vector3): void {
  prefab.mesh.thinInstanceAdd(Matrix.Compose(scale, Quaternion.RotationYawPitchRoll(rotY, 0, 0), new Vector3(x, 0, z)), false);
  prefab.placed++;
}

/** Call once after every place(): uploads instances; unused prefabs are hidden. */
export function finishPrefabs(prefabs: Record<PrefabKey, Prefab>): void {
  for (const p of Object.values(prefabs)) {
    if (p.placed === 0) {
      // A thin-instance mesh without instances would render its base at the origin.
      p.mesh.setEnabled(false);
      continue;
    }
    p.mesh.thinInstanceBufferUpdated("matrix");
    p.mesh.thinInstanceRefreshBoundingInfo();
    p.mesh.freezeWorldMatrix();
  }
}

/**
 * Splits the moto into body + two wheels (so the wheels can spin) and converts it to
 * moto-local metres: front +z, centred on x/z, wheels on y = 0.
 */
function buildMotoTemplate(container: AssetContainer): MotoTemplate {
  const src = container.meshes.find((m) => m.getTotalVertices() > 0) as Mesh;
  const raw = src.getVerticesData(VertexBuffer.PositionKind)!;
  const uvs = src.getVerticesData(VertexBuffer.UVKind)!;
  const indices = src.getIndices()!;
  const n = raw.length / 3;

  // Raw glTF is right-handed; Babylon is left-handed. Mirror one axis, chosen so the front
  // (where the windscreen apex is) ends up at +z. The mirror flips winding (fixed below).
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  let apex = 0;
  for (let i = 0; i < n; i++) {
    min.minimizeInPlaceFromFloats(raw[3 * i], raw[3 * i + 1], raw[3 * i + 2]);
    max.maximizeInPlaceFromFloats(raw[3 * i], raw[3 * i + 1], raw[3 * i + 2]);
    if (raw[3 * i + 1] > raw[3 * apex + 1]) apex = i;
  }
  const frontIsNegZ = raw[3 * apex + 2] < (min.z + max.z) / 2;
  const sx = frontIsNegZ ? 1 : -1;
  const sz = frontIsNegZ ? -1 : 1;
  const cx = (sx * min.x + sx * max.x) / 2;
  const cz = (sz * min.z + sz * max.z) / 2;
  const rawLength = max.z - min.z;
  const k = MOTO_LENGTH / rawLength;
  // Raw → moto-local metres.
  const toLocal = (x: number, y: number, z: number): Vector3 => new Vector3((sx * x - cx) * k, (y - min.y) * k, (sz * z - cz) * k);
  const local = new Float32Array(raw.length);
  for (let i = 0; i < n; i++) toLocal(raw[3 * i], raw[3 * i + 1], raw[3 * i + 2]).toArray(local, 3 * i);

  const half = (rawLength * k) / 2;
  const axleY = RAW_AXLE_Y * k;
  const axles = [half - RAW_FRONT_AXLE_INSET * k, -half + RAW_REAR_AXLE_INSET * k]; // z of front, rear
  const reach2 = (RAW_WHEEL_REACH * k) ** 2;
  const halfWidth = RAW_WHEEL_HALF_WIDTH * k;
  const groups: number[][] = [[], [], []]; // body, front, rear (triangle starts)
  for (let t = 0; t < indices.length; t += 3) {
    let group = 0;
    for (let w = 0; w < 2 && group === 0; w++) {
      let inside = true;
      for (let c = 0; c < 3 && inside; c++) {
        const v = indices[t + c];
        const dy = local[3 * v + 1] - axleY;
        const dz = local[3 * v + 2] - axles[w];
        inside = Math.abs(local[3 * v]) <= halfWidth && dy * dy + dz * dz <= reach2;
      }
      if (inside) group = w + 1;
    }
    groups[group].push(t);
  }

  /** `atAxle`: mesh origin at the group's bbox centre (y/z) so it can spin about local x. */
  const build = (name: string, tris: number[], atAxle: boolean): { mesh: Mesh; min: Vector3; max: Vector3 } => {
    const gMin = new Vector3(Infinity, Infinity, Infinity);
    const gMax = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const t of tris) {
      for (let c = 0; c < 3; c++) {
        const v = indices[t + c];
        gMin.minimizeInPlaceFromFloats(local[3 * v], local[3 * v + 1], local[3 * v + 2]);
        gMax.maximizeInPlaceFromFloats(local[3 * v], local[3 * v + 1], local[3 * v + 2]);
      }
    }
    const origin = atAxle ? new Vector3(0, (gMin.y + gMax.y) / 2, (gMin.z + gMax.z) / 2) : Vector3.Zero();
    // Unshared vertices: flat shading, and the winding is reversed to undo the mirror.
    const positions = new Float32Array(tris.length * 9);
    const uv = new Float32Array(tris.length * 6);
    const ind = new Uint32Array(tris.length * 3);
    tris.forEach((t, j) => {
      for (let c = 0; c < 3; c++) {
        const v = indices[t + 2 - c];
        const o = 3 * j + c;
        positions[3 * o] = local[3 * v] - origin.x;
        positions[3 * o + 1] = local[3 * v + 1] - origin.y;
        positions[3 * o + 2] = local[3 * v + 2] - origin.z;
        uv[2 * o] = uvs[2 * v];
        uv[2 * o + 1] = uvs[2 * v + 1];
        ind[o] = o;
      }
    });
    const normals = new Float32Array(positions.length);
    VertexData.ComputeNormals(positions, ind, normals);
    const data = new VertexData();
    data.positions = positions;
    data.indices = ind;
    data.uvs = uv;
    data.normals = normals;
    const mesh = new Mesh(name, src.getScene());
    data.applyToMesh(mesh);
    mesh.position.copyFrom(origin);
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return { mesh, min: gMin, max: gMax };
  };

  const body = build("motoBody", groups[0], false);
  const front = build("motoFrontWheel", groups[1], true);
  const rear = build("motoRearWheel", groups[2], true);
  container.dispose();

  const grips = [toLocal(-RAW_GRIP.x, RAW_GRIP.y, RAW_GRIP.z), toLocal(RAW_GRIP.x, RAW_GRIP.y, RAW_GRIP.z)].sort((a, b) => a.x - b.x);
  return {
    body: body.mesh,
    frontWheel: front.mesh,
    rearWheel: rear.mesh,
    wheelRadius: (front.max.y - front.min.y) / 2,
    seat: toLocal(RAW_SEAT.x, RAW_SEAT.y, RAW_SEAT.z),
    grips: [grips[0], grips[1]],
    length: MOTO_LENGTH,
  };
}
