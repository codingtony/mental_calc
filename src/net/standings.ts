import type { RiderLook } from "../look";
import type { FinalStandings, PlayerStatus, RankInfo, ReportedStatus, TopRow } from "./protocol";

export const TOP_N = 5;
export const STANDINGS_INTERVAL_MS = 500;

/** Host-side state of one player. */
export interface PlayerState {
  id: string;
  name: string;
  /** Correct answers so far. */
  done: number;
  status: ReportedStatus;
  /** Finish / crash / last-answer time (ms from the player's local start), per `status`. */
  ms: number;
  connected: boolean;
  /** Join order: final tie-breaker so the ranking is stable. */
  order: number;
  /** Validated rider look from the join message; null = slot default. */
  look: RiderLook | null;
}

export interface Standings extends FinalStandings {
  /** Every player, best first. */
  ranked: PlayerState[];
}

const GROUP: Record<ReportedStatus, number> = { finished: 0, racing: 1, crashed: 2 };

/**
 * Ranking rules: finished by finish time; then racing by answers (desc) and last-answer time;
 * then crashed by answers (desc) and crash time (desc: survived longer = better).
 * A disconnected player keeps the rank of its last reported state.
 */
export function compareProgress(a: PlayerState, b: PlayerState): number {
  const group = GROUP[a.status] - GROUP[b.status];
  if (group !== 0) return group;
  let diff: number;
  switch (a.status) {
    case "finished":
      diff = a.ms - b.ms;
      break;
    case "racing":
      diff = b.done - a.done || a.ms - b.ms;
      break;
    case "crashed":
      diff = b.done - a.done || b.ms - a.ms;
      break;
  }
  return diff || a.order - b.order;
}

/** Status shown to others: finished/crashed are final; a dropped racer shows as disconnected. */
export function displayStatus(p: PlayerState): PlayerStatus {
  return !p.connected && p.status === "racing" ? "disconnected" : p.status;
}

export function computeStandings(players: Iterable<PlayerState>): Standings {
  const ranked = [...players].sort(compareProgress);
  const of = ranked.length;
  const ranks: Record<string, RankInfo> = {};
  ranked.forEach((p, i) => {
    ranks[p.id] = { rank: i + 1, of, done: p.done, status: displayStatus(p) };
  });
  const top: TopRow[] = ranked
    .slice(0, TOP_N)
    .map((p) => ({ name: p.name, done: p.done, status: displayStatus(p), ms: p.ms, ...(p.look ? { look: p.look } : {}) }));
  return { ranked, top, ranks };
}

/** At most one message per interval, and only when the content changed. */
export class StandingsThrottle {
  private lastSentMs = -Infinity;
  private lastKey = "";

  constructor(private readonly intervalMs = STANDINGS_INTERVAL_MS) {}

  shouldSend(nowMs: number, key: string): boolean {
    if (key === this.lastKey || nowMs - this.lastSentMs < this.intervalMs) return false;
    this.lastSentMs = nowMs;
    this.lastKey = key;
    return true;
  }

  reset(): void {
    this.lastSentMs = -Infinity;
    this.lastKey = "";
  }
}
