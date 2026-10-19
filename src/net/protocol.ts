// Message types of the relay protocol v1. Mirrors relay/PROTOCOL.md (the single source):
// change both together. Every message is a JSON object with a `t` field.
import type { Category, CupId, Difficulty } from "../config";
import type { RiderLook } from "../look";
import type { SceneryId } from "../sceneries/types";

export interface RoomSettings {
  cup: CupId;
  n: Category;
  difficulty: Difficulty;
  /** Circuit; untrusted from the relay: resolve with sceneryById. */
  scenery: SceneryId;
}

/** Status a player reports about itself. */
export type ReportedStatus = "racing" | "finished" | "crashed";
/** Status in standings: the host adds `disconnected`. */
export type PlayerStatus = ReportedStatus | "disconnected";

export interface TopRow {
  name: string;
  done: number;
  status: PlayerStatus;
  /** Finish / crash / last-answer time (ms from the player's local start) used for ranking. */
  ms: number;
  /** Rider appearance, when the player sent one (else the client picks a default). */
  look?: RiderLook;
}

export interface RankInfo {
  rank: number;
  of: number;
  done: number;
  status: PlayerStatus;
}

export interface FinalStandings {
  top: TopRow[];
  ranks: Record<string, RankInfo>;
}

export type Ping = { t: "ping" } | { t: "pong" };

export type RoomPhase = "lobby" | "racing" | "ended";

/** Machine-readable `error.reason` values sent by the relay. */
export type ErrorReason =
  | "not_found"
  | "full"
  | "started"
  | "bad_name"
  | "name_taken"
  | "bad_token"
  | "rate_limited"
  | "bad_request"
  | "not_allowed";

/** WebSocket close codes after which the client must not reconnect. */
export const CLOSE_KICKED = 4000;
export const CLOSE_REPLACED = 4001;
export const CLOSE_ROOM_CLOSED = 4002;

// ---------- Host → relay ----------

export type HostToRelay =
  /** `code` + `hostToken` resume an existing room (host tab reload). */
  | { t: "create"; settings: RoomSettings; code?: string; hostToken?: string }
  | { t: "start"; seed: number; settings: RoomSettings; countdownMs: number }
  | { t: "standings"; v: number; top: TopRow[]; ranks: Record<string, RankInfo> }
  | { t: "end"; final: FinalStandings }
  | { t: "kick"; playerId: string }
  | { t: "rematch"; seed: number }
  | Ping;

// ---------- Relay → host ----------

export type RelayToHost =
  | { t: "created"; code: string; hostToken: string; phase?: RoomPhase }
  /** `look` is the player's opaque join `look`, forwarded unvalidated: parse before use. */
  | { t: "player_joined"; playerId: string; name: string; reconnect?: boolean; look?: unknown }
  | { t: "player_left"; playerId: string; reason?: "disconnected" | "kicked" }
  | { t: "progress"; playerId: string; done: number; status: ReportedStatus; elapsedMs: number }
  | { t: "error"; reason: ErrorReason }
  | Ping;

// ---------- Player → relay ----------

export type PlayerToRelay =
  | { t: "join"; code: string; name: string; playerToken?: string; look?: RiderLook }
  | { t: "progress"; done: number; status: ReportedStatus; elapsedMs: number }
  | Ping;

// ---------- Relay → player ----------

export type RelayToPlayer =
  | { t: "joined"; playerId: string; playerToken: string; settings: RoomSettings; phase?: RoomPhase; seed?: number }
  | { t: "error"; reason: ErrorReason }
  | { t: "lobby"; names: string[] }
  | { t: "started"; seed: number; settings: RoomSettings; countdownMs: number }
  /** `me` is null for a connection that is not part of the race. */
  | { t: "standings"; v: number; top: TopRow[]; me: RankInfo | null }
  | { t: "ended"; top: TopRow[]; me: RankInfo | null }
  | { t: "rematch" }
  | { t: "kicked" }
  | { t: "closed"; reason: "host_gone" | "idle" | "shutdown" }
  | Ping;
