import {
  AbstractMesh,
  Axis,
  Color3,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Skeleton,
} from "@babylonjs/core";
import type { Assets } from "./assets";
import { buildHelmet } from "./helmet";
import { rgbCss, type RiderLook, type Rgb } from "./look";

export interface Moto {
  /** On the ground, forward +z. */
  root: TransformNode;
  /** [front, rear], spin around local x. */
  wheels: Mesh[];
  wheelRadius: number;
  flame: Mesh;
  /** For the shadow generator; rebuilt by setLook. */
  casters: AbstractMesh[];
  setLook(look: RiderLook): void;
  /** 0 = both feet on the pegs, 1 = left foot on the ground (stopped). */
  setFootDown(amount: number): void;
}

/** Standing height of a rider in metres (scaled from the model's rest pose). */
const RIDER_HEIGHT = 2.0;
/** Helmet diameter in metres: the cartoon riders have big heads (~0.4 m wide). */
const HELMET_SIZE = 0.44;
/** Hips sit this far above the seat dip. */
const HIP_LIFT = 0.1;
/** Helmet centre: along the head joint's up axis from the joint. */
const HELMET_LIFT = 0.11;
/** Seconds into the `_Sitting` clip (seated from 1 s), in loader frames (60 fps). */
const SIT_FRAME = 120;
/**
 * Local joint rotations (radians, applied in order) turning the sitting pose into a racing tuck:
 * torso ~42° forward, hands on the grips, left knee/foot out onto the peg. Fitted for both bodies
 * (same skeleton) against the moto's seat and grips.
 */
const TUCK: Record<string, readonly (readonly ["x" | "y" | "z", number])[]> = {
  Abdomen: [["x", 0.9], ["y", 0.5]],
  Torso: [["x", 0.3], ["z", -0.4]],
  Neck: [["x", -0.38], ["z", 0.59]],
  "UpperArm.L": [["x", 2.14], ["y", -0.4], ["z", -1.2]],
  "LowerArm.L": [["x", -0.1], ["z", 0.4]],
  "UpperArm.R": [["x", 0.89], ["y", 0.83], ["z", 0.7]],
  "LowerArm.R": [["x", -0.5], ["z", 0.42]],
  "UpperLeg.L": [["x", 0.2], ["z", -0.7], ["y", -0.1]],
};
/** Left lean (radians) of a stopped moto resting on the rider's left foot; FOOT_DOWN is fitted to it. */
export const FOOT_DOWN_LEAN = 0.23;
/**
 * Extra local joint rotations from the tuck to the stopped pose (see TUCK): left leg swung down and
 * out, knee ~20° bent, sole flat on the ground ~0.43 m left of the moto's centre when it leans by
 * FOOT_DOWN_LEAN. `Foot.L` applies after the foot follows the shin, to flatten the sole. Fitted
 * numerically for both bodies (same skeleton).
 */
const FOOT_DOWN: Record<string, readonly (readonly ["x" | "y" | "z", number])[]> = {
  "UpperLeg.L": [["x", 0.879], ["z", -0.125], ["y", 0.296]],
  "LowerLeg.L": [["x", -1.384]],
  "Foot.L": [["x", -0.298], ["z", 0.046]],
};
const AXES = { x: Axis.X, y: Axis.Y, z: Axis.Z };

// Moto palette texture tiles (256×256 image, v pointing down).
const PALETTE_SIZE = 256;
const PALETTE: readonly [x: number, y: number, w: number, h: number, color: Rgb | null][] = [
  [0, 0, 128, 128, [233 / 255, 233 / 255, 233 / 255]],
  [128, 0, 128, 128, [128 / 255, 128 / 255, 128 / 255]],
  [0, 128, 128, 128, null], // paint
  [128, 128, 64, 128, [80 / 255, 62 / 255, 53 / 255]],
  [192, 128, 64, 128, [44 / 255, 44 / 255, 44 / 255]],
];

