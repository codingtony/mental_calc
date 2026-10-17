package main

import (
	"bytes"
	"encoding/json"
	"time"
)

// simPlayer plays one kid: it joins, follows its scripted race (one
// `progress` per correct answer, crash or finish, at scripted elapsed times
// compressed by -speed) and verifies every personalised message it gets.
type simPlayer struct {
	actor
	rm    *room
	idx   int
	label string
	name  string // name sent in `join`
	want  string // name the relay should report (cleanName)

	c      *wsConn
	online bool

	id, token string
	joinedN   int
	jPhase    string
	jSeed     []byte
	jSettings []byte
	lobby     []string
	lobbyN    int

	race    int // number of `started` received
	scripts map[int][]step
	sent    map[int][]step
	stepIdx int
	gate    int // stall before sending step #gate (-1: never)
	racing  bool
	t0      time.Time
	timer   *time.Timer

	standN     int
	replayNext bool
	replays    int
	ended      map[int][]byte // race → raw `me` of `ended`
	rematchN   int
	syncPing   bool
	synced     bool
	kickedN    int
	pongs      int
	errs       []string
	errUsed    int
	closed     string
}

func (rm *room) newPlayerNamed(name string) *simPlayer {
	p := &simPlayer{rm: rm, idx: len(rm.players), name: name, want: cleanName(name), gate: -1,
		scripts: map[int][]step{}, sent: map[int][]step{}, ended: map[int][]byte{}}
	p.label = rm.label("p", p.idx)
	p.init(rm.sc)
	rm.players = append(rm.players, p)
	go p.run()
	return p
}

func (rm *room) newPlayers(n int) []*simPlayer {
	ps := make([]*simPlayer, n)
	for i := range ps {
		ps[i] = rm.newPlayerNamed(rm.defaultName(len(rm.players)))
	}
	return ps
}

func (p *simPlayer) run() {
	for {
		var tc <-chan time.Time
		if p.timer != nil {
			tc = p.timer.C
		}
		select {
		case <-p.sc.ctx.Done():
			return
		case m := <-p.inbox:
			p.mu.Lock()
			p.handle(m)
			p.bump()
			p.mu.Unlock()
		case f := <-p.cmds:
			p.mu.Lock()
			f()
			p.bump()
			p.mu.Unlock()
		case <-tc:
			p.mu.Lock()
			p.timer = nil
			p.fire()
			p.bump()
			p.mu.Unlock()
		}
	}
}

func (p *simPlayer) handle(m inMsg) {
	sc := p.sc
	if m.closed {
		if m.c == p.c {
			p.online = false
			p.stopTimer()
		}
		return
	}
	// Messages a replaced socket delivered before closing are still checked.
	switch m.t {
	case "standings":
		p.onStandings(m)
		return
	case "ended":
		p.onEnded(m)
		return
	case "error":
		r := m.str("reason")
		p.errs = append(p.errs, r)
		sc.sim.countError(r)
		return
	case "pong":
		p.pongs++
		if p.syncPing {
			p.syncPing, p.synced = false, true
		}
		return
	}
	if m.c != p.c {
		return
	}
	switch m.t {
	case "joined":
		var j struct {
			PlayerID    string          `json:"playerId"`
			PlayerToken string          `json:"playerToken"`
			Phase       string          `json:"phase"`
			Settings    json.RawMessage `json:"settings"`
			Seed        json.RawMessage `json:"seed"`
		}
		_ = json.Unmarshal(m.raw, &j)
		if len(j.PlayerID) != 8 || len(j.PlayerToken) != 32 {
			sc.failf("%s: bad joined %s", p.label, m.raw)
		}
		p.id, p.token = j.PlayerID, j.PlayerToken
		p.joinedN++
		p.jPhase, p.jSeed, p.jSettings = j.Phase, j.Seed, j.Settings
		p.online = true
		switch j.Phase {
		case phaseLobby:
			p.race = p.rm.lastRace() // the next `started` is the room's next race
		case phaseRacing:
			p.replayNext = true
			// Back after a drop: resend the latest state, then go on.
			if sent := p.sent[p.race]; len(sent) > 0 && p.ended[p.race] == nil {
				p.c.send(progressOut(sent[len(sent)-1]))
				p.sent[p.race] = append(sent, sent[len(sent)-1])
			}
			p.schedule()
		case phaseEnded:
			p.racing = false
			p.stopTimer()
		}
	case "lobby":
		var l struct {
			Names []string `json:"names"`
		}
		_ = json.Unmarshal(m.raw, &l)
		p.lobby = l.Names
		p.lobbyN++
	case "started":
		var s struct {
			Seed        json.RawMessage `json:"seed"`
			Settings    json.RawMessage `json:"settings"`
			CountdownMs float64         `json:"countdownMs"`
		}
		_ = json.Unmarshal(m.raw, &s)
		p.race++
		seed, set := p.rm.raceInfo(p.race)
		if !bytes.Equal(s.Seed, seed) || !bytes.Equal(s.Settings, set) {
			sc.failf("%s: started %s, want seed %s settings %s", p.label, m.raw, seed, set)
		}
		script := p.scripts[p.race]
		if script == nil {
			sc.failf("%s: started race %d without a script", p.label, p.race)
			return
		}
		p.stepIdx = 0
		p.sent[p.race] = nil
		p.racing = true
		p.t0 = m.at.Add(time.Duration(s.CountdownMs / p.sc.sim.cfg.speed * float64(time.Millisecond)))
		p.schedule()
	case "rematch":
		p.rematchN++
		p.racing = false
		p.stopTimer()
		// Ping after `rematch`: once the pong is back, every progress sent
		// before it has reached the relay's room (dropped in the lobby).
		p.synced, p.syncPing = false, true
		p.c.send(map[string]string{"t": "ping"})
	case "kicked":
		p.kickedN++
		p.racing = false
		p.stopTimer()
	case "closed":
		p.closed = m.str("reason")
	default:
		sc.failf("%s: unexpected message %s", p.label, m.raw)
	}
}

