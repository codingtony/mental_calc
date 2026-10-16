import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { LANE_OFFSETS, PLAYER_COLOR, RIVALS } from "./config";
import { createKart, type Kart } from "./kart";
import { mulberry32 } from "./rng";
import { Track } from "./track";

export type WorldMode = "intro" | "menu" | "race" | "finish" | "crash";

export interface RaceFrame {
  player: number;
  rivals: number[];
  perQuestion: number;
}

const SKY = new Color3(0.42, 0.75, 1);
const BOOST_SECONDS = 0.5;
const SPIN_SECONDS = 0.6;
const SHAKE_SECONDS = 0.3;
const SHAKE_AMPLITUDE = 0.15;
const CRASH_SECONDS = 1.2;
const SMOKE_SECONDS = 2;
const WHEEL_RADIUS = 0.35;
const INTRO_CUT_SECONDS = 1.8;
const INTRO_SECONDS = 4;
const BASE_FOV = 0.9;

function smoothstep(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

function flatMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.25);
  mat.specularColor = Color3.Black();
  return mat;
}

interface Smoke {
  mesh: Mesh;
  mat: StandardMaterial;
  age: number;
  baseY: number;
}

export class World {
  readonly scene: Scene;
  readonly track: Track;

  private readonly camera: UniversalCamera;
  private readonly karts: Kart[] = [];
  /** Current track distance of each kart (index 0 = player). */
  private readonly kartDist: number[] = [];
  private menuStart: number[] = [];
  private mode: WorldMode = "intro";
  private modeT0 = 0;
  private snapCamera = true;
  private playerVis = 0;

  private boostRemaining = 0;
  private spinElapsed = -1;
  private shakeRemaining = 0;
  private crashElapsed = -1;
  private smoke: Smoke[] = [];
  private readonly camTarget = new Vector3(0, 0, 0);

  constructor(engine: Engine) {
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(SKY.r, SKY.g, SKY.b, 1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = 250;
    scene.fogEnd = 700;
    scene.fogColor = SKY.clone();
    scene.skipPointerMovePicking = true;

    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.9;
    hemi.groundColor = new Color3(0.45, 0.45, 0.5);
    const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1), scene);
    sun.intensity = 0.6;

    this.camera = new UniversalCamera("camera", new Vector3(0, 120, -220), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000;
    this.camera.fov = BASE_FOV;
    this.camera.setTarget(Vector3.Zero());

    this.track = new Track(scene);
    this.buildScenery();

    const colors: Color3[] = [
      new Color3(...PLAYER_COLOR),
      ...RIVALS.map((r) => new Color3(r.color[0], r.color[1], r.color[2])),
    ];
    colors.forEach((c, i) => {
      this.karts.push(createKart(scene, i === 0 ? "player" : `rival${i}`, c));
      this.kartDist.push(0);
    });
    this.setMode("intro", performance.now());
  }

  setMode(mode: WorldMode, nowMs: number): void {
    this.mode = mode;
    this.modeT0 = nowMs;
    if (mode === "intro" || mode === "menu") this.resetPlayerEffects();
    if (mode === "menu") this.menuStart = this.kartDist.slice();
    if (mode === "race") this.snapCamera = true;
  }

  setupRace(_totalDistance: number): void {
    this.resetPlayerEffects();
    this.playerVis = 0;
    for (let i = 0; i < this.karts.length; i++) {
      this.kartDist[i] = 0;
      this.placeKart(i, 0, LANE_OFFSETS[i], 0, 0);
    }
    this.snapCamera = true;
  }

  /**
   * Multiplayer: recolours karts 1..k with the given colours and hides the rest.
   * `null` restores the AI rival colours and shows all karts (solo).
   */
  setRivalSlots(colors: readonly (readonly number[])[] | null): void {
    for (let i = 1; i < this.karts.length; i++) {
      const c = colors === null ? RIVALS[i - 1].color : colors[i - 1];
      if (c !== undefined) this.karts[i].paint(new Color3(c[0], c[1], c[2]));
      this.karts[i].root.setEnabled(c !== undefined);
    }
  }

  /** Player's visual distance along the track in world units. */
  playerDistance(): number {
    return this.kartDist[0];
  }

  boost(): void {
    this.boostRemaining = BOOST_SECONDS;
  }

  spin(): void {
    this.spinElapsed = 0;
    this.shakeRemaining = SHAKE_SECONDS;
  }

