package main

import (
	"encoding/json"
	"time"
)

// hEntry is the host's view of one player.
type hEntry struct {
	id, name string
	idx      int
	online   bool
	inRace   bool
	kicked   bool
	status   string
	done     int
	ms       float64
	log      []step // progress received during the current race
}

type joinEv struct {
	id, name  string
	reconnect bool
	epoch     int
}

type leftEv struct {
	id, reason string
	epoch      int
}

// simHost plays the teacher's tab: it tracks players from player_joined /
// player_left / progress, ranks them (rank.go), sends throttled standings
// (≤ 2/s, only when something changed) and ends the race when every racer
// is finished or crashed (or expected gone), like the real client.
type simHost struct {
	actor
	rm *room
	c  *wsConn // nil while the host tab is "closed"

	epoch        int // number of `created` received (1 = create, 2+ = resumes)
	code, token  string
	createdPhase string
	phase        string
	entries      map[string]*hEntry
	order        []*hEntry
	joins        []joinEv
	lefts        []leftEv
	errs         []string
	errUsed      int
	pongs        int
	closedReason string

	race      int
	v         int
	sentRace  int // standings sent during the current race
	dirty     bool
	autoEnd   bool
	gone      map[string]bool // players allowed to be absent at the end
	endedRace int
}

func (rm *room) newHost() *simHost {
	h := &simHost{rm: rm, entries: map[string]*hEntry{}, gone: map[string]bool{}, autoEnd: true}
	h.init(rm.sc)
	go h.run()
	return h
}

func (h *simHost) run() {
	tick := time.NewTicker(500 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-h.sc.ctx.Done():
			return
		case m := <-h.inbox:
			h.mu.Lock()
			h.handle(m)
			h.bump()
			h.mu.Unlock()
		case f := <-h.cmds:
			h.mu.Lock()
			f()
			h.bump()
			h.mu.Unlock()
		case <-tick.C:
			h.mu.Lock()
			if h.phase == phaseRacing && h.dirty && h.c != nil {
				h.sendStandings()
				h.bump()
			}
			h.mu.Unlock()
		}
	}
}

func (h *simHost) handle(m inMsg) {
	sc := h.sc
	if m.closed || m.c != h.c {
		return // end of a connection, or a replaced tab
	}
	switch m.t {
	case "created":
		code, token, phase := m.str("code"), m.str("hostToken"), m.str("phase")
		h.epoch++
		h.createdPhase = phase
		if h.epoch == 1 {
			if phase != phaseLobby || len(code) != 5 || len(token) != 32 {
				sc.failf("%s: bad created %s", m.c.label, m.raw)
			}
			h.code, h.token, h.phase = code, token, phaseLobby
			if err := sc.sim.registerCode(code, sc.id); err != nil {
				sc.failf("%v", err)
			}
			return
		}
		if code != h.code || token != h.token || phase != h.phase {
			sc.failf("%s: resume replied %s, want code %s phase %s", m.c.label, m.raw, h.code, h.phase)
		}
	case "player_joined":
		var j struct {
			PlayerID  string `json:"playerId"`
			Name      string `json:"name"`
			Reconnect bool   `json:"reconnect"`
		}
		_ = json.Unmarshal(m.raw, &j)
		e := h.entries[j.PlayerID]
		if e == nil {
			e = &hEntry{id: j.PlayerID, name: j.Name, idx: len(h.order), status: stRacing}
			h.entries[e.id] = e
			h.order = append(h.order, e)
		} else if e.name != j.Name {
			sc.failf("host: player %s renamed from %q to %q", e.id, e.name, j.Name)
		}
		e.online = true
		h.joins = append(h.joins, joinEv{id: j.PlayerID, name: j.Name, reconnect: j.Reconnect, epoch: h.epoch})
		h.dirty = true
	case "player_left":
		id, reason := m.str("playerId"), m.str("reason")
		e := h.entries[id]
		if e == nil || (reason != "disconnected" && reason != "kicked") {
			sc.failf("host: bad player_left %s", m.raw)
			return
		}
		e.online = false
		h.lefts = append(h.lefts, leftEv{id: id, reason: reason, epoch: h.epoch})
		h.dirty = true
		h.maybeEnd()
	case "progress":
		var p struct {
			PlayerID string `json:"playerId"`
			step
		}
		_ = json.Unmarshal(m.raw, &p)
		if h.phase != phaseRacing {
			return // after end/rematch: ignored, like the real client
		}
		e := h.entries[p.PlayerID]
		switch {
		case e == nil:
			sc.failf("host: progress from unknown player %s", m.raw)
			return
		case e.kicked:
			return // in flight when the kick was sent
		case !e.inRace:
			sc.failf("host: progress from %s, who is not in the race: %s", e.id, m.raw)
			return
		}
		e.log = append(e.log, p.step)
		e.status, e.done, e.ms = p.Status, p.Done, p.Ms
		h.dirty = true
		h.maybeEnd()
	case "error":
		r := m.str("reason")
		h.errs = append(h.errs, r)
		sc.sim.countError(r)
	case "pong":
		h.pongs++
	case "closed":
		h.closedReason = m.str("reason")
	default:
		sc.failf("host: unexpected message %s", m.raw)
	}
}

