package main

import (
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"math"
	"strings"
	"time"
)

const (
	phaseLobby  = "lobby"
	phaseRacing = "racing"
	phaseEnded  = "ended"
)

// Events posted to a room's inbox.
type (
	msgEvent struct {
		c   *client
		t   string
		raw []byte
	}
	leaveEvent    struct{ c *client }
	shutdownEvent struct{}
	joinReq       struct {
		c     *client
		name  string
		token string
		look  json.RawMessage // opaque rider look, already size/shape checked; nil if none
		reply chan string
	}
	resumeReq struct {
		c     *client
		token string
		reply chan string
	}
)

// Outgoing messages built by the relay.
type (
	createdMsg struct {
		T         string `json:"t"`
		Code      string `json:"code"`
		HostToken string `json:"hostToken"`
		Phase     string `json:"phase"`
	}
	joinedMsg struct {
		T           string          `json:"t"`
		PlayerID    string          `json:"playerId"`
		PlayerToken string          `json:"playerToken"`
		Settings    json.RawMessage `json:"settings"`
		Phase       string          `json:"phase"`
		Seed        json.RawMessage `json:"seed,omitempty"`
	}
	playerJoinedMsg struct {
		T         string          `json:"t"`
		PlayerID  string          `json:"playerId"`
		Name      string          `json:"name"`
		Reconnect bool            `json:"reconnect,omitempty"`
		Look      json.RawMessage `json:"look,omitempty"`
	}
	playerLeftMsg struct {
		T        string `json:"t"`
		PlayerID string `json:"playerId"`
		Reason   string `json:"reason"`
	}
	progressMsg struct {
		T         string  `json:"t"`
		PlayerID  string  `json:"playerId"`
		Done      int     `json:"done"`
		Status    string  `json:"status"`
		ElapsedMs float64 `json:"elapsedMs"`
	}
	lobbyMsg struct {
		T     string   `json:"t"`
		Names []string `json:"names"`
	}
	startedMsg struct {
		T           string          `json:"t"`
		Seed        json.RawMessage `json:"seed"`
		Settings    json.RawMessage `json:"settings"`
		CountdownMs json.RawMessage `json:"countdownMs"`
	}
	closedMsg struct {
		T      string `json:"t"`
		Reason string `json:"reason"`
	}
)

type progress struct {
	set       bool
	done      int
	status    string
	elapsedMs float64
}

type player struct {
	id, token, name string
	look            json.RawMessage // from the fresh join; a reconnect keeps it, like the name
	conn            *client         // nil while disconnected
	inRace          bool            // connected when the current race started
	prog            progress
}

// personalised is a host standings/end message split into the shared part
// and the per-player `me` entries.
type personalised struct {
	prefix []byte // `{"t":...,"top":[...],"me":`
	ranks  map[string]json.RawMessage
}

func newPersonalised(t string, v json.RawMessage, withV bool, top json.RawMessage, ranks map[string]json.RawMessage) *personalised {
	b := append([]byte(`{"t":"`), t...)
	b = append(b, '"')
	if withV {
		b = append(b, `,"v":`...)
		b = appendRaw(b, v, "null")
	}
	b = append(b, `,"top":`...)
	b = appendRaw(b, top, "[]")
	b = append(b, `,"me":`...)
	return &personalised{prefix: b, ranks: ranks}
}

func appendRaw(b []byte, raw json.RawMessage, def string) []byte {
	if len(raw) == 0 {
		return append(b, def...)
	}
	return append(b, raw...)
}

func (p *personalised) msgFor(id string) []byte {
	me := p.ranks[id]
	b := make([]byte, 0, len(p.prefix)+len(me)+5)
	b = append(b, p.prefix...)
	b = appendRaw(b, me, "null")
	return append(b, '}')
}