function paintPalette(tex: DynamicTexture, bike: Rgb): void {
  const ctx = tex.getContext();
  for (const [x, y, w, h, color] of PALETTE) {
    ctx.fillStyle = rgbCss(color ?? bike);
    ctx.fillRect(x, y, w, h);
  }
  tex.update(false);
}

/** Recomputes world matrices top-down (the scene only does this at render time). */
function refresh(node: TransformNode): void {
  node.computeWorldMatrix(true);
  for (const child of node.getChildren()) if (child instanceof TransformNode) refresh(child);
}

/** Applies local joint rotations (in order) on top of each joint's current rotation. */
function rotateJoints(
  joint: (j: string) => TransformNode,
  table: Record<string, readonly (readonly ["x" | "y" | "z", number])[]>,
): void {
  for (const [j, rotations] of Object.entries(table)) {
    const node = joint(j);
    let q = node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation);
    for (const [axis, a] of rotations) q = q.multiply(Quaternion.RotationAxis(AXES[axis], a));
    node.rotationQuaternion = q;
  }
}

interface Rider {
  pivot: TransformNode;
  meshes: AbstractMesh[];
  materials: StandardMaterial[];
  skeletons: Skeleton[];
  /** Helmet centre, moto-local. */
  head: Vector3;
  /** End poses blended by setFootDown: index 0 = tuck, 1 = left foot down. */
  legPose: {
    joints: TransformNode[];
    tuck: Quaternion[];
    down: Quaternion[];
    foot: TransformNode;
    footPos: [Vector3, Vector3];
    footRot: [Quaternion, Quaternion];
  };
}