  crash(): void {
    this.crashElapsed = 0;
    this.boostRemaining = 0;
    this.spinElapsed = -1;
    const root = this.karts[0].root;
    const rand = Math.random;
    for (let k = 0; k < 6; k++) {
      const mesh = MeshBuilder.CreateSphere(`smoke${k}`, { diameter: 1, segments: 8 }, this.scene);
      const mat = new StandardMaterial(`smokeMat${k}`, this.scene);
      mat.diffuseColor = new Color3(0.55, 0.55, 0.58);
      mat.emissiveColor = new Color3(0.35, 0.35, 0.37);
      mat.specularColor = Color3.Black();
      mat.alpha = 0.8;
      mesh.material = mat;
      mesh.isPickable = false;
      const baseY = 0.5 + rand() * 0.5;
      mesh.position.set(root.position.x + (rand() - 0.5) * 2.5, baseY, root.position.z + (rand() - 0.5) * 2.5);
      mesh.scaling.setAll(0.5);
      // Stagger slightly so the puffs don't move in lockstep.
      this.smoke.push({ mesh, mat, age: -k * 0.08, baseY });
    }
  }

  update(dtSec: number, nowMs: number, race: RaceFrame | null): void {
    const dt = Math.min(Math.max(dtSec, 0), 0.1);
    const t = (nowMs - this.modeT0) / 1000;
    this.tickEffects(dt);

    switch (this.mode) {
      case "intro":
        for (let i = 0; i < this.karts.length; i++) {
          this.driveKart(i, -40 + 6 * i + (40 + 3 * i) * t, nowMs);
        }
        this.introCamera(t);
        break;
      case "menu":
        for (let i = 0; i < this.karts.length; i++) {
          this.driveKart(i, (this.menuStart[i] ?? 0) + (25 + i) * t, nowMs);
        }
        this.menuCamera(t);
        break;
      case "race":
      case "finish":
      case "crash":
        if (race) {
          const target = race.player * race.perQuestion;
          this.playerVis += (target - this.playerVis) * (1 - Math.exp(-dt * 10));
          this.driveKart(0, this.playerVis, nowMs);
          for (let i = 1; i < this.karts.length; i++) {
            this.driveKart(i, (race.rivals[i - 1] ?? 0) * race.perQuestion, nowMs);
          }
        }
        if (this.mode === "race") this.chaseCamera(dt);
        else if (this.mode === "finish") this.finishCamera(dt, t);
        else this.crashCamera();
        break;
    }
    this.applyShake();
  }

  render(): void {
    this.scene.render();
  }

  // ---------------------------------------------------------------------------

  private driveKart(i: number, distance: number, nowMs: number): void {
    const delta = distance - this.kartDist[i];
    this.kartDist[i] = distance;
    const lateral = LANE_OFFSETS[i] + (i === 0 ? 0 : 0.4 * Math.sin((nowMs / 1000) * 0.7 + i));
    // Large jumps are teleports (mode switches): don't spin the wheels for them.
    const wheelSpin = Math.abs(delta) < 50 ? delta / WHEEL_RADIUS : 0;
    this.placeKart(i, distance, lateral, wheelSpin, nowMs);
  }

  private placeKart(i: number, distance: number, lateral: number, wheelSpin: number, nowMs: number): void {
    const kart = this.karts[i];
    const { pos, heading } = this.track.positionAt(distance, lateral);
    const root = kart.root;
    root.position.copyFrom(pos);
    root.position.y = 0.04 + 0.05 * Math.sin((nowMs / 1000) * 12 + i * 1.7);
    root.rotation.set(0, heading, 0);
    for (const w of kart.wheels) w.rotation.x += wheelSpin;

    if (i !== 0) return;
    if (this.spinElapsed >= 0) {
      const p = Math.min(1, this.spinElapsed / SPIN_SECONDS);
      root.rotation.y += 2 * Math.PI * (1 - (1 - p) ** 3);
    }
    if (this.crashElapsed >= 0) {
      const p = Math.min(1, this.crashElapsed / CRASH_SECONDS);
      const ease = 1 - (1 - p) ** 2;
      // Arc up 2.5 units, then settle upside down resting on the roll-bar height.
      root.position.y = 2.5 * 4 * p * (1 - p) + 1.3 * ease;
      root.rotation.z = 3 * Math.PI * ease;
    }
  }

  private resetPlayerEffects(): void {
    this.boostRemaining = 0;
    this.spinElapsed = -1;
    this.shakeRemaining = 0;
    this.crashElapsed = -1;
    const player = this.karts[0];
    if (player) {
      player.flame.isVisible = false;
      player.root.rotation.set(0, player.root.rotation.y, 0);
    }
    for (const s of this.smoke) {
      s.mesh.dispose();
      s.mat.dispose();
    }
    this.smoke = [];
    this.camera.fov = BASE_FOV;
  }

