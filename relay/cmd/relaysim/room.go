package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
)

// sentStandings is a standings (or end) message exactly as the host sent
// it; players compare what they receive against it.
type sentStandings struct {
	race  int
	v     int
	top   []byte
	ranks map[string]json.RawMessage
	at    atomic.Int64 // unix nanos when written to the socket
}

// room is one relay room: a simulated host, its players and what the host
// sent. Its trace lines are written by one goroutine at a time.
type room struct {
	sc      *scenario
	idx     int
	tag     string // name prefix (rooms archetype)
	host    *simHost
	players []*simPlayer
	raceNo  int

	mu       sync.Mutex
	stand    map[int]*sentStandings
	finals   map[int]*sentStandings
	seeds    map[int][]byte
	settings map[int][]byte
	lines    []string
}

func (sc *scenario) newRoom(tag string) *room {
	sc.mu.Lock()
	rm := &room{sc: sc, idx: len(sc.rooms), tag: tag, stand: map[int]*sentStandings{},
		finals: map[int]*sentStandings{}, seeds: map[int][]byte{}, settings: map[int][]byte{}}
	sc.rooms = append(sc.rooms, rm)
	sc.mu.Unlock()
	rm.host = rm.newHost()
	return rm
}

func (rm *room) label(kind string, i int) string {
	if kind == "host" {
		return fmt.Sprintf("r%d/host", rm.idx)
	}
	return fmt.Sprintf("r%d/%s%d", rm.idx, kind, i)
}

func (rm *room) defaultName(i int) string {
	return fmt.Sprintf("%s%s %d", rm.tag, namePool[i%len(namePool)], i)
}

func (rm *room) tr(format string, a ...any) {
	rm.mu.Lock()
	rm.lines = append(rm.lines, fmt.Sprintf("r%d ", rm.idx)+fmt.Sprintf(format, a...))
	rm.mu.Unlock()
}

func (rm *room) putStandings(ss *sentStandings) {
	rm.mu.Lock()
	rm.stand[ss.v] = ss
	rm.mu.Unlock()
}

func (rm *room) standings(v int) *sentStandings {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.stand[v]
}

func (rm *room) putFinal(ss *sentStandings) {
	rm.mu.Lock()
	rm.finals[ss.race] = ss
	rm.mu.Unlock()
}

func (rm *room) final(race int) *sentStandings {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.finals[race]
}

func (rm *room) setRaceInfo(race int, seed, settings []byte) {
	rm.mu.Lock()
	rm.seeds[race], rm.settings[race] = seed, settings
	rm.mu.Unlock()
}

func (rm *room) raceInfo(race int) (seed, settings []byte) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.seeds[race], rm.settings[race]
}

// lastRace is the number of races started so far in the room.
func (rm *room) lastRace() int {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return len(rm.seeds)
}

func (rm *room) code() string {
	var c string
	rm.host.with(func() { c = rm.host.code })
	return c
}

func (rm *room) hostToken() string {
	var t string
	rm.host.with(func() { t = rm.host.token })
	return t
}

// --- flows (run on one goroutine per room) ----------------------------------

func (rm *room) create(s settings) {
	h := rm.host
	c := rm.sc.dial(rm.label("host", 0), h.inbox)
	h.call(func() { h.c = c })
	c.send(map[string]any{"t": "create", "settings": s})
	h.await("created", stepWait, func() bool { return h.epoch >= 1 })
	rm.tr("created phase=lobby")
}

// connect gives p a new socket (the previous one, if any, stays as is) and
// returns the previous one.
func (rm *room) connect(p *simPlayer) *wsConn {
	c := rm.sc.dial(p.label, p.inbox)
	var old *wsConn
	p.call(func() {
		old = p.c
		p.c = c
		p.online = false
	})
	return old
}

func (rm *room) connectAll(ps []*simPlayer) {
	rm.sc.parallel(len(ps), func(i int) { rm.connect(ps[i]) })
}

// join sends `join` on p's current socket and returns the error reason
// ("" when joined).
func (rm *room) join(p *simPlayer, code, name, token string) string {
	var before int
	p.with(func() { before = p.joinedN })
	msg := map[string]any{"t": "join", "code": code, "name": name}
	if token != "" {
		msg["playerToken"] = token
	}
	p.c.send(msg)
	p.await(p.label+" joined or error", stepWait, func() bool { return p.joinedN > before || len(p.errs) > p.errUsed })
	reason := ""
	p.with(func() {
		if p.joinedN == before {
			reason = p.errs[p.errUsed]
			p.errUsed++
		}
	})
	return reason
}