// Room is a single race room. All fields below are owned by run().
type Room struct {
	hub       *Hub
	cfg       Config
	log       *slog.Logger
	id        string // random, used in events instead of the join code
	code      string
	hostToken string
	inbox     chan any
	done      chan struct{}

	settings json.RawMessage
	host     *client
	grace    *time.Timer
	players  map[string]*player
	byToken  map[string]*player
	byConn   map[*client]*player
	order    []*player // join order

	phase         string
	seed          json.RawMessage
	raceNo        int
	raceStart     time.Time
	lastStandings *personalised
	lastFinal     *personalised
	closed        bool

	openedAt     time.Time
	lastActivity time.Time
	maxPlayers   int
	totalJoins   int
	reconnects   int
}

// post delivers ev to the room; false if the room is closed.
func (r *Room) post(ev any) bool {
	select {
	case r.inbox <- ev:
		return true
	case <-r.done:
		return false
	}
}

// call posts a request carrying a reply channel and waits for the answer
// ("" = success, otherwise an error reason).
func (r *Room) call(build func(reply chan string) any) string {
	reply := make(chan string, 1)
	if !r.post(build(reply)) {
		return "not_found"
	}
	select {
	case s := <-reply:
		return s
	case <-r.done:
		select {
		case s := <-reply:
			return s
		default:
			return "not_found"
		}
	}
}

func (r *Room) run() {
	check := r.cfg.IdleTTL / 4
	if check > time.Minute {
		check = time.Minute
	}
	if check < 10*time.Millisecond {
		check = 10 * time.Millisecond
	}
	idle := time.NewTicker(check)
	defer idle.Stop()
	for !r.closed {
		var graceC <-chan time.Time
		if r.grace != nil {
			graceC = r.grace.C
		}
		select {
		case ev := <-r.inbox:
			r.lastActivity = time.Now()
			r.handle(ev)
		case <-graceC:
			r.grace = nil
			r.close("host_gone")
		case now := <-idle.C:
			if now.Sub(r.lastActivity) >= r.cfg.IdleTTL {
				r.close("idle")
			}
		}
	}
}

func (r *Room) handle(ev any) {
	switch ev := ev.(type) {
	case msgEvent:
		if ev.c == r.host {
			r.handleHost(ev.t, ev.raw)
		} else if p := r.byConn[ev.c]; p != nil {
			r.handlePlayer(p, ev.t, ev.raw)
		}
	case leaveEvent:
		r.handleLeave(ev.c)
	case joinReq:
		ev.reply <- r.handleJoin(ev)
	case resumeReq:
		ev.reply <- r.handleResume(ev)
	case shutdownEvent:
		r.close("shutdown")
	}
}

func (r *Room) sendHost(v any) {
	if r.host != nil {
		r.host.sendJSON(v)
	}
}

func (r *Room) broadcast(b []byte, onlyRacers bool) {
	for _, p := range r.order {
		if p.conn != nil && (!onlyRacers || p.inRace) {
			p.conn.send(b)
		}
	}
}

func (r *Room) broadcastLobby() {
	if r.phase != phaseLobby {
		return
	}
	names := make([]string, 0, len(r.byConn))
	for _, p := range r.order {
		if p.conn != nil {
			names = append(names, p.name)
		}
	}
	b, _ := json.Marshal(lobbyMsg{T: "lobby", Names: names})
	r.broadcast(b, false)
}