func progressOut(s step) any {
	return struct {
		T string `json:"t"`
		step
	}{"progress", s}
}

func (p *simPlayer) stopTimer() {
	if p.timer != nil {
		p.timer.Stop()
		p.timer = nil
	}
}

func (p *simPlayer) stepAt(i int) time.Time {
	ms := p.scripts[p.race][i].Ms
	return p.t0.Add(time.Duration(ms / p.sc.sim.cfg.speed * float64(time.Millisecond)))
}

func (p *simPlayer) schedule() {
	p.stopTimer()
	if !p.racing || !p.online || p.stepIdx >= len(p.scripts[p.race]) || p.stepIdx == p.gate {
		return
	}
	p.timer = time.NewTimer(time.Until(p.stepAt(p.stepIdx)))
}

func (p *simPlayer) fire() {
	script := p.scripts[p.race]
	if !p.racing || !p.online || p.stepIdx >= len(script) || p.stepIdx == p.gate {
		return
	}
	s := script[p.stepIdx]
	p.c.send(progressOut(s))
	p.sent[p.race] = append(p.sent[p.race], s)
	p.stepIdx++
	if p.stepIdx >= len(script) {
		p.racing = false
	}
	p.schedule()
}

// releaseGate lets a stalled player go on; the remaining steps keep their
// scripted elapsed times but are shifted so none is overdue.
func (p *simPlayer) releaseGate() {
	p.call(func() {
		p.gate = -1
		if p.racing && p.stepIdx < len(p.scripts[p.race]) {
			if late := time.Since(p.stepAt(p.stepIdx)); late > 0 {
				p.t0 = p.t0.Add(late)
			}
		}
		p.schedule()
	})
}

// onStandings checks that the message is the host's standings with this
// player's own `me` (byte for byte) and nothing else.
func (p *simPlayer) onStandings(m inMsg) {
	sc := p.sc
	for k := range m.f {
		if k != "t" && k != "v" && k != "top" && k != "me" {
			sc.failf("%s: standings has extra field %q: %s", p.label, k, m.raw)
			return
		}
	}
	var v int
	_ = json.Unmarshal(m.f["v"], &v)
	ss := p.rm.standings(v)
	if ss == nil {
		sc.failf("%s: standings with unknown v=%d: %s", p.label, v, m.raw)
		return
	}
	if ss.race != p.race {
		sc.failf("%s: standings v=%d of race %d during race %d", p.label, v, ss.race, p.race)
		return
	}
	if !bytes.Equal(m.f["top"], ss.top) {
		sc.failf("%s: standings top %s, host sent %s", p.label, m.f["top"], ss.top)
		return
	}
	want := ss.ranks[p.id]
	if want == nil {
		want = json.RawMessage("null")
	}
	if !bytes.Equal(m.f["me"], want) {
		sc.failf("%s (%s): standings me %s, own rank is %s", p.label, p.id, m.f["me"], want)
		return
	}
	p.standN++
	if p.replayNext {
		p.replayNext = false
		p.replays++
		return
	}
	if at := ss.at.Load(); at > 0 {
		sc.sim.addLatency(m.at.Sub(time.Unix(0, at)))
	}
}

func (p *simPlayer) onEnded(m inMsg) {
	sc := p.sc
	for k := range m.f {
		if k != "t" && k != "top" && k != "me" {
			sc.failf("%s: ended has extra field %q: %s", p.label, k, m.raw)
			return
		}
	}
	fin := p.rm.final(p.race)
	if fin == nil {
		sc.failf("%s: ended without an end from the host (race %d): %s", p.label, p.race, m.raw)
		return
	}
	want := fin.ranks[p.id]
	if want == nil {
		want = json.RawMessage("null")
	}
	if !bytes.Equal(m.f["top"], fin.top) || !bytes.Equal(m.f["me"], want) {
		sc.failf("%s (%s): ended %s, want top %s me %s", p.label, p.id, m.raw, fin.top, want)
		return
	}
	if p.ended[p.race] != nil {
		sc.failf("%s: second ended for race %d", p.label, p.race)
	}
	p.ended[p.race] = m.f["me"]
	p.replayNext = false
	p.racing = false
	p.stopTimer()
}

// --- main-goroutine helpers -------------------------------------------------

func (p *simPlayer) expectError(want string) {
	p.await(p.label+" error "+want, stepWait, func() bool { return len(p.errs) > p.errUsed })
	p.with(func() {
		got := p.errs[p.errUsed]
		p.errUsed++
		p.sc.check(got == want, "%s: error %q, want %q", p.label, got, want)
	})
}

func (p *simPlayer) ID() (id, token string) {
	p.with(func() { id, token = p.id, p.token })
	return id, token
}

// drop simulates a lost connection.
func (p *simPlayer) drop() {
	p.call(func() {
		p.c.drop()
		p.online = false
		p.stopTimer()
	})
}
