// Command racebots fills an existing room (hosted in a browser) with
// simulated players, for trying the host screen.
//
//	go run ./cmd/racebots -code ABCDE [-players 60] [-speed 1]
//
// Bot i joins as a classroom first name (bots 41 and up reuse the first
// names, so the relay refuses them with name_taken and they retry as
// "Ebba A", "Ebba B"…). In a race each bot answers at a pace set by the
// difficulty and its own skill, makes a few wrong answers, and may crash
// (-crash) or drop mid-race and reconnect with its token (-drop). The bots
// follow the host: rematch waits for the next start, ended stops the race,
// and a kick or a closed room makes a bot exit. Ctrl-C closes every socket.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"math/rand/v2"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// namePool is a classroom. Bot i is namePool[i%len(namePool)].
var namePool = [...]string{
	"Ebba", "Emma", "Alice", "Maja", "Elsa", "Wilma", "Saga", "Astrid", "Alva", "Olivia",
	"Selma", "Vera", "Ella", "Freja", "Agnes", "Lilly", "Ines", "Signe", "Leah", "Stella",
	"Noah", "William", "Hugo", "Liam", "Lucas", "Oscar", "Elias", "Adam", "Matteo", "Leo",
	"Theo", "Alexander", "Nils", "Viggo", "Charlie", "Ludvig", "Arvid", "Sixten", "Melvin", "Frank",
}

// paceSec is the time per question in seconds (src/config.ts DIFFICULTIES).
var paceSec = map[string]float64{"easy": 10, "medium": 5, "hard": 3}

const (
	minSendGap = 60 * time.Millisecond  // between frames on one connection (relay: 20 msg/s)
	overdueGap = 100 * time.Millisecond // between overdue progress steps after a reconnect
	wrongP     = 0.08                   // probability of a wrong answer per question
	maxWrong   = 3                      // wrong answers per race, unless the bot crashes
	maxRedials = 5                      // failed dials in a row before a bot gives up
)

type config struct {
	url, origin, code string
	players           int
	speed             float64
	crash, drop       float64
	connectRate       int
}

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	var cfg config
	fs := flag.NewFlagSet("racebots", flag.ContinueOnError)
	fs.StringVar(&cfg.url, "url", "ws://127.0.0.1:8010/ws", "relay URL")
	fs.StringVar(&cfg.origin, "origin", "http://localhost:5173", "Origin header (empty: none)")
	fs.StringVar(&cfg.code, "code", "", "room code (required)")
	fs.IntVar(&cfg.players, "players", 60, "number of bots")
	fs.Float64Var(&cfg.speed, "speed", 1, "time compression (2 = twice as fast)")
	fs.Float64Var(&cfg.crash, "crash", 0.05, "probability that a bot crashes in a race")
	fs.Float64Var(&cfg.drop, "drop", 0.05, "probability that a bot drops mid-race and reconnects")
	seed := fs.Uint64("seed", 0, "random seed (default: time-based)")
	fs.IntVar(&cfg.connectRate, "connect-rate", 20, "handshakes per second")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	cfg.code = strings.ToUpper(strings.TrimSpace(cfg.code))
	switch {
	case cfg.code == "":
		return usage(fs, "-code is required")
	case cfg.players <= 0 || cfg.speed <= 0 || cfg.connectRate <= 0:
		return usage(fs, "-players, -speed and -connect-rate must be positive")
	case cfg.crash < 0 || cfg.crash > 1 || cfg.drop < 0 || cfg.drop > 1:
		return usage(fs, "-crash and -drop must be between 0 and 1")
	}
	seedSet := false
	fs.Visit(func(f *flag.Flag) { seedSet = seedSet || f.Name == "seed" })
	if !seedSet {
		*seed = uint64(time.Now().UnixNano())
	}
	fmt.Printf("seed=%d\n", *seed)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() { <-ctx.Done(); stop() }() // a second Ctrl-C kills the process

	// One ticker paces every handshake: the first dials (launched in bot
	// order, so the name collisions are reproducible) and the reconnects.
	tick := time.NewTicker(time.Second / time.Duration(cfg.connectRate))
	defer tick.Stop()
	tr := &tracker{n: cfg.players, pending: cfg.players, races: map[string]*race{}}
	var wg sync.WaitGroup
	for i := range cfg.players {
		if i > 0 {
			select {
			case <-tick.C:
			case <-ctx.Done():
			}
		}
		if ctx.Err() != nil {
			break
		}
		b := &bot{
			n: i + 1, base: namePool[i%len(namePool)], cfg: &cfg, tr: tr, slot: tick.C,
			rng: rand.New(rand.NewPCG(*seed, uint64(i))), inbox: make(chan inMsg, 256), done: make(chan struct{}),
		}
		b.name = b.base
		b.skill = 0.45 + 0.8*b.rng.Float64()
		wg.Add(1)
		go func() {
			defer wg.Done()
			b.run(ctx)
		}()
	}
	wg.Wait()
	if ctx.Err() == nil && !tr.everJoined {
		return 1
	}
	return 0
}

