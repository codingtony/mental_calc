package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestRouting(t *testing.T) {
	r := startRelay(t, testConfig())
	host, created := createRoom(t, r.url)
	code := created.str("code")
	if len(code) != codeLen || strings.Trim(code, codeAlphabet) != "" {
		t.Fatalf("bad code %q", code)
	}
	if created.str("hostToken") == "" || created.str("phase") != phaseLobby {
		t.Fatalf("bad created %s", created.raw)
	}

	// Code is case-insensitive and names are cleaned.
	p1 := dial(t, r.url)
	p1.send(map[string]any{"t": "join", "code": strings.ToLower(code), "name": "  Ann\x07a\n "})
	j1 := p1.expect("joined")
	if j1.str("playerToken") == "" || j1.str("phase") != phaseLobby {
		t.Fatalf("bad joined %s", j1.raw)
	}
	if s, _ := j1.m["settings"].(map[string]any); s["cup"] != "mul" {
		t.Fatalf("settings not forwarded: %s", j1.raw)
	}
	if l := p1.expect("lobby"); fmt.Sprint(l.m["names"]) != "[Anna]" {
		t.Fatalf("lobby %s", l.raw)
	}
	pj := host.expect("player_joined")
	if pj.str("playerId") != j1.str("playerId") || pj.str("name") != "Anna" || pj.m["reconnect"] != nil {
		t.Fatalf("bad player_joined %s", pj.raw)
	}

	p2, j2 := joinRoom(t, r.url, code, "Bo")
	host.expect("player_joined")
	if l := p1.expect("lobby"); fmt.Sprint(l.m["names"]) != "[Anna Bo]" {
		t.Fatalf("lobby %s", l.raw)
	}

	host.send(map[string]any{"t": "start", "seed": 42, "settings": testSettings, "countdownMs": 3000})
	for _, p := range []*testClient{p1, p2} {
		s := p.expect("started")
		if s.m["seed"] != float64(42) || s.m["countdownMs"] != float64(3000) {
			t.Fatalf("bad started %s", s.raw)
		}
	}

	p2.send(map[string]any{"t": "progress", "done": 3, "status": "racing", "elapsedMs": 4100.5})
	pr := host.expect("progress")
	if pr.str("playerId") != j2.str("playerId") || pr.m["done"] != float64(3) || pr.m["elapsedMs"] != 4100.5 {
		t.Fatalf("bad progress %s", pr.raw)
	}
	// Progress is only forwarded to the host.
	p1.expectNone(100 * time.Millisecond)

	// Invalid progress is rejected, not forwarded.
	p2.send(map[string]any{"t": "progress", "done": 3, "status": "flying", "elapsedMs": 1})
	p2.expect("error")
	// Players cannot send host messages.
	p2.send(map[string]any{"t": "start", "seed": 1})
	if e := p2.expect("error"); e.str("reason") != "bad_request" {
		t.Fatalf("bad error %s", e.raw)
	}
	// Ping is answered.
	p2.send(map[string]any{"t": "ping"})
	p2.expect("pong")
	host.expectNone(100 * time.Millisecond)

	host.send(map[string]any{"t": "kick", "playerId": j1.str("playerId")})
	p1.expect("kicked")
	if code := p1.expectClosed(); code != closeKicked {
		t.Fatalf("kick close code %d", code)
	}
	if pl := host.expect("player_left"); pl.str("reason") != "kicked" || pl.str("playerId") != j1.str("playerId") {
		t.Fatalf("bad player_left %s", pl.raw)
	}
}

func TestJoinRejectedAfterStart(t *testing.T) {
	r := startRelay(t, testConfig())
	host, created := createRoom(t, r.url)
	code := created.str("code")
	joinRoom(t, r.url, code, "Ann")
	host.send(map[string]any{"t": "start", "seed": 1, "countdownMs": 3000})

	late := dial(t, r.url)
	late.send(map[string]any{"t": "join", "code": code, "name": "Late"})
	if e := late.expect("error"); e.str("reason") != "started" {
		t.Fatalf("want started, got %s", e.raw)
	}
	// Unknown code.
	late.send(map[string]any{"t": "join", "code": "ZZZZZ", "name": "Late"})
	if e := late.expect("error"); e.str("reason") != "not_found" {
		t.Fatalf("want not_found, got %s", e.raw)
	}
	// Empty name.
	late.send(map[string]any{"t": "join", "code": code, "name": " \t "})
	if e := late.expect("error"); e.str("reason") != "bad_name" {
		t.Fatalf("want bad_name, got %s", e.raw)
	}
	// Start twice is not allowed.
	host.expect("player_joined")
	host.send(map[string]any{"t": "start", "seed": 2})
	if e := host.expect("error"); e.str("reason") != "not_allowed" {
		t.Fatalf("want not_allowed, got %s", e.raw)
	}
}

