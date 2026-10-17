package main

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Race statuses and room phases (PROTOCOL.md).
const (
	stRacing   = "racing"
	stFinished = "finished"
	stCrashed  = "crashed"
	stGone     = "disconnected"

	phaseLobby  = "lobby"
	phaseRacing = "racing"
	phaseEnded  = "ended"
)

// rankIn is one player's state as the host sees it.
type rankIn struct {
	id, name string
	idx      int // join order, the final tie-break
	status   string
	done     int
	ms       float64 // finish, crash or last-answer time
	online   bool
}

type topRow struct {
	Name   string  `json:"name"`
	Done   int     `json:"done"`
	Status string  `json:"status"`
	Ms     float64 `json:"ms"`
}

type rankRow struct {
	Rank   int    `json:"rank"`
	Of     int    `json:"of"`
	Done   int    `json:"done"`
	Status string `json:"status"`
}

func statusClass(s string) int {
	switch s {
	case stFinished:
		return 0
	case stRacing:
		return 1
	default:
		return 2
	}
}

// rankLess implements the ranking rules of PROTOCOL.md: finished by finish
// time, racing by done desc then last answer time, crashed by done desc then
// crash time desc. A disconnected player keeps its last state (status stays
// the underlying one here; only the displayed status changes).
func rankLess(a, b rankIn) bool {
	ca, cb := statusClass(a.status), statusClass(b.status)
	if ca != cb {
		return ca < cb
	}
	switch ca {
	case 0:
		if a.ms != b.ms {
			return a.ms < b.ms
		}
	case 1:
		if a.done != b.done {
			return a.done > b.done
		}
		if a.ms != b.ms {
			return a.ms < b.ms
		}
	default:
		if a.done != b.done {
			return a.done > b.done
		}
		if a.ms != b.ms {
			return a.ms > b.ms
		}
	}
	return a.idx < b.idx
}

// rankPlayers returns the top 5 rows and every player's rank, exactly as the
// host sends them in `standings` and `end`.
func rankPlayers(in []rankIn) ([]topRow, map[string]rankRow) {
	s := append([]rankIn(nil), in...)
	sort.Slice(s, func(i, j int) bool { return rankLess(s[i], s[j]) })
	top := make([]topRow, 0, 5)
	ranks := make(map[string]rankRow, len(s))
	for i, r := range s {
		st := r.status
		if !r.online {
			st = stGone
		}
		if i < 5 {
			top = append(top, topRow{Name: r.name, Done: r.done, Status: st, Ms: r.ms})
		}
		ranks[r.id] = rankRow{Rank: i + 1, Of: len(s), Done: r.done, Status: st}
	}
	return top, ranks
}

// cleanName mirrors the relay's name rule (PROTOCOL.md: trimmed, control
// characters stripped, cut to 32 characters).
func cleanName(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > 32 {
		s = strings.TrimSpace(string([]rune(s)[:32]))
	}
	return s
}