func usage(fs *flag.FlagSet, msg string) int {
	fmt.Fprintf(os.Stderr, "racebots: %s\n", msg)
	fs.Usage()
	return 2
}

// tracker aggregates the bots for the output lines.
type tracker struct {
	mu         sync.Mutex
	n          int
	pending    int // joins (first joins and reconnects) not settled yet
	joined     int // bots currently in the room
	everJoined bool
	races      map[string]*race // by seed
}

type race struct {
	participants, settled       int
	finished, crashed, unfinish int
}

func (t *tracker) say(format string, a ...any) {
	t.mu.Lock()
	defer t.mu.Unlock()
	fmt.Printf(format+"\n", a...)
}

func (t *tracker) joinBegin() {
	t.mu.Lock()
	t.pending++
	t.mu.Unlock()
}

func (t *tracker) joinEnd(ok bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.pending--
	if ok {
		t.joined++
		t.everJoined = true
	}
	if t.pending == 0 {
		fmt.Printf("joined %d/%d\n", t.joined, t.n)
	}
}

func (t *tracker) left() {
	t.mu.Lock()
	t.joined--
	t.mu.Unlock()
}

// raceStart registers a bot in the race identified by seed; the first bot
// announces it.
func (t *tracker) raceStart(seed string, n int, difficulty string) *race {
	t.mu.Lock()
	defer t.mu.Unlock()
	r := t.races[seed]
	if r == nil {
		r = &race{}
		t.races[seed] = r
		fmt.Printf("race started n=%d difficulty=%s\n", n, difficulty)
	}
	r.participants++
	return r
}

// raceSettle records how a bot's race ended: "finished", "crashed" or
// "unfinished" (ended by the host, rematch, or the bot left).
func (t *tracker) raceSettle(r *race, outcome string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	switch outcome {
	case "finished":
		r.finished++
	case "crashed":
		r.crashed++
	default:
		r.unfinish++
	}
	r.settled++
	if r.settled < r.participants {
		return
	}
	line := fmt.Sprintf("race done: finished %d crashed %d", r.finished, r.crashed)
	if r.unfinish > 0 {
		line += fmt.Sprintf(" unfinished %d", r.unfinish)
	}
	fmt.Println(line)
}

type settings struct {
	N          int    `json:"n"`
	Difficulty string `json:"difficulty"`
}

// inMsg is one message from the relay, or (closed) the end of the
// connection of generation gen.
type inMsg struct {
	T           string          `json:"t"`
	Reason      string          `json:"reason"`
	PlayerToken string          `json:"playerToken"`
	Phase       string          `json:"phase"`
	Seed        json.RawMessage `json:"seed"`
	Settings    settings        `json:"settings"`
	CountdownMs float64         `json:"countdownMs"`

	gen    int
	closed bool
	code   websocket.StatusCode
}

type step struct {
	at     time.Duration // wall time after GO
	done   int
	status string
}

