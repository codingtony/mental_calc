package main

import (
	"bufio"
	"crypto/subtle"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type quantiles struct {
	Median float64 `json:"median"`
	P90    float64 `json:"p90"`
}

// Stats summarises the usage events of the last Days days, plus the relay's live state.
type Stats struct {
	Days          int            `json:"days"`
	Since         time.Time      `json:"since"`
	Rooms         int            `json:"rooms"`
	Races         int            `json:"races"`
	Players       playerTotals   `json:"players"`
	RoomDurationS quantiles      `json:"room_duration_s"`
	RaceDurationS quantiles      `json:"race_duration_s"`
	RacesPerCup   map[string]int `json:"races_per_cup"`
	RacesPerN     map[string]int `json:"races_per_n"`
	Live          liveStats      `json:"live"`
}

// liveStats is the relay's state when /stats is served (not from the event log): tells whether a
// restart would drop anyone.
type liveStats struct {
	Connections int64 `json:"connections"` // open WebSocket connections (hosts and players)
	Rooms       int   `json:"rooms"`       // rooms in memory, including those in their host grace
}

type playerTotals struct {
	Sum int     `json:"sum"` // sum of max_players over rooms
	Avg float64 `json:"avg"` // average max_players per room
}

// computeStats reads the event files (missing files are skipped) and
// aggregates the events with ts >= now - days.
func computeStats(paths []string, now time.Time, days int) Stats {
	since := now.Add(-time.Duration(days) * 24 * time.Hour).UTC()
	st := Stats{Days: days, Since: since, RacesPerCup: map[string]int{}, RacesPerN: map[string]int{}}
	var roomDur, raceDur []float64
	for _, path := range paths {
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			var ev struct {
				Event      string    `json:"event"`
				TS         time.Time `json:"ts"`
				DurationS  float64   `json:"duration_s"`
				MaxPlayers int       `json:"max_players"`
				N          int       `json:"n"`
				Cup        string    `json:"cup"`
			}
			if json.Unmarshal(sc.Bytes(), &ev) != nil || ev.TS.Before(since) {
				continue
			}
			switch ev.Event {
			case "room_closed":
				st.Rooms++
				st.Players.Sum += ev.MaxPlayers
				roomDur = append(roomDur, ev.DurationS)
			case "race_ended":
				st.Races++
				raceDur = append(raceDur, ev.DurationS)
				st.RacesPerCup[ev.Cup]++
				st.RacesPerN[strconv.Itoa(ev.N)]++
			}
		}
		f.Close()
	}
	if st.Rooms > 0 {
		st.Players.Avg = math.Round(float64(st.Players.Sum)/float64(st.Rooms)*100) / 100
	}
	st.RoomDurationS = quantilesOf(roomDur)
	st.RaceDurationS = quantilesOf(raceDur)
	return st
}

// quantilesOf uses the nearest-rank method.
func quantilesOf(v []float64) quantiles {
	if len(v) == 0 {
		return quantiles{}
	}
	sort.Float64s(v)
	rank := func(p float64) float64 {
		i := int(math.Ceil(p*float64(len(v)))) - 1
		if i < 0 {
			i = 0
		}
		return v[i]
	}
	return quantiles{Median: rank(0.5), P90: rank(0.9)}
}

func (s *Server) serveStats(w http.ResponseWriter, r *http.Request) {
	if s.cfg.StatsToken == "" {
		http.NotFound(w, r)
		return
	}
	got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || subtle.ConstantTimeCompare([]byte(got), []byte(s.cfg.StatsToken)) != 1 {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	days := 30
	if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil {
		days = min(max(v, 1), 60)
	}
	paths := []string{}
	if s.cfg.EventsPath != "" {
		paths = append(paths, s.cfg.EventsPath, s.cfg.EventsPath+".1")
	}
	st := computeStats(paths, time.Now(), days)
	st.Live = liveStats{Connections: s.conns.Load(), Rooms: s.hub.count()}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(st)
}
