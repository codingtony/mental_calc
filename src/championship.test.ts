import { describe, expect, it } from "vitest";
import {
  afterRace,
  compareChampionshipRecords,
  newRun,
  raceDifficulty,
  runComplete,
  type ChampionshipRecord,
} from "./championship";
import { SCENERIES } from "./sceneries";

describe("raceDifficulty", () => {
  it("starts at 25 questions × 6 s", () => {
    expect(raceDifficulty(0)).toEqual({ questions: 25, secondsPerQuestion: 6 });
  });

  it("adds 5 questions per race and lowers the time down to a 2 s floor", () => {
    for (let i = 1; i <= 20; i++) {
      const prev = raceDifficulty(i - 1);
      const cur = raceDifficulty(i);
      expect(cur.questions - prev.questions).toBe(5);
      expect(cur.secondsPerQuestion).toBeLessThanOrEqual(prev.secondsPerQuestion);
      expect(cur.secondsPerQuestion).toBeGreaterThanOrEqual(2);
      if (i >= 4) expect(cur.secondsPerQuestion).toBe(2);
    }
  });
});

describe("championship run", () => {
  it("retries the same race unless the player finishes 1st", () => {
    const run = afterRace(newRun("add", 1), true, 60_000);
    const lost = afterRace(run, false, 30_000);
    expect(lost).toMatchObject({ won: 1, elapsedMs: 60_000, retries: 1 });
    expect(afterRace(lost, true, 50_000)).toMatchObject({ won: 2, elapsedMs: 110_000, retries: 1 });
  });

  it("completes after one win per scenery", () => {
    let run = newRun("mul", 1);
    for (let i = 0; i < SCENERIES.length; i++) {
      expect(runComplete(run)).toBe(false);
      run = afterRace(run, true, 1000);
    }
    expect(runComplete(run)).toBe(true);
  });
});

describe("compareChampionshipRecords", () => {
  const rec = (won: number, elapsedMs: number, startedAt: number): ChampionshipRecord => ({
    name: "x",
    cup: "add",
    won,
    races: 3,
    elapsedMs,
    retries: 0,
    startedAt,
    timestamp: 0,
  });

  it("ranks by races won, then lower time, then earlier start", () => {
    const oneFast = rec(1, 10_000, 1);
    const twoSlow = rec(2, 99_000, 2);
    const twoFast = rec(2, 50_000, 3);
    const twoFastLater = rec(2, 50_000, 4);
    const sorted = [oneFast, twoFastLater, twoSlow, twoFast].sort(compareChampionshipRecords);
    expect(sorted).toEqual([twoFast, twoFastLater, twoSlow, oneFast]);
  });
});