func (r *Room) handleHost(t string, raw []byte) {
	c := r.host
	switch t {
	case "start":
		if r.phase != phaseLobby {
			c.send(errorMsg("not_allowed"))
			return
		}
		var m struct {
			Seed        json.RawMessage `json:"seed"`
			Settings    json.RawMessage `json:"settings"`
			CountdownMs json.RawMessage `json:"countdownMs"`
		}
		if json.Unmarshal(raw, &m) != nil || len(m.Seed) == 0 {
			c.send(errorMsg("bad_request"))
			return
		}
		if len(m.Settings) > 0 && m.Settings[0] == '{' {
			r.settings = m.Settings
		}
		if len(m.CountdownMs) == 0 {
			m.CountdownMs = json.RawMessage("0")
		}
		r.phase = phaseRacing
		r.seed = m.Seed
		r.raceNo++
		r.raceStart = time.Now()
		r.lastStandings, r.lastFinal = nil, nil
		racers := 0
		for _, p := range r.order {
			p.prog = progress{}
			p.inRace = p.conn != nil
			if p.inRace {
				racers++
			}
		}
		b, _ := json.Marshal(startedMsg{T: "started", Seed: m.Seed, Settings: r.settings, CountdownMs: m.CountdownMs})
		r.broadcast(b, true)
		r.log.Info("race_started", "race_no", r.raceNo, "players", racers)

	case "standings":
		if r.phase != phaseRacing {
			c.send(errorMsg("not_allowed"))
			return
		}
		var m struct {
			V     json.RawMessage            `json:"v"`
			Top   json.RawMessage            `json:"top"`
			Ranks map[string]json.RawMessage `json:"ranks"`
		}
		if json.Unmarshal(raw, &m) != nil || !isArray(m.Top) {
			c.send(errorMsg("bad_request"))
			return
		}
		r.lastStandings = newPersonalised("standings", m.V, true, m.Top, m.Ranks)
		r.sendPersonal(r.lastStandings)

	case "end":
		if r.phase != phaseRacing {
			c.send(errorMsg("not_allowed"))
			return
		}
		var m struct {
			Final struct {
				Top   json.RawMessage            `json:"top"`
				Ranks map[string]json.RawMessage `json:"ranks"`
			} `json:"final"`
		}
		if json.Unmarshal(raw, &m) != nil || !isArray(m.Final.Top) {
			c.send(errorMsg("bad_request"))
			return
		}
		r.phase = phaseEnded
		r.lastFinal = newPersonalised("ended", nil, false, m.Final.Top, m.Final.Ranks)
		r.sendPersonal(r.lastFinal)
		r.raceEnded("host")

	case "kick":
		var m struct {
			PlayerID string `json:"playerId"`
		}
		if json.Unmarshal(raw, &m) != nil {
			c.send(errorMsg("bad_request"))
			return
		}
		p := r.players[m.PlayerID]
		if p == nil {
			return // already gone; kicking is idempotent
		}
		r.removePlayer(p)
		if p.conn != nil {
			delete(r.byConn, p.conn)
			p.conn.closeWith(closeKicked, "kicked", []byte(`{"t":"kicked"}`))
		}
		r.sendHost(playerLeftMsg{T: "player_left", PlayerID: p.id, Reason: "kicked"})
		r.broadcastLobby()
		r.log.Info("player_kicked", "player_id", p.id)

	case "rematch":
		if r.phase == phaseLobby {
			c.send(errorMsg("not_allowed"))
			return
		}
		if r.phase == phaseRacing {
			r.raceEnded("rematch")
		}
		r.phase = phaseLobby
		r.seed = nil
		r.lastStandings, r.lastFinal = nil, nil
		for _, p := range r.order {
			p.prog = progress{}
			p.inRace = false
		}
		r.broadcast([]byte(`{"t":"rematch"}`), false)
		r.broadcastLobby()
		r.log.Info("rematch", "after_race", r.raceNo)

	default:
		c.send(errorMsg("bad_request"))
	}
}

func isArray(raw json.RawMessage) bool {
	return len(raw) > 0 && raw[0] == '['
}

func (r *Room) sendPersonal(p *personalised) {
	for _, pl := range r.order {
		if pl.conn != nil && pl.inRace {
			pl.conn.send(p.msgFor(pl.id))
		}
	}
}

func (r *Room) handlePlayer(p *player, t string, raw []byte) {
	switch t {
	case "progress":
		if r.phase != phaseRacing || !p.inRace {
			return // late update after the end or a rematch: harmless, dropped
		}
		var m struct {
			Done      *int     `json:"done"`
			Status    string   `json:"status"`
			ElapsedMs *float64 `json:"elapsedMs"`
		}
		if json.Unmarshal(raw, &m) != nil || m.Done == nil || *m.Done < 0 || m.ElapsedMs == nil ||
			math.IsNaN(*m.ElapsedMs) || *m.ElapsedMs < 0 {
			p.conn.send(errorMsg("bad_request"))
			return
		}
		switch m.Status {
		case "racing", "finished", "crashed":
		default:
			p.conn.send(errorMsg("bad_request"))
			return
		}
		p.prog = progress{set: true, done: *m.Done, status: m.Status, elapsedMs: *m.ElapsedMs}
		r.sendHost(r.progressMsg(p))
	default:
		p.conn.send(errorMsg("bad_request"))
	}
}

