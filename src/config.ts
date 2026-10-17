import type { HelmetId, RiderBody, RiderLook, Rgb } from "./look";

export const CATEGORIES = [10, 30, 50, 120] as const; // questions per race; 10 = quick/testing
export type Category = (typeof CATEGORIES)[number];

export const DIFFICULTIES = { easy: 10, medium: 5, hard: 3 } as const; // seconds per question
export type Difficulty = keyof typeof DIFFICULTIES;

export type CupId = "add" | "addsub" | "mul" | "muldiv" | "all";
export interface Cup {
  id: CupId;
  mode: number;
  icon: string;
  color: string;
}
export const CUPS: readonly Cup[] = [
  { id: "add", mode: 1, icon: "+", color: "#ffd200" },
  { id: "addsub", mode: 3, icon: "+ −", color: "#43b047" },
  { id: "mul", mode: 4, icon: "×", color: "#e4000f" },
  { id: "muldiv", mode: 12, icon: "× ÷", color: "#0094ff" },
  { id: "all", mode: 15, icon: "★", color: "rainbow" }, // "rainbow" → CSS gradient in ui
];

export const LIVES = 3; // hearts; each wrong answer costs one, losing the last one crashes
export const CREEP_CAP = 0.9; // see RaceSession.playerProgress
export const TARGET_SPEED = 30; // world units/s, used to pick lap count

export interface Rival {
  name: string;
  look: RiderLook;
  paceFactor: number;
}

function rival(name: string, body: RiderBody, color: Rgb, helmet: HelmetId, helmetColor: Rgb, paceFactor: number): Rival {
  return { name, look: { body, bike: color, suit: color, helmet, helmetColor }, paceFactor };
}

// paceFactor × timePerQuestion = rival seconds per question.
// "Max Plus" runs exactly at goal pace: meeting the goal ⇔ finishing top 3.
export const RIVALS: readonly Rival[] = [
  rival("Turbo Tina", "girl", [1, 0.85, 0.1], "mirror", [0.1, 0.1, 0.1], 0.8),
  rival("Dr. Divide", "boy", [0.6, 0.3, 0.9], "classic", [1, 1, 1], 0.9),
  rival("Max Plus", "boy", [0.2, 0.8, 0.3], "classic", [0.2, 0.8, 0.3], 1.0),
  rival("Minus Mia", "girl", [0.2, 0.5, 1], "mirror", [1, 1, 1], 1.1),
  rival("Captain Carry", "boy", [1, 0.55, 0.1], "classic", [0.1, 0.1, 0.1], 1.2),
  rival("Zippy Zero", "girl", [1, 0.4, 0.7], "classic", [1, 1, 1], 1.35),
  rival("Professor Pi", "boy", [0.2, 0.9, 0.9], "mirror", [0.2, 0.9, 0.9], 1.5),
];

export const LANE_OFFSETS = [0.9, -0.9, 2.7, -2.7, 4.5, -4.5, 6.3, -6.3]; // [player, rival0..6]