  private tickEffects(dt: number): void {
    this.boostRemaining = Math.max(0, this.boostRemaining - dt);
    this.shakeRemaining = Math.max(0, this.shakeRemaining - dt);
    if (this.spinElapsed >= 0) {
      this.spinElapsed += dt;
      if (this.spinElapsed >= SPIN_SECONDS) this.spinElapsed = -1;
    }
    if (this.crashElapsed >= 0) this.crashElapsed = Math.min(this.crashElapsed + dt, CRASH_SECONDS);

    const flame = this.karts[0].flame;
    flame.isVisible = this.boostRemaining > 0;
    if (flame.isVisible) {
      const flicker = 0.8 + 0.4 * Math.random();
      flame.scaling.set(flicker * 0.9 + 0.1, flicker * (0.6 + this.boostRemaining / BOOST_SECONDS), flicker * 0.9 + 0.1);
    }

    for (const s of this.smoke) {
      s.age += dt;
      const p = Math.min(1, Math.max(0, s.age / SMOKE_SECONDS));
      s.mesh.position.y = s.baseY + 3 * p;
      s.mesh.scaling.setAll(0.5 + 2.5 * p);
      s.mat.alpha = 0.8 * (1 - p);
    }
    const alive: Smoke[] = [];
    for (const s of this.smoke) {
      if (s.age >= SMOKE_SECONDS) {
        s.mesh.dispose();
        s.mat.dispose();
      } else alive.push(s);
    }
    this.smoke = alive;
  }

  private introCamera(t: number): void {
    const a = this.track.positionAt(60, 12).pos;
    a.y = 1.5;
    const b = this.track.positionAt(40, 0).pos;
    b.y = 1;
    const s = smoothstep((t - INTRO_CUT_SECONDS) / (INTRO_SECONDS - INTRO_CUT_SECONDS));
    Vector3.LerpToRef(a, new Vector3(0, 120, -220), s, this.camera.position);
    Vector3.LerpToRef(b, Vector3.ZeroReadOnly, s, this.camTarget);
    this.camera.fov = BASE_FOV;
  }

  private menuCamera(t: number): void {
    // Start the orbit at the intro's end pose (0,120,-220) direction.
    const angle = Math.PI + 0.05 * t;
    // Ease the height down from the intro's final 120 so the cut to the menu is seamless.
    this.camera.position.set(220 * Math.sin(angle), 90 + 30 * Math.exp(-t * 1.5), 220 * Math.cos(angle));
    this.camTarget.set(0, 0, 0);
    this.camera.fov = BASE_FOV;
  }

  private chaseCamera(dt: number): void {
    const { pos, heading } = this.track.positionAt(this.kartDist[0], LANE_OFFSETS[0]);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const desired = new Vector3(pos.x - fx * 9, 4, pos.z - fz * 9);
    if (this.snapCamera) {
      this.camera.position.copyFrom(desired);
      this.snapCamera = false;
    } else {
      Vector3.LerpToRef(this.camera.position, desired, 1 - Math.exp(-dt * 6), this.camera.position);
    }
    this.camTarget.set(pos.x + fx * 6, 1, pos.z + fz * 6);
    this.camera.fov = BASE_FOV + (0.15 * this.boostRemaining) / BOOST_SECONDS;
  }

  private finishCamera(dt: number, t: number): void {
    const { pos, heading } = this.track.positionAt(this.kartDist[0], LANE_OFFSETS[0]);
    // Begin behind the kart (where the chase cam was), then circle around it.
    const angle = heading + Math.PI + 0.6 * t;
    const desired = new Vector3(pos.x + 10 * Math.sin(angle), 3, pos.z + 10 * Math.cos(angle));
    Vector3.LerpToRef(this.camera.position, desired, 1 - Math.exp(-dt * 5), this.camera.position);
    this.camTarget.set(pos.x, 1, pos.z);
    this.camera.fov = BASE_FOV;
  }

  private crashCamera(): void {
    const p = this.karts[0].root.position;
    this.camTarget.set(p.x, p.y + 0.5, p.z);
    this.camera.fov = BASE_FOV;
  }

  /** Applies camera-shake offset to the look target, then aims the camera. */
  private applyShake(): void {
    const target = this.camTarget.clone();
    if (this.shakeRemaining > 0) {
      const amp = SHAKE_AMPLITUDE * (this.shakeRemaining / SHAKE_SECONDS);
      target.x += (Math.random() * 2 - 1) * amp;
      target.y += (Math.random() * 2 - 1) * amp;
      target.z += (Math.random() * 2 - 1) * amp;
    }
    this.camera.setTarget(target);
  }