function spawnRider(scene: Scene, assets: Assets, root: TransformNode, name: string, look: RiderLook): Rider {
  const entries = assets.riders[look.body].instantiateModelsToScene((n) => `${name}-${n}`, true, { doNotInstantiate: true });
  const top = entries.rootNodes[0] as TransformNode;
  const pivot = new TransformNode(`${name}-rider`, scene);
  pivot.parent = root;
  top.parent = pivot;
  const joints = new Map<string, TransformNode>();
  for (const n of top.getDescendants(false)) {
    if (n instanceof TransformNode && !(n instanceof AbstractMesh)) joints.set(n.name.slice(name.length + 1), n);
  }
  const joint = (j: string): TransformNode => joints.get(j)!;

  refresh(root);
  const rest = top.getHierarchyBoundingVectors(true);
  const standing = rest.max.y - rest.min.y;

  // Freeze the seated frame of the sitting clip.
  for (const g of entries.animationGroups) g.stop();
  const sit = entries.animationGroups.find((g) => g.name.endsWith("_Sitting"))!;
  for (const ta of sit.targetedAnimations) {
    // evaluate() can return the key's own object (shared by every clone of the clip): copy it,
    // since the tuck below mutates joint transforms in place.
    const value = ta.animation.evaluate(SIT_FRAME);
    ta.target[ta.animation.targetProperty] = typeof value?.clone === "function" ? value.clone() : value;
  }
  for (const g of entries.animationGroups) g.dispose();

  // The feet are IK targets parented to the armature root, not to the shins: remember where
  // each sits relative to its shin so it can follow a tucked leg.
  refresh(root);
  const feet = (["L", "R"] as const).map((s) => {
    const foot = joint(`Foot.${s}`);
    const shin = joint(`LowerLeg.${s}`);
    return { foot, shin, rel: foot.getWorldMatrix().multiply(Matrix.Invert(shin.getWorldMatrix())) };
  });

  // Racing tuck (before measuring, so orientation/placement use the final pose).
  rotateJoints(joint, TUCK);
  const attachFeet = (): void => {
    refresh(root);
    for (const { foot, shin, rel } of feet) {
      const target = rel.multiply(shin.getWorldMatrix()).multiply(Matrix.Invert((foot.parent as TransformNode).getWorldMatrix()));
      foot.rotationQuaternion ??= new Quaternion();
      target.decompose(foot.scaling, foot.rotationQuaternion, foot.position);
    }
  };
  attachFeet();

  // Stopped pose (left foot on the ground): captured, then the tuck is restored for measuring.
  const { "Foot.L": sole, ...leg } = FOOT_DOWN;
  const legJoints = Object.keys(leg).map(joint);
  const footL = joint("Foot.L");
  const tuck = legJoints.map((n) => n.rotationQuaternion!.clone());
  const tuckFoot = [footL.position.clone(), footL.rotationQuaternion!.clone()] as const;
  rotateJoints(joint, leg);
  attachFeet();
  rotateJoints(joint, { "Foot.L": sole });
  const legPose: Rider["legPose"] = {
    joints: legJoints,
    tuck,
    down: legJoints.map((n) => n.rotationQuaternion!.clone()),
    foot: footL,
    footPos: [tuckFoot[0], footL.position.clone()],
    footRot: [tuckFoot[1], footL.rotationQuaternion!.clone()],
  };
  legJoints.forEach((n, k) => n.rotationQuaternion!.copyFrom(tuck[k]));
  footL.position.copyFrom(tuckFoot[0]);
  footL.rotationQuaternion!.copyFrom(tuckFoot[1]);

  // Scale to rider height.
  pivot.scaling.setAll(RIDER_HEIGHT / standing);

  const inv = new Matrix();
  const local = (n: TransformNode): Vector3 => Vector3.TransformCoordinates(n.getAbsolutePosition(), inv);

  // Face forward: knees (midpoint) ahead of the hips.
  refresh(root);
  root.getWorldMatrix().invertToRef(inv);
  const knees = local(joint("LowerLeg.L")).addInPlace(local(joint("LowerLeg.R"))).scaleInPlace(0.5);
  const forward = knees.subtract(local(joint("Hips")));
  pivot.rotation.y = -Math.atan2(forward.x, forward.z);

  // Sit on the seat.
  refresh(root);
  const seat = assets.moto.seat.add(new Vector3(0, HIP_LIFT, 0));
  pivot.position.addInPlace(seat.subtract(local(joint("Hips"))));

  refresh(root);
  const headNode = joint("Head");
  const up = Vector3.TransformNormal(Vector3.TransformNormal(Axis.Y, headNode.getWorldMatrix()), inv).normalize();
  const head = local(headNode).add(up.scale(HELMET_LIFT));

  const meshes = top.getChildMeshes(false);
  const materials = [...new Set(meshes.map((m) => m.material))].filter((m): m is StandardMaterial => m instanceof StandardMaterial);
  for (const m of meshes) m.isPickable = false;
  return { pivot, meshes, materials, skeletons: entries.skeletons, head, legPose };
}

function disposeRider(r: Rider): void {
  r.pivot.dispose(false, false);
  // Textures are shared with the template container: dispose only the cloned materials.
  for (const m of r.materials) m.dispose(false, false);
  for (const s of r.skeletons) s.dispose();
}

function setColor(mat: StandardMaterial, c: Rgb): void {
  mat.diffuseColor.set(c[0], c[1], c[2]);
  mat.emissiveColor.set(c[0] * 0.15, c[1] * 0.15, c[2] * 0.15);
}

function paintRider(r: Rider, look: RiderLook): void {
  const s = look.suit;
  for (const mat of r.materials) {
    const n = mat.name;
    if (n.endsWith("Shirt")) setColor(mat, s);
    else if (n.endsWith("Pants")) setColor(mat, [s[0] * 0.55, s[1] * 0.55, s[2] * 0.55]);
    // Only arms/hands/neck show under the helmet: reads as leather sleeves and gloves.
    else if (n.endsWith("Skin")) setColor(mat, [0.08, 0.08, 0.09]);
    else if (n.endsWith("Shoes") || n.endsWith("Socks")) setColor(mat, [0.05, 0.05, 0.05]);
  }
}