func TestCapacity(t *testing.T) {
	cfg := testConfig()
	cfg.MaxPlayers = 2
	r := startRelay(t, cfg)
	_, created := createRoom(t, r.url)
	code := created.str("code")
	joinRoom(t, r.url, code, "A")
	p2, _ := joinRoom(t, r.url, code, "B")

	extra := dial(t, r.url)
	extra.send(map[string]any{"t": "join", "code": code, "name": "C"})
	if e := extra.expect("error"); e.str("reason") != "full" {
		t.Fatalf("want full, got %s", e.raw)
	}
	// A slot frees up when someone leaves.
	p2.close()
	p2.expectClosed()
	waitUntil(t, func() bool {
		extra.send(map[string]any{"t": "join", "code": code, "name": "C"})
		m := <-extra.msgs
		return m.T == "joined"
	})
}

func waitUntil(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(waitFor)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestReconnectByToken(t *testing.T) {
	r := startRelay(t, testConfig())
	host, created := createRoom(t, r.url)
	code := created.str("code")
	p, j := joinRoom(t, r.url, code, "Ann")
	host.expect("player_joined")
	id, token := j.str("playerId"), j.str("playerToken")

	host.send(map[string]any{"t": "start", "seed": 7, "countdownMs": 3000})
	p.expect("started")
	p.send(map[string]any{"t": "progress", "done": 2, "status": "racing", "elapsedMs": 2000})
	host.expect("progress")
	host.send(map[string]any{"t": "standings", "v": 1, "top": []any{}, "ranks": map[string]any{id: map[string]any{"rank": 1}}})
	p.expect("standings")

	p.close()
	p.expectClosed()
	if pl := host.expect("player_left"); pl.str("reason") != "disconnected" || pl.str("playerId") != id {
		t.Fatalf("bad player_left %s", pl.raw)
	}

	// Mid-race: new players are rejected but the token reconnects.
	again := dial(t, r.url)
	again.send(map[string]any{"t": "join", "code": code, "name": "Other name", "playerToken": token})
	rj := again.expect("joined")
	if rj.str("playerId") != id || rj.str("playerToken") != token || rj.str("phase") != phaseRacing || rj.m["seed"] != float64(7) {
		t.Fatalf("bad rejoin %s", rj.raw)
	}
	// The latest standings are replayed.
	if s := again.expect("standings"); !strings.Contains(string(s.raw), `"me":{"rank":1}`) {
		t.Fatalf("bad replayed standings %s", s.raw)
	}
	pj := host.expect("player_joined")
	if pj.str("playerId") != id || pj.m["reconnect"] != true || pj.str("name") != "Ann" {
		t.Fatalf("bad player_joined %s", pj.raw)
	}

	// A second connection with the same token replaces the first.
	third := dial(t, r.url)
	third.send(map[string]any{"t": "join", "code": code, "name": "Ann", "playerToken": token})
	third.expect("joined")
	if c := again.expectClosed(); c != closeReplaced {
		t.Fatalf("replace close code %d", c)
	}
	host.expect("player_joined")
	host.expectNone(100 * time.Millisecond) // the replaced socket does not produce player_left
}

func TestHostGraceTimeout(t *testing.T) {
	cfg := testConfig()
	cfg.HostGrace = 300 * time.Millisecond
	r := startRelay(t, cfg)

	t.Run("resume within grace", func(t *testing.T) {
		host, created := createRoom(t, r.url)
		code, hostToken := created.str("code"), created.str("hostToken")
		p, j := joinRoom(t, r.url, code, "Ann")
		q, jq := joinRoom(t, r.url, code, "Bo")
		host.send(map[string]any{"t": "start", "seed": 1, "countdownMs": 3000})
		p.expect("started")
		q.expect("started")
		p.send(map[string]any{"t": "progress", "done": 5, "status": "racing", "elapsedMs": 5000})
		q.close()
		host.expect("player_joined")
		host.expect("player_joined")
		host.expect("progress")
		host.expect("player_left")
		host.close()
		host.expectClosed()
		time.Sleep(100 * time.Millisecond)

		h2 := dial(t, r.url)
		h2.send(map[string]any{"t": "create", "code": code, "hostToken": "wrong"})
		if e := h2.expect("error"); e.str("reason") != "bad_token" {
			t.Fatalf("want bad_token, got %s", e.raw)
		}
		h2.send(map[string]any{"t": "create", "code": code, "hostToken": hostToken})
		c := h2.expect("created")
		if c.str("code") != code || c.str("phase") != phaseRacing {
			t.Fatalf("bad resume %s", c.raw)
		}
		if m := h2.expect("player_joined"); m.str("playerId") != j.str("playerId") {
			t.Fatalf("replay order %s", m.raw)
		}
		if m := h2.expect("progress"); m.m["done"] != float64(5) {
			t.Fatalf("replayed progress %s", m.raw)
		}
		h2.expect("player_joined") // Bo
		if m := h2.expect("player_left"); m.str("playerId") != jq.str("playerId") || m.str("reason") != "disconnected" {
			t.Fatalf("replay left %s", m.raw)
		}
		// The room survives past the original grace deadline.
		time.Sleep(cfg.HostGrace + 100*time.Millisecond)
		p.expectNone(50 * time.Millisecond)
		p.send(map[string]any{"t": "progress", "done": 6, "status": "racing", "elapsedMs": 6000})
		h2.expect("progress")
	})

	t.Run("room closes after grace", func(t *testing.T) {
		host, created := createRoom(t, r.url)
		code := created.str("code")
		p, _ := joinRoom(t, r.url, code, "Ann")
		host.close()
		host.expectClosed()
		if m := p.expect("closed"); m.str("reason") != "host_gone" {
			t.Fatalf("bad closed %s", m.raw)
		}
		if c := p.expectClosed(); c != closeRoom {
			t.Fatalf("close code %d", c)
		}
		late := dial(t, r.url)
		late.send(map[string]any{"t": "join", "code": code, "name": "Late"})
		if e := late.expect("error"); e.str("reason") != "not_found" {
			t.Fatalf("want not_found, got %s", e.raw)
		}
	})
}

func TestPersonalisedStandings(t *testing.T) {
	r := startRelay(t, testConfig())
	host, created := createRoom(t, r.url)
	code := created.str("code")
	var players []*testClient
	var ids []string
	for _, n := range []string{"A", "B", "C"} {
		p, j := joinRoom(t, r.url, code, n)
		players = append(players, p)
		ids = append(ids, j.str("playerId"))
	}
	host.send(map[string]any{"t": "start", "seed": 1, "countdownMs": 3000})
	for _, p := range players {
		p.expect("started")
	}

	top := []map[string]any{{"name": "B", "done": 4, "status": "racing", "ms": 900}}
	ranks := map[string]any{
		ids[0]: map[string]any{"rank": 2, "of": 3, "done": 1, "status": "racing"},
		ids[1]: map[string]any{"rank": 1, "of": 3, "done": 4, "status": "racing"},
		// ids[2] intentionally missing → me: null
	}
	host.send(map[string]any{"t": "standings", "v": 9, "top": top, "ranks": ranks})
	for i, p := range players {
		s := p.expect("standings")
		if s.m["v"] != float64(9) || fmt.Sprint(s.m["top"]) != "[map[done:4 ms:900 name:B status:racing]]" {
			t.Fatalf("bad standings %s", s.raw)
		}
		if _, ok := s.m["ranks"]; ok {
			t.Fatalf("ranks leaked: %s", s.raw)
		}
		for k, id := range ids {
			if k != i && strings.Contains(string(s.raw), id) {
				t.Fatalf("player %d sees id of player %d: %s", i, k, s.raw)
			}
		}
		want := "<nil>"
		if i < 2 {
			want = fmt.Sprint(ranks[ids[i]])
		}
		if got := fmt.Sprint(s.m["me"]); got != want {
			t.Fatalf("player %d me = %s, want %s", i, got, want)
		}
	}

	host.send(map[string]any{"t": "end", "final": map[string]any{"top": top, "ranks": ranks}})
	for i, p := range players {
		e := p.expect("ended")
		if _, ok := e.m["v"]; ok {
			t.Fatalf("ended has v: %s", e.raw)
		}
		if i == 1 && fmt.Sprint(e.m["me"]) != fmt.Sprint(ranks[ids[1]]) {
			t.Fatalf("bad ended %s", e.raw)
		}
	}
	// Standings after the end are refused.
	host.send(map[string]any{"t": "standings", "v": 10, "top": top, "ranks": ranks})
	if e := host.skipTo("error"); e.str("reason") != "not_allowed" {
		t.Fatalf("want not_allowed, got %s", e.raw)
	}
}

func TestRematch(t *testing.T) {
	r := startRelay(t, testConfig())
	host, created := createRoom(t, r.url)
	code := created.str("code")
	p, j := joinRoom(t, r.url, code, "Ann")
	host.expect("player_joined")
	host.send(map[string]any{"t": "start", "seed": 1, "countdownMs": 3000})
	p.expect("started")
	host.send(map[string]any{"t": "end", "final": map[string]any{"top": []any{}, "ranks": map[string]any{}}})
	p.expect("ended")

	host.send(map[string]any{"t": "rematch", "seed": 2})
	p.expect("rematch")
	if l := p.expect("lobby"); fmt.Sprint(l.m["names"]) != "[Ann]" {
		t.Fatalf("lobby %s", l.raw)
	}
	// Joins are open again.
	joinRoom(t, r.url, code, "Bo")
	host.expect("player_joined")
	host.send(map[string]any{"t": "start", "seed": 2, "countdownMs": 3000})
	if s := p.expect("started"); s.m["seed"] != float64(2) {
		t.Fatalf("bad started %s", s.raw)
	}
	p.send(map[string]any{"t": "progress", "done": 1, "status": "racing", "elapsedMs": 1000})
	if m := host.expect("progress"); m.str("playerId") != j.str("playerId") {
		t.Fatalf("player id changed %s", m.raw)
	}
}

func TestOriginCheck(t *testing.T) {
	r := startRelay(t, testConfig())
	ctx, cancel := context.WithTimeout(context.Background(), waitFor)
	defer cancel()
	for origin, want := range map[string]int{
		"https://evil.example":         http.StatusForbidden,
		"https://maths.codingtony.com": http.StatusSwitchingProtocols,
	} {
		ws, resp, err := websocket.Dial(ctx, r.url, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {origin}}})
		if resp == nil || resp.StatusCode != want {
			t.Fatalf("origin %s: resp %v err %v, want %d", origin, resp, err, want)
		}
		if ws != nil {
			ws.CloseNow()
		}
	}
}

