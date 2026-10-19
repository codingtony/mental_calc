import { parseLook, type RiderLook } from "../look";
import { randomSeed } from "../rng";
import { sceneryById } from "../sceneries";
import { clearSession, Connection, loadSession, relayUrl, saveSession } from "./connection";
import { CLOSE_KICKED, CLOSE_REPLACED } from "./protocol";
import type {
  FinalStandings,
  HostToRelay,
  PlayerToRelay,
  RankInfo,
  RelayToHost,
  RelayToPlayer,
  ReportedStatus,
  RoomSettings,
  TopRow,
} from "./protocol";
import { computeStandings, StandingsThrottle, type PlayerState, type Standings } from "./standings";

export const COUNTDOWN_MS = 3000;
const TICK_MS = 250;

export type HostPhase = "lobby" | "racing" | "ended";

/** Persisted in sessionStorage so a reload of the teacher's tab resumes the room. */
interface HostSnapshot {
  code: string;
  hostToken: string;
  settings: RoomSettings;
  phase: HostPhase;
  seed: number;
  goAt: number;
  endAt: number;
  nextOrder: number;
  players: PlayerState[];
  final: FinalStandings | null;
}

export interface HostListener {
  onChange(): void;
  /** `fatal`: the room could not be created/resumed. */
  onError(reason: string, fatal: boolean): void;
  onConnection(online: boolean): void;
}

/**
 * Teacher side. Authoritative for the standings: ranks every player from their `progress`
 * reports and pushes throttled `standings` to the relay, which personalises them per player.
 */
export class HostRoom {
  code = "";
  settings: RoomSettings;
  phase: HostPhase = "lobby";
  readonly players = new Map<string, PlayerState>();
  standings: Standings = computeStandings([]);
  /** Final standings sent with `end` (null until the race ends). */
  final: FinalStandings | null = null;
  /** Epoch ms of the race's GO and end (for the teacher's clock). */
  goAt = 0;
  endAt = 0;

  private hostToken = "";
  private seed = randomSeed();
  private nextOrder = 0;
  private created = false;
  /** Epoch-based so versions keep increasing across a reload of the host tab. */
  private v = Date.now();
  private standingsKey = "";
  private ticker = 0;
  private readonly throttle = new StandingsThrottle();
  private readonly conn: Connection<RelayToHost, HostToRelay>;

  constructor(
    settings: RoomSettings,
    private readonly listener: HostListener,
    snapshot: HostSnapshot | null = null,
  ) {
    this.settings = settings;
    if (snapshot) {
      this.code = snapshot.code;
      this.hostToken = snapshot.hostToken;
      // Snapshots from before circuits existed lack `scenery`.
      this.settings = { ...snapshot.settings, scenery: sceneryById(snapshot.settings.scenery).id };
      this.phase = snapshot.phase;
      this.seed = snapshot.seed;
      this.goAt = snapshot.goAt;
      this.endAt = snapshot.endAt;
      this.nextOrder = snapshot.nextOrder;
      this.final = snapshot.final;
      // Everyone is offline until the relay replays player_joined after the resume.
      for (const p of snapshot.players) this.players.set(p.id, { ...p, look: p.look ?? null, connected: false });
      this.standings = computeStandings(this.players.values());
      if (this.phase === "racing") this.startTicker();
    }
    this.conn = new Connection(relayUrl(), {
      onOpen: () => {
        this.conn.send(
          this.code ? { t: "create", settings: this.settings, code: this.code, hostToken: this.hostToken } : { t: "create", settings: this.settings },
        );
        this.listener.onConnection(true);
      },
      onMessage: (msg) => this.handle(msg),
      onDrop: () => {
        this.created = false;
        this.listener.onConnection(false);
      },
      onEnd: (code) => {
        this.stopTicker();
        clearSession("host");
        this.listener.onError(code === CLOSE_REPLACED ? "replaced" : "closed", true);
      },
    });
  }

  /** Resumes the room of this tab after a reload, if any. */
  static resume(listener: HostListener): HostRoom | null {
    const snapshot = loadSession<HostSnapshot>("host");
    return snapshot?.code ? new HostRoom(snapshot.settings, listener, snapshot) : null;
  }

  get joinable(): boolean {
    return this.created && this.phase === "lobby" && [...this.players.values()].some((p) => p.connected);
  }

  setSettings(settings: RoomSettings): void {
    if (this.phase !== "lobby") return;
    this.settings = settings;
    this.changed();
  }

