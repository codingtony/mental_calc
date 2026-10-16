package main

import (
	"encoding/json"
	"log/slog"
	"os"
	"sync"
	"time"
)

// Usage events, one JSON object per line in EVENTS_PATH. They never contain
// the join code or player names.
type roomClosedEvent struct {
	Event       string    `json:"event"`
	TS          time.Time `json:"ts"`
	RoomID      string    `json:"room_id"`
	OpenedAt    time.Time `json:"opened_at"`
	DurationS   float64   `json:"duration_s"`
	Races       int       `json:"races"`
	MaxPlayers  int       `json:"max_players"`
	TotalJoins  int       `json:"total_joins"`
	Reconnects  int       `json:"reconnects"`
	CloseReason string    `json:"close_reason"`
}

type raceEndedEvent struct {
	Event      string    `json:"event"`
	TS         time.Time `json:"ts"`
	RoomID     string    `json:"room_id"`
	RaceNo     int       `json:"race_no"`
	Players    int       `json:"players"`
	N          int       `json:"n"`
	Cup        string    `json:"cup"`
	Difficulty string    `json:"difficulty"`
	DurationS  float64   `json:"duration_s"`
	Finished   int       `json:"finished"`
	Crashed    int       `json:"crashed"`
	DNF        int       `json:"dnf"`
	EndedBy    string    `json:"ended_by"`
}

// EventLog appends events to path. The file is opened and closed per event,
// so logrotate can move it without signalling the relay.
type EventLog struct {
	path string
	log  *slog.Logger
	mu   sync.Mutex
}

func (e *EventLog) Write(ev any) {
	if e.path == "" {
		return
	}
	b, err := json.Marshal(ev)
	if err != nil {
		e.log.Error("event_marshal", "err", err)
		return
	}
	b = append(b, '\n')
	e.mu.Lock()
	defer e.mu.Unlock()
	f, err := os.OpenFile(e.path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o640)
	if err != nil {
		e.log.Error("event_open", "err", err)
		return
	}
	if _, err := f.Write(b); err != nil {
		e.log.Error("event_write", "err", err)
	}
	if err := f.Close(); err != nil {
		e.log.Error("event_close", "err", err)
	}
}