func (r *Room) progressMsg(p *player) progressMsg {
	return progressMsg{T: "progress", PlayerID: p.id, Done: p.prog.done, Status: p.prog.status, ElapsedMs: p.prog.elapsedMs}
}

func (r *Room) handleLeave(c *client) {
	if c == r.host {
		r.host = nil
		r.grace = time.NewTimer(r.cfg.HostGrace)
		r.log.Info("host_left")
		return
	}
	p := r.byConn[c]
	if p == nil {
		return // replaced or kicked connection
	}
	delete(r.byConn, c)
	p.conn = nil
	r.sendHost(playerLeftMsg{T: "player_left", PlayerID: p.id, Reason: "disconnected"})
	r.broadcastLobby()
	r.log.Info("player_left", "player_id", p.id)
}

func (r *Room) removePlayer(p *player) {
	delete(r.players, p.id)
	delete(r.byToken, p.token)
	for i, q := range r.order {
		if q == p {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
}

func (r *Room) handleJoin(req joinReq) string {
	c := req.c
	if p := r.byToken[req.token]; req.token != "" && p != nil {
		if r.phase == phaseRacing && !p.inRace {
			return "started"
		}
		if p.conn == nil && len(r.byConn) >= r.cfg.MaxPlayers {
			return "full"
		}
		if p.conn != nil {
			delete(r.byConn, p.conn)
			p.conn.closeWith(closeReplaced, "replaced", nil)
		}
		p.conn = c
		r.byConn[c] = p
		r.reconnects++
		r.afterJoin(p, true)
		return ""
	}

	if r.phase != phaseLobby {
		return "started"
	}
	if len(r.byConn) >= r.cfg.MaxPlayers {
		return "full"
	}
	if r.nameTaken(req.name) {
		return "name_taken"
	}
	r.pruneRecords()
	p := &player{id: r.newPlayerID(), token: randomHex(16), name: req.name, look: req.look, conn: c}
	r.players[p.id] = p
	r.byToken[p.token] = p
	r.byConn[c] = p
	r.order = append(r.order, p)
	r.totalJoins++
	r.afterJoin(p, false)
	return ""
}

// nameTaken reports whether a connected player already uses this name
// (case-insensitive). Disconnected players don't count, so a kid who closed
// the tab can rejoin under the same name.
func (r *Room) nameTaken(name string) bool {
	for _, p := range r.byConn {
		if strings.EqualFold(p.name, name) {
			return true
		}
	}
	return false
}

func (r *Room) afterJoin(p *player, reconnect bool) {
	c := p.conn
	if n := len(r.byConn); n > r.maxPlayers {
		r.maxPlayers = n
	}
	jm := joinedMsg{T: "joined", PlayerID: p.id, PlayerToken: p.token, Settings: r.settings, Phase: r.phase}
	if r.phase != phaseLobby {
		jm.Seed = r.seed
	}
	c.sendJSON(jm)
	switch {
	case r.phase == phaseRacing && r.lastStandings != nil:
		c.send(r.lastStandings.msgFor(p.id))
	case r.phase == phaseEnded && r.lastFinal != nil && p.inRace:
		c.send(r.lastFinal.msgFor(p.id))
	}
	r.sendHost(playerJoinedMsg{T: "player_joined", PlayerID: p.id, Name: p.name, Reconnect: reconnect, Look: p.look})
	r.broadcastLobby()
	r.log.Info("player_joined", append([]any{"player_id", p.id, "reconnect", reconnect, "players", len(r.byConn)}, c.logAttrs()...)...)
}

// pruneRecords keeps the number of remembered (reconnectable) players
// bounded by forgetting the oldest disconnected ones.
func (r *Room) pruneRecords() {
	for len(r.players) >= 2*r.cfg.MaxPlayers {
		var victim *player
		for _, p := range r.order {
			if p.conn == nil && !p.inRace {
				victim = p
				break
			}
		}
		if victim == nil {
			return
		}
		r.removePlayer(victim)
	}
}

func (r *Room) newPlayerID() string {
	for {
		id := randomHex(4)
		if r.players[id] == nil {
			return id
		}
	}
}

func (r *Room) handleResume(req resumeReq) string {
	if subtle.ConstantTimeCompare([]byte(req.token), []byte(r.hostToken)) != 1 {
		r.log.Warn("host_resume_rejected", req.c.logAttrs()...)
		return "bad_token"
	}
	if r.host != nil && r.host != req.c {
		r.host.closeWith(closeReplaced, "replaced", nil)
	}
	if r.grace != nil {
		r.grace.Stop()
		r.grace = nil
	}
	r.host = req.c
	r.sendHost(createdMsg{T: "created", Code: r.code, HostToken: r.hostToken, Phase: r.phase})
	for _, p := range r.order {
		r.sendHost(playerJoinedMsg{T: "player_joined", PlayerID: p.id, Name: p.name, Look: p.look})
		if p.conn == nil {
			r.sendHost(playerLeftMsg{T: "player_left", PlayerID: p.id, Reason: "disconnected"})
		}
		if r.phase == phaseRacing && p.inRace && p.prog.set {
			r.sendHost(r.progressMsg(p))
		}
	}
	r.log.Info("host_resumed", req.c.logAttrs()...)
	return ""
}

// raceEnded writes the race_ended usage event for the current race.
func (r *Room) raceEnded(endedBy string) {
	var players, finished, crashed int
	for _, p := range r.order {
		if !p.inRace {
			continue
		}
		players++
		switch p.prog.status {
		case "finished":
			finished++
		case "crashed":
			crashed++
		}
	}
	dnf := players - finished - crashed
	if endedBy == "host" && dnf == 0 {
		endedBy = "all_done"
	}
	var s struct {
		N          int    `json:"n"`
		Cup        string `json:"cup"`
		Difficulty string `json:"difficulty"`
	}
	_ = json.Unmarshal(r.settings, &s)
	now := time.Now().UTC()
	r.hub.events.Write(raceEndedEvent{
		Event: "race_ended", TS: now, RoomID: r.id, RaceNo: r.raceNo, Players: players,
		N: s.N, Cup: s.Cup, Difficulty: s.Difficulty, DurationS: seconds(now.Sub(r.raceStart)),
		Finished: finished, Crashed: crashed, DNF: dnf, EndedBy: endedBy,
	})
	r.log.Info("race_ended", "race_no", r.raceNo, "players", players, "finished", finished,
		"crashed", crashed, "dnf", dnf, "ended_by", endedBy)
}

func seconds(d time.Duration) float64 {
	return math.Round(d.Seconds()*10) / 10
}

func (r *Room) close(reason string) {
	if r.closed {
		return
	}
	r.closed = true
	r.hub.remove(r)
	if r.phase == phaseRacing {
		r.raceEnded("closed")
	}
	final, _ := json.Marshal(closedMsg{T: "closed", Reason: reason})
	if r.host != nil {
		r.host.closeWith(closeRoom, reason, final)
	}
	for c := range r.byConn {
		c.closeWith(closeRoom, reason, final)
	}
	if r.grace != nil {
		r.grace.Stop()
	}
	close(r.done)
	now := time.Now().UTC()
	r.hub.events.Write(roomClosedEvent{
		Event: "room_closed", TS: now, RoomID: r.id, OpenedAt: r.openedAt.UTC(),
		DurationS: seconds(now.Sub(r.openedAt)), Races: r.raceNo, MaxPlayers: r.maxPlayers,
		TotalJoins: r.totalJoins, Reconnects: r.reconnects, CloseReason: reason,
	})
	r.log.Info("room_closed", "reason", reason, "duration_s", seconds(now.Sub(r.openedAt)),
		"races", r.raceNo, "max_players", r.maxPlayers)
}