func (h *simHost) racers() []rankIn {
	var in []rankIn
	for _, e := range h.order {
		if e.inRace && !e.kicked {
			in = append(in, rankIn{id: e.id, name: e.name, idx: e.idx, status: e.status, done: e.done, ms: e.ms, online: e.online})
		}
	}
	return in
}

func (h *simHost) maybeEnd() {
	if !h.autoEnd || h.phase != phaseRacing || h.c == nil {
		return
	}
	n := 0
	for _, e := range h.order {
		if !e.inRace || e.kicked {
			continue
		}
		n++
		if e.status == stRacing && (!h.gone[e.id] || e.online) {
			return
		}
	}
	if n > 0 {
		h.end()
	}
}

// snapshot ranks the racers into a sentStandings (shared with the players
// for verification).
func (h *simHost) snapshot() *sentStandings {
	top, ranks := rankPlayers(h.racers())
	ss := &sentStandings{race: h.race, top: mustJSON(top), ranks: make(map[string]json.RawMessage, len(ranks))}
	for id, r := range ranks {
		ss.ranks[id] = mustJSON(r)
	}
	return ss
}

func (h *simHost) sendStandings() {
	ss := h.snapshot()
	h.v++
	ss.v = h.v
	h.rm.putStandings(ss)
	h.c.sendStamped(struct {
		T     string                     `json:"t"`
		V     int                        `json:"v"`
		Top   json.RawMessage            `json:"top"`
		Ranks map[string]json.RawMessage `json:"ranks"`
	}{"standings", ss.v, ss.top, ss.ranks}, func(t time.Time) { ss.at.Store(t.UnixNano()) })
	h.sentRace++
	h.dirty = false
}

func (h *simHost) end() {
	ss := h.snapshot()
	h.rm.putFinal(ss)
	type final struct {
		Top   json.RawMessage            `json:"top"`
		Ranks map[string]json.RawMessage `json:"ranks"`
	}
	h.c.send(struct {
		T     string `json:"t"`
		Final final  `json:"final"`
	}{"end", final{ss.top, ss.ranks}})
	h.phase = phaseEnded
	h.endedRace = h.race
	h.dirty = false
}

func (h *simHost) start(pl *racePlan, countdownMs int) {
	h.race++
	h.phase = phaseRacing
	h.sentRace = 0
	h.dirty = true
	h.rm.setRaceInfo(h.race, mustJSON(pl.seed), mustJSON(pl.s))
	for _, e := range h.order {
		e.inRace = e.online && !e.kicked
		e.status, e.done, e.ms, e.log = stRacing, 0, 0, nil
	}
	h.c.send(struct {
		T           string   `json:"t"`
		Seed        uint32   `json:"seed"`
		Settings    settings `json:"settings"`
		CountdownMs int      `json:"countdownMs"`
	}{"start", pl.seed, pl.s, countdownMs})
}

func (h *simHost) kick(id string) {
	if e := h.entries[id]; e != nil {
		e.kicked = true
		e.inRace = false
	}
	h.c.send(map[string]any{"t": "kick", "playerId": id})
	h.dirty = true
}

func (h *simHost) rematch(seed uint32) {
	h.c.send(map[string]any{"t": "rematch", "seed": seed})
	h.phase = phaseLobby
	h.dirty = false
	for _, e := range h.order {
		e.inRace = false
	}
}

// --- main-goroutine helpers -------------------------------------------------

func (h *simHost) expectError(want string) {
	h.await("host error "+want, stepWait, func() bool { return len(h.errs) > h.errUsed })
	h.with(func() {
		got := h.errs[h.errUsed]
		h.errUsed++
		h.sc.check(got == want, "host: error %q, want %q", got, want)
	})
}

func (h *simHost) hasLeft(id, reason string) bool {
	for _, l := range h.lefts {
		if l.id == id && l.reason == reason {
			return true
		}
	}
	return false
}

func (h *simHost) hasJoin(id string, reconnect bool) bool {
	for _, j := range h.joins {
		if j.id == id && j.reconnect == reconnect {
			return true
		}
	}
	return false
}

func (h *simHost) totalProgress() int {
	n := 0
	for _, e := range h.order {
		n += len(e.log)
	}
	return n
}

func (h *simHost) logLen(id string) int {
	if e := h.entries[id]; e != nil {
		return len(e.log)
	}
	return 0
}

// sync makes sure every relay message queued for the host before now has
// been handled (ping/pong round trip on the same socket).
func (h *simHost) sync() {
	var before int
	h.call(func() {
		before = h.pongs
		h.c.send(map[string]string{"t": "ping"})
	})
	h.await("host pong", stepWait, func() bool { return h.pongs > before })
}

func (h *simHost) drop() {
	h.call(func() {
		h.c.drop()
		h.c = nil
	})
}
