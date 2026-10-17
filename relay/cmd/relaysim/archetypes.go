package main

import (
	"encoding/json"
	"math/rand/v2"
	"slices"
	"strings"
	"time"

	"github.com/coder/websocket"
)

type archetype struct {
	name   string
	weight int
	slow   bool          // only with -slow
	extra  time.Duration // added to -timeout
	run    func(sc *scenario)
}

var archetypes = []archetype{
	{name: "race", weight: 22, run: scRace},
	{name: "rematch", weight: 8, run: scRematch},
	{name: "rematch_midrace", weight: 5, run: scRematchMidrace},
	{name: "kick_lobby", weight: 6, run: scKickLobby},
	{name: "kick_race", weight: 7, run: scKickRace},
	{name: "reconnect", weight: 8, run: scReconnect},
	{name: "dup_conn", weight: 6, run: scDupConn},
	{name: "reconnect_after_end", weight: 5, run: scReconnectAfterEnd},
	{name: "host_resume_race", weight: 7, run: scHostResumeRace},
	{name: "host_resume_lobby", weight: 4, run: scHostResumeLobby},
	{name: "host_takeover", weight: 5, run: scHostTakeover},
	{name: "late_join", weight: 6, run: scLateJoin},
	{name: "bad_input", weight: 6, run: scBadInput},
	{name: "capacity", weight: 3, run: scCapacity},
	{name: "rooms", weight: 4, run: scRooms},
	{name: "host_gone", weight: 3, slow: true, extra: 3 * time.Minute, run: scHostGone},
}

func pickArchetype(rng *rand.Rand, slow bool) *archetype {
	total := 0
	for _, a := range archetypes {
		if !a.slow || slow {
			total += a.weight
		}
	}
	x := rng.IntN(total)
	for i := range archetypes {
		a := &archetypes[i]
		if a.slow && !slow {
			continue
		}
		if x < a.weight {
			return a
		}
		x -= a.weight
	}
	panic("unreachable")
}