  start(): void {
    if (!this.joinable) return;
    for (const p of this.players.values()) Object.assign(p, { done: 0, status: "racing", ms: 0 });
    this.final = null;
    this.phase = "racing";
    this.goAt = Date.now() + COUNTDOWN_MS;
    this.endAt = 0;
    this.conn.send({ t: "start", seed: this.seed, settings: this.settings, countdownMs: COUNTDOWN_MS });
    this.startTicker();
    this.changed();
  }

  kick(playerId: string): void {
    this.conn.send({ t: "kick", playerId });
    this.players.delete(playerId);
    this.changed();
  }

  end(): void {
    if (this.phase !== "racing") return;
    this.stopTicker();
    this.standings = computeStandings(this.players.values());
    this.final = { top: this.standings.top, ranks: this.standings.ranks };
    this.conn.send({ t: "end", final: this.final });
    this.phase = "ended";
    this.endAt = Date.now();
    this.changed();
  }

  /** Back to the lobby with a new question sequence; players keep their seats. */
  rematch(): void {
    if (this.phase !== "ended") return;
    this.seed = randomSeed();
    this.conn.send({ t: "rematch", seed: this.seed });
    for (const [id, p] of this.players) if (!p.connected) this.players.delete(id);
    this.phase = "lobby";
    this.final = null;
    this.standings = computeStandings(this.players.values());
    this.changed();
  }

  close(): void {
    this.stopTicker();
    this.conn.close();
    clearSession("host");
  }

  private handle(msg: RelayToHost): void {
    switch (msg.t) {
      case "created":
        this.code = msg.code;
        this.hostToken = msg.hostToken;
        this.created = true;
        break;
      case "error":
        this.listener.onError(msg.reason, !this.created);
        return;
      case "player_joined": {
        const p = this.players.get(msg.playerId);
        if (p) {
          p.connected = true;
          p.name = msg.name;
          p.look = parseLook(msg.look) ?? p.look;
        } else {
          this.players.set(msg.playerId, {
            id: msg.playerId,
            name: msg.name,
            done: 0,
            status: "racing",
            ms: 0,
            connected: true,
            order: this.nextOrder++,
            look: parseLook(msg.look),
          });
        }
        break;
      }
      case "player_left":
        if (this.phase === "lobby" || msg.reason === "kicked") this.players.delete(msg.playerId);
        else {
          const p = this.players.get(msg.playerId);
          if (p) p.connected = false;
        }
        break;
      case "progress": {
        const p = this.players.get(msg.playerId);
        // Finished/crashed is final; a stale replay must not move a racer backwards.
        if (this.phase !== "racing" || !p || p.status !== "racing" || msg.done < p.done) return;
        p.done = msg.done;
        p.status = msg.status;
        p.ms = msg.elapsedMs;
        if ([...this.players.values()].every((q) => q.status !== "racing")) {
          this.end();
          return;
        }
        this.tick();
        return;
      }
      default:
        return;
    }
    this.changed();
  }

  private startTicker(): void {
    this.stopTicker();
    this.throttle.reset();
    this.ticker = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicker(): void {
    window.clearInterval(this.ticker);
  }

  /** Recomputes the standings; sends them (throttled) and re-renders when they changed. */
  private tick(): void {
    this.standings = computeStandings(this.players.values());
    const { top, ranks } = this.standings;
    const key = JSON.stringify([top, ranks]);
    if (this.throttle.shouldSend(performance.now(), key)) this.conn.send({ t: "standings", v: ++this.v, top, ranks });
    if (key !== this.standingsKey) {
      this.standingsKey = key;
      this.changed();
    }
  }

  private changed(): void {
    if (this.phase !== "racing") this.standings = computeStandings(this.players.values());
    if (this.code) {
      const snapshot: HostSnapshot = {
        code: this.code,
        hostToken: this.hostToken,
        settings: this.settings,
        phase: this.phase,
        seed: this.seed,
        goAt: this.goAt,
        endAt: this.endAt,
        nextOrder: this.nextOrder,
        players: [...this.players.values()],
        final: this.final,
      };
      saveSession("host", snapshot);
    }
    this.listener.onChange();
  }
}

// ---------------------------------------------------------------------------

export type PlayerPhase = "joining" | "lobby" | "racing" | "ended";

interface PlayerSession {
  code: string;
  name: string;
  playerId: string;
  playerToken: string;
  /** The look sent at the first join, so a reloaded tab keeps its bike colour. */
  look?: unknown;
}

export interface RaceStart {
  seed: number;
  settings: RoomSettings;
  countdownMs: number;
}

export interface PersonalStandings {
  top: TopRow[];
  me: RankInfo;
}

export interface PlayerListener {
  /** Called after the room state was updated from `msg`. */
  onMessage(msg: RelayToPlayer): void;
  /** `fatal`: the join was refused or the seat is gone; the room is closed. */
  onError(reason: string, fatal: boolean): void;
  onConnection(online: boolean): void;
}

/** Kid side: joins with a code (or rejoins with the stored token) and reports its own progress. */
export class PlayerRoom {
  phase: PlayerPhase = "joining";
  names: string[] = [];
  settings: RoomSettings | null = null;
  start: RaceStart | null = null;
  /** Latest personalised standings (null until the host sent some for this race). */
  standings: PersonalStandings | null = null;
  final: PersonalStandings | null = null;
  playerId = "";

