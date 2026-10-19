import {
  AbstractMesh,
  BaseTexture,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Material,
  MultiMaterial,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  Quaternion,
  ShadowGenerator,
  SpotLight,
  StandardMaterial,
  UniversalCamera,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { clearPrefabs, finishPrefabs, loadAssets, place, type Assets } from "./assets";
import { additiveMaterial, buildBuildings, buildLampLights, glowTexture, insideBuildings, placeProps } from "./dressing";
import { LANE_OFFSETS, RIVALS, TARGET_SPEED } from "./config";
import type { RiderLook, Rgb } from "./look";
import { createMoto, FOOT_DOWN_LEAN, type Moto } from "./moto";
import { mulberry32 } from "./rng";
import type { Lighting, Scenery, Water } from "./sceneries/types";
import type { Terrain } from "./terrain";
import { Track } from "./track";

interface LightingLook {
  /** Sky fill: intensity, sky and ground colours. */
  hemi: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  /** Sun (the moon at night): intensity, colour, height above the horizon in degrees. */
  sun: number;
  sunColor: Rgb;
  elevation: number;
  /** Share of their authored self-illumination that lit materials keep (night darkens them). */
  emissive: number;
}

const LIGHTING: Record<Lighting, LightingLook> = {
  // Day: the (-1, -2, -1) sun at the default azimuth.
  day: { hemi: 0.75, hemiSky: [1, 1, 1], hemiGround: [0.45, 0.45, 0.5], sun: 0.8, sunColor: [1, 1, 1], elevation: 54.74, emissive: 1 },
  sunset: { hemi: 0.6, hemiSky: [1, 0.8, 0.66], hemiGround: [0.45, 0.36, 0.42], sun: 1, sunColor: [1, 0.66, 0.4], elevation: 14, emissive: 0.85 },
  night: { hemi: 0.4, hemiSky: [0.5, 0.6, 0.95], hemiGround: [0.14, 0.14, 0.2], sun: 0.25, sunColor: [0.65, 0.75, 1], elevation: 40, emissive: 0.45 },
};
/** Degrees clockwise from +z when the scenery sets no sunAzimuth. */
const DEFAULT_SUN_AZIMUTH = 45;
/** Sunset sun disc / night moon: elevation (degrees) and distance on the sky dome (radius 900 m). */
const SUN_DISC_ELEVATION = 5;
const MOON_ELEVATION = 35;
const SKY_OBJECT_DISTANCE = 800;
/** Player's headlight spot: range (m) and intensity. */
const HEADLIGHT_RANGE = 70;
const HEADLIGHT_INTENSITY = 2.2;
/** Championship trophy (placeTrophy): distance from the camera (m), drop time (s), drop height (m), spin (rad/s). */
const TROPHY_DISTANCE = 11;
const TROPHY_DROP_SECONDS = 1.4;
const TROPHY_DROP_HEIGHT = 9;
const TROPHY_SPIN = 1.6;

export type WorldMode = "intro" | "menu" | "race" | "finish" | "crash" | "trophy";

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
/** Below this speed (m/s) a rider puts a foot down; the foot moves at FOOT_RATE (1/s). */
const FOOT_DOWN_SPEED = 2;
const FOOT_RATE = 8;
/** Vegetation never comes closer than this to another placed prop (default of Vegetation.spacing). */
const PROP_SPACING = 12;
/** Vegetation never grows within this distance of a tunnel (the rock shell covers ~28 m each side). */
const TUNNEL_CLEARANCE = 32;
/** Ground vertices inside a tunnel's strip sit this far under its road (4 m ground cells vs a sloping road). */
const TUNNEL_FLOOR_SINK = 0.3;
/** Half width of a tunnel tube (track.ts TUBE_PROFILE walls). */
const TUBE_HALF_WIDTH = 12;
/** Ground emissive = grassBase × GROUND_GLOW (meadow: ≈ 0.08, 0.18, 0.06); Babylon multiplies it by texture × vertex colour. */
const GROUND_GLOW = 0.28;
/** Shore colour up to SHORE_SAND m from the water's edge, fading out over SHORE_BLEND m. */
const SHORE_SAND = 14;
const SHORE_BLEND = 10;
/** Snow fades in from SNOW_BLEND m below the snow line to SNOW_BLEND m above it. */
const SNOW_BLEND = 3;
/** Water surface opacity: the shallow bed shows through near the shore. */
const WATER_ALPHA = 0.85;
/** Canyon rock vertices further than ROCK_JITTER_CLEAR m from open road move up to ±ROCK_JITTER m in plan (facets; never folds 4 m cells). */
const ROCK_JITTER = 0.8;
const ROCK_JITTER_CLEAR = 20;

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

/**
 * Vertex colour of the ground at (x, y, z): multiplies the grass texture so it reads as `rock` (a cut's
 * rock colour, on its faceted rock mesh), the shore colour along the water and the snow colour above the
 * snow line; white elsewhere. Null when the scenery has none of these (no colour buffer at all).
 */
function groundTint(scenery: Scenery, terrain: Terrain, x: number, y: number, z: number, rock: Rgb | null): [number, number, number] | null {
  if (!scenery.water?.shore && !scenery.snowLine && !scenery.cuts?.some((c) => c.color)) return null;
  const layers: [Rgb, number][] = [];
  if (rock) layers.push([rock, 1]);
  if (scenery.water?.shore) layers.push([scenery.water.shore, 1 - smoothstep((terrain.shoreDistance(x, z) - SHORE_SAND) / SHORE_BLEND)]);
  if (scenery.snowLine) {
    const { height, color } = scenery.snowLine;
    layers.push([color, smoothstep((y - height + SNOW_BLEND) / (2 * SNOW_BLEND))]);
  }
  const tint: [number, number, number] = [1, 1, 1];
  for (const [color, t] of layers) {
    for (let c = 0; c < 3; c++) tint[c] += (color[c] / Math.max(0.05, scenery.grassBase[c]) - tint[c]) * t;
  }
  return tint;
}

/**
 * Texture coordinates (16 m per repeat) for a flat-shaded mesh (no shared vertices): each triangle is
 * projected on the plane its normal faces most, so steep rock faces show the texture unstretched.
 */
function faceUVs(positions: ArrayLike<number>, indices: ArrayLike<number>): number[] {
  const uvs = new Array<number>((positions.length / 3) * 2).fill(0);
  for (let k = 0; k < indices.length; k += 3) {
    const [a, b, c] = [indices[k], indices[k + 1], indices[k + 2]];
    const e1 = [0, 1, 2].map((i) => positions[3 * b + i] - positions[3 * a + i]);
    const e2 = [0, 1, 2].map((i) => positions[3 * c + i] - positions[3 * a + i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]].map(Math.abs);
    // Plane axes: the two coordinates other than the normal's dominant one.
    const [u, v] = n[1] >= n[0] && n[1] >= n[2] ? [0, 2] : n[0] >= n[2] ? [2, 1] : [0, 1];
    for (const i of [a, b, c]) {
      uvs[2 * i] = positions[3 * i + u] / 16;
      uvs[2 * i + 1] = positions[3 * i + v] / 16;
    }
  }
  return uvs;
}

/** Plan points hashed in square cells: fast "is any point closer than r" queries for the scatter. */
class PlanGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly cell: number) {}

  add(x: number, z: number): void {
    // Keys cover ±32 km in cells of ≥ 1 m: far beyond the ±800 m map.
    const key = (Math.floor(x / this.cell) + 32768) * 65536 + Math.floor(z / this.cell) + 32768;
    const list = this.cells.get(key);
    if (list) list.push(x, z);
    else this.cells.set(key, [x, z]);
  }

  near(x: number, z: number, r: number): boolean {
    const reach = Math.ceil(r / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = cx - reach; i <= cx + reach; i++) {
      for (let j = cz - reach; j <= cz + reach; j++) {
        const list = this.cells.get((i + 32768) * 65536 + j + 32768);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) if ((list[k] - x) ** 2 + (list[k + 1] - z) ** 2 < r * r) return true;
      }
    }
    return false;
  }
}

