# relaysim

Replayable stress and behaviour test for the relay. It runs a fixed suite of 60 randomised scenarios
(every archetype below, normal and edge cases) against any relay URL and checks the relay's
behaviour against `../../PROTOCOL.md`. The simulated host plays the
teacher's tab: it ranks the players by the protocol's rules, sends throttled `standings` (≤ 2/s, only
when something changed) and `end`. The simulated players follow scripted races.

```sh
cd relay
go run ./cmd/relaysim -url ws://127.0.0.1:8010/ws                    # local relay, one suite pass
go run ./cmd/relaysim -url wss://mc-relay.learnsvenska.com/ws         # production (default pacing)
go run ./cmd/relaysim -seed 42 -only reconnect#25 -v -trace            # replay one scenario
```

Each run prints its seed. Scenario `i` runs entry `i mod len(suite)` of the suite (the `archetypes`
list in `archetypes.go`, each repeated its run count) and draws all its randomness from `(seed, i)`, so
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
| `-n` | 0 | number of scenarios; 0 = one suite pass (60, 61 with `-slow`) |
| `-concurrency` | 10 | scenarios (rooms) in parallel |
| `-only` | | `name#i` exactly, or a regexp over `name#i` |
| `-timeout` | 3m | per scenario |
| `-connect-rate` | 8 | handshakes/s over the whole run (nginx: 10 r/s, burst 40 per IP) |
| `-msg-interval` | 100ms | minimum gap between messages on one connection (relay limit: 20/s) |
| `-speed` | 20 | race time compression (scripted answer times ÷ speed) |
| `-max-players` | 60 | the relay's `MAX_PLAYERS` (capacity scenario) |
| `-slow` | off | adds `host_gone` (waits out the 2 min host grace) |
| `-v`, `-trace` | off | trace hashes / full traces |
| `-json FILE` | | JSON report (`-` = stdout) |

Handshakes answered 429/502/503 are retried with exponential backoff. A 403 (a Cloudflare challenge,
or an `Origin` the relay refuses) aborts the run: no more connections are attempted.

## Scenarios

| Name | Runs | Checks |
|---|---|---|
| `host_gone` (`-slow`) | 1 | after the 2 min grace players get `closed {host_gone}` + 4002; resuming gives `not_found` |
| `class60_chaos` | 2 | 60 racers (N=30): 3 drop mid-race, the host drops and resumes (60 players replayed, 3 offline), the 3 reconnect, one racer is kicked, one opens a second tab (4001); then a rematch and a second race |
| `class60` | 2 | a full class of 60 (N ∈ {30, 50}); a second `  eBBA ` gets `name_taken` and joins as `Ebba S` on the same socket |
| `race` | 10 | 1–30 players, N ∈ {10, 30, 50, 120}: `player_joined` with sanitised names, lobby list, every `progress` reaches the host in order, each personalised `standings`/`ended` carries only the player's own `me` (byte-for-byte equal to the host's `ranks[id]`), and the final ranking and `of` match the scripts |
| `rematch`, `rematch_midrace` | 4, 3 | `rematch {}` + lobby for everyone, second race without re-joining |
| `host_resume_race`, `host_takeover`, `host_resume_lobby` | 4, 3, 3 | host resumes with `hostToken` (after a drop, or while the old tab is open, which gets 4001): `created` phase, replayed `player_joined` in join order, race completes |
| `reconnect` | 4 | drop mid-race, token reconnect: same `playerId`, original name kept, replayed `standings`, host `player_joined reconnect` |
| `dup_conn` | 3 | second socket with the same token: old one closed 4001, no `player_left` |
| `late_join` | 3 | `started` while racing and after the end, join accepted after `rematch` |
| `kick_race`, `kick_lobby` | 3, 3 | `kicked` + close 4000, host `player_left kicked`, lobby update, kicked token is forgotten (fresh join / `started`) |
| `reconnect_after_end` | 3 | race ends with the player `disconnected`; on reconnect the player gets the replayed `ended` |
| `bad_input` | 4 | unparseable/wrong-role/wrong-phase messages, `not_found`, `bad_name`, `name_taken` (case-insensitive), sanitised names, case-insensitive code, `bad_token`, 9 KB frame → 1009, sometimes a 40-message burst → `rate_limited` + 1008 |
| `capacity` | 2 | `MAX_PLAYERS` join, the next one gets `full` (and gets in on the same socket once a seat frees), join after start → `started`, host ends mid-race |
| `rooms` | 4 | 3–10 rooms at once: distinct codes, each host only sees its own players |

Room codes are checked for uniqueness across all rooms of a run while they are live, including the
host grace period. Against production, every simulated room and race is written to the relay's usage
events (`/stats`).
