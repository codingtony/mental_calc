# Multiplayer race plan (v2)

The teacher opens a room and gets a code. Up to 30 kids join with that code and race to N questions on
the same question sequence. Each kid sees the top 5 plus their own progress. The teacher's projected
screen shows everyone.

## Decisions

| Topic | Decision |
|---|---|
| Transport | WebSocket relay. No WebRTC, so no TURN server and no exposure to Wi-Fi client isolation. |
| Server | A small Go process (`relay/`) on the existing swedish-learning VPS, behind nginx. |
| Authority | The teacher's tab is the host: it builds the standings. The relay only forwards and fans out. |
| State | In memory only. A relay restart kills the open rooms, which is acceptable. |
| Format | Always a race to N questions (N = the existing `CATEGORIES`: 10/30/50/120). |
| Wrong answers | Same as solo: retry until correct; the 4th wrong answer crashes (`MAX_ERRORS`). |
| Visibility | Players see the top 5 plus their own rank and progress. The teacher sees all lanes and the full podium. |
| Capacity | 30 players per room (configurable), plus the host. |
| Domain | `mc-relay.learnsvenska.com`: proxied Cloudflare record in the existing `learnsvenska.com` zone. The Hetzner firewall only admits Cloudflare on 80/443, so the relay must sit behind Cloudflare too. |

## Ranking

1. `finished`, ordered by `finishMs` ascending.
2. `racing`, ordered by `done` descending, then `lastAnswerMs` ascending.
3. `crashed`, ordered by `done` descending, then `crashMs` descending (survived longer = better).
4. `disconnected` keeps its last state and rank position until the end of the race.

Each device measures its own times from its local start (`performance.now()` at the end of the
countdown), so network lag doesn't affect the ranking.

## Repository layout

```
mental_calc/
├── 2/src/net/            # NEW client: protocol types, connection, room state
├── relay/                # NEW Go module (WebSocket relay)
├── docs/relay-protocol.md  # NEW, shared contract (or kept in relay/README.md)
└── .github/workflows/
    ├── sync-to-s3.yml    # add paths-ignore: relay/**
    └── relay-release.yml # NEW: tag relay-v* → linux/amd64 binary + sha256 → GitHub Release

swedish-learning/infra/
├── terraform/            # + cloudflare_dns_record mc_relay / mc_relay_ipv6 (proxied)
└── ansible/roles/mc_relay/  # NEW: user, binary download, systemd, nginx vhost, certificate
```

## Protocol (JSON over WebSocket, v1)

URL: `wss://mc-relay.learnsvenska.com/ws`. Every message has a `t` field.

Host → relay
- `create {settings}` → `created {code, hostToken}`
- `start {seed, settings, countdownMs}`; the relay rejects joins from then on
- `standings {v, top[5], ranks{playerId: {rank, of, done, status}}}`, throttled by the host to ≤ 2/s
- `end {final}`, `kick {playerId}`, `rematch {seed}`

Player → relay
- `join {code, name, playerToken?}` → `joined {playerId, playerToken, settings}` or `error {reason}`
- `progress {done, status, elapsedMs}`, sent on every correct answer, crash and finish

Relay → host: `player_joined`, `player_left`, `progress` (with `playerId` added)
Relay → each player: `started`, a personal `standings {v, top, me}`, `ended`, `kicked`
Both directions: `ping`/`pong` every 25 s (Cloudflare and nginx close idle connections).

## Phase 1: Relay (Go, `mental_calc/relay`)

1. Module setup: Go 1.23 (same as the VPS toolchain), `github.com/coder/websocket`, standard library otherwise.
2. `Hub` holding `map[code]*Room`. Each room has its own goroutine and a channel for its messages,
   so no locks are spread through the handlers.
3. Room codes: 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, checked against live rooms for
   collisions.
4. Routing: player → host forward; host `standings` → per-player messages (top + `ranks[id]`);
   host broadcasts.
5. Lifecycle: the room closes 2 minutes after the host disconnects (the grace period lets the teacher
   reload the tab and rejoin with `hostToken`). Idle TTL is 2 h. A player reconnects through
   `playerToken`.