interface Smoke {
  mesh: Mesh;
  mat: StandardMaterial;
  age: number;
  baseY: number;
}

export class World {
  readonly scene: Scene;
  private readonly assets: Assets;
  private circuit: Track | null = null;
  private current: Scenery | null = null;
  /** Meshes, materials and textures built for the current scenery (disposed by the next setScenery). */
  private owned: { meshes: AbstractMesh[]; materials: Material[]; textures: BaseTexture[] } = { meshes: [], materials: [], textures: [] };

  private readonly camera: UniversalCamera;
  private readonly hemi: HemisphericLight;
  /** Night riding: headlight lens meshes (on the motos), road pools (one per moto, laid on the road by placeMoto), the player's spot light. */
  private readonly headlightMeshes: Mesh[] = [];
  private readonly headlightPools: Mesh[] = [];
  private headlight: SpotLight | null = null;
  private night = false;
  private readonly trophy: Mesh;
  /** Authored emissive colour of every material the lighting dims (see applyLighting). */
  private readonly baseEmissive = new WeakMap<StandardMaterial, Color3>();
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
  /** Foot-down amount per moto: 0 = feet on the pegs, 1 = left foot on the ground. */
  private readonly motoFoot: number[] = [];
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
  /** Finish orbit: camera position relative to the player moto, eased towards the orbit pose. */
  private readonly finishOffset = new Vector3();
  /** Menu orbit height: 90 m, raised to clear the current scenery's mountains (see buildScenery). */
  private orbitHeight = 90;

  /** Loads the 3D models, then builds the world. Rejects when a model fails to load. */
  static async create(engine: Engine, playerLook: RiderLook, scenery: Scenery): Promise<World> {
    const scene = new Scene(engine);
    const assets = await loadAssets(scene);
    return new World(scene, assets, playerLook, scenery);
  }

  private constructor(scene: Scene, assets: Assets, playerLook: RiderLook, scenery: Scenery) {
    this.scene = scene;
    this.assets = assets;
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = 250;
    scene.fogEnd = 700;
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
    this.hemi = hemi;
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

    this.setScenery(scenery);

    for (let i = 0; i <= RIVALS.length; i++) {
      const look = i === 0 ? playerLook : RIVALS[i - 1].look;
      const moto = createMoto(scene, assets, i === 0 ? "player" : `rival${i}`, look);
      this.motos.push(moto);
      this.appliedLook.push(JSON.stringify(look));
      for (const m of moto.casters) this.shadows.addShadowCaster(m, false);
      this.motoDist.push(0);
      this.motoSpeed.push(0);
      this.motoLean.push(0);
      this.motoFoot.push(0);
    }
    this.createHeadlights();
    this.trophy = this.createTrophy();
    this.applyLighting(scenery);
    this.setMode("intro", performance.now());
  }

  get track(): Track {
    return this.circuit!;
  }

  get scenery(): Scenery {
    return this.current!;
  }

