# mc-relay protocol (v1)

Single source for the multiplayer messages. The client types in `2/src/net/protocol.ts` mirror
this file.

URL: `wss://mc-relay.learnsvenska.com/ws` (local: `ws://127.0.0.1:8010/ws`).
Every message is one JSON text frame with a `t` field. Unknown fields are ignored.

The teacher's tab is the **host**: it ranks the players and sends the standings. The relay only
forwards messages, fans them out and personalises the standings. The first message on a
connection decides its role: `create` (host) or `join` (player).

## Shapes

```ts
type Settings = { cup: "add" | "addsub" | "mul" | "muldiv" | "all"; n: 10 | 30 | 50 | 120;
                  difficulty: "easy" | "medium" | "hard";   // opaque to the relay, except that
                  scenery: string };                        // cup/n/difficulty feed the usage events
// scenery: circuit id from the client's `src/sceneries`; clients use their first circuit for an
// unknown or missing id.
type Status = "racing" | "finished" | "crashed" | "disconnected";
type TopRow = { name: string; done: number; status: Status; ms: number;   // ms = finish, crash or
                look?: Look };                                            // last-answer time
type Look   = { body: "girl" | "boy"; bike: Rgb; suit: Rgb; helmet: "classic" | "mirror";
                helmetColor: Rgb };   // opaque to the relay; Rgb = [r, g, b] in 0..1
type Rank   = { rank: number; of: number; done: number; status: Status };
type Phase  = "lobby" | "racing" | "ended";
```

`playerId` is 8 hex characters; `hostToken` and `playerToken` are 32 hex characters. Keep the
tokens in `sessionStorage` to reconnect.

## Host → relay

| Message | Effect |
|---|---|
| `create {settings}` | Opens a room. Reply: `created {code, hostToken, phase: "lobby"}`. |
| `create {code, hostToken}` | Resumes a room after a reload (allowed during the 2 min grace and while another host tab is connected; that tab is closed with code 4001). Reply: `created {code, hostToken, phase}`, then for every known player in join order: `player_joined {playerId, name, look?}`, followed by `player_left {playerId, reason: "disconnected"}` if offline, and the latest `progress` if `phase` is `racing`. Errors: `not_found`, `bad_token`. |
| `start {seed, settings, countdownMs}` | Only in `lobby`. `settings` replaces the room settings. Every connected player gets `started {seed, settings, countdownMs}`; from then on new players are rejected (`started`). |
| `standings {v, top: TopRow[5], ranks: {[playerId]: Rank}}` | Only in `racing`. Throttle ≤ 2/s. Each racing player gets `standings {v, top, me}` with `me = ranks[playerId]` (or `null`). `top` rows (with their optional `look`, built by the host from `player_joined`) are passed through unchanged. |
| `end {final: {top, ranks}}` | Only in `racing`. Phase → `ended`. Each player gets `ended {top, me}`. |
| `kick {playerId}` | Player gets `kicked {}` and is closed with code 4000; its token is forgotten. Host gets `player_left {playerId, reason: "kicked"}`. Unknown ids are ignored. |
| `rematch {seed}` | Only in `racing` or `ended`. Phase → `lobby`, joins are open again, players keep their ids and tokens. Players get `rematch {}` and a `lobby` update. The host then sends `start` (the relay does not use `seed` here). |

## Player → relay

| Message | Effect |
|---|---|
| `join {code, name, playerToken?, look?}` | `code` is case-insensitive. `name` is trimmed, control characters are stripped and it is cut to 32 characters. `look` (optional `Look`) is opaque: kept if it is a JSON object of at most 512 bytes and forwarded to the host in `player_joined`; anything else is dropped and the join still succeeds. Reply: `joined {playerId, playerToken, settings, phase, seed?}` (`seed` when `phase` ≠ `lobby`). A known `playerToken` reconnects the same player (also mid-race, if the player was in the race) and keeps the original name and look; an unknown token is ignored (fresh join). After a reconnect the player also gets the latest personal `standings` (racing) or `ended` (ended). If the token is already connected elsewhere, that socket is closed with code 4001. Errors: `not_found`, `full`, `started`, `bad_name`, `name_taken` (another connected player in the room already uses this name, case-insensitive). |
| `progress {done, status, elapsedMs}` | Send on every correct answer, crash and finish. `status`: `racing \| finished \| crashed`; `elapsedMs` from the local start (end of the countdown). Forwarded to the host as `progress {playerId, done, status, elapsedMs}`. Silently dropped outside `racing` or from a player not in the race. |

## Relay → host

- `created {code, hostToken, phase}`
- `player_joined {playerId, name, reconnect?: true, look?: Look}` (`look` as sent in the fresh join, unvalidated beyond
  "object ≤ 512 bytes": the host must validate it)
- `player_left {playerId, reason: "disconnected" | "kicked"}`. A disconnected player can come back with
  its token; the host keeps its last state.
