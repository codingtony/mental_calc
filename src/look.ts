/** Rider appearance: what a future shop sells and what travels over the network. */

export type Rgb = readonly [number, number, number]; // 0..1, sRGB

export const RIDER_BODIES = ["girl", "boy"] as const;
export type RiderBody = (typeof RIDER_BODIES)[number];

export const HELMETS = ["classic", "mirror"] as const;
export type HelmetId = (typeof HELMETS)[number];

export interface RiderLook {
  body: RiderBody;
  bike: Rgb;
  suit: Rgb;
  helmet: HelmetId;
  helmetColor: Rgb;
}

export const DEFAULT_PLAYER_LOOK: RiderLook = {
  body: "girl",
  bike: [0.9, 0.05, 0.1],
  suit: [0.9, 0.05, 0.1],
  helmet: "classic",
  helmetColor: [1, 1, 1],
};

/** Bike colours a player gets at random when joining a class race (later: picked by the player). */
export const BIKE_PALETTE: readonly Rgb[] = [
  [0.9, 0.05, 0.1], // red
  [1, 0.45, 0], // orange
  [1, 0.82, 0.05], // yellow
  [0.55, 0.85, 0.1], // lime
  [0.1, 0.65, 0.2], // green
  [0, 0.6, 0.55], // teal
  [0.1, 0.8, 0.9], // cyan
  [0.2, 0.55, 1], // sky blue
  [0.1, 0.2, 0.85], // blue
  [0.35, 0.15, 0.75], // indigo
  [0.6, 0.2, 0.85], // purple
  [0.95, 0.2, 0.65], // magenta
  [1, 0.55, 0.7], // pink
  [0.5, 0.3, 0.15], // brown
  [0.95, 0.95, 0.95], // white
  [0.15, 0.15, 0.18], // black
];

/** `base` with a random palette colour on the bike and the suit (the suit matches the bike, like the rivals). */
export function randomBikeLook(base: RiderLook, rand: () => number = Math.random): RiderLook {
  const color = BIKE_PALETTE[Math.floor(rand() * BIKE_PALETTE.length)];
  return { ...base, bike: color, suit: color };
}

function parseRgb(raw: unknown): Rgb | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  if (!raw.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [r, g, b] = (raw as number[]).map((v) => Math.min(1, Math.max(0, v)));
  return [r, g, b];
}

/** Validates untrusted JSON (prefs, network). Returns null when not a valid look; clamps channels to [0,1]. */
export function parseLook(raw: unknown): RiderLook | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const body = RIDER_BODIES.find((b) => b === o.body);
  const helmet = HELMETS.find((h) => h === o.helmet);
  const bike = parseRgb(o.bike);
  const suit = parseRgb(o.suit);
  const helmetColor = parseRgb(o.helmetColor);
  if (!body || !helmet || !bike || !suit || !helmetColor) return null;
  return { body, bike, suit, helmet, helmetColor };
}

export function rgbCss(c: readonly number[]): string {
  return `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
}