/** Sport moto with a posed rider and helmet. Origin on the ground, forward is +z. */
export function createMoto(scene: Scene, assets: Assets, name: string, look: RiderLook): Moto {
  const t = assets.moto;
  const root = new TransformNode(name, scene);

  const palette = new DynamicTexture(`${name}-palette`, { width: PALETTE_SIZE, height: PALETTE_SIZE }, scene, true, undefined, undefined, false);
  const bikeMat = new StandardMaterial(`${name}-bikeMat`, scene);
  bikeMat.diffuseTexture = palette;
  bikeMat.specularColor = new Color3(0.35, 0.35, 0.35);
  bikeMat.specularPower = 64;
  const part = (src: Mesh, suffix: string): Mesh => {
    const m = src.clone(`${name}-${suffix}`, root);
    m.setEnabled(true);
    m.material = bikeMat;
    return m;
  };
  const body = part(t.body, "body");
  const wheels = [part(t.frontWheel, "frontWheel"), part(t.rearWheel, "rearWheel")];

  const flameMat = new StandardMaterial(`${name}-flame`, scene);
  flameMat.diffuseColor = Color3.Black();
  flameMat.specularColor = Color3.Black();
  flameMat.emissiveColor = new Color3(1, 0.55, 0.05);
  flameMat.disableLighting = true;
  const flameHeight = 0.9;
  const flame = MeshBuilder.CreateCylinder(
    `${name}-flameCone`,
    { diameterTop: 0, diameterBottom: 0.5, height: flameHeight, tessellation: 12 },
    scene,
  );
  flame.material = flameMat;
  flame.parent = root;
  flame.position.set(0, 0.45, -t.length / 2 - flameHeight / 2 + 0.1);
  flame.rotation.x = -Math.PI / 2; // tip points toward −z
  flame.isPickable = false;
  flame.isVisible = false;

  let current: RiderLook | null = null;
  let rider: Rider | null = null;
  /** Requested foot-down amount, and the one last posed on `rider` (NaN = not yet). */
  let foot = 0;
  let posedFoot = NaN;
  const poseFoot = (): void => {
    if (!rider || foot === posedFoot) return;
    posedFoot = foot;
    const p = rider.legPose;
    for (let k = 0; k < p.joints.length; k++) Quaternion.SlerpToRef(p.tuck[k], p.down[k], foot, p.joints[k].rotationQuaternion!);
    Vector3.LerpToRef(p.footPos[0], p.footPos[1], foot, p.foot.position);
    Quaternion.SlerpToRef(p.footRot[0], p.footRot[1], foot, p.foot.rotationQuaternion!);
  };
  let helmet: TransformNode | null = null;
  const moto: Moto = {
    root,
    wheels,
    wheelRadius: t.wheelRadius,
    flame,
    casters: [],
    setLook(look) {
      if (!rider || current?.body !== look.body) {
        if (rider) disposeRider(rider);
        if (helmet) helmet.dispose(false, true);
        helmet = null;
        rider = spawnRider(scene, assets, root, name, look);
        posedFoot = NaN;
      }
      const helmetChanged =
        current?.helmet !== look.helmet || current.helmetColor.some((v, i) => v !== look.helmetColor[i]);
      if (!helmet || helmetChanged) {
        if (helmet) helmet.dispose(false, true);
        helmet = buildHelmet(scene, `${name}-helmet`, look.helmet, look.helmetColor);
        helmet.parent = root;
        helmet.position.copyFrom(rider.head);
        helmet.scaling.setAll(HELMET_SIZE);
      }
      paintPalette(palette, look.bike);
      paintRider(rider, look);
      moto.casters = [body, ...wheels, ...rider.meshes, ...helmet.getChildMeshes()];
      current = look;
      poseFoot();
    },
    setFootDown(amount) {
      foot = amount;
      poseFoot();
    },
  };
  moto.setLook(look);
  return moto;
}
