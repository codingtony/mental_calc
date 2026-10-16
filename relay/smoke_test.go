package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

// TestSmoke30Players runs 1 host and 30 players through a full race and
// checks that every player receives only its own `me`. It uses an in-process
// relay, or the relay at RELAY_URL (e.g. ws://127.0.0.1:8010/ws) when set.
func TestSmoke30Players(t *testing.T) {
	url := os.Getenv("RELAY_URL")
	if url == "" {
		url = startRelay(t, testConfig()).url
	}
	const nPlayers = 30

	host, created := createRoom(t, url)
	code := created.str("code")
	players := make([]*testClient, nPlayers)
	ids := make([]string, nPlayers)
	index := map[string]int{}
	for i := range nPlayers {
		p := dial(t, url)
		p.send(map[string]any{"t": "join", "code": code, "name": fmt.Sprintf("Player-name-%04d", i)})
		ids[i] = p.expect("joined").str("playerId")
		index[ids[i]] = i
		players[i] = p
		host.expect("player_joined")
	}
	host.send(map[string]any{"t": "start", "seed": 12345, "settings": testSettings, "countdownMs": 3000})
	for _, p := range players {
		p.expect("started")
	}

	// Player i answers i questions; the last 3 crash, player 0 finishes.
	type state struct {
		done   int
		status string
		ms     float64
	}
	states := make([]state, nPlayers)
	for i, p := range players {
		s := state{done: i % 10, status: "racing", ms: float64(1000 + i)}
		switch {
		case i == 0:
			s = state{done: 10, status: "finished", ms: 20000}
		case i >= nPlayers-3:
			s.status = "crashed"
		}
		states[i] = s
		p.send(map[string]any{"t": "progress", "done": s.done, "status": s.status, "elapsedMs": s.ms})
	}
	for range nPlayers {
		m := host.skipTo("progress")
		i := index[m.str("playerId")]
		if m.m["done"] != float64(states[i].done) || m.str("status") != states[i].status {
			t.Fatalf("progress mismatch for %d: %s", i, m.raw)
		}
	}

	// Host-side ranking (simplified): finished, racing by done desc, crashed.
	order := make([]int, nPlayers)
	for i := range order {
		order[i] = i
	}
	group := map[string]int{"finished": 0, "racing": 1, "crashed": 2}
	sort.SliceStable(order, func(a, b int) bool {
		sa, sb := states[order[a]], states[order[b]]
		if group[sa.status] != group[sb.status] {
			return group[sa.status] < group[sb.status]
		}
		return sa.done > sb.done
	})
	ranks := map[string]any{}
	rankOf := make([]int, nPlayers)
	var top []map[string]any
	for r, i := range order {
		rankOf[i] = r + 1
		ranks[ids[i]] = map[string]any{"rank": r + 1, "of": nPlayers, "done": states[i].done, "status": states[i].status}
		if r < 5 {
			top = append(top, map[string]any{"name": fmt.Sprintf("Player-name-%04d", i), "done": states[i].done, "status": states[i].status, "ms": states[i].ms})
		}
	}

	check := func(kind string, sent time.Time) {
		var worst time.Duration
		for i, p := range players {
			m := p.expect(kind)
			if d := time.Since(sent); d > worst {
				worst = d
			}
			me, _ := m.m["me"].(map[string]any)
			if me == nil || me["rank"] != float64(rankOf[i]) || me["done"] != float64(states[i].done) || me["status"] != states[i].status {
				t.Fatalf("%s: player %d got me=%v, want rank %d", kind, i, m.m["me"], rankOf[i])
			}
			if _, ok := m.m["ranks"]; ok {
				t.Fatalf("%s: player %d received ranks", kind, i)
			}
			if tp, _ := m.m["top"].([]any); len(tp) != 5 {
				t.Fatalf("%s: player %d top has %d rows", kind, i, len(tp))
			}
			for k, id := range ids {
				if k != i && strings.Contains(string(m.raw), id) {
					t.Fatalf("%s: player %d sees id of player %d", kind, i, k)
				}
			}
		}
		t.Logf("%s: all %d players got their own me; slowest delivery %v", kind, nPlayers, worst)
	}

	standings := map[string]any{"t": "standings", "v": 1, "top": top, "ranks": ranks}
	b, _ := json.Marshal(standings)
	t.Logf("host standings message: %d bytes (limit %d)", len(b), maxMessageBytes)
	sent := time.Now()
	host.send(standings)
	check("standings", sent)

	sent = time.Now()
	host.send(map[string]any{"t": "end", "final": map[string]any{"top": top, "ranks": ranks}})
	check("ended", sent)
	host.expectNone(100 * time.Millisecond)
}