6. Limits: 31 connections per room, 4 KiB per message, 20 messages/s per connection, 32-character
   names (trimmed, control characters stripped).
   Cross-origin: WebSockets bypass CORS (no preflight, no `Access-Control-*`), so the relay checks
   `Origin` itself during the upgrade. `coder/websocket` rejects cross-origin upgrades by default;
   set `AcceptOptions.OriginPatterns` from `ALLOWED_ORIGINS` (host patterns: `maths.codingtony.com`,
   `localhost:5173`, `localhost:4173` for `vite preview`). Other websites get 403. Non-browser clients
   can fake `Origin`; that is accepted (rate limits and room codes still apply).
   `/healthz` and `/stats` send no CORS headers: they are for curl, and browsers on other sites
   cannot read them.
7. Config through env/flags: `LISTEN=127.0.0.1:8010`, `ALLOWED_ORIGINS`, `MAX_PLAYERS`,
   `EVENTS_PATH=/var/log/mc-relay/events.jsonl`, `STATS_TOKEN`.
8. `GET /healthz`, plus structured logs (room created/closed, joins, errors). Player names are never
   logged. Join/connect lines include the client IP (from `CF-Connecting-IP`, forwarded by nginx;
   `$remote_addr` is a Cloudflare edge) and the User-Agent, for troubleshooting.
9. Usage events, appended as JSON lines to `EVENTS_PATH` (never the join code, never names):
   - `room_closed {room_id (random), opened_at, duration_s, races, max_players, total_joins,
     reconnects, close_reason}`
   - `race_ended {room_id, race_no, players, n, cup, difficulty, duration_s, finished, crashed,
     dnf, ended_by}`
10. `GET /stats?days=30` → totals over the window: rooms, races, players (sum and average of
    `max_players`), median and p90 room/race duration, races per cup and per N. Computed by reading
    `EVENTS_PATH` (small file). Requires `Authorization: Bearer <STATS_TOKEN>`, compared with
    `crypto/subtle.ConstantTimeCompare`; 404 when `STATS_TOKEN` is empty, 401 when wrong.
11. Tests: `room_test.go` covers routing, join rejection after start, capacity limit, reconnect by
    token, host grace timeout, and personalised standings; `stats_test.go` covers a closed room
    producing exactly one `room_closed` line, aggregation over a fixture file, and the 401/404 cases.

Done when `go test ./...` passes and a local smoke run (1 host and 30 scripted players through
`websocat` or a Go test client) shows each player receiving only their own `me`.

## Phase 2: Client (`mental_calc/2/src`)

1. **Seeded questions**: `pickQuestions(bank, n, rng)` takes a seeded PRNG (mulberry32). Solo mode
   passes a random seed, so its behaviour doesn't change.
2. `net/protocol.ts`: message types matching `relay-protocol.md`.
3. `net/connection.ts`: WebSocket wrapper with `send`/`onMessage`, reconnect with backoff,
   ping, and `playerToken`/`hostToken` in `sessionStorage`.
4. `net/standings.ts`: host-side ranking (the rules above) and the throttle (≤ 1 message per 500 ms,
   only when something changed). This is a pure function and gets a unit test for the ranking edge
   cases (finished/crashed/tie order).
5. Screens (`ui.ts`, `i18n.ts`):
   - Intro: "Host a race" / "Join a race".
   - Host lobby: code in large type plus a QR code of `https://maths.codingtony.com/2/?room=CODE`,
     player list with a kick button, cup/N/difficulty settings, Start button.
   - Join: code (prefilled from `?room=`) and a name.
   - Player waiting room: "Waiting for teacher…" and the list of joined names.
6. Race for players: reuse `RaceSession` and `world.ts`. The 7 AI rivals are replaced by the
   current top-5 players as karts (positioned from `done`, interpolated between updates).
   The HUD shows "You: 9/20 · 7th of 28".
7. Teacher view: no answer input. A 2D lane board for all players (projectable), a
   finished/crashed counter, and an End button.
8. Results: player sees their rank, time and the top 5. Host sees the full podium and a Rematch
   button (new seed, same room).
9. Multiplayer games never touch the local high scores: `addGame` is not called in multiplayer mode,
   and the results screen hides the "best" and high-score panels.

Done when two browsers plus one host on the deployed relay complete a race, and a rematch works
without anyone re-entering the code.

## Phase 3: Infrastructure (swedish-learning/infra)

