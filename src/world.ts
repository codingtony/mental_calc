import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  Quaternion,
  ShadowGenerator,
  StandardMaterial,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { finishPrefabs, loadAssets, place, type Assets } from "./assets";
import { LANE_OFFSETS, RIVALS } from "./config";
import type { RiderLook, Rgb } from "./look";
import { createMoto, type Moto } from "./moto";
import { mulberry32 } from "./rng";
import { MEADOW, type SceneryTheme } from "./theme";
import { Track } from "./track";

export type WorldMode = "intro" | "menu" | "race" | "finish" | "crash";

export interface RaceFrame {
  player: number;
  rivals: number[];
  perQuestion: number;
}

const BOOST_SECONDS = 0.5;
const SPIN_SECONDS = 0.6;
const SHAKE_SECONDS = 0.3;
const SHAKE_AMPLITUDE = 0.15;
const CRASH_SECONDS = 1.2;
const SMOKE_SECONDS = 2;
const INTRO_CUT_SECONDS = 1.8;
const INTRO_SECONDS = 4;
const BASE_FOV = 0.9;
const GRAVITY = 9.81;
const MAX_LEAN = 0.6;
/** Natural frequency (rad/s) of the player's progress spring: ~0.8 s to settle after an answer. */
const PLAYER_SPRING = 6;
/** Vegetation never comes closer than this to another placed prop. */
const PROP_SPACING = 12;

/**
 * Quality levels, cheapest last. `pixelScale` multiplies the hardware scaling level (1.5 renders
 * ~44% of the pixels): fill rate is what low-power GPUs run out of first.
 */
export const QUALITY = [
  { shadows: true, shadowSize: 1024, shadowFilter: ShadowGenerator.QUALITY_MEDIUM, pixelScale: 1 },
  { shadows: true, shadowSize: 512, shadowFilter: ShadowGenerator.QUALITY_LOW, pixelScale: 1 },
  { shadows: true, shadowSize: 512, shadowFilter: ShadowGenerator.QUALITY_LOW, pixelScale: 1.5 },
  { shadows: false, shadowSize: 512, shadowFilter: ShadowGenerator.QUALITY_LOW, pixelScale: 2 },
] as const;