// script is a bot's race: progress steps sent at fixed wall times after GO.
type script struct {
	seed         string
	race         *race
	goAt         time.Time
	steps        []step
	next         int
	dropAfter    int // done value after which the bot drops (0: never)
	lastProgress time.Time
}

// bot is one simulated player. Its run goroutine owns all the state; a
// reader goroutine per connection feeds it the parsed messages.
type bot struct {
	n          int // 1-based, for the output
	base, name string
	letter     int // next initial to try on name_taken
	cfg        *config
	tr         *tracker
	slot       <-chan time.Time
	rng        *rand.Rand
	skill      float64
	inbox      chan inMsg
	done       chan struct{}

	ws       *websocket.Conn
	gen      int
	online   bool // joined and the socket still writable
	counted  bool // counted in tracker.joined
	lastSend time.Time
	token    string
	sc       *script
}

type joinResult int

const (
	joinOK      joinResult = iota
	joinRefused            // the relay refused the join: the bot stops
	joinLost               // the socket closed before a reply: dial again
	joinExit               // kicked, room closed, replaced, or Ctrl-C
)

func (b *bot) run(ctx context.Context) {
	defer close(b.done)
	defer b.exit()
	if !b.connect(ctx, true) {
		return
	}
	for {
		var fire <-chan time.Time
		var tm *time.Timer
		if sc := b.sc; sc != nil && b.online {
			due := sc.goAt.Add(sc.steps[sc.next].at)
			if due.Before(time.Now()) {
				if gap := sc.lastProgress.Add(overdueGap); due.Before(gap) {
					due = gap
				}
			}
			tm = time.NewTimer(time.Until(due))
			fire = tm.C
		}
		select {
		case <-ctx.Done():
			if tm != nil {
				tm.Stop()
			}
			if b.ws != nil {
				_ = b.ws.Close(websocket.StatusNormalClosure, "")
				b.ws = nil
			}
			return
		case m := <-b.inbox:
			if tm != nil {
				tm.Stop()
			}
			if m.gen == b.gen && !b.handle(ctx, m) {
				return
			}
		case <-fire:
			if !b.step(ctx) {
				return
			}
		}
	}
}

// exit settles the bot's race and leaves the room.
func (b *bot) exit() {
	if b.sc != nil {
		b.settle("unfinished")
	}
	b.offline()
	if b.ws != nil {
		_ = b.ws.CloseNow()
		b.ws = nil
	}
}

func (b *bot) offline() {
	b.online = false
	if b.counted {
		b.counted = false
		b.tr.left()
	}
}

func (b *bot) settle(outcome string) {
	b.tr.raceSettle(b.sc.race, outcome)
	b.sc = nil
}

// handle processes one message of the current connection; false means the
// bot exits.
func (b *bot) handle(ctx context.Context, m inMsg) bool {
	if m.closed {
		b.offline()
		b.ws = nil
		if terminal(m.code) {
			return false
		}
		if !sleep(ctx, time.Second) {
			return false
		}
		return b.connect(ctx, false)
	}
	switch m.T {
	case "ping":
		_ = b.send(ctx, map[string]string{"t": "pong"})
	case "started":
		b.start(m)
	case "rematch", "ended":
		if b.sc != nil {
			b.settle("unfinished")
		}
	case "kicked", "closed":
		return false
	case "error":
		b.tr.say("bot %d: relay error: %s", b.n, m.Reason)
	}
	return true
}

// terminal reports the close codes after which a bot must not come back:
// 4000 kicked, 4001 replaced by another socket with its token, 4002 room
// closed.
func terminal(code websocket.StatusCode) bool {
	return code == 4000 || code == 4001 || code == 4002
}

