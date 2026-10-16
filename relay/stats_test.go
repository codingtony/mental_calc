package main

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func readEvents(t *testing.T, path string) []map[string]any {
	t.Helper()
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var out []map[string]any
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatalf("bad event line %q: %v", sc.Text(), err)
		}
		out = append(out, m)
	}
	return out
}

func TestRoomClosedEventOnce(t *testing.T) {
	cfg := testConfig()
	cfg.EventsPath = filepath.Join(t.TempDir(), "events.jsonl")
	cfg.HostGrace = 100 * time.Millisecond
	r := startRelay(t, cfg)

	host, created := createRoom(t, r.url)
	code := created.str("code")
	p, _ := joinRoom(t, r.url, code, "SecretName")
	q, j := joinRoom(t, r.url, code, "Other")
	q.close()
	q.expectClosed()
	again := dial(t, r.url)
	again.send(map[string]any{"t": "join", "code": code, "name": "Other", "playerToken": j.str("playerToken")})
	again.expect("joined")
	host.send(map[string]any{"t": "start", "seed": 1, "countdownMs": 3000})
	p.expect("started")
	p.send(map[string]any{"t": "progress", "done": 10, "status": "finished", "elapsedMs": 9000})
	host.skipTo("progress")
	host.close()
	p.expect("closed")

	waitUntil(t, func() bool { return len(readEvents(t, cfg.EventsPath)) == 2 })
	r.srv.hub.Shutdown() // must not log the already-closed room again
	if r.srv.hub.count() != 0 {
		t.Fatal("room still registered")
	}

	evs := readEvents(t, cfg.EventsPath)
	var closed, races []map[string]any
	for _, e := range evs {
		switch e["event"] {
		case "room_closed":
			closed = append(closed, e)
		case "race_ended":
			races = append(races, e)
		}
	}
	if len(closed) != 1 || len(races) != 1 {
		t.Fatalf("want 1 room_closed and 1 race_ended, got %v", evs)
	}
	c := closed[0]
	for k, want := range map[string]any{"races": 1.0, "max_players": 2.0, "total_joins": 2.0, "reconnects": 1.0, "close_reason": "host_gone"} {
		if c[k] != want {
			t.Errorf("room_closed %s = %v, want %v", k, c[k], want)
		}
	}
	for k, want := range map[string]any{"race_no": 1.0, "players": 2.0, "n": 10.0, "cup": "mul", "difficulty": "easy",
		"finished": 1.0, "crashed": 0.0, "dnf": 1.0, "ended_by": "closed"} {
		if races[0][k] != want {
			t.Errorf("race_ended %s = %v, want %v", k, races[0][k], want)
		}
	}
	if c["room_id"] != races[0]["room_id"] || c["room_id"] == "" {
		t.Errorf("room ids differ: %v %v", c["room_id"], races[0]["room_id"])
	}
	raw, _ := os.ReadFile(cfg.EventsPath)
	for _, secret := range []string{code, "SecretName", "Other"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("events contain %q", secret)
		}
	}
}

func TestStatsAggregation(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	paths := []string{"testdata/events.jsonl", "testdata/events.jsonl.1", "testdata/missing.jsonl"}

	got := computeStats(paths, now, 30)
	want := Stats{
		Days:          30,
		Since:         time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC),
		Rooms:         3,
		Races:         3,
		Players:       playerTotals{Sum: 60, Avg: 20},
		RoomDurationS: quantiles{Median: 600, P90: 1200},
		RaceDurationS: quantiles{Median: 100, P90: 200},
		RacesPerCup:   map[string]int{"mul": 2, "add": 1},
		RacesPerN:     map[string]int{"30": 2, "10": 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("30 days:\n got %+v\nwant %+v", got, want)
	}

	got = computeStats(paths, now, 60)
	if got.Rooms != 4 || got.Races != 4 || got.RacesPerN["120"] != 1 || got.Players.Sum != 159 {
		t.Fatalf("60 days: %+v", got)
	}
}

func TestStatsAuth(t *testing.T) {
	cfg := testConfig()
	cfg.EventsPath = "testdata/events.jsonl"

	get := func(s *Server, auth, query string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/stats"+query, nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)
		return rec
	}

	if rec := get(NewServer(cfg, discardLogger()), "Bearer anything", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("no token configured: %d", rec.Code)
	}

	cfg.StatsToken = "s3cret"
	s := NewServer(cfg, discardLogger())
	for _, auth := range []string{"", "Bearer wrong", "s3cret", "Basic s3cret", "Bearer s3cret2"} {
		if rec := get(s, auth, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("auth %q: %d", auth, rec.Code)
		}
	}
	for query, wantDays := range map[string]int{"": 30, "?days=7": 7, "?days=0": 1, "?days=999": 60, "?days=x": 30} {
		rec := get(s, "Bearer s3cret", query)
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" {
			t.Fatalf("query %q: %d %s", query, rec.Code, rec.Body)
		}
		if rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatal("stats must not send CORS headers")
		}
		var st Stats
		if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil || st.Days != wantDays {
			t.Fatalf("query %q: days %d err %v", query, st.Days, err)
		}
	}
}

func TestHealthz(t *testing.T) {
	s := NewServer(testConfig(), discardLogger())
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("healthz %d", rec.Code)
	}
}