// race: 1-30 players race to the end; every progress reaches the host, every
// personalised standings/ended carries only the player's own rank, and the
// final ranking matches the rules applied to the scripts.
func scRace(sc *scenario) {
	n := 1 + sc.rng.IntN(30)
	s := sc.genSettings(allN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	pl := sc.planRace(ps, s)
	sc.describe("players=%d n=%d", n, s.N)

	rm.create(s)
	rm.joinAll(ps)
	r := rm.startRace(ps, pl)
	rm.finishRace(r, ps, finishOpts{exact: true})
}

// rematch: a full race, rematch {seed}, then a second race in the same room
// without anyone re-joining.
func scRematch(sc *scenario) {
	n := 1 + sc.rng.IntN(8)
	s1, s2 := sc.genSettings(smallN), sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	pl1 := sc.planRace(ps, s1)
	seed := sc.rng.Uint32()
	pl2 := sc.planRace(ps, s2)
	sc.describe("players=%d n=%d,%d", n, s1.N, s2.N)

	rm.create(s1)
	rm.joinAll(ps)
	r1 := rm.startRace(ps, pl1)
	rm.finishRace(r1, ps, finishOpts{exact: true})
	rm.rematch(ps, seed)
	r2 := rm.startRace(ps, pl2)
	rm.finishRace(r2, ps, finishOpts{exact: true})
}

// rematch_midrace: rematch while a player is still racing (stalled), then a
// clean second race.
func scRematchMidrace(sc *scenario) {
	n := 2 + sc.rng.IntN(7)
	s1, s2 := sc.genSettings(smallN), sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	g := ps[sc.rng.IntN(n)]
	pl1 := sc.planRace(ps, s1, g)
	seed := sc.rng.Uint32()
	pl2 := sc.planRace(ps, s2)
	sc.describe("players=%d n=%d,%d stalled=%s@%d", n, s1.N, s2.N, g.label, pl1.gates[g])

	rm.create(s1)
	rm.joinAll(ps)
	rm.startRace(ps, pl1)
	rm.waitHostLog(g, pl1.gates[g])
	rm.rematch(ps, seed)
	r2 := rm.startRace(ps, pl2)
	rm.finishRace(r2, ps, finishOpts{exact: true})
}

// kick_lobby: kick in the lobby (kicked + 4000, player_left kicked, lobby
// update); the forgotten token then gives a fresh player.
func scKickLobby(sc *scenario) {
	n := 3 + sc.rng.IntN(6)
	s := sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	t := ps[sc.rng.IntN(n)]
	pl := sc.planRace(ps, s)
	sc.describe("players=%d n=%d kick=%s", n, s.N, t.label)

	rm.create(s)
	rm.joinAll(ps)
	oldID, oldToken := t.ID()
	rm.kick(t)
	others := without(ps, t)
	rm.checkLobby(others)

	rm.connect(t)
	rm.mustJoin(t, oldToken)
	newID, _ := t.ID()
	sc.check(newID != oldID, "%s: rejoined with the kicked token and kept id %s", t.label, oldID)
	order := append(others, t)
	rm.checkHostJoins([]*simPlayer{t})
	rm.checkLobby(order)
	rm.tr("%s rejoined with its forgotten token as a new player", t.label)
	r := rm.startRace(order, pl)
	rm.finishRace(r, order, finishOpts{exact: true})
}

// kick waits for kicked + close 4000 on t and player_left kicked on the host.
func (rm *room) kick(t *simPlayer) {
	id, _ := t.ID()
	var c *wsConn
	t.with(func() { c = t.c })
	c.expectClose(4000)
	rm.host.call(func() { rm.host.kick(id) })
	t.await(t.label+" kicked", stepWait, func() bool { return t.kickedN > 0 })
	code := c.awaitClosed(stepWait)
	rm.sc.check(code == 4000, "%s: kicked socket closed with %d, want 4000", t.label, code)
	rm.host.await("player_left kicked", stepWait, func() bool { return rm.host.hasLeft(id, "kicked") })
	rm.tr("kick %s: kicked, close 4000, host player_left kicked", t.label)
}

// kick_race: kick a racer mid-race; the race ends without it (of = n-1) and
// its token no longer gets it back in (started).
func scKickRace(sc *scenario) {
	n := 2 + sc.rng.IntN(7)
	s := sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	t := ps[sc.rng.IntN(n)]
	pl := sc.planRace(ps, s, t)
	sc.describe("players=%d n=%d kick=%s@%d", n, s.N, t.label, pl.gates[t])

	rm.create(s)
	rm.joinAll(ps)
	r := rm.startRace(ps, pl)
	rm.waitHostLog(t, pl.gates[t])
	_, token := t.ID()
	rm.kick(t)

	rm.connect(t)
	got := rm.join(t, rm.code(), t.name, token)
	sc.check(got == "started", "%s: rejoin after kick mid-race: %q, want started", t.label, got)
	rm.tr("%s rejoin after kick: started", t.label)
	rm.finishRace(r, without(ps, t), finishOpts{exact: true})
}

// stallAndDrop waits until t stalled at its gate (host saw it, t got a
// standings) and drops its socket; the host must see player_left disconnected.
func (rm *room) stallAndDrop(t *simPlayer, gate int) {
	rm.waitHostLog(t, gate)
	t.waitStandings()
	id, _ := t.ID()
	t.drop()
	rm.host.await("player_left disconnected", stepWait, func() bool { return rm.host.hasLeft(id, "disconnected") })
	rm.tr("%s dropped after %d answers: host player_left disconnected", t.label, gate)
}

// reconnect: drop mid-race, come back with playerToken (other name sent: the
// original is kept), same playerId, replayed standings, then finish.
func scReconnect(sc *scenario) {
	n := 1 + sc.rng.IntN(8)
	s := sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	t := ps[sc.rng.IntN(n)]
	pl := sc.planRace(ps, s, t)
	sc.describe("players=%d n=%d reconnect=%s@%d", n, s.N, t.label, pl.gates[t])

	rm.create(s)
	rm.joinAll(ps)
	r := rm.startRace(ps, pl)
	rm.stallAndDrop(t, pl.gates[t])
	oldID, token := t.ID()
	rm.connect(t)
	got := rm.join(t, rm.code(), "Someone Else", token)
	sc.check(got == "", "%s: reconnect refused: %s", t.label, got)
	rm.checkRejoined(t, oldID, phaseRacing, r)
	t.await(t.label+" replayed standings", stepWait, func() bool { return t.replays > 0 })
	rm.tr("%s replayed standings received", t.label)
	t.releaseGate()
	rm.finishRace(r, ps, finishOpts{exact: true})
}

// checkRejoined checks a token reconnect: same id, phase and seed, and the
// host's player_joined {reconnect: true} with the original name.
func (rm *room) checkRejoined(t *simPlayer, oldID, phase string, race int) {
	var id, jPhase string
	var jSeed []byte
	t.with(func() { id, jPhase, jSeed = t.id, t.jPhase, t.jSeed })
	seed, _ := rm.raceInfo(race)
	rm.sc.check(id == oldID, "%s: reconnected as %s, want %s", t.label, id, oldID)
	rm.sc.check(jPhase == phase && string(jSeed) == string(seed), "%s: joined phase=%s seed=%s, want %s/%s", t.label, jPhase, jSeed, phase, seed)
	rm.host.await("player_joined reconnect", stepWait, func() bool { return rm.host.hasJoin(oldID, true) })
	rm.tr("%s reconnected: same id, phase=%s, host player_joined reconnect", t.label, phase)
}

// dup_conn: a second socket with the same token takes over (old one 4001),
// the host sees a reconnect but no player_left.
func scDupConn(sc *scenario) {
	n := 1 + sc.rng.IntN(8)
	s := sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	t := ps[sc.rng.IntN(n)]
	pl := sc.planRace(ps, s, t)
	sc.describe("players=%d n=%d dup=%s@%d", n, s.N, t.label, pl.gates[t])

	rm.create(s)
	rm.joinAll(ps)
	r := rm.startRace(ps, pl)
	rm.waitHostLog(t, pl.gates[t])
	oldID, token := t.ID()
	var oldConn *wsConn
	t.with(func() { oldConn = t.c })
	oldConn.expectClose(4001)
	rm.connect(t)
	rm.mustJoin(t, token)
	code := oldConn.awaitClosed(stepWait)
	sc.check(code == 4001, "%s: replaced socket closed with %d, want 4001", t.label, code)
	rm.checkRejoined(t, oldID, phaseRacing, r)
	t.releaseGate()
	rm.finishRace(r, ps, finishOpts{exact: true})
	rm.host.with(func() {
		sc.check(!rm.host.hasLeft(oldID, "disconnected"), "host got player_left for a replaced socket")
	})
	rm.tr("%s replaced socket: close 4001, no player_left", t.label)
}

// reconnect_after_end: a racer drops, the race ends with it disconnected,
// it comes back and gets the replayed `ended`.
func scReconnectAfterEnd(sc *scenario) {
	n := 2 + sc.rng.IntN(5)
	s := sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	t := ps[sc.rng.IntN(n)]
	pl := sc.planRace(ps, s, t)
	sc.describe("players=%d n=%d gone=%s@%d", n, s.N, t.label, pl.gates[t])

	rm.create(s)
	rm.joinAll(ps)
	id, token := t.ID()
	rm.host.call(func() { rm.host.gone[id] = true })
	r := rm.startRace(ps, pl)
	rm.stallAndDrop(t, pl.gates[t])
	rm.finishRace(r, ps, finishOpts{gone: map[*simPlayer]bool{t: true}, exact: true})

	rm.connect(t)
	rm.mustJoin(t, token)
	rm.checkRejoined(t, id, phaseEnded, r)
	t.await(t.label+" replayed ended", stepWait, func() bool { return t.ended[r] != nil })
	rm.tr("%s replayed ended received", t.label)
}

// host_resume_race: the host tab drops mid-race and comes back with
// hostToken; players keep racing and the race still completes.
func scHostResumeRace(sc *scenario) {
	n := 1 + sc.rng.IntN(10)
	s := sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	pl := sc.planRace(ps, s)
	threshold := 1 + sc.rng.IntN(n)
	absence := time.Duration(200+sc.rng.IntN(800)) * time.Millisecond
	sc.describe("players=%d n=%d drop_after=%d absence=%s", n, s.N, threshold, absence)

	rm.create(s)
	rm.joinAll(ps)
	r := rm.startRace(ps, pl)
	rm.host.await("progress before host drop", stepWait, func() bool { return rm.host.totalProgress() >= threshold })
	rm.host.drop()
	sc.sleep(absence)
	rm.resumeHost(false, ps, phaseRacing)
	rm.finishRace(r, ps, finishOpts{})
}

// host_resume_lobby: the host drops in the lobby, a player joins meanwhile,
// the resumed host gets every player replayed and runs the race.
func scHostResumeLobby(sc *scenario) {
	n := 1 + sc.rng.IntN(5)
	s := sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n + 1)
	pl := sc.planRace(ps, s)
	sc.describe("players=%d n=%d", n+1, s.N)

	rm.create(s)
	rm.joinAll(ps[:n])
	rm.host.drop()
	late := ps[n]
	rm.connect(late)
	rm.mustJoin(late, "")
	rm.checkLobby(ps)
	rm.tr("%s joined while the host was away", late.label)
	rm.resumeHost(false, ps, phaseLobby)
	r := rm.startRace(ps, pl)
	rm.finishRace(r, ps, finishOpts{exact: true})
}