// start builds the race script from the started message.
func (b *bot) start(m inMsg) {
	if b.sc != nil {
		b.settle("unfinished")
	}
	n := m.Settings.N
	r := b.tr.raceStart(string(m.Seed), n, m.Settings.Difficulty)
	sc := &script{seed: string(m.Seed), race: r, goAt: time.Now().Add(b.wall(m.CountdownMs))}
	b.sc = sc
	if n <= 0 {
		b.settle("unfinished")
		return
	}
	pace, ok := paceSec[m.Settings.Difficulty]
	if !ok {
		pace = paceSec["medium"]
	}
	paceMs := pace * 1000
	crash := n >= 2 && b.rng.Float64() < b.cfg.crash
	crashQ := 0
	if crash {
		crashQ = 2 + b.rng.IntN(n-1) // question 2..n
	}
	if n >= 3 && b.rng.Float64() < b.cfg.drop {
		sc.dropAfter = 1 + b.rng.IntN(n-2) // after question 1..n-2
	}
	t, wrong := 0.0, 0
	for q := 1; q <= n; q++ {
		qt := paceMs * b.skill * (0.6 + 0.8*b.rng.Float64())
		if q == crashQ {
			t += qt * b.rng.Float64()
			sc.steps = append(sc.steps, step{b.wall(t), q - 1, "crashed"})
			break
		}
		if (crash || wrong < maxWrong) && b.rng.Float64() < wrongP {
			wrong++
			t += paceMs * 0.5
		}
		t += qt
		status := "racing"
		if q == n {
			status = "finished"
		}
		sc.steps = append(sc.steps, step{b.wall(t), q, status})
	}
}

// wall converts script milliseconds to wall time.
func (b *bot) wall(ms float64) time.Duration {
	return time.Duration(ms / b.cfg.speed * float64(time.Millisecond))
}

// step sends the next progress step; false means the bot exits.
func (b *bot) step(ctx context.Context) bool {
	sc := b.sc
	st := sc.steps[sc.next]
	if !b.pace(ctx) {
		return false
	}
	err := b.write(map[string]any{
		"t": "progress", "done": st.done, "status": st.status, "elapsedMs": time.Since(sc.goAt).Milliseconds(),
	})
	if err != nil {
		return true // resent after the reconnect; the reader reports the close
	}
	sc.next++
	sc.lastProgress = time.Now()
	if st.status != "racing" {
		b.settle(st.status)
		return true
	}
	if st.done != sc.dropAfter {
		return true
	}
	// A lost Wi-Fi link: no close handshake, back after 3–8 s.
	b.gen++
	_ = b.ws.CloseNow()
	b.ws = nil
	b.offline()
	if !sleep(ctx, b.wall(3000+5000*b.rng.Float64())) {
		return false
	}
	return b.connect(ctx, false)
}

// connect dials and joins (with the token once the bot has one), retrying
// lost sockets; false means the bot exits.
func (b *bot) connect(ctx context.Context, first bool) bool {
	if !first {
		b.tr.joinBegin()
	}
	fails := 0
	for {
		ws, err := b.dial(ctx, first)
		first = false
		if err != nil {
			fails++
			if ctx.Err() != nil {
				b.tr.joinEnd(false)
				return false
			}
			if errors.Is(err, errForbidden) || fails >= maxRedials {
				b.tr.say("bot %d: dial failed: %v", b.n, err)
				b.tr.joinEnd(false)
				return false
			}
			if !sleep(ctx, time.Second<<(fails-1)) {
				b.tr.joinEnd(false)
				return false
			}
			continue
		}
		b.gen++
		b.ws = ws
		b.lastSend = time.Time{}
		go b.read(ws, b.gen)
		switch b.join(ctx) {
		case joinOK:
			b.online, b.counted = true, true
			b.tr.joinEnd(true)
			return true
		case joinLost:
			b.ws = nil
			fails++
			if fails >= maxRedials {
				b.tr.say("bot %d: connection lost while joining", b.n)
			}
			if fails >= maxRedials || !sleep(ctx, time.Second) {
				b.tr.joinEnd(false)
				return false
			}
		default:
			b.tr.joinEnd(false)
			return false
		}
	}
}

