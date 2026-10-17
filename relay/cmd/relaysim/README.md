# relaysim

Replayable stress and behaviour test for the relay. It runs randomised race scenarios against any
relay URL and checks the relay's behaviour against `../../PROTOCOL.md`. The simulated host plays the
teacher's tab: it ranks the players by the protocol's rules, sends throttled `standings` (≤ 2/s, only
when something changed) and `end`. The simulated players follow scripted races.

```sh
cd relay
go run ./cmd/relaysim -url ws://127.0.0.1:8010/ws -n 100              # local relay
go run ./cmd/relaysim -url wss://mc-relay.learnsvenska.com/ws -n 100   # production (default pacing)
go run ./cmd/relaysim -seed 42 -only reconnect#17 -v -trace            # replay one scenario
```

Each run prints its seed. Scenario `i` draws all its randomness from `(seed, i)`, so
`-seed S -only name#i` replays that scenario exactly. With `-v`, every result line ends with a hash
of the scenario's deterministic event trace (scripted actions, error reasons, close codes, final
ranks; timings are excluded). A replay prints the same hash. `-trace` prints the trace itself. Every
failure prints its replay command, and the exit code is non-zero if any scenario fails or the run
aborts.

| Flag | Default | |
|---|---|---|
| `-url` | `ws://127.0.0.1:8010/ws` | relay WebSocket URL |
| `-origin` | `https://maths.codingtony.com` | `Origin` header (must match `ALLOWED_ORIGINS`) |
| `-seed` | time-based | run seed, always printed |
| `-n` | 100 | number of scenarios |
| `-concurrency` | 10 | scenarios (rooms) in parallel |
| `-only` | | `name#i` exactly, or a regexp over `name#i` |
| `-timeout` | 3m | per scenario |
| `-connect-rate` | 8 | handshakes/s over the whole run (nginx: 10 r/s, burst 40 per IP) |
| `-msg-interval` | 100ms | minimum gap between messages on one connection (relay limit: 20/s) |
| `-speed` | 20 | race time compression (scripted answer times ÷ speed) |
| `-max-players` | 30 | the relay's `MAX_PLAYERS` (capacity scenario) |
| `-slow` | off | adds `host_gone` (waits out the 2 min host grace) |
| `-v`, `-trace` | off | trace hashes / full traces |
| `-json FILE` | | JSON report (`-` = stdout) |

Handshakes answered 429/502/503 are retried with exponential backoff. A 403 (a Cloudflare challenge,
or an `Origin` the relay refuses) aborts the run: no more connections are attempted.

## Scenarios

| Name | Checks |
|---|---|
| `race` | 1–30 players, N ∈ {10, 30, 50, 120}: `player_joined` with sanitised names, lobby list, every `progress` reaches the host in order, each personalised `standings`/`ended` carries only the player's own `me` (byte-for-byte equal to the host's `ranks[id]`), and the final ranking and `of` match the scripts |
| `rematch`, `rematch_midrace` | `rematch {}` + lobby for everyone, second race without re-joining |
| `kick_lobby`, `kick_race` | `kicked` + close 4000, host `player_left kicked`, lobby update, kicked token is forgotten (fresh join / `started`) |
| `reconnect` | drop mid-race, token reconnect: same `playerId`, original name kept, replayed `standings`, host `player_joined reconnect` |
| `dup_conn` | second socket with the same token: old one closed 4001, no `player_left` |
| `reconnect_after_end` | race ends with the player `disconnected`; on reconnect the player gets the replayed `ended` |
| `host_resume_race`, `host_resume_lobby`, `host_takeover` | host resumes with `hostToken` (after a drop, or while the old tab is open, which gets 4001): `created` phase, replayed `player_joined` in join order, race completes |
| `late_join` | `started` while racing and after the end, join accepted after `rematch` |
| `bad_input` | unparseable/wrong-role/wrong-phase messages, `not_found`, `bad_name`, sanitised names, case-insensitive code, `bad_token`, 5 KB frame → 1009, sometimes a 40-message burst → `rate_limited` + 1008 |
| `capacity` | `MAX_PLAYERS` join, the next one gets `full` (and gets in on the same socket once a seat frees), join after start → `started`, host ends mid-race |
| `rooms` | 3–10 rooms at once: distinct codes, each host only sees its own players |
| `host_gone` (`-slow`) | after the 2 min grace players get `closed {host_gone}` + 4002; resuming gives `not_found` |

Room codes are checked for uniqueness across all rooms of a run while they are live, including the
host grace period. Against production, every simulated room and race is written to the relay's usage
events (`/stats`).