func (rm *room) mustJoin(p *simPlayer, token string) {
	r := rm.join(p, rm.code(), p.name, token)
	rm.sc.check(r == "", "%s: join refused: %s", p.label, r)
}

// joinAll connects ps concurrently, joins them one by one (so join order is
// deterministic) and checks the host and lobby views.
func (rm *room) joinAll(ps []*simPlayer) {
	rm.connectAll(ps)
	for _, p := range ps {
		rm.mustJoin(p, "")
	}
	rm.checkHostJoins(ps)
	rm.checkLobby(ps)
}

func names(ps []*simPlayer) []string {
	out := make([]string, len(ps))
	for i, p := range ps {
		out[i] = p.want
	}
	return out
}

// checkHostJoins waits until the host saw player_joined for every p with the
// sanitised name.
func (rm *room) checkHostJoins(ps []*simPlayer) {
	h := rm.host
	for _, p := range ps {
		id, _ := p.ID()
		h.await("player_joined "+p.label, stepWait, func() bool {
			for _, j := range h.joins {
				if j.id == id {
					return true
				}
			}
			return false
		})
		h.with(func() {
			name := h.entries[id].name
			rm.sc.check(name == p.want, "host: %s joined as %q, want %q", p.label, name, p.want)
		})
		rm.tr("join %s name=%q", p.label, p.want)
	}
}

// checkLobby waits until every player in ps has the lobby list ps.
func (rm *room) checkLobby(ps []*simPlayer) {
	want := names(ps)
	for _, p := range ps {
		p.await(p.label+" lobby "+strings.Join(want, ","), stepWait, func() bool { return slices.Equal(p.lobby, want) })
	}
	rm.tr("lobby %q", want)
}

// startRace hands out the scripts, sends `start` and waits until every racer
// got `started`.
func (rm *room) startRace(ps []*simPlayer, pl *racePlan) int {
	rm.raceNo++
	r := rm.raceNo
	for _, p := range ps {
		script := pl.scripts[p]
		gate, ok := pl.gates[p]
		if !ok {
			gate = -1
		}
		p.call(func() {
			p.scripts[r] = script
			p.gate = gate
		})
	}
	rm.host.call(func() { rm.host.start(pl, 3000) })
	for _, p := range ps {
		p.await(p.label+" started", stepWait, func() bool { return p.race >= r })
	}
	rm.tr("race%d start seed=%d settings=%+v players=%d gates=%d", r, pl.seed, pl.s, len(ps), len(pl.gates))
	return r
}

type finishOpts struct {
	gone  map[*simPlayer]bool // racers expected to be disconnected at the end
	exact bool                // the host saw every progress message (no host absence)
}

// finishRace waits for the host to end race r and checks progress delivery,
// the final ranking (against the scripts) and every racer's `ended`.
func (rm *room) finishRace(r int, racers []*simPlayer, o finishOpts) {
	h := rm.host
	h.await(fmt.Sprintf("host ends race %d", r), 0, func() bool { return h.endedRace >= r })
	for _, p := range racers {
		if !o.gone[p] {
			p.await(p.label+" ended", stepWait, func() bool { return p.ended[r] != nil })
		}
	}
	rm.verifyProgress(r, racers, o.exact)
	rm.verifyFinal(r, racers, o.gone)
}

func (rm *room) verifyProgress(r int, racers []*simPlayer, exact bool) {
	sc := rm.sc
	for _, p := range racers {
		var id string
		var sent []step
		p.with(func() { id, sent = p.id, slices.Clone(p.sent[r]) })
		var got []step
		rm.host.with(func() { got = slices.Clone(rm.host.entries[id].log) })
		sc.check(len(sent) > 0, "%s sent no progress in race %d", p.label, r)
		if exact {
			sc.check(slices.Equal(got, sent), "%s: host got progress %v, player sent %v", p.label, got, sent)
			continue
		}
		got = slices.Compact(got)
		sc.check(len(got) > 0 && got[len(got)-1] == sent[len(sent)-1] && isSubsequence(got, sent),
			"%s: host got progress %v, not an ordered subset of %v ending with the last one", p.label, got, sent)
	}
}

func isSubsequence(sub, seq []step) bool {
	i := 0
	for _, s := range seq {
		if i < len(sub) && sub[i] == s {
			i++
		}
	}
	return i == len(sub)
}