func TestMessageLimits(t *testing.T) {
	r := startRelay(t, testConfig())

	big := dial(t, r.url)
	b := []byte(`{"t":"create","settings":{"x":"` + strings.Repeat("a", maxMessageBytes) + `"}}`)
	_ = big.ws.Write(context.Background(), websocket.MessageText, b)
	if c := big.expectClosed(); c != websocket.StatusMessageTooBig {
		t.Fatalf("oversized close code %d", c)
	}

	spam := dial(t, r.url)
	for range 3 * msgsPerSecond {
		if spam.ws.Write(context.Background(), websocket.MessageText, []byte(`{"t":"ping"}`)) != nil {
			break
		}
	}
	if c := spam.expectClosed(); c != websocket.StatusPolicyViolation {
		t.Fatalf("rate limit close code %d", c)
	}
}

func TestRelayPing(t *testing.T) {
	cfg := testConfig()
	cfg.PingInterval = 50 * time.Millisecond
	r := startRelay(t, cfg)
	ctx, cancel := context.WithTimeout(context.Background(), waitFor)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, r.url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	_, data, err := ws.Read(ctx)
	if err != nil || string(data) != `{"t":"ping"}` {
		t.Fatalf("got %s %v", data, err)
	}
}

func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"  Ann  ":                      "Ann",
		"A\x00n\u0085n\t":              "Ann",
		"\u200bZ":                      "\u200bZ", // format chars are not control chars
		strings.Repeat("é", 40):        strings.Repeat("é", 32),
		strings.Repeat("a", 31) + " b": strings.Repeat("a", 31),
		"\n\r":                         "",
	} {
		if got := cleanName(in); got != want {
			t.Errorf("cleanName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRandomCode(t *testing.T) {
	seen := map[byte]bool{}
	for range 2000 {
		c := randomCode()
		if len(c) != codeLen {
			t.Fatalf("len %q", c)
		}
		for _, ch := range []byte(c) {
			if !strings.ContainsRune(codeAlphabet, rune(ch)) {
				t.Fatalf("bad char in %q", c)
			}
			seen[ch] = true
		}
	}
	if len(seen) != len(codeAlphabet) {
		t.Fatalf("only %d distinct chars", len(seen))
	}
}
