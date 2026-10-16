package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"sync"
	"time"
)

const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const codeLen = 5

// Hub owns the code → room map. Everything else about a room lives on the
// room's own goroutine.
type Hub struct {
	cfg    Config
	events *EventLog
	log    *slog.Logger

	mu    sync.Mutex
	rooms map[string]*Room
	wg    sync.WaitGroup
}

func newHub(cfg Config, events *EventLog, logger *slog.Logger) *Hub {
	return &Hub{cfg: cfg, events: events, log: logger, rooms: make(map[string]*Room)}
}

// randomCode draws codeLen characters by rejection sampling, so every
// character of the alphabet is equally likely.
func randomCode() string {
	const limit = 256 - 256%len(codeAlphabet)
	out := make([]byte, 0, codeLen)
	var buf [16]byte
	for len(out) < codeLen {
		_, _ = rand.Read(buf[:])
		for _, b := range buf {
			if int(b) < limit && len(out) < codeLen {
				out = append(out, codeAlphabet[int(b)%len(codeAlphabet)])
			}
		}
	}
	return string(out)
}

func randomHex(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// create opens a room hosted by host and sends it `created`.
func (h *Hub) create(host *client, settings json.RawMessage) *Room {
	h.mu.Lock()
	code := randomCode()
	for h.rooms[code] != nil {
		code = randomCode()
	}
	now := time.Now()
	r := &Room{
		hub:          h,
		cfg:          h.cfg,
		id:           randomHex(8),
		code:         code,
		hostToken:    randomHex(16),
		settings:     settings,
		inbox:        make(chan any, 256),
		done:         make(chan struct{}),
		host:         host,
		players:      make(map[string]*player),
		byToken:      make(map[string]*player),
		byConn:       make(map[*client]*player),
		phase:        phaseLobby,
		openedAt:     now,
		lastActivity: now,
	}
	r.log = h.log.With("room_id", r.id, "code", code)
	h.rooms[code] = r
	h.wg.Add(1)
	h.mu.Unlock()

	r.log.Info("room_created", host.logAttrs()...)
	host.sendJSON(createdMsg{T: "created", Code: code, HostToken: r.hostToken, Phase: r.phase})
	go func() {
		defer h.wg.Done()
		r.run()
	}()
	return r
}

func (h *Hub) get(code string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[code]
}

func (h *Hub) remove(r *Room) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[r.code] == r {
		delete(h.rooms, r.code)
	}
}

func (h *Hub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.rooms)
}

// Shutdown closes every room (emitting their events) and waits for them.
func (h *Hub) Shutdown() {
	h.mu.Lock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()
	for _, r := range rooms {
		r.post(shutdownEvent{})
	}
	h.wg.Wait()
}
