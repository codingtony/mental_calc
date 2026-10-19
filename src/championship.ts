import { RIVALS, type CupId } from "./config";
import { SCENERIES } from "./sceneries";
import type { Scenery } from "./sceneries/types";

/** Race 1; each next race: +STEP_QUESTIONS, −STEP_SECONDS per question, never below MIN_SECONDS. Play-test values. */
export const FIRST_QUESTIONS = 25;
export const STEP_QUESTIONS = 5;
export const FIRST_SECONDS = 6;
export const STEP_SECONDS = 1;
export const MIN_SECONDS = 2;

/** Fastest rival's pace: 1st place ⇔ time ≤ goalMs × WIN_PACE (RaceSession.finalPosition). */
export const WIN_PACE = Math.min(...RIVALS.map((r) => r.paceFactor));

export interface RaceDifficulty {
  questions: number;
  secondsPerQuestion: number;
}

/** 0-based race index → 25×6 s, 30×5 s, 35×4 s, 40×3 s, 45×2 s, 50×2 s… */
export function raceDifficulty(index: number): RaceDifficulty {
  return {
    questions: FIRST_QUESTIONS + index * STEP_QUESTIONS,
    secondsPerQuestion: Math.max(MIN_SECONDS, FIRST_SECONDS - index * STEP_SECONDS),
  };
}

export interface ChampionshipRace extends RaceDifficulty {
  scenery: Scenery;
}

export function championshipRace(index: number): ChampionshipRace {
  return { ...raceDifficulty(index), scenery: SCENERIES[index] };
}

/** In memory only: a reload starts a new run at race 1. */
export interface ChampionshipRun {
  cup: CupId;
  /** Races won = 0-based index of the next race; SCENERIES.length once complete. */
  won: number;
  /** Races lost or crashed. */
  retries: number;
  /** Sum of the winning races' times. */
  elapsedMs: number;
  /** Date.now() when the run began; identifies its record. */
  startedAt: number;
}

export function newRun(cup: CupId, startedAt: number): ChampionshipRun {
  return { cup, won: 0, retries: 0, elapsedMs: 0, startedAt };
}

export function runComplete(run: ChampionshipRun): boolean {
  return run.won >= SCENERIES.length;
}

/** 1st place moves on (adding the race time); anything else counts a retry of the same race. Returns a new run. */
export function afterRace(run: ChampionshipRun, first: boolean, elapsedMs: number): ChampionshipRun {
  return first
    ? { ...run, won: run.won + 1, elapsedMs: run.elapsedMs + elapsedMs }
    : { ...run, retries: run.retries + 1 };
}

export interface ChampionshipRecord {
  name: string;
  cup: CupId;
  won: number;
  races: number;
  elapsedMs: number;
  retries: number;
  startedAt: number;
  timestamp: number;
}

export function toRecord(run: ChampionshipRun, name: string, timestamp: number): ChampionshipRecord {
  return {
    name,
    cup: run.cup,
    won: run.won,
    races: SCENERIES.length,
    elapsedMs: run.elapsedMs,
    retries: run.retries,
    startedAt: run.startedAt,
    timestamp,
  };
}

/** More races won first, then lower elapsedMs, then earlier startedAt. */
export function compareChampionshipRecords(a: ChampionshipRecord, b: ChampionshipRecord): number {
  return b.won - a.won || a.elapsedMs - b.elapsedMs || a.startedAt - b.startedAt;
}