// verifyFinal recomputes the final ranking from the scripts and compares it
// with the host's `end` (which every player already matched byte for byte).
func (rm *room) verifyFinal(r int, racers []*simPlayer, gone map[*simPlayer]bool) {
	sc := rm.sc
	fin := rm.final(r)
	sc.check(fin != nil, "race %d: no final", r)
	var in []rankIn
	for _, p := range racers {
		var id string
		var last step
		p.with(func() {
			id = p.id
			if gone[p] {
				last = step{Status: stRacing}
				if s := p.sent[r]; len(s) > 0 {
					last = s[len(s)-1]
				}
			} else {
				s := p.scripts[r]
				last = s[len(s)-1]
			}
		})
		var idx int
		rm.host.with(func() { idx = rm.host.entries[id].idx })
		in = append(in, rankIn{id: id, name: p.want, idx: idx, status: last.Status, done: last.Done, ms: last.Ms, online: !gone[p]})
	}
	top, ranks := rankPlayers(in)
	sc.check(len(fin.ranks) == len(racers), "race %d: final has %d ranks, want %d", r, len(fin.ranks), len(racers))
	sc.check(bytes.Equal(fin.top, mustJSON(top)), "race %d: final top %s, want %s", r, fin.top, mustJSON(top))
	for _, p := range racers {
		var id string
		p.with(func() { id = p.id })
		var got rankRow
		sc.check(json.Unmarshal(fin.ranks[id], &got) == nil, "race %d: no final rank for %s", r, p.label)
		want := ranks[id]
		sc.check(got == want, "race %d: %s final %+v, want %+v", r, p.label, got, want)
		rm.tr("race%d final %s rank=%d/%d done=%d %s", r, p.label, got.Rank, got.Of, got.Done, got.Status)
	}
}

// rematch sends `rematch` and waits until every connected player got it,
// the new lobby list, and synced (see simPlayer "rematch"); then syncs the
// host so no stale progress can leak into the next race.
func (rm *room) rematch(ps []*simPlayer, seed uint32) {
	before := make([]int, len(ps))
	for i, p := range ps {
		p.with(func() { before[i] = p.rematchN })
	}
	rm.host.call(func() { rm.host.rematch(seed) })
	want := names(ps)
	for i, p := range ps {
		p.await(p.label+" rematch", stepWait, func() bool {
			return p.rematchN > before[i] && p.synced && slices.Equal(p.lobby, want)
		})
	}
	rm.host.sync()
	rm.tr("rematch seed=%d lobby %q", seed, want)
}

// resumeHost reconnects the host tab with create {code, hostToken}. With
// takeover the old tab is still open and must be closed with 4001. known
// lists the players the relay must replay, in join order.
func (rm *room) resumeHost(takeover bool, known []*simPlayer, wantPhase string) {
	h := rm.host
	nc := rm.sc.dial(rm.label("host", 0)+"'", h.inbox)
	var old *wsConn
	var ep int
	h.call(func() {
		old, ep = h.c, h.epoch
		h.c = nc
	})
	if takeover {
		old.expectClose(4001)
	}
	nc.send(map[string]any{"t": "create", "code": rm.code(), "hostToken": rm.hostToken()})
	h.await("created on resume", stepWait, func() bool { return h.epoch > ep })
	if takeover {
		code := old.awaitClosed(stepWait)
		rm.sc.check(code == 4001, "old host tab closed with %d, want 4001", code)
	}
	ids := make([]string, len(known))
	for i, p := range known {
		ids[i], _ = p.ID()
	}
	h.await("player_joined replay", stepWait, func() bool {
		n := 0
		for _, j := range h.joins {
			if j.epoch == ep+1 {
				n++
			}
		}
		return n >= len(ids)
	})
	h.with(func() {
		var got []string
		for _, j := range h.joins {
			if j.epoch == ep+1 {
				got = append(got, j.id)
			}
		}
		rm.sc.check(h.createdPhase == wantPhase, "resume: phase %s, want %s", h.createdPhase, wantPhase)
		rm.sc.check(slices.Equal(got, ids), "resume: replayed player_joined %v, want %v (join order)", got, ids)
	})
	rm.tr("host resumed takeover=%v phase=%s replayed=%d", takeover, wantPhase, len(ids))
}

func without(ps []*simPlayer, x *simPlayer) []*simPlayer {
	var out []*simPlayer
	for _, p := range ps {
		if p != x {
			out = append(out, p)
		}
	}
	return out
}

// waitStandings waits until p got at least one live standings.
func (p *simPlayer) waitStandings() {
	p.await(p.label+" standings", stepWait, func() bool { return p.standN > 0 })
}

func (rm *room) waitHostLog(p *simPlayer, n int) {
	id, _ := p.ID()
	rm.host.await(fmt.Sprintf("%d progress from %s", n, p.label), stepWait, func() bool { return rm.host.logLen(id) >= n })
}