  /** Rebuilds the circuit and its surroundings; synchronous (create() loaded every model). */
  setScenery(scenery: Scenery): void {
    if (this.current?.id === scenery.id) return;
    const t0 = performance.now();
    const scene = this.scene;
    if (this.circuit) for (const m of this.circuit.casters) this.shadows.removeShadowCaster(m, false);
    for (const m of this.owned.meshes) if (!m.isDisposed()) m.dispose(false, false);
    for (const m of this.owned.materials) m.dispose();
    for (const t of this.owned.textures) t.dispose();
    clearPrefabs(this.assets.prefabs);

    const meshes = new Set(scene.meshes);
    const materials = new Set(scene.materials);
    const textures = new Set(scene.textures);
    const horizon = new Color3(...scenery.skyHorizon);
    scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
    scene.fogColor = horizon;
    this.circuit = new Track(scene, scenery);
    for (const m of this.circuit.casters) this.shadows.addShadowCaster(m, false);
    const night = scenery.lighting === "night";
    const { bulky, lamps } = this.circuit.buildProps(this.assets.prefabs);
    const placed = placeProps(this.assets.prefabs, scenery.props ?? [], this.circuit.terrain);
    buildBuildings(scene, scenery.buildings ?? [], this.circuit.terrain, night);
    if (night) buildLampLights(scene, lamps);
    this.buildScenery(scenery, [...bulky, ...placed]);
    finishPrefabs(this.assets.prefabs);

    // Whatever appeared while building belongs to this scenery: no per-feature disposal bookkeeping.
    this.owned = {
      meshes: scene.meshes.filter((m) => !meshes.has(m)),
      materials: scene.materials.filter((m) => !materials.has(m)),
      textures: scene.textures.filter((t) => !textures.has(t)),
    };
    this.current = scenery;
    this.applyLighting(scenery);
    console.info(`[scenery] ${scenery.id} built in ${Math.round(performance.now() - t0)} ms`);
  }

