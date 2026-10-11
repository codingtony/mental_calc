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

export const MAX_ERRORS = 3; // the 4th wrong submission crashes
export const CREEP_CAP = 0.9; // see RaceSession.playerProgress
export const TARGET_SPEED = 30; // world units/s, used to pick lap count

export const PLAYER_COLOR: [number, number, number] = [0.9, 0.05, 0.1];

// paceFactor × timePerQuestion = rival seconds per question.
// "Max Plus" runs exactly at goal pace: meeting the goal ⇔ finishing top 3.
export const RIVALS = [
  { name: "Turbo Tina", color: [1, 0.85, 0.1], paceFactor: 0.8 },
  { name: "Dr. Divide", color: [0.6, 0.3, 0.9], paceFactor: 0.9 },
  { name: "Max Plus", color: [0.2, 0.8, 0.3], paceFactor: 1.0 },
  { name: "Minus Mia", color: [0.2, 0.5, 1], paceFactor: 1.1 },
  { name: "Captain Carry", color: [1, 0.55, 0.1], paceFactor: 1.2 },
  { name: "Zippy Zero", color: [1, 0.4, 0.7], paceFactor: 1.35 },
  { name: "Professor Pi", color: [0.2, 0.9, 0.9], paceFactor: 1.5 },
] as const;

export const LANE_OFFSETS = [0.9, -0.9, 2.7, -2.7, 4.5, -4.5, 6.3, -6.3]; // [player, rival0..6]
