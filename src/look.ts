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