  private playerToken = "";
  private standingsV = -1;
  private awaitingJoin = false;
  private lastProgress: PlayerToRelay | null = null;
  private readonly conn: Connection<RelayToPlayer, PlayerToRelay>;

  constructor(
    readonly code: string,
    readonly name: string,
    /** Sent with every join; the relay keeps the first one for the seat. */
    readonly look: RiderLook,
    private readonly listener: PlayerListener,
    session: PlayerSession | null = null,
  ) {
    if (session) {
      this.playerId = session.playerId;
      this.playerToken = session.playerToken;
    }
    this.conn = new Connection(relayUrl(), {
      onOpen: () => {
        this.awaitingJoin = true;
        this.conn.send({
          t: "join",
          code,
          name,
          ...(this.playerToken ? { playerToken: this.playerToken } : {}),
          look: this.look,
        });
        this.listener.onConnection(true);
      },
      onMessage: (msg) => this.handle(msg),
      onDrop: () => this.listener.onConnection(false),
      onEnd: (code) => {
        clearSession("player");
        if (code === CLOSE_KICKED) this.listener.onMessage({ t: "kicked" });
        else this.listener.onError(code === CLOSE_REPLACED ? "replaced" : "closed", true);
      },
    });
  }

  /** Rejoins the room of this tab after a reload (same seat and look), if any; `code` must match when given. */
  static resume(listener: PlayerListener, code: string | null, look: RiderLook): PlayerRoom | null {
    const s = loadSession<PlayerSession>("player");
    if (!s?.playerToken || (code !== null && code !== s.code)) return null;
    return new PlayerRoom(s.code, s.name, parseLook(s.look) ?? look, listener, s);
  }

  sendProgress(done: number, status: ReportedStatus, elapsedMs: number): void {
    this.lastProgress = { t: "progress", done, status, elapsedMs };
    this.conn.send(this.lastProgress);
  }

  leave(): void {
    this.conn.close();
    clearSession("player");
  }

  private handle(msg: RelayToPlayer): void {
    switch (msg.t) {
      case "joined": {
        this.awaitingJoin = false;
        this.playerId = msg.playerId;
        this.playerToken = msg.playerToken;
        this.settings = msg.settings;
        const session: PlayerSession = {
          code: this.code,
          name: this.name,
          playerId: msg.playerId,
          playerToken: msg.playerToken,
          look: this.look,
        };
        saveSession("player", session);
        // A reload mid-race rejoins as a spectator of the running/ended race.
        if (this.phase === "joining") this.phase = msg.phase ?? "lobby";
        // Reports sent while the connection was down were lost.
        else if (this.lastProgress) this.conn.send(this.lastProgress);
        break;
      }
      case "error":
        if (this.awaitingJoin) this.leave();
        this.listener.onError(msg.reason, this.awaitingJoin);
        return;
      case "lobby":
        this.names = msg.names;
        break;
      case "started":
        this.phase = "racing";
        this.start = { seed: msg.seed, settings: msg.settings, countdownMs: msg.countdownMs };
        this.standings = null;
        this.final = null;
        this.standingsV = -1;
        this.lastProgress = null;
        break;
      case "standings":
        // Not part of this race (me = null): nothing personal to show.
        if (!msg.me || msg.v <= this.standingsV) return;
        this.standingsV = msg.v;
        this.standings = { top: msg.top, me: msg.me };
        break;
      case "ended":
        this.phase = "ended";
        if (msg.me) this.final = { top: msg.top, me: msg.me };
        break;
      case "rematch":
        this.phase = "lobby";
        this.start = null;
        this.standings = null;
        this.final = null;
        this.lastProgress = null;
        break;
      case "kicked":
        this.leave();
        break;
      case "closed":
        this.leave();
        this.listener.onError("closed", true);
        return;
      default:
        return;
    }
    this.listener.onMessage(msg);
  }
}