1. DNS (Terraform, `terraform/main.tf`): `cloudflare_dns_record.mc_relay` (A) and `mc_relay_ipv6`
   (AAAA), `name = "mc-relay"`, content from `hcloud_server.app`, `proxied = true`, same shape as
   `apex`/`apex_ipv6`. No firewall change. Apply before step 2 so the LE HTTP-01 challenge resolves.
2. Ansible role `mc_relay`:
   - `mc-relay` system user, `/opt/mc-relay/bin/relay`.
   - Download the pinned Release asset (`mc_relay_version`), verify its sha256, and restart
     through a handler.
   - systemd unit: `Restart=on-failure`, `MemoryMax=64M`, `NoNewPrivileges`, `ProtectSystem=strict`,
     `DynamicUser` or the dedicated user.
   - nginx server block for `mc-relay.learnsvenska.com`: `/ws` with `Upgrade`/`Connection`
     headers, `proxy_read_timeout 1h`, `limit_req` on the handshake, and `/healthz`.
   - Certificate: add `mc-relay.learnsvenska.com` to `nginx_tls_subject_alt_names` (existing certbot
     webroot flow), or use its own server block with a separate cert name; keep the SSL mode used
     by the apex.
3. Stats token (Terraform → Ansible, the same path as `ansible_ssh_host` today):
   - `random_password.mc_relay_stats_token` (`length = 40`, `special = false`), adding
     `hashicorp/random` to `versions.tf`; `output "mc_relay_stats_token" { sensitive = true }`.
   - `Makefile` deploy target: `-e mc_relay_stats_token=$$(terraform output -raw mc_relay_stats_token)`,
     next to the existing `terraform output` reads.
   - Role: `STATS_TOKEN` in `/opt/mc-relay/relay.env` (mode 0600, owner `mc-relay`), task with
     `no_log: true`; the systemd unit reads it via `EnvironmentFile=`.
   - Read it yourself with `terraform output -raw mc_relay_stats_token`. Rotate with
     `terraform apply -replace=random_password.mc_relay_stats_token` and a redeploy.
4. Logs: `/var/log/mc-relay/` owned by `mc-relay`, the unit gets `ReadWritePaths=` for it (needed with
   `ProtectSystem=strict`); add a logrotate entry in the existing `logrotate` role (monthly,
   12 rotations). nginx vhost: log `$http_cf_connecting_ip` instead of `$remote_addr`.
5. Add the role to `site.yml` after `nginx`, so the vhost exists before the certificate is issued.
   It must not restart any `swedish-learning-*` unit.
6. Cloudflare: WebSockets are on by default in the zone. Keep the 25 s ping (Cloudflare drops
   idle WebSockets after ~100 s). Make sure the `auth_rate_limit` ruleset doesn't match `/ws`.

Done when `curl https://mc-relay.learnsvenska.com/healthz` returns 200, `websocat` connects
from outside, and `curl -H "Authorization: Bearer $(terraform output -raw mc_relay_stats_token)"
https://mc-relay.learnsvenska.com/stats` returns JSON (401 without the header).

## Phase 4: Classroom rehearsal

1. Rehearsal on the school Wi-Fi with 3–5 devices: join by QR code, race, kick, reload the
   teacher's tab mid-race, drop a kid's Wi-Fi mid-race.
2. Load check: 30 scripted players against production during off-hours, watching relay CPU and
   memory and the latency of `standings`.
3. Short teacher guide in `2/README.md`: host, share the code, start, rematch.

## Out of scope

- Accounts, persistence, history across sessions.
- Anti-cheat (answers are computed client-side; acceptable for a classroom).
- Multiple relay instances or horizontal scaling.

## Assumptions and risks

- **School network allows `wss://` to `mc-relay.learnsvenska.com` (assumed, not verified).**
  Do Phases 1 and 3 before Phase 2, then verify from a school device: open
  `https://mc-relay.learnsvenska.com/healthz` and a one-file `wstest.html` (connect, send, echo).
  If it fails, stop before building the client screens. The relay is on port 443, so the likely
  cause would be a domain filter; ask the school IT to allowlist the domain.
- The relay shares the Hetzner VPS (CX23) and the Cloudflare zone with the Swedish app; the DNS
  record follows the server IP automatically through Terraform.