// host_takeover: a second host tab resumes while the first is still open;
// the first gets 4001. A stalled racer keeps the race open meanwhile.
func scHostTakeover(sc *scenario) {
	n := 1 + sc.rng.IntN(10)
	s := sc.genSettings(smallN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	g := ps[sc.rng.IntN(n)]
	pl := sc.planRace(ps, s, g)
	threshold := 1 + sc.rng.IntN(n)
	sc.describe("players=%d n=%d takeover_after=%d stalled=%s@%d", n, s.N, threshold, g.label, pl.gates[g])

	rm.create(s)
	rm.joinAll(ps)
	r := rm.startRace(ps, pl)
	rm.host.await("progress before takeover", stepWait, func() bool { return rm.host.totalProgress() >= threshold })
	rm.resumeHost(true, ps, phaseRacing)
	g.releaseGate()
	rm.finishRace(r, ps, finishOpts{})
}

// late_join: joins are refused while racing and after the end (started),
// and accepted again after a rematch.
func scLateJoin(sc *scenario) {
	n := 2 + sc.rng.IntN(5)
	s := sc.genSettings(tenN)
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	late := rm.newPlayers(1)[0]
	g := ps[sc.rng.IntN(n)]
	pl1 := sc.planRace(ps, s, g)
	seed := sc.rng.Uint32()
	all := append(slices.Clone(ps), late)
	pl2 := sc.planRace(all, s)
	sc.describe("players=%d n=%d", n, s.N)

	rm.create(s)
	rm.joinAll(ps)
	r1 := rm.startRace(ps, pl1)
	rm.connect(late)
	got := rm.join(late, rm.code(), late.name, "")
	sc.check(got == "started", "join while racing: %q, want started", got)
	rm.tr("join while racing: started")
	g.releaseGate()
	rm.finishRace(r1, ps, finishOpts{exact: true})
	got = rm.join(late, rm.code(), late.name, "")
	sc.check(got == "started", "join after the end: %q, want started", got)
	rm.tr("join after end: started")
	rm.rematch(ps, seed)
	rm.mustJoin(late, "")
	rm.checkHostJoins([]*simPlayer{late})
	rm.checkLobby(all)
	r2 := rm.startRace(all, pl2)
	rm.finishRace(r2, all, finishOpts{exact: true})
}

// bad_input: malformed, wrong-role and wrong-phase messages, bad codes and
// names, oversized frames (1009) and, sometimes, a flood (1008).
func scBadInput(sc *scenario) {
	n := 1 + sc.rng.IntN(2)
	s := sc.genSettings(tenN)
	flood := sc.rng.IntN(10) < 3
	bad := sc.badCode()
	rm := sc.newRoom("")
	ps := rm.newPlayers(n)
	x := rm.newPlayerNamed("  Al\x07i\x00ce  ")
	y := rm.newPlayerNamed(strings.Repeat("Åsa😀", 10))
	all := append(slices.Clone(ps), x, y)
	pl := sc.planRace(all, s, x)
	sc.describe("players=%d flood=%v", len(all), flood)

	rm.create(s)
	rm.joinAll(ps)
	code := rm.code()
	rm.connectAll([]*simPlayer{x, y})

	// Before joining: garbage, then failed joins; the socket stays usable.
	x.c.sendRaw([]byte("hello"), false)
	x.expectError("bad_request")
	x.c.send(map[string]any{"t": "progress", "done": 1, "status": "racing", "elapsedMs": 1})
	x.expectError("bad_request")
	for _, tc := range []struct{ code, name, want string }{
		{bad, "Kim", "not_found"},
		{code, "", "bad_name"},
		{code, " \t  ", "bad_name"},
		{code, "\x01\x02\x7f", "bad_name"},
	} {
		got := rm.join(x, tc.code, tc.name, "")
		sc.check(got == tc.want, "join code=%q name=%q: %q, want %q", tc.code, tc.name, got, tc.want)
		rm.tr("join name=%q: %s", tc.name, got)
	}
	got := rm.join(x, " "+strings.ToLower(code)+" ", x.name, "")
	sc.check(got == "", "join with lower-case padded code: %q", got)
	rm.mustJoin(y, "")
	rm.checkHostJoins([]*simPlayer{x, y})
	rm.checkLobby(all)

	// Wrong role / unknown messages from a player.
	x.c.send(map[string]any{"t": "start", "seed": 1})
	x.expectError("bad_request")
	x.c.send(map[string]any{"t": "foo"})
	x.expectError("bad_request")
	x.c.sendRaw([]byte(`{"t":"ping"}`), true)
	x.expectError("bad_request")
	x.c.send(map[string]any{"t": "join", "code": code, "name": "Again"})
	x.expectError("bad_request")
	rm.tr("player wrong-role messages: bad_request")

	// Host messages in the wrong phase; kicking an unknown id is silent.
	h := rm.host
	var hc *wsConn
	h.with(func() { hc = h.c })
	hc.send(map[string]any{"t": "standings", "v": 1, "top": []any{}, "ranks": map[string]any{}})
	h.expectError("not_allowed")
	hc.send(map[string]any{"t": "end", "final": map[string]any{"top": []any{}, "ranks": map[string]any{}}})
	h.expectError("not_allowed")
	hc.send(map[string]any{"t": "rematch", "seed": 1})
	h.expectError("not_allowed")
	hc.send(map[string]any{"t": "kick", "playerId": "00000000"})
	hc.send(map[string]any{"t": "bogus"})
	h.expectError("bad_request")
	hc.send(map[string]any{"t": "start", "settings": s})
	h.expectError("bad_request")
	rm.tr("host wrong-phase messages: not_allowed / bad_request")

	// Resume attempts with a wrong token or code.
	z := rm.newPlayerNamed("probe")
	rm.connect(z)
	z.c.send(map[string]any{"t": "create", "code": code, "hostToken": strings.Repeat("0", 32)})
	z.expectError("bad_token")
	z.c.send(map[string]any{"t": "create", "code": bad, "hostToken": rm.hostToken()})
	z.expectError("not_found")
	z.c.send(map[string]any{"t": "ping"})
	z.await("probe pong", stepWait, func() bool { return z.pongs > 0 })
	rm.tr("resume with bad token/code: bad_token, not_found; socket still open")

	// Oversized message: closed with 1009.
	o := rm.newPlayerNamed("big")
	rm.connect(o)
	o.c.expectClose(websocket.StatusMessageTooBig)
	o.c.sendRaw([]byte(`{"t":"ping","pad":"`+strings.Repeat("x", 5000)+`"}`), false)
	cc := o.c.awaitClosed(stepWait)
	sc.check(cc == websocket.StatusMessageTooBig, "oversized message: close %d, want 1009", cc)
	rm.tr("oversized message: close 1009")

	if flood {
		f := rm.newPlayerNamed("flood")
		rm.connect(f)
		f.c.expectClose(websocket.StatusPolicyViolation)
		for range 40 {
			if f.c.ws.Write(f.c.ctx, websocket.MessageText, []byte(`{"t":"ping"}`)) != nil {
				break
			}
		}
		f.expectError("rate_limited")
		cc := f.c.awaitClosed(stepWait)
		sc.check(cc == websocket.StatusPolicyViolation, "flood: close %d, want 1008", cc)
		rm.tr("flood: rate_limited, close 1008")
	}

	// Invalid progress during the race; x is stalled so the race is open.
	r := rm.startRace(all, pl)
	x.c.send(map[string]any{"t": "progress", "done": 1, "status": "flying", "elapsedMs": 1})
	x.expectError("bad_request")
	x.c.send(map[string]any{"t": "progress", "done": -1, "status": "racing", "elapsedMs": 1})
	x.expectError("bad_request")
	x.c.send(map[string]any{"t": "progress", "done": 1, "status": "racing"})
	x.expectError("bad_request")
	rm.tr("invalid progress: bad_request")
	x.releaseGate()
	rm.finishRace(r, all, finishOpts{exact: true})
}

// capacity: MAX_PLAYERS join, the next one gets full (and gets in once a
// seat frees up), joins after start get started, the host ends mid-race.
func scCapacity(sc *scenario) {
	m := sc.sim.cfg.maxPlayers
	s := settings{Cup: "mul", N: 10, Difficulty: "easy"}
	rm := sc.newRoom("")
	ps := rm.newPlayers(m)
	extra := rm.newPlayers(1)[0]
	late := rm.newPlayers(1)[0]
	racers := append(slices.Clone(ps[1:]), extra)
	pl := sc.planRace(racers, s)
	sc.describe("players=%d", m)

	rm.create(s)
	rm.joinAll(ps)
	rm.connect(extra)
	got := rm.join(extra, rm.code(), extra.name, "")
	sc.check(got == "full", "join #%d: %q, want full", m+1, got)
	rm.tr("join #%d: full", m+1)
	id0, _ := ps[0].ID()
	ps[0].drop()
	rm.host.await("player_left disconnected", stepWait, func() bool { return rm.host.hasLeft(id0, "disconnected") })
	rm.mustJoin(extra, "")
	rm.checkHostJoins([]*simPlayer{extra})
	rm.checkLobby(racers)
	rm.tr("seat freed: join retried on the same socket")

	rm.host.call(func() { rm.host.autoEnd = false })
	r := rm.startRace(racers, pl)
	rm.connect(late)
	got = rm.join(late, rm.code(), late.name, "")
	sc.check(got == "started", "join after start: %q, want started", got)
	rm.tr("join after start: started")
	rm.host.await("first standings", stepWait, func() bool { return rm.host.sentRace > 0 })
	rm.host.call(func() { rm.host.end() })
	for _, p := range racers {
		p.await(p.label+" ended", stepWait, func() bool { return p.ended[r] != nil })
		var me rankRow
		p.with(func() { _ = json.Unmarshal(p.ended[r], &me) })
		sc.check(me.Of == m, "%s: ended of=%d, want %d", p.label, me.Of, m)
	}
	rm.tr("host ended mid-race: %d players got ended of=%d", len(racers), m)
}

// rooms: several rooms at once; codes are unique and each host only sees
// its own players.
func scRooms(sc *scenario) {
	k := 3 + sc.rng.IntN(8)
	type plan struct {
		rm *room
		ps []*simPlayer
		s  settings
		pl *racePlan
	}
	plans := make([]plan, k)
	total := 0
	for i := range plans {
		rm := sc.newRoom(string(rune('A'+i)) + "-")
		ps := rm.newPlayers(1 + sc.rng.IntN(3))
		s := sc.genSettings(tenN)
		plans[i] = plan{rm, ps, s, sc.planRace(ps, s)}
		total += len(ps)
	}
	sc.describe("rooms=%d players=%d", k, total)
	sc.parallel(k, func(i int) {
		p := plans[i]
		p.rm.create(p.s)
		p.rm.joinAll(p.ps)
		h := p.rm.host
		h.with(func() {
			sc.check(len(h.joins) == len(p.ps), "room %d: host saw %d joins, want %d", i, len(h.joins), len(p.ps))
			for _, j := range h.joins {
				sc.check(strings.HasPrefix(j.name, p.rm.tag), "room %d: foreign player %q", i, j.name)
			}
		})
		r := p.rm.startRace(p.ps, p.pl)
		p.rm.finishRace(r, p.ps, finishOpts{exact: true})
	})
	codes := map[string]bool{}
	for _, p := range plans {
		codes[p.rm.code()] = true
	}
	sc.check(len(codes) == k, "%d rooms got only %d distinct codes", k, len(codes))
	sc.tr("rooms=%d distinct codes", k)
}

// host_gone (-slow): the host never comes back; after the 2 min grace the
// players get closed {host_gone} + 4002 and the code is gone.
func scHostGone(sc *scenario) {
	rm := sc.newRoom("")
	ps := rm.newPlayers(2)
	s := sc.genSettings(tenN)
	sc.describe("players=2")

	rm.create(s)
	rm.joinAll(ps)
	code, token := rm.code(), rm.hostToken()
	conns := make([]*wsConn, len(ps))
	for i, p := range ps {
		p.with(func() { conns[i] = p.c })
		conns[i].expectClose(4002)
	}
	rm.host.drop()
	for i, p := range ps {
		p.await(p.label+" closed host_gone", 2*time.Minute+30*time.Second, func() bool { return p.closed == "host_gone" })
		cc := conns[i].awaitClosed(stepWait)
		sc.check(cc == 4002, "%s: close %d, want 4002", p.label, cc)
	}
	rm.tr("host gone past grace: closed host_gone, 4002")
	z := rm.newPlayerNamed("probe")
	rm.connect(z)
	z.c.send(map[string]any{"t": "create", "code": code, "hostToken": token})
	z.expectError("not_found")
	sc.sim.releaseCode(code, 0)
	rm.tr("resume after grace: not_found")
}