  private buildScenery(): void {
    const scene = this.scene;
    const rand = mulberry32(42);

    // Mowed-grass ground.
    const grassTex = new DynamicTexture("grassTex", { width: 64, height: 64 }, scene, true);
    const ctx = grassTex.getContext();
    ctx.fillStyle = "rgb(92,194,64)";
    ctx.fillRect(0, 0, 32, 64);
    ctx.fillStyle = "rgb(77,173,51)";
    ctx.fillRect(32, 0, 32, 64);
    grassTex.update();
    grassTex.uScale = 60;
    grassTex.vScale = 60;
    const ground = MeshBuilder.CreateGround("ground", { width: 1600, height: 1600 }, scene);
    const groundMat = new StandardMaterial("groundMat", scene);
    groundMat.diffuseTexture = grassTex;
    groundMat.emissiveColor = new Color3(0.08, 0.18, 0.06);
    groundMat.specularColor = Color3.Black();
    ground.material = groundMat;
    ground.isPickable = false;
    ground.freezeWorldMatrix();

    // Trees: trunk + two cone shades, as instances.
    const trunk = MeshBuilder.CreateCylinder("trunk", { diameter: 0.8, height: 2, tessellation: 8 }, scene);
    trunk.material = flatMaterial(scene, "trunkMat", new Color3(0.5, 0.3, 0.12));
    const coneLow = MeshBuilder.CreateCylinder("coneLow", { diameterTop: 0, diameterBottom: 4, height: 4, tessellation: 10 }, scene);
    coneLow.material = flatMaterial(scene, "coneLowMat", new Color3(0.1, 0.55, 0.2));
    const coneHigh = MeshBuilder.CreateCylinder("coneHigh", { diameterTop: 0, diameterBottom: 3, height: 3, tessellation: 10 }, scene);
    coneHigh.material = flatMaterial(scene, "coneHighMat", new Color3(0.2, 0.7, 0.25));
    const centerline = this.track.points;
    const minDistSq = 16 * 16;
    let placed = 0;
    for (let attempt = 0; placed < 140 && attempt < 10000; attempt++) {
      const x = (rand() * 2 - 1) * 300;
      const z = (rand() * 2 - 1) * 300;
      const s = 0.8 + rand() * 0.8;
      if (centerline.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minDistSq)) continue;
      const parts: [Mesh, number][] = [
        [trunk, 1],
        [coneLow, 3.5],
        [coneHigh, 5.5],
      ];
      for (const [source, y] of parts) {
        const inst = placed === 0 ? source : source.createInstance(`${source.name}${placed}`);
        inst.position.set(x, y * s, z);
        inst.scaling.setAll(s);
        inst.isPickable = false;
        inst.freezeWorldMatrix();
      }
      placed++;
    }

    // Hills on the horizon.
    const hillMat = flatMaterial(scene, "hillMat", new Color3(0.3, 0.72, 0.25));
    for (let k = 0; k < 8; k++) {
      const angle = (k / 8) * Math.PI * 2 + rand() * 0.5;
      const dist = 330 + rand() * 90;
      const radius = 60 + rand() * 30;
      const hill = MeshBuilder.CreateSphere(`hill${k}`, { diameter: radius * 2, segments: 16 }, scene);
      hill.material = hillMat;
      hill.scaling.y = 0.35;
      hill.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      hill.isPickable = false;
      hill.freezeWorldMatrix();
    }

    // Clouds.
    const cloudMat = new StandardMaterial("cloudMat", scene);
    cloudMat.diffuseColor = Color3.Black();
    cloudMat.specularColor = Color3.Black();
    cloudMat.emissiveColor = new Color3(1, 1, 1);
    cloudMat.disableLighting = true;
    const puff = MeshBuilder.CreateSphere("cloudPuff", { diameter: 1, segments: 10 }, scene);
    puff.material = cloudMat;
    puff.applyFog = false;
    let puffs = 0;
    for (let c = 0; c < 12; c++) {
      const cx = (rand() * 2 - 1) * 400;
      const cz = (rand() * 2 - 1) * 400;
      const cy = 70 + rand() * 30;
      const count = 3 + Math.floor(rand() * 2);
      for (let k = 0; k < count; k++) {
        const inst = puffs === 0 ? puff : puff.createInstance(`cloudPuff${puffs}`);
        const size = 14 + rand() * 10;
        inst.position.set(cx + (k - count / 2) * 9 + rand() * 4, cy + rand() * 4, cz + (rand() - 0.5) * 8);
        inst.scaling.set(size, size * 0.6, size);
        inst.isPickable = false;
        inst.freezeWorldMatrix();
        puffs++;
      }
    }
  }
}