- `progress {playerId, done, status, elapsedMs}`

## Relay → player

- `joined {…}` (above)
- `lobby {names: string[]}`: connected players in join order, sent to every player on each join,
  leave or kick while the room is in `lobby` (and after `rematch`).
- `started {seed, settings, countdownMs}`
- `standings {v, top, me: Rank | null}`
- `ended {top, me: Rank | null}`
- `rematch {}`
- `kicked {}`

## Both directions

- `error {reason}`: `not_found`, `full`, `started`, `bad_name`, `name_taken` (another connected player in
  the room already uses this name, case-insensitive), `bad_token`, `bad_request` (unparseable,
  unknown or wrong-role message), `not_allowed` (valid message in the wrong phase), `rate_limited`.
  Except for `rate_limited`, the socket stays open; a failed `create`/`join` can be retried.
- `closed {reason: "host_gone" | "idle" | "shutdown"}`: sent to everyone in the room right before the
  relay closes the socket with code 4002.
- `ping` / `pong`: send `{"t":"ping"}` every 25 s; the relay answers `{"t":"pong"}`. The relay also
  sends `{"t":"ping"}` every 25 s; answer `{"t":"pong"}`. A socket silent for 75 s is dropped.

WebSocket close codes: 4000 kicked, 4001 replaced by a newer connection with the same token,
4002 room closed, 1008 rate limited, 1009 message too big.

## Rules and limits

- Room code: 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
- A room has 1 host and up to `MAX_PLAYERS` (default 60) connected players (`full` beyond that).
- The room closes 2 minutes after the host disconnects (`host_gone`) unless the host resumes, and
  after 2 hours without any message (`idle`). Everything is in memory; a relay restart closes all
  rooms.
- 8 KiB per message (a 60-player `standings` is about 4 KiB, up to 5 KiB with 32-character names),
  20 messages/s per connection.
- The upgrade is refused with 403 unless `Origin` is absent or matches `ALLOWED_ORIGINS`.

## Ranking (done by the host)

1. `finished`, by `finishMs` ascending.
2. `racing`, by `done` descending, then `lastAnswerMs` ascending.
3. `crashed`, by `done` descending, then `crashMs` descending.
4. `disconnected` keeps its last state and rank position until the end of the race.

## Operations

Configuration (env, flags override): `LISTEN` (`127.0.0.1:8010`), `ALLOWED_ORIGINS`
(comma-separated host patterns, default `maths.codingtony.com,localhost:5173,localhost:4173`),
`MAX_PLAYERS` (60), `EVENTS_PATH` (`/var/log/mc-relay/events.jsonl`, empty disables),
`STATS_TOKEN` (env only).

- `GET /healthz` → `200 ok`.
- `GET /stats?days=30` (`days` clamped to 1–60) with `Authorization: Bearer $STATS_TOKEN` → JSON:
  `{days, since, rooms, races, players: {sum, avg}, room_duration_s: {median, p90},
  race_duration_s: {median, p90}, races_per_cup, races_per_n, live: {connections, rooms}}` (`players`
  sums/averages the `max_players` of each room; quantiles use the nearest-rank method; `live` is the
  state at request time, not from the events: open WebSocket connections and rooms in memory, so
  0/0 means a restart drops nobody). 404 when `STATS_TOKEN` is empty, 401 when the token is missing
  or wrong. Reads `EVENTS_PATH` and `EVENTS_PATH.1`.
- Logs: JSON lines on stderr (room created/closed, joins with client IP from `CF-Connecting-IP`
  and User-Agent, errors). Player names are never logged.
- Usage events, one JSON line each in `EVENTS_PATH` (no join code, no names):
  - `{"event":"room_closed","ts","room_id","opened_at","duration_s","races","max_players","total_joins","reconnects","close_reason"}`
  - `{"event":"race_ended","ts","room_id","race_no","players","n","cup","difficulty","duration_s","finished","crashed","dnf","ended_by"}`
    with `ended_by`: `all_done`, `host` (End clicked with players still racing), `rematch`, `closed`.

Tests: `go test ./...`. Smoke against a running relay:
`RELAY_URL=ws://127.0.0.1:8010/ws go test -run TestSmoke60Players -v .`

Scenario simulator (a fixed suite of 60 replayable scenarios, normal and edge cases, against any
relay URL, production included): `go run ./cmd/relaysim -url ws://127.0.0.1:8010/ws`. Replay one
scenario with `-seed S -only name#i`. Flags and scenarios: `cmd/relaysim/README.md`.

Race bots (fill a room hosted in a browser with simulated players, to try the host screen):
host a race in the browser, then `go run ./cmd/racebots -code CODE` (60 players by default; bots 41+
reuse names, so they show the `name_taken` retry as "Ebba A"). Flags: `go run ./cmd/racebots -h`.