function smoothstep(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

function wrapToPi(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

function css(c: Rgb, gain = 1): string {
  return `rgb(${c.map((v) => Math.round(Math.min(1, v * gain) * 255)).join(",")})`;
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
  private readonly sun: DirectionalLight;
  private shadows: ShadowGenerator;
  /** Hardware scaling set by the caller before the world was built (quality level 0). */
  private readonly baseScaling: number;
  private readonly motos: Moto[] = [];
  /** Current track distance of each moto (index 0 = player). */
  private readonly motoDist: number[] = [];
  /** Smoothed forward speed (m/s) and current lean (radians) per moto. */
  private readonly motoSpeed: number[] = [];
  private readonly motoLean: number[] = [];
  /** JSON of the look last applied to each moto, so unchanged looks are not rebuilt. */
  private readonly appliedLook: string[] = [];
  private menuStart: number[] = [];
  private mode: WorldMode = "intro";
  private modeT0 = 0;
  /** Player's eased visual distance (m) and its rate (m/s), see update(). */
  private playerVis = 0;
  private playerVel = 0;

  private boostRemaining = 0;
  private spinElapsed = -1;
  private shakeRemaining = 0;
  private crashElapsed = -1;
  private smoke: Smoke[] = [];
  private readonly camTarget = new Vector3(0, 0, 0);

  /** Loads the 3D models, then builds the world. Rejects when a model fails to load. */
  static async create(engine: Engine, playerLook: RiderLook, theme: SceneryTheme = MEADOW): Promise<World> {
    const scene = new Scene(engine);
    const assets = await loadAssets(scene);
    return new World(scene, assets, playerLook, theme);
  }

  private constructor(scene: Scene, assets: Assets, playerLook: RiderLook, theme: SceneryTheme) {
    this.scene = scene;
    const horizon = new Color3(...theme.skyHorizon);
    scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = 250;
    scene.fogEnd = 700;
    scene.fogColor = horizon;
    scene.skipPointerMovePicking = true;
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.1;
    ip.contrast = 1.15;

    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    // Sun stronger than the sky fill so the motos' shadows read on the dark asphalt.
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.45, 0.45, 0.5);
    const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1), scene);
    sun.intensity = 0.8;
    // Shadow frustum follows the player (see update), so a small map stays sharp.
    sun.autoUpdateExtends = false;
    sun.orthoLeft = -25;
    sun.orthoRight = 25;
    sun.orthoBottom = -25;
    sun.orthoTop = 25;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 150;
    this.sun = sun;
    this.baseScaling = scene.getEngine().getHardwareScalingLevel();
    this.shadows = this.createShadows(QUALITY[0].shadowSize, QUALITY[0].shadowFilter);

    this.camera = new UniversalCamera("camera", new Vector3(0, 120, -220), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000;
    this.camera.fov = BASE_FOV;
    this.camera.setTarget(Vector3.Zero());

    this.track = new Track(scene);
    const props = this.track.buildProps(assets.prefabs);
    this.buildScenery(theme, assets, props);
    finishPrefabs(assets.prefabs);

    for (let i = 0; i <= RIVALS.length; i++) {
      const look = i === 0 ? playerLook : RIVALS[i - 1].look;
      const moto = createMoto(scene, assets, i === 0 ? "player" : `rival${i}`, look);
      this.motos.push(moto);
      this.appliedLook.push(JSON.stringify(look));
      for (const m of moto.casters) this.shadows.addShadowCaster(m, false);
      this.motoDist.push(0);
      this.motoSpeed.push(0);
      this.motoLean.push(0);
    }
    this.setMode("intro", performance.now());
  }

  setMode(mode: WorldMode, nowMs: number): void {
    this.mode = mode;
    this.modeT0 = nowMs;
    if (mode === "intro" || mode === "menu") this.resetPlayerEffects();
    if (mode === "menu") this.menuStart = this.motoDist.slice();
  }

  /**
   * 0 = full quality; each higher level trades looks for GPU time (see QUALITY). Picked at load
   * from a short frame-rate probe, since slow school Chromebooks can't be tested beforehand.
   */
  setQuality(level: number): void {
    const q = QUALITY[Math.max(0, Math.min(QUALITY.length - 1, level))];
    this.scene.getEngine().setHardwareScalingLevel(this.baseScaling * q.pixelScale);
    this.sun.shadowEnabled = q.shadows;
    if (this.shadows.getShadowMap()!.getSize().width !== q.shadowSize) {
      this.shadows.dispose();
      this.shadows = this.createShadows(q.shadowSize, q.shadowFilter);
    }
    this.shadows.filteringQuality = q.shadowFilter;
  }

  setupRace(_totalDistance: number): void {
    this.resetPlayerEffects();
    this.playerVis = 0;
    this.playerVel = 0;
    for (let i = 0; i < this.motos.length; i++) {
      this.motoDist[i] = 0;
      this.motoSpeed[i] = 0;
      this.motoLean[i] = 0;
      this.placeMoto(i, 0, LANE_OFFSETS[i], 0);
    }
  }

  /**
   * Multiplayer: motos 1..k take the given looks and the rest are hidden.
   * `null` restores the AI rival looks and shows all motos (solo).
   */
  setRivalSlots(looks: readonly RiderLook[] | null): void {
    for (let i = 1; i < this.motos.length; i++) {
      const look = looks === null ? RIVALS[i - 1].look : looks[i - 1];
      const moto = this.motos[i];
      moto.root.setEnabled(look !== undefined);
      if (look === undefined) continue;
      const key = JSON.stringify(look);
      if (key === this.appliedLook[i]) continue;
      this.appliedLook[i] = key;
      moto.setLook(look);
      for (const m of moto.casters) this.shadows.addShadowCaster(m, false);
    }
  }

  /** Player's visual distance along the track in world units. */
  playerDistance(): number {
    return this.motoDist[0];
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
    const root = this.motos[0].root;
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
        for (let i = 0; i < this.motos.length; i++) {
          this.driveMoto(i, -40 + 6 * i + (40 + 3 * i) * t, nowMs, dt);
        }
        this.introCamera(t);
        break;
      case "menu":
        for (let i = 0; i < this.motos.length; i++) {
          this.driveMoto(i, (this.menuStart[i] ?? 0) + (25 + i) * t, nowMs, dt);
        }
        this.menuCamera(t);
        break;
      case "race":
      case "finish":
      case "crash":
        if (race) {
          // Critically damped spring towards the race progress: the velocity stays continuous,
          // so an answer's boost accelerates the moto instead of jumping to full speed in a frame.
          // Exact solution per step: stable for any dt (slow devices hitch up to the 0.1 s cap).
          const target = race.player * race.perQuestion;
          const e = this.playerVis - target;
          const k = Math.exp(-PLAYER_SPRING * dt);
          const j = (this.playerVel + PLAYER_SPRING * e) * dt;
          this.playerVis = target + (e + j) * k;
          this.playerVel = (this.playerVel - PLAYER_SPRING * j) * k;
          this.driveMoto(0, this.playerVis, nowMs, dt);
          for (let i = 1; i < this.motos.length; i++) {
            this.driveMoto(i, (race.rivals[i - 1] ?? 0) * race.perQuestion, nowMs, dt);
          }
        }
        if (this.mode === "race") this.chaseCamera();
        else if (this.mode === "finish") this.finishCamera(dt, t);
        else this.crashCamera();
        break;
    }
    this.applyShake();
    // Keep the shadow frustum centred on the player.
    const sunDir = this.sun.direction.normalizeToNew();
    this.motos[0].root.position.subtractToRef(sunDir.scale(60), this.sun.position);
  }

  render(): void {
    this.scene.render();
  }

  // ---------------------------------------------------------------------------

  private driveMoto(i: number, distance: number, nowMs: number, dt: number): void {
    const delta = distance - this.motoDist[i];
    this.motoDist[i] = distance;
    const lateral = LANE_OFFSETS[i] + (i === 0 ? 0 : 0.4 * Math.sin((nowMs / 1000) * 0.7 + i));
    // Large jumps are teleports (mode switches): don't spin the wheels or update speed for them.
    const teleport = Math.abs(delta) >= 50;
    if (!teleport && dt > 0) this.motoSpeed[i] += (delta / dt - this.motoSpeed[i]) * (1 - Math.exp(-5 * dt));

    // Lean into the bend: tan(lean) = v²κ/g.
    const h0 = this.track.positionAt(distance - 3, lateral).heading;
    const h1 = this.track.positionAt(distance + 3, lateral).heading;
    const curvature = wrapToPi(h1 - h0) / 6;
    const v = this.motoSpeed[i];
    // κ > 0 is a right-hand bend (heading grows); leaning right is a negative rotation.z.
    const target = -Math.min(MAX_LEAN, Math.max(-MAX_LEAN, Math.atan((v * v * curvature) / GRAVITY)));
    this.motoLean[i] += (target - this.motoLean[i]) * (1 - Math.exp(-6 * dt));

    this.placeMoto(i, distance, lateral, teleport ? 0 : delta / this.motos[i].wheelRadius);
  }

  private placeMoto(i: number, distance: number, lateral: number, wheelSpin: number): void {
    const moto = this.motos[i];
    const { pos, heading } = this.track.positionAt(distance, lateral);
    const root = moto.root;
    root.position.copyFrom(pos);
    root.position.y = 0;
    root.rotation.set(0, heading, this.motoLean[i]);
    for (const w of moto.wheels) w.rotation.x += wheelSpin;

    if (i !== 0) return;
    if (this.spinElapsed >= 0) {
      const p = Math.min(1, this.spinElapsed / SPIN_SECONDS);
      root.rotation.y += 2 * Math.PI * (1 - (1 - p) ** 3);
    }
    if (this.crashElapsed >= 0) {
      const p = Math.min(1, this.crashElapsed / CRASH_SECONDS);
      const ease = 1 - (1 - p) ** 2;
      // Small hop, then the bike falls over onto its side.
      root.position.y = 0.8 * 4 * p * (1 - p);
      root.rotation.z = 1.35 * ease;
    }
  }

  /** Shadow generator for the sun, with every moto's meshes as casters. */
  private createShadows(size: number, filter: number): ShadowGenerator {
    const shadows = new ShadowGenerator(size, this.sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = filter;
    shadows.bias = 0.002;
    shadows.normalBias = 0.02;
    for (const moto of this.motos) for (const m of moto.casters) shadows.addShadowCaster(m, false);
    return shadows;
  }

  private resetPlayerEffects(): void {
    this.boostRemaining = 0;
    this.spinElapsed = -1;
    this.shakeRemaining = 0;
    this.crashElapsed = -1;
    const player = this.motos[0];
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

    const flame = this.motos[0].flame;
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

  /** Rides the track 7 m behind the player: as smooth as the spline, never left behind by a boost. */
  private chaseCamera(): void {
    const d = this.motoDist[0];
    const behind = this.track.positionAt(d - 7, LANE_OFFSETS[0]).pos;
    const { pos, heading } = this.track.positionAt(d, LANE_OFFSETS[0]);
    this.camera.position.set(behind.x, 3, behind.z);
    this.camTarget.set(pos.x + Math.sin(heading) * 6, 1.2, pos.z + Math.cos(heading) * 6);
    this.camera.fov = BASE_FOV + (0.15 * this.boostRemaining) / BOOST_SECONDS;
  }

  private finishCamera(dt: number, t: number): void {
    const { pos, heading } = this.track.positionAt(this.motoDist[0], LANE_OFFSETS[0]);
    // Begin behind the moto (where the chase cam was), then circle around it.
    const angle = heading + Math.PI + 0.6 * t;
    const desired = new Vector3(pos.x + 7 * Math.sin(angle), 2.2, pos.z + 7 * Math.cos(angle));
    Vector3.LerpToRef(this.camera.position, desired, 1 - Math.exp(-dt * 5), this.camera.position);
    this.camTarget.set(pos.x, 1, pos.z);
    this.camera.fov = BASE_FOV;
  }

  private crashCamera(): void {
    const p = this.motos[0].root.position;
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

  /** `props`: ground positions of the circuit props, kept clear of vegetation. */
  private buildScenery(theme: SceneryTheme, assets: Assets, props: readonly Vector3[]): void {
    const scene = this.scene;
    const rand = mulberry32(42);

    // Sky dome: zenith → horizon gradient on the upper half, horizon colour below.
    const skyTex = new DynamicTexture("skyTex", { width: 4, height: 256 }, scene, false);
    const skyCtx = skyTex.getContext();
    const gradient = skyCtx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, css(theme.skyZenith));
    gradient.addColorStop(1, css(theme.skyHorizon));
    skyCtx.fillStyle = gradient;
    skyCtx.fillRect(0, 0, 4, 128);
    skyCtx.fillStyle = css(theme.skyHorizon);
    skyCtx.fillRect(0, 128, 4, 128);
    skyTex.update(false); // canvas top must map to the sphere's top pole
    const sky = MeshBuilder.CreateSphere("sky", { diameter: 1800, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
    const skyMat = new StandardMaterial("skyMat", scene);
    skyMat.disableLighting = true;
    skyMat.emissiveTexture = skyTex;
    skyMat.diffuseColor = Color3.Black();
    skyMat.specularColor = Color3.Black();
    skyMat.backFaceCulling = false;
    sky.material = skyMat;
    sky.infiniteDistance = true;
    sky.applyFog = false;
    sky.isPickable = false;

    // Mown-grass ground: speckles and two mowing bands.
    const grassTex = new DynamicTexture("grassTex", { width: 512, height: 512 }, scene, true);
    const ctx = grassTex.getContext();
    ctx.fillStyle = css(theme.grassBase);
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = css(theme.grassBase, 1.06);
    ctx.fillRect(256, 0, 256, 512);
    for (let k = 0; k < 6000; k++) {
      const c = theme.grassSpeckles[Math.floor(rand() * theme.grassSpeckles.length)];
      ctx.fillStyle = css(c, rand() < 0.5 ? 1 : 1.06);
      ctx.fillRect(Math.floor(rand() * 511), Math.floor(rand() * 511), 2, 2);
    }
    grassTex.update();
    grassTex.uScale = 100;
    grassTex.vScale = 100;
    const ground = MeshBuilder.CreateGround("ground", { width: 1600, height: 1600 }, scene);
    const groundMat = new StandardMaterial("groundMat", scene);
    groundMat.diffuseTexture = grassTex;
    groundMat.emissiveColor = new Color3(0.08, 0.18, 0.06);
    groundMat.specularColor = Color3.Black();
    ground.material = groundMat;
    ground.isPickable = false;
    ground.receiveShadows = true;
    ground.freezeWorldMatrix();

    // Soft blob shadows under trees and bushes (the sun's shadow map only covers the motos).
    const blobTex = new DynamicTexture("blobTex", { width: 128, height: 128 }, scene, true);
    const blobCtx = blobTex.getContext();
    const radial = blobCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    radial.addColorStop(0, "rgba(0,0,0,0.55)");
    radial.addColorStop(1, "rgba(0,0,0,0)");
    blobCtx.fillStyle = radial;
    blobCtx.fillRect(0, 0, 128, 128);
    blobTex.update();
    blobTex.hasAlpha = true;
    const blob = MeshBuilder.CreateDisc("blobShadow", { radius: 1, tessellation: 24 }, scene);
    blob.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2));
    const blobMat = new StandardMaterial("blobMat", scene);
    blobMat.diffuseTexture = blobTex;
    blobMat.useAlphaFromDiffuseTexture = true;
    blobMat.diffuseColor = Color3.Black();
    blobMat.specularColor = Color3.Black();
    blobMat.disableLighting = true;
    blobMat.zOffset = -2;
    blob.material = blobMat;
    blob.isPickable = false;
    const blobRadius: Partial<Record<string, number>> = { treeRound: 0.35, treeTall: 0.35, treeSmall: 0.35, bush: 0.6 };

    // Vegetation: rejection-sampled away from the track and other props.
    const centerline = this.track.points;
    const placed: Vector3[] = props.slice();
    let attempts = 0;
    for (const veg of theme.vegetation) {
      const prefab = assets.prefabs[veg.prefab];
      const clearSq = veg.clearance * veg.clearance;
      for (let n = 0; n < veg.count && attempts < 10000; attempts++) {
        const x = (rand() * 2 - 1) * 300;
        const z = (rand() * 2 - 1) * 300;
        const height = veg.height[0] + rand() * (veg.height[1] - veg.height[0]);
        const yaw = rand() * Math.PI * 2;
        if (centerline.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < clearSq)) continue;
        if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < PROP_SPACING * PROP_SPACING)) continue;
        place(prefab, x, z, yaw, new Vector3(height, height, height));
        placed.push(new Vector3(x, 0, z));
        const r = blobRadius[veg.prefab];
        if (r !== undefined) {
          const s = r * height;
          blob.thinInstanceAdd(Matrix.Compose(new Vector3(s, 1, s), Quaternion.Identity(), new Vector3(x, 0.05, z)), false);
        }
        n++;
      }
    }
    if (blob.thinInstanceCount > 0) {
      blob.thinInstanceBufferUpdated("matrix");
      blob.thinInstanceRefreshBoundingInfo();
      blob.freezeWorldMatrix();
    } else blob.setEnabled(false);

    // Hills on the horizon.
    const hillMat = flatMaterial(scene, "hillMat", new Color3(...theme.hill));
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
      // Above the intro/menu orbit cameras (y ≤ 120) so no puff fills the screen.
      const cy = 140 + rand() * 30;
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