  setMode(mode: WorldMode, nowMs: number): void {
    this.mode = mode;
    this.modeT0 = nowMs;
    if (mode === "intro" || mode === "menu" || mode === "trophy") this.resetPlayerEffects();
    if (mode === "menu" || mode === "trophy") this.menuStart = this.motoDist.slice();
    this.trophy.setEnabled(mode === "trophy");
    if (mode === "finish") this.camera.position.subtractToRef(this.motos[0].root.position, this.finishOffset);
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
      // Everyone waits on the grid with a foot down.
      this.motoFoot[i] = 1;
      this.motos[i].setFootDown(1);
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

  /** The player's own moto look (class races use the colour picked at joining); no-op when unchanged. */
  setPlayerLook(look: RiderLook): void {
    const key = JSON.stringify(look);
    if (key === this.appliedLook[0]) return;
    this.appliedLook[0] = key;
    this.motos[0].setLook(look);
    for (const m of this.motos[0].casters) this.shadows.addShadowCaster(m, false);
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
      const baseY = root.position.y + 0.5 + rand() * 0.5;
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
      case "trophy":
        for (let i = 0; i < this.motos.length; i++) {
          this.driveMoto(i, (this.menuStart[i] ?? 0) + (25 + i) * t, nowMs, dt);
        }
        this.menuCamera(t);
        if (this.mode === "trophy") this.placeTrophy(t);
        break;
      case "race":
      case "finish":
      case "crash":
        if (race) {
          if (this.mode === "finish") {
            // Past the line: ease to cruise speed and keep riding while the banner shows.
            this.playerVel += (TARGET_SPEED - this.playerVel) * (1 - Math.exp(-2 * dt));
            this.playerVis += this.playerVel * dt;
          } else {
            // Critically damped spring towards the race progress: the velocity stays continuous,
            // so an answer's boost accelerates the moto instead of jumping to full speed in a frame.
            // Exact solution per step: stable for any dt (slow devices hitch up to the 0.1 s cap).
            const target = race.player * race.perQuestion;
            const e = this.playerVis - target;
            const k = Math.exp(-PLAYER_SPRING * dt);
            const j = (this.playerVel + PLAYER_SPRING * e) * dt;
            this.playerVis = target + (e + j) * k;
            this.playerVel = (this.playerVel - PLAYER_SPRING * j) * k;
          }
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

    const stopped = this.motoSpeed[i] < FOOT_DOWN_SPEED && !(i === 0 && this.crashElapsed >= 0);
    const goal = stopped ? 1 : 0;
    const foot = this.motoFoot[i] + (goal - this.motoFoot[i]) * (1 - Math.exp(-FOOT_RATE * dt));
    // Snap once settled so setFootDown skips the re-pose in the steady state.
    this.motoFoot[i] = Math.abs(goal - foot) < 1e-3 ? goal : foot;
    this.motos[i].setFootDown(this.motoFoot[i]);

    this.placeMoto(i, distance, lateral, teleport ? 0 : delta / this.motos[i].wheelRadius);
  }

  private placeMoto(i: number, distance: number, lateral: number, wheelSpin: number): void {
    const moto = this.motos[i];
    const { pos, heading, pitch } = this.track.positionAt(distance, lateral);
    const root = moto.root;
    root.position.copyFrom(pos);
    // Uphill = nose up = negative x rotation. A stopped moto rests on the rider's left foot (positive rotation.z leans left).
    root.rotation.set(-pitch, heading, this.motoLean[i] + FOOT_DOWN_LEAN * this.motoFoot[i]);
    for (const w of moto.wheels) w.rotation.x += wheelSpin;

    // Headlight beam: flat on the road ahead and level with it, whatever the lean (a child of the
    // rolled root would sink half into the road). Off while the player's bike lies on its side.
    const front = this.assets.moto.length / 2;
    const lit = this.night && root.isEnabled(false) && !(i === 0 && this.crashElapsed >= 0);
    const pool = this.headlightPools[i];
    pool.setEnabled(lit);
    if (lit) {
      const ahead = this.track.positionAt(distance + front + 8, lateral);
      pool.position.set(ahead.pos.x, ahead.pos.y + 0.08, ahead.pos.z);
      pool.rotation.set(-ahead.pitch, ahead.heading, 0);
    }

    if (i !== 0) return;
    if (this.headlight) {
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      this.headlight.position.set(pos.x + fx * front, pos.y + 1.1, pos.z + fz * front);
      this.headlight.direction.set(fx * Math.cos(pitch), Math.sin(pitch) - 0.2, fz * Math.cos(pitch));
    }
    if (this.spinElapsed >= 0) {
      const p = Math.min(1, this.spinElapsed / SPIN_SECONDS);
      root.rotation.y += 2 * Math.PI * (1 - (1 - p) ** 3);
    }
    if (this.crashElapsed >= 0) {
      const p = Math.min(1, this.crashElapsed / CRASH_SECONDS);
      const ease = 1 - (1 - p) ** 2;
      // Small hop, then the bike falls over onto its side.
      root.position.y = pos.y + 0.8 * 4 * p * (1 - p);
      root.rotation.z = 1.35 * ease;
    }
  }

  /**
   * Night riding: a lens and a light pool on the road ahead of every moto (cheap additive decals),
   * plus a real spot light on the player's (hemi + sun + spot: StandardMaterial lights up to 4).
   */
  private createHeadlights(): void {
    const scene = this.scene;
    const lensMat = new StandardMaterial("headlightLensMat", scene);
    lensMat.disableLighting = true;
    lensMat.diffuseColor = Color3.Black();
    lensMat.specularColor = Color3.Black();
    lensMat.emissiveColor = new Color3(1, 0.97, 0.85);
    const poolTex = glowTexture(scene, "headlightPoolTex", [
      [0, "rgba(255,255,255,0.9)"],
      [0.45, "rgba(255,255,255,0.45)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    const poolMat = additiveMaterial(scene, "headlightPoolMat", poolTex, new Color3(0.5, 0.47, 0.38));
    poolMat.zOffset = -4;
    const front = this.assets.moto.length / 2;
    for (const moto of this.motos) {
      const lens = MeshBuilder.CreateSphere(`${moto.root.name}-lens`, { diameter: 0.2, segments: 6 }, scene);
      lens.material = lensMat;
      lens.parent = moto.root;
      lens.position.set(0, 0.85, front - 0.15);
      lens.isPickable = false;
      // Not parented to the moto: it would roll with the lean and sink half into the road (placeMoto
      // lays it flat on the road ahead instead).
      const pool = MeshBuilder.CreateGround(`${moto.root.name}-beam`, { width: 7, height: 18 }, scene);
      pool.material = poolMat;
      pool.isPickable = false;
      this.headlightMeshes.push(lens);
      this.headlightPools.push(pool);
    }
    // Wide cone with a steep exponent: the beam fades out before its hard edge. Placed by placeMoto
    // (level with the road, ignoring the lean).
    const spot = new SpotLight("headlight", Vector3.Zero(), new Vector3(0, -0.2, 1), 1.3, 10, scene);
    spot.range = HEADLIGHT_RANGE;
    spot.intensity = HEADLIGHT_INTENSITY;
    spot.diffuse = new Color3(1, 0.93, 0.78);
    spot.specular = Color3.Black();
    this.headlight = spot;
  }

  /** Lights, sun direction and the materials' self-illumination for the scenery's time of day. */
  private applyLighting(scenery: Scenery): void {
    const lighting = scenery.lighting ?? "day";
    const look = LIGHTING[lighting];
    this.hemi.intensity = look.hemi;
    this.hemi.diffuse = new Color3(...look.hemiSky);
    this.hemi.groundColor = new Color3(...look.hemiGround);
    const azimuth = ((scenery.sunAzimuth ?? DEFAULT_SUN_AZIMUTH) * Math.PI) / 180;
    const elevation = (look.elevation * Math.PI) / 180;
    // The light travels from the sun towards the ground.
    this.sun.direction = new Vector3(
      -Math.sin(azimuth) * Math.cos(elevation),
      -Math.sin(elevation),
      -Math.cos(azimuth) * Math.cos(elevation),
    );
    this.sun.intensity = look.sun;
    this.sun.diffuse = new Color3(...look.sunColor);
    // Prefab materials outlive the scenery: scale from their authored colour, never compound.
    const prefabMaterials = Object.values(this.assets.prefabs).flatMap((p) =>
      p.mesh.material instanceof MultiMaterial ? p.mesh.material.subMaterials : [p.mesh.material],
    );
    for (const mat of [...this.owned.materials, ...prefabMaterials]) {
      if (!(mat instanceof StandardMaterial) || mat.disableLighting) continue;
      let base = this.baseEmissive.get(mat);
      if (!base) {
        base = mat.emissiveColor.clone();
        this.baseEmissive.set(mat, base);
      }
      base.scaleToRef(look.emissive, mat.emissiveColor);
    }
    this.night = lighting === "night";
    for (const m of this.headlightMeshes) m.setEnabled(this.night);
    this.headlight?.setEnabled(this.night);
  }

  /** Shadow generator for the sun, with every moto's meshes and the circuit's casters. */
  private createShadows(size: number, filter: number): ShadowGenerator {
    const shadows = new ShadowGenerator(size, this.sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = filter;
    shadows.bias = 0.002;
    shadows.normalBias = 0.02;
    for (const moto of this.motos) for (const m of moto.casters) shadows.addShadowCaster(m, false);
    for (const m of this.circuit?.casters ?? []) shadows.addShadowCaster(m, false);
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
    a.y += 1.5;
    const b = this.track.positionAt(40, 0).pos;
    b.y += 1;
    const s = smoothstep((t - INTRO_CUT_SECONDS) / (INTRO_SECONDS - INTRO_CUT_SECONDS));
    Vector3.LerpToRef(a, new Vector3(0, this.orbitHeight + 30, -220), s, this.camera.position);
    Vector3.LerpToRef(b, Vector3.ZeroReadOnly, s, this.camTarget);
    this.camera.fov = BASE_FOV;
  }

  private menuCamera(t: number): void {
    // Start the orbit at the intro's end pose (0, orbitHeight + 30, -220) direction.
    const angle = Math.PI + 0.05 * t;
    // Ease the height down from the intro's final pose so the cut to the menu is seamless.
    this.camera.position.set(220 * Math.sin(angle), this.orbitHeight + 30 * Math.exp(-t * 1.5), 220 * Math.cos(angle));
    this.camTarget.set(0, 0, 0);
    this.camera.fov = BASE_FOV;
  }

  /** Championship trophy: drops in front of the menu camera with a bounce, then keeps spinning. */
  private placeTrophy(t: number): void {
    const dir = this.camTarget.subtract(this.camera.position).normalize();
    const p = Math.min(1, t / TROPHY_DROP_SECONDS);
    // Ease-out bounce: falls, then two small rebounds.
    const bounce =
      p < 0.6 ? 1 - (p / 0.6) ** 2 : p < 0.85 ? 0.12 * Math.sin(((p - 0.6) / 0.25) * Math.PI) : 0.03 * Math.sin(((p - 0.85) / 0.15) * Math.PI);
    this.camera.position.addToRef(dir.scale(TROPHY_DISTANCE), this.trophy.position);
    this.trophy.position.y += -2.2 + TROPHY_DROP_HEIGHT * bounce;
    this.trophy.rotation.y = Math.atan2(dir.x, dir.z) + t * TROPHY_SPIN;
  }

  /** Gold cup (lathe body, two handles, stepped base), about 4 m tall; shown only in "trophy" mode. */
  private createTrophy(): Mesh {
    const scene = this.scene;
    const profile = [
      [0, 0], [0.85, 0], [0.85, 0.22], [0.55, 0.3], [0.55, 0.42], [0.22, 0.52], [0.16, 1.05], [0.3, 1.2],
      [0.78, 1.38], [1.02, 1.9], [1.08, 2.45], [0.98, 2.45], [0.9, 1.95], [0.68, 1.5], [0, 1.42],
    ].map(([r, y]) => new Vector3(r, y, 0));
    const cup = MeshBuilder.CreateLathe("trophyCup", { shape: profile, tessellation: 40 }, scene);
    const handles = [-1, 1].map((s) => {
      const handle = MeshBuilder.CreateTorus("trophyHandle", { diameter: 0.75, thickness: 0.13, tessellation: 28 }, scene);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(s * 1.05, 1.88, 0);
      return handle;
    });
    const trophy = Mesh.MergeMeshes([cup, ...handles], true, true)!;
    trophy.name = "trophy";
    const gold = new StandardMaterial("trophyGold", scene);
    gold.diffuseColor = new Color3(1, 0.76, 0.15);
    gold.specularColor = new Color3(1, 0.95, 0.6);
    gold.specularPower = 24;
    // Bright at night too: the cup carries its own glow.
    gold.emissiveColor = new Color3(0.45, 0.32, 0.04);
    trophy.material = gold;
    trophy.scaling.setAll(1.6);
    trophy.applyFog = false;
    trophy.isPickable = false;
    trophy.setEnabled(false);
    return trophy;
  }

  /** Rides the track 7 m behind the player: as smooth as the spline, never left behind by a boost. */
  private chaseCamera(): void {
    const d = this.motoDist[0];
    const behind = this.track.positionAt(d - 7, LANE_OFFSETS[0]).pos;
    const { pos, heading } = this.track.positionAt(d, LANE_OFFSETS[0]);
    this.camera.position.set(behind.x, behind.y + 3, behind.z);
    const ahead = this.track.positionAt(d + 6, LANE_OFFSETS[0]).pos;
    this.camTarget.set(pos.x + Math.sin(heading) * 6, ahead.y + 1.2, pos.z + Math.cos(heading) * 6);
    this.camera.fov = BASE_FOV + (0.15 * this.boostRemaining) / BOOST_SECONDS;
  }

  /** Circles the player, following it as it keeps riding past the line. */
  private finishCamera(dt: number, t: number): void {
    const { pos, heading } = this.track.positionAt(this.motoDist[0], LANE_OFFSETS[0]);
    // Begin behind the moto (where the chase cam was), then circle around it.
    const angle = heading + Math.PI + 0.6 * t;
    const k = 1 - Math.exp(-dt * 5);
    const o = this.finishOffset;
    o.x += (7 * Math.sin(angle) - o.x) * k;
    o.y += (2.2 - o.y) * k;
    o.z += (7 * Math.cos(angle) - o.z) * k;
    this.camera.position.set(pos.x + o.x, pos.y + o.y, pos.z + o.z);
    this.camTarget.set(pos.x, pos.y + 1, pos.z);
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
  private buildScenery(scenery: Scenery, props: readonly Vector3[]): void {
    const scene = this.scene;
    const terrain = this.track.terrain;
    const rand = mulberry32(42);

    // Sky dome: zenith → horizon gradient on the upper half, horizon colour below; stars at night.
    const lighting = scenery.lighting ?? "day";
    const night = lighting === "night";
    const skyW = night ? 2048 : 4;
    const skyH = night ? 1024 : 256;
    const skyTex = new DynamicTexture("skyTex", { width: skyW, height: skyH }, scene, false);
    const skyCtx = skyTex.getContext();
    const gradient = skyCtx.createLinearGradient(0, 0, 0, skyH / 2);
    gradient.addColorStop(0, css(scenery.skyZenith));
    gradient.addColorStop(1, css(scenery.skyHorizon));
    skyCtx.fillStyle = gradient;
    skyCtx.fillRect(0, 0, skyW, skyH / 2);
    skyCtx.fillStyle = css(scenery.skyHorizon);
    skyCtx.fillRect(0, skyH / 2, skyW, skyH / 2);
    if (night) {
      const starRand = mulberry32(5);
      for (let k = 0; k < 1500; k++) {
        skyCtx.fillStyle = `rgba(255,255,240,${(0.35 + 0.65 * starRand()).toFixed(2)})`;
        const size = starRand() < 0.06 ? 2 : 1;
        // Rows near the top pole are squeezed together on the sphere: fewer stars there.
        const row = (skyH / 2) * (0.12 + 0.8 * Math.sqrt(starRand()));
        skyCtx.fillRect(Math.floor(starRand() * skyW), Math.floor(row), size, size);
      }
    }
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

    // Sunset sun with its halo / night moon, on the dome at the sun's azimuth (hills may hide the sun).
    if (lighting !== "day") {
      const azimuth = ((scenery.sunAzimuth ?? DEFAULT_SUN_AZIMUTH) * Math.PI) / 180;
      const elevation = ((night ? MOON_ELEVATION : SUN_DISC_ELEVATION) * Math.PI) / 180;
      const disc = MeshBuilder.CreatePlane("sunDisc", { size: night ? 70 : 300 }, scene);
      disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
      disc.position.set(
        SKY_OBJECT_DISTANCE * Math.sin(azimuth) * Math.cos(elevation),
        SKY_OBJECT_DISTANCE * Math.sin(elevation),
        SKY_OBJECT_DISTANCE * Math.cos(azimuth) * Math.cos(elevation),
      );
      disc.infiniteDistance = true;
      disc.applyFog = false;
      disc.isPickable = false;
      const stops: readonly (readonly [number, string])[] = night
        ? [
            [0, "rgba(255,255,255,1)"],
            [0.55, "rgba(255,255,255,1)"],
            [0.62, "rgba(255,255,255,0.25)"],
            [1, "rgba(255,255,255,0)"],
          ]
        : [
            [0, "rgba(255,255,255,1)"],
            [0.16, "rgba(255,255,255,1)"],
            [0.2, "rgba(255,255,255,0.5)"],
            [0.45, "rgba(255,255,255,0.18)"],
            [1, "rgba(255,255,255,0)"],
          ];
      disc.material = additiveMaterial(
        scene,
        "sunDiscMat",
        glowTexture(scene, "sunDiscTex", stops),
        night ? new Color3(0.85, 0.88, 0.95) : new Color3(1, 0.82, 0.5),
      );
    }

    // Mown-grass ground: speckles and two mowing bands.
    const grassTex = new DynamicTexture("grassTex", { width: 512, height: 512 }, scene, true);
    const ctx = grassTex.getContext();
    ctx.fillStyle = css(scenery.grassBase);
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = css(scenery.grassBase, 1.06);
    ctx.fillRect(256, 0, 256, 512);
    for (let k = 0; k < 6000; k++) {
      const c = scenery.grassSpeckles[Math.floor(rand() * scenery.grassSpeckles.length)];
      ctx.fillStyle = css(c, rand() < 0.5 ? 1 : 1.06);
      ctx.fillRect(Math.floor(rand() * 511), Math.floor(rand() * 511), 2, 2);
    }
    grassTex.update();
    // UVs are in 16 m units (see below): one texture repeat per 16 m.
    grassTex.uScale = 1;
    grassTex.vScale = 1;
    const ground = new Mesh("ground", scene);
    const { peak, rock } = this.buildGround(ground, scenery);
    this.orbitHeight = Math.max(90, peak + 40);
    const groundMat = new StandardMaterial("groundMat", scene);
    groundMat.diffuseTexture = grassTex;
    groundMat.emissiveColor = new Color3(...scenery.grassBase).scale(GROUND_GLOW);
    groundMat.specularColor = Color3.Black();
    ground.material = groundMat;
    if (rock) rock.material = groundMat;
    // Tunnel shells: same material and tint as the ground around them. Canyon arches: the same faceted
    // rock as the canyon's walls (its tint, face-projected texture).
    const covers = [
      ...this.track.groundCovers.map((mesh) => ({ mesh, color: null, faceted: false })),
      ...this.track.rockCovers.map((c) => ({ ...c, faceted: true })),
    ];
    for (const { mesh, color, faceted } of covers) {
      mesh.material = groundMat;
      const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      if (faceted) mesh.setVerticesData(VertexBuffer.UVKind, faceUVs(pos, mesh.getIndices()!));
      const colors: number[] = [];
      for (let k = 0; k < pos.length; k += 3) {
        const tint = groundTint(scenery, terrain, pos[k], pos[k + 1], pos[k + 2], color);
        if (!tint) break;
        colors.push(...tint, 1);
      }
      if (colors.length > 0) mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    }
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

    // Vegetation: rejection-sampled away from the track, the rock over tunnels, water, cuts and other props.
    const roadGrid = new PlanGrid(16);
    const tunnelGrid = new PlanGrid(16);
    this.track.points.forEach((p, i) => {
      roadGrid.add(p.x, p.z);
      if (this.track.support[i] === "tunnel") tunnelGrid.add(p.x, p.z);
    });
    const placed = new PlanGrid(PROP_SPACING);
    for (const p of props) placed.add(p.x, p.z);
    const maxAttempts = Math.max(10000, 25 * scenery.vegetation.reduce((s, v) => s + v.count, 0));
    let attempts = 0;
    for (const veg of scenery.vegetation) {
      const prefab = this.assets.prefabs[veg.prefab];
      const spacing = veg.spacing ?? PROP_SPACING;
      for (let n = 0; n < veg.count && attempts < maxAttempts; attempts++) {
        const x = (rand() * 2 - 1) * 300;
        const z = (rand() * 2 - 1) * 300;
        const height = veg.height[0] + rand() * (veg.height[1] - veg.height[0]);
        const yaw = rand() * Math.PI * 2;
        if (roadGrid.near(x, z, veg.clearance) || tunnelGrid.near(x, z, TUNNEL_CLEARANCE) || placed.near(x, z, spacing)) continue;
        if (terrain.reshaped(x, z)) continue;
        if (insideBuildings(scenery.buildings ?? [], x, z, spacing / 2)) continue;
        const y = terrain.height(x, z);
        place(prefab, x, y, z, yaw, new Vector3(height, height, height));
        placed.add(x, z);
        const r = blobRadius[veg.prefab];
        if (r !== undefined) {
          const s = r * height;
          blob.thinInstanceAdd(Matrix.Compose(new Vector3(s, 1, s), Quaternion.Identity(), new Vector3(x, y + 0.05, z)), false);
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
    const hillMat = flatMaterial(scene, "hillMat", new Color3(...scenery.hill));
    for (let k = 0; k < 8; k++) {
      const angle = (k / 8) * Math.PI * 2 + rand() * 0.5;
      const dist = 330 + rand() * 90;
      const radius = 60 + rand() * 30;
      const hx = Math.cos(angle) * dist;
      const hz = Math.sin(angle) * dist;
      // No islands in the sea, no hills in a canyon.
      if (terrain.shoreDistance(hx, hz) < radius || terrain.reshaped(hx, hz)) continue;
      const hill = MeshBuilder.CreateSphere(`hill${k}`, { diameter: radius * 2, segments: 16 }, scene);
      hill.material = hillMat;
      hill.scaling.y = 0.35;
      hill.position.set(hx, terrain.height(hx, hz), hz);
      hill.isPickable = false;
      hill.freezeWorldMatrix();
    }

    // Clouds (none at night: stars instead), tinted by the low sun at sunset.
    if (!night) {
      const cloudMat = new StandardMaterial("cloudMat", scene);
      cloudMat.diffuseColor = Color3.Black();
      cloudMat.specularColor = Color3.Black();
      cloudMat.emissiveColor = lighting === "sunset" ? new Color3(1, 0.8, 0.68) : new Color3(1, 1, 1);
      cloudMat.disableLighting = true;
      const puff = MeshBuilder.CreateSphere("cloudPuff", { diameter: 1, segments: 10 }, scene);
      puff.material = cloudMat;
      puff.applyFog = false;
      let puffs = 0;
      for (let c = 0; c < 12; c++) {
        const cx = (rand() * 2 - 1) * 400;
        const cz = (rand() * 2 - 1) * 400;
        // Above the intro/menu orbit cameras (y ≤ orbitHeight + 30) so no puff fills the screen.
        const cy = this.orbitHeight + 50 + rand() * 30;
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

  /**
   * Fills `ground` with the terrain on a graded grid (4 m cells where the circuit is, 32 m further
   * out), without the strip over tunnels, tinted (shores, snow: see groundTint), and builds the water
   * surface over the cells dug below its level. Canyon rock (every triangle touching a cut's floor,
   * walls or mesas) goes to a separate flat-shaded `rock` mesh with jittered vertices: faceted like the
   * arches, with a crisp edge on the sand. Returns the highest point within 300 m of the centre.
   */
  private buildGround(ground: Mesh, scenery: Scenery): { peak: number; rock: Mesh | null } {
    const terrain = this.track.terrain;
    const axis: number[] = [];
    for (let v = -800; v <= -288; v += 32) axis.push(v);
    for (let v = -256; v <= 252; v += 4) axis.push(v);
    for (let v = 256; v <= 800; v += 32) axis.push(v);
    const last = axis.length - 1;
    // Rows run +z → −z, columns −x → +x (CreateGroundVertexData's layout and winding).
    const data = VertexData.CreateGround({ width: 1600, height: 1600, subdivisionsX: last, subdivisionsY: last });
    const positions = data.positions as number[];
    const uvs = data.uvs as number[];
    const colors: number[] = [];
    /** Vertices in a tunnel's tube away from its portals: triangles touching one would poke into it. */
    const inTube: boolean[] = [];
    /** Per vertex: the rock colour of the cut there, or null. */
    const rockColor: (Rgb | null)[] = [];
    let peak = -Infinity;
    for (let row = 0; row <= last; row++) {
      for (let col = 0; col <= last; col++) {
        const v = row * (last + 1) + col;
        let x = axis[col];
        let z = axis[last - row];
        const rock = terrain.rockAt(x, z);
        rockColor[v] = rock;
        if (rock && terrain.groundDistance(x, z) > ROCK_JITTER_CLEAR) {
          // Seeded by the vertex index: the same facets on every build.
          const jitter = (k: number): number => {
            const h = Math.sin(v * 12.9898 + k * 78.233) * 43758.5453;
            return (h - Math.floor(h) - 0.5) * 2 * ROCK_JITTER;
          };
          x += jitter(1);
          z += jitter(2);
        }
        const tunnel = terrain.tunnelAt(x, z);
        let y = terrain.height(x, z);
        // Near a portal the ground stays (see Terrain.tunnelAt); inside the tube pull it under the
        // road, else the higher ground before a dipping road pokes through it.
        if (tunnel && !tunnel.interior && tunnel.distance <= TUBE_HALF_WIDTH) y = Math.min(y, tunnel.roadY - TUNNEL_FLOOR_SINK);
        inTube[v] = tunnel !== null && tunnel.interior && tunnel.distance <= TUBE_HALF_WIDTH + 1;
        positions[3 * v] = x;
        positions[3 * v + 1] = y;
        positions[3 * v + 2] = z;
        uvs[2 * v] = x / 16;
        uvs[2 * v + 1] = z / 16;
        if (Math.abs(x) <= 300 && Math.abs(z) <= 300) peak = Math.max(peak, y);
        const tint = groundTint(scenery, terrain, x, y, z, null);
        if (tint) colors.push(...tint, 1);
      }
    }
    const indices = data.indices as number[];
    const kept: number[] = [];
    const rockTris: number[] = [];
    for (let k = 0; k < indices.length; k += 3) {
      const [a, b, c] = [indices[k], indices[k + 1], indices[k + 2]];
      const cx = (positions[3 * a] + positions[3 * b] + positions[3 * c]) / 3;
      const cz = (positions[3 * a + 2] + positions[3 * b + 2] + positions[3 * c + 2]) / 3;
      // Over a tunnel the shell replaces the ground.
      if (inTube[a] || inTube[b] || inTube[c] || terrain.tunnelAt(cx, cz)?.interior) continue;
      (rockColor[a] || rockColor[b] || rockColor[c] ? rockTris : kept).push(a, b, c);
    }
    data.indices = kept;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, kept, normals);
    data.normals = normals;
    if (colors.length > 0) data.colors = colors;
    data.applyToMesh(ground);
    if (scenery.water) this.buildWater(scenery.water, axis, positions);
    if (rockTris.length === 0) return { peak, rock: null };

    // Rock: no shared vertices, so every triangle shows its own facet (face normals, face-projected texture).
    const rockData = new VertexData();
    const rockPositions = rockTris.flatMap((v) => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]]);
    const rockIndices = rockTris.map((_, k) => k);
    const rockNormals: number[] = [];
    VertexData.ComputeNormals(rockPositions, rockIndices, rockNormals);
    const rockColors: number[] = [];
    rockTris.forEach((v, k) => {
      const [x, y, z] = [rockPositions[3 * k], rockPositions[3 * k + 1], rockPositions[3 * k + 2]];
      // A sand vertex of a rock triangle (at the cliff foot) takes the triangle's rock colour.
      const t = k - (k % 3);
      const color = rockColor[v] ?? rockColor[rockTris[t]] ?? rockColor[rockTris[t + 1]] ?? rockColor[rockTris[t + 2]];
      rockColors.push(...groundTint(scenery, terrain, x, y, z, color)!, 1);
    });
    rockData.positions = rockPositions;
    rockData.indices = rockIndices;
    rockData.normals = rockNormals;
    rockData.uvs = faceUVs(rockPositions, rockIndices);
    rockData.colors = rockColors;
    const rock = new Mesh("groundRock", this.scene);
    rockData.applyToMesh(rock);
    rock.isPickable = false;
    rock.receiveShadows = true;
    rock.freezeWorldMatrix();
    return { peak, rock };
  }

  /** One flat quad per run of ground grid cells (in a row) with a corner below the water's surface. */
  private buildWater(water: Water, axis: readonly number[], positions: readonly number[]): void {
    // Elsewhere there is no water mesh at all, so it never fights with ground near its level.
    const last = axis.length - 1;
    const wet: number[] = [];
    const quads: number[] = [];
    const yAt = (row: number, col: number): number => positions[3 * (row * (last + 1) + col) + 1];
    for (let row = 0; row < last; row++) {
      let start = -1;
      for (let col = 0; col <= last; col++) {
        const isWet =
          col < last && Math.min(yAt(row, col), yAt(row, col + 1), yAt(row + 1, col), yAt(row + 1, col + 1)) < water.level;
        if (isWet && start < 0) start = col;
        if (isWet || start < 0) continue;
        const v = wet.length / 3;
        const [x0, x1, z0, z1] = [axis[start], axis[col], axis[last - row - 1], axis[last - row]];
        wet.push(x0, water.level, z1, x1, water.level, z1, x1, water.level, z0, x0, water.level, z0);
        quads.push(v, v + 1, v + 2, v, v + 2, v + 3);
        start = -1;
      }
    }
    if (quads.length === 0) return;
    const surface = new VertexData();
    surface.positions = wet;
    surface.indices = quads;
    surface.normals = wet.map((_, k) => (k % 3 === 1 ? 1 : 0));
    const waterMesh = new Mesh("water", this.scene);
    surface.applyToMesh(waterMesh);
    const waterMat = new StandardMaterial("waterMat", this.scene);
    waterMat.diffuseColor = new Color3(...water.color);
    waterMat.emissiveColor = new Color3(...water.color).scale(0.3);
    waterMat.specularColor = new Color3(0.6, 0.6, 0.6);
    waterMat.specularPower = 48;
    waterMat.alpha = WATER_ALPHA;
    waterMat.backFaceCulling = false;
    waterMesh.material = waterMat;
    waterMesh.isPickable = false;
    waterMesh.freezeWorldMatrix();
  }
}
