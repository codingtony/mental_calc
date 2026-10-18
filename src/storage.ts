import { CATEGORIES, CUPS, DIFFICULTIES, type Category, type CupId, type Difficulty } from "./config";
import { LANGS, type Lang } from "./i18n";
import { parseLook, type RiderLook } from "./look";

// Prefixed keys: v1 (served at /1/) shares this origin and owns "highscore", "name", etc.
const PREFS_KEY = "mcgp.prefs";
const GAMES_KEY = "mcgp.games";
const MAX_GAMES = 200;

export interface Prefs {
  name: string;
  lang: Lang;
  category: Category;
  difficulty: Difficulty;
  music: boolean;
  sound: boolean;
  /** Rider look bought in the shop; null = default rider. */
  look: RiderLook | null;
}

export interface GameRecord {
  name: string;
  category: Category;
  cup: CupId;
  difficulty: Difficulty;
  timePerQuestion: number;
  elapsedMs: number;
  answered: number;
  errors: number;
  position: number | null;
  crashed: boolean;
  won: boolean;
  score: number;
  timestamp: number;
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

/** Each field falls back to its default independently when missing or invalid. */
export function loadPrefs(): Prefs {
  const raw = readJson(PREFS_KEY);
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name : "";
  return {
    // v1's name (same origin) prefills the first visit; read only.
    name: name !== "" ? name : (localStorage.getItem("name") ?? ""),
    lang: LANGS.includes(p.lang as Lang) ? (p.lang as Lang) : "sv",
    category: CATEGORIES.includes(p.category as Category) ? (p.category as Category) : 30,
    difficulty: typeof p.difficulty === "string" && p.difficulty in DIFFICULTIES ? (p.difficulty as Difficulty) : "medium",
    music: typeof p.music === "boolean" ? p.music : false,
    sound: typeof p.sound === "boolean" ? p.sound : false,
    look: parseLook(p.look),
  };
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export interface AudioPrefs {
  music: boolean;
  sound: boolean;
}

/** `?audio=` bitmask: 1 = sound effects, 2 = music (0 none, 3 all). Anything else → null (ignored). */
export function parseAudioParam(value: string | null): AudioPrefs | null {
  if (value === null || !/^[0-3]$/.test(value)) return null;
  const v = Number(value);
  return { sound: (v & 1) !== 0, music: (v & 2) !== 0 };
}

function loadGames(): GameRecord[] {
  const raw = readJson(GAMES_KEY);
  return Array.isArray(raw) ? (raw as GameRecord[]) : [];
}

/** v1 Score.valueOf (game.js): questions per second-per-question, weighted by success ratio. */
export function computeScore(numQuestions: number, elapsedMs: number, errors: number): number {
  const spq = elapsedMs / 1000 / numQuestions;
  return Math.round(((numQuestions * 100) / spq) * (1 - errors / numQuestions));
}

export function addGame(record: GameRecord): void {
  const games = loadGames();
  games.push(record);
  localStorage.setItem(GAMES_KEY, JSON.stringify(games.slice(-MAX_GAMES)));
}

export function lastGames(limit = 10): GameRecord[] {
  return loadGames().reverse().slice(0, limit);
}

export function highScores(category: Category, cup: CupId, difficulty: Difficulty, limit = 10): GameRecord[] {
  return loadGames()
    .filter((g) => !g.crashed && g.category === category && g.cup === cup && g.difficulty === difficulty)
    .sort((a, b) => b.score - a.score || a.timestamp - b.timestamp)
    .slice(0, limit);
}

export function bestFor(category: Category, cup: CupId, difficulty: Difficulty): GameRecord | undefined {
  return highScores(category, cup, difficulty, 1)[0];
}

export function cupById(id: CupId) {
  return CUPS.find((c) => c.id === id)!;
}
