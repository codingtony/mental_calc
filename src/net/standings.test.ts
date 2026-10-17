import { describe, expect, it } from "vitest";
import type { RiderLook } from "../look";
import { computeStandings, StandingsThrottle, type PlayerState } from "./standings";

let order = 0;
function player(id: string, p: Partial<PlayerState>): PlayerState {
  return { id, name: id, done: 0, status: "racing", ms: 0, connected: true, order: order++, ...p, look: p.look ?? null };
}

const ids = (players: PlayerState[]) => computeStandings(players).ranked.map((p) => p.id);

describe("computeStandings", () => {
  it("orders finished before racing before crashed", () => {
    expect(
      ids([
        player("crashed", { status: "crashed", done: 19, ms: 50_000 }),
        player("racing", { done: 3, ms: 9_000 }),
        player("finished", { status: "finished", done: 20, ms: 90_000 }),
      ]),
    ).toEqual(["finished", "racing", "crashed"]);
  });

  it("orders finished players by finish time", () => {
    expect(
      ids([
        player("slow", { status: "finished", done: 20, ms: 80_000 }),
        player("fast", { status: "finished", done: 20, ms: 60_000 }),
      ]),
    ).toEqual(["fast", "slow"]);
  });

  it("orders racers by answers, then by who reached them first", () => {
    expect(
      ids([
        player("late", { done: 7, ms: 30_000 }),
        player("behind", { done: 6, ms: 10_000 }),
        player("early", { done: 7, ms: 25_000 }),
      ]),
    ).toEqual(["early", "late", "behind"]);
  });

  it("orders crashed players by answers, then by who survived longer", () => {
    expect(
      ids([
        player("short", { status: "crashed", done: 5, ms: 20_000 }),
        player("long", { status: "crashed", done: 5, ms: 40_000 }),
        player("more", { status: "crashed", done: 8, ms: 10_000 }),
      ]),
    ).toEqual(["more", "long", "short"]);
  });

  it("breaks exact ties by join order", () => {
    expect(ids([player("first", {}), player("second", {})])).toEqual(["first", "second"]);
    expect(
      ids([
        player("a", { status: "finished", done: 10, ms: 5000 }),
        player("b", { status: "finished", done: 10, ms: 5000 }),
      ]),
    ).toEqual(["a", "b"]);
  });

  it("keeps a disconnected racer's rank and marks it disconnected", () => {
    const s = computeStandings([
      player("gone", { done: 9, ms: 30_000, connected: false }),
      player("here", { done: 4, ms: 20_000 }),
      player("gone-finished", { status: "finished", done: 10, ms: 40_000, connected: false }),
    ]);
    expect(s.ranked.map((p) => p.id)).toEqual(["gone-finished", "gone", "here"]);
    expect(s.ranks.gone).toEqual({ rank: 2, of: 3, done: 9, status: "disconnected" });
    expect(s.ranks["gone-finished"].status).toBe("finished");
  });

  it("sends the top 5 rows and a rank for everyone", () => {
    const players = Array.from({ length: 8 }, (_, i) => player(`p${i}`, { done: i, ms: 1000 * i }));
    const s = computeStandings(players);
    expect(s.top.map((r) => r.name)).toEqual(["p7", "p6", "p5", "p4", "p3"]);
    expect(s.top[0]).toEqual({ name: "p7", done: 7, status: "racing", ms: 7000 });
    expect(Object.keys(s.ranks)).toHaveLength(8);
    expect(s.ranks.p0).toEqual({ rank: 8, of: 8, done: 0, status: "racing" });
  });

  it("carries a known look in top rows and omits it otherwise", () => {
    const look: RiderLook = { body: "boy", bike: [0, 0, 1], suit: [0, 0, 1], helmet: "mirror", helmetColor: [1, 1, 0] };
    const s = computeStandings([player("styled", { done: 2, look }), player("plain", { done: 1 })]);
    expect(s.top[0].look).toEqual(look);
    expect("look" in s.top[1]).toBe(false);
  });
});

describe("StandingsThrottle", () => {
  it("sends at most once per interval and only on change", () => {
    const th = new StandingsThrottle(500);
    expect(th.shouldSend(0, "a")).toBe(true);
    expect(th.shouldSend(100, "b")).toBe(false); // too soon
    expect(th.shouldSend(600, "a")).toBe(false); // unchanged
    expect(th.shouldSend(600, "b")).toBe(true);
    expect(th.shouldSend(1099, "c")).toBe(false);
    expect(th.shouldSend(1100, "c")).toBe(true);
  });
});