var errForbidden = errors.New("HTTP 403 on the WebSocket upgrade (Origin not allowed?)")

// dial opens a socket, waiting for a handshake slot unless the launcher
// already did.
func (b *bot) dial(ctx context.Context, slotTaken bool) (*websocket.Conn, error) {
	if !slotTaken {
		select {
		case <-b.slot:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	hdr := http.Header{"User-Agent": {"mc-racebots/1"}}
	if b.cfg.origin != "" {
		hdr.Set("Origin", b.cfg.origin)
	}
	dctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	ws, resp, err := websocket.Dial(dctx, b.cfg.url, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusForbidden {
			return nil, errForbidden
		}
		return nil, err
	}
	ws.SetReadLimit(1 << 20)
	return ws, nil
}

// join sends join and waits for the reply. name_taken retries on the same
// socket with the next initial: "Ebba A", "Ebba B"…
func (b *bot) join(ctx context.Context) joinResult {
send:
	for {
		msg := map[string]string{"t": "join", "code": b.cfg.code, "name": b.name}
		if b.token != "" {
			msg["playerToken"] = b.token
		}
		if !b.pace(ctx) {
			return joinExit
		}
		_ = b.write(msg) // on failure the reader reports the close
		for {
			m, ok := b.await(ctx)
			switch {
			case !ok:
				return joinExit
			case m.closed:
				if terminal(m.code) {
					return joinExit
				}
				return joinLost
			case m.T == "joined":
				if b.token == "" && b.name != b.base {
					b.tr.say("bot %d: %s taken, joined as %s", b.n, b.base, b.name)
				}
				b.token = m.PlayerToken
				// Offline across a rematch, the end or another start: the
				// script is stale.
				if b.sc != nil && (m.Phase != "racing" || string(m.Seed) != b.sc.seed) {
					b.settle("unfinished")
				}
				return joinOK
			case m.T == "error" && m.Reason == "name_taken" && b.letter < 26:
				b.name = fmt.Sprintf("%s %c", b.base, 'A'+b.letter)
				b.letter++
				continue send
			case m.T == "error" && m.Reason == "rate_limited":
				// The relay closes the socket next.
			case m.T == "error":
				b.tr.say("bot %d: join refused: %s", b.n, m.Reason)
				return joinRefused
			}
		}
	}
}

// await returns the next message of the current connection, answering
// pings; false on Ctrl-C.
func (b *bot) await(ctx context.Context) (inMsg, bool) {
	for {
		select {
		case <-ctx.Done():
			return inMsg{}, false
		case m := <-b.inbox:
			if m.gen != b.gen {
				continue
			}
			if m.T == "ping" {
				_ = b.send(ctx, map[string]string{"t": "pong"})
				continue
			}
			return m, true
		}
	}
}

func (b *bot) read(ws *websocket.Conn, gen int) {
	for {
		_, data, err := ws.Read(context.Background())
		if err != nil {
			b.deliver(inMsg{gen: gen, closed: true, code: websocket.CloseStatus(err)})
			return
		}
		var m inMsg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		m.gen = gen
		if !b.deliver(m) {
			return
		}
	}
}

func (b *bot) deliver(m inMsg) bool {
	select {
	case b.inbox <- m:
		return true
	case <-b.done:
		return false
	}
}

// pace keeps minSendGap between frames on the connection; false on Ctrl-C.
func (b *bot) pace(ctx context.Context) bool {
	if b.lastSend.IsZero() {
		return true
	}
	return sleep(ctx, minSendGap-time.Since(b.lastSend))
}

func (b *bot) send(ctx context.Context, v any) error {
	if !b.pace(ctx) {
		return ctx.Err()
	}
	return b.write(v)
}

func (b *bot) write(v any) error {
	if b.ws == nil {
		return errors.New("offline")
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = b.ws.Write(wctx, websocket.MessageText, data)
	b.lastSend = time.Now()
	if err != nil {
		b.online = false
	}
	return err
}

// sleep waits d; false if ctx ended first.
func sleep(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}
