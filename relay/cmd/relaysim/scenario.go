package main

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"
)

// errAbort unwinds a scenario after a failure has been recorded.
var errAbort = errors.New("scenario aborted")

const stepWait = 20 * time.Second // timeout of a single protocol step

// scenario is one replayable test case. All randomness comes from rng,
// seeded from (run seed, index), and is drawn on the scenario goroutine
// before any concurrent work, so `-seed S -only name#i` replays it.
//
// The trace only records facts that are deterministic for a given seed
// (scripted actions, error reasons, close codes, final ranks), never
// timing-dependent ones, so its hash is identical across replays.
type scenario struct {
	sim    *sim
	idx    int
	arch   *archetype
	id     string
	rng    *rand.Rand
	ctx    context.Context
	cancel context.CancelCauseFunc
	down   atomic.Bool
	nconns atomic.Int64

	mu    sync.Mutex
	err   error
	desc  string
	lines []string
	rooms []*room
	conns []*wsConn
}

func scenarioRNG(seed int64, idx int) *rand.Rand {
	return rand.New(rand.NewPCG(uint64(seed), uint64(idx)))
}

func (sc *scenario) failf(format string, a ...any) {
	err := fmt.Errorf(format, a...)
	sc.mu.Lock()
	if sc.err == nil {
		sc.err = err
	}
	sc.mu.Unlock()
	sc.cancel(err)
}

func (sc *scenario) fatalf(format string, a ...any) {
	sc.failf(format, a...)
	panic(errAbort)
}

func (sc *scenario) check(ok bool, format string, a ...any) {
	if !ok {
		sc.fatalf(format, a...)
	}
}

func (sc *scenario) failed() bool {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.err != nil
}

func (sc *scenario) tr(format string, a ...any) {
	sc.mu.Lock()
	sc.lines = append(sc.lines, fmt.Sprintf(format, a...))
	sc.mu.Unlock()
}

func (sc *scenario) describe(format string, a ...any) {
	sc.mu.Lock()
	sc.desc = fmt.Sprintf(format, a...)
	sc.mu.Unlock()
	sc.tr("scenario %s %s", sc.arch.name, sc.desc)
}

func (sc *scenario) addConn(c *wsConn) {
	sc.mu.Lock()
	sc.conns = append(sc.conns, c)
	sc.mu.Unlock()
}

// parallel runs fn(0..n-1) concurrently and aborts if any of them failed.
func (sc *scenario) parallel(n int, fn func(i int)) {
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil && r != errAbort {
					sc.failf("panic: %v", r)
				}
			}()
			fn(i)
		}()
	}
	wg.Wait()
	if sc.failed() {
		panic(errAbort)
	}
}

func (sc *scenario) sleep(d time.Duration) { sleepCtx(sc.ctx, d) }

// trace returns the scenario lines followed by each room's lines.
func (sc *scenario) trace() []string {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	out := append([]string(nil), sc.lines...)
	for _, rm := range sc.rooms {
		rm.mu.Lock()
		out = append(out, rm.lines...)
		rm.mu.Unlock()
	}
	return out
}

// actor is the shared plumbing of the simulated host and players: one
// goroutine owns the state (guarded by mu while it handles an event) and
// bumps sig after every event so waiters can re-check their predicate.
type actor struct {
	sc    *scenario
	mu    sync.Mutex
	sig   chan struct{}
	cmds  chan func()
	inbox chan inMsg
}

func (a *actor) init(sc *scenario) {
	a.sc = sc
	a.sig = make(chan struct{})
	a.cmds = make(chan func(), 16)
	a.inbox = make(chan inMsg, 8192)
}

func (a *actor) bump() {
	close(a.sig)
	a.sig = make(chan struct{})
}

// call runs f on the actor goroutine and waits for it.
func (a *actor) call(f func()) {
	done := make(chan struct{})
	select {
	case a.cmds <- func() { f(); close(done) }:
	case <-a.sc.ctx.Done():
		panic(errAbort)
	}
	select {
	case <-done:
	case <-a.sc.ctx.Done():
		panic(errAbort)
	}
}

// with runs f under the actor lock on the calling goroutine (read access).
func (a *actor) with(f func()) {
	a.mu.Lock()
	defer a.mu.Unlock()
	f()
}

// await waits until pred (evaluated under the actor lock) holds. d == 0
// waits until the scenario deadline.
func (a *actor) await(desc string, d time.Duration, pred func() bool) {
	var tc <-chan time.Time
	if d > 0 {
		t := time.NewTimer(d)
		defer t.Stop()
		tc = t.C
	}
	for {
		a.mu.Lock()
		ok := pred()
		ch := a.sig
		a.mu.Unlock()
		if ok {
			return
		}
		select {
		case <-ch:
		case <-tc:
			a.sc.fatalf("timeout (%s) waiting for %s", d, desc)
		case <-a.sc.ctx.Done():
			panic(errAbort)
		}
	}
}

// --- scripted races -------------------------------------------------------

type settings struct {
	Cup        string `json:"cup"`
	N          int    `json:"n"`
	Difficulty string `json:"difficulty"`
}

var (
	allN   = []int{10, 30, 50, 120}
	smallN = []int{10, 10, 30}
	tenN   = []int{10}
)

func (sc *scenario) genSettings(ns []int) settings {
	cups := []string{"add", "addsub", "mul", "muldiv", "all"}
	diffs := []string{"easy", "medium", "hard"}
	return settings{Cup: cups[sc.rng.IntN(len(cups))], N: ns[sc.rng.IntN(len(ns))], Difficulty: diffs[sc.rng.IntN(len(diffs))]}
}

// step is one `progress` message of a scripted player.
type step struct {
	Done   int     `json:"done"`
	Status string  `json:"status"`
	Ms     float64 `json:"elapsedMs"`
}

// genScript draws a player's race: an answer speed, occasional wrong
// answers (retried, as in solo) and sometimes a crash (4th wrong answer).
// Crashes never happen before minRacing correct answers.
func (sc *scenario) genScript(n, minRacing int) []step {
	rng := sc.rng
	base := 1500 + rng.Float64()*3500
	pWrong := rng.Float64() * 0.03
	crashAt := -1
	if rng.IntN(5) == 0 && n > minRacing {
		crashAt = minRacing + rng.IntN(n-minRacing)
	}
	errs := 0
	t := 0.0
	steps := make([]step, 0, n)
	for q := range n {
		t += base * (0.6 + 0.8*rng.Float64())
		for errs < 4 && (q == crashAt || (q >= minRacing && rng.Float64() < pWrong)) {
			errs++
			t += base * (0.3 + 0.4*rng.Float64())
		}
		if errs >= 4 {
			return append(steps, step{Done: q, Status: stCrashed, Ms: math.Round(t)})
		}
		st := stRacing
		if q == n-1 {
			st = stFinished
		}
		steps = append(steps, step{Done: q + 1, Status: st, Ms: math.Round(t)})
	}
	return steps
}

// pickGate picks after how many sent steps a player stalls (1..3, always
// while still racing).
func (sc *scenario) pickGate(script []step) int {
	racing := 0
	for _, s := range script {
		if s.Status == stRacing {
			racing++
		}
	}
	return 1 + sc.rng.IntN(min(3, racing))
}

type racePlan struct {
	seed    uint32
	s       settings
	scripts map[*simPlayer][]step
	gates   map[*simPlayer]int
}

// planRace draws the seed and every player's script. gated players get a
// stall point (see simPlayer.gate) and at least 3 racing steps.
func (sc *scenario) planRace(ps []*simPlayer, s settings, gated ...*simPlayer) *racePlan {
	pl := &racePlan{seed: sc.rng.Uint32(), s: s, scripts: map[*simPlayer][]step{}, gates: map[*simPlayer]int{}}
	isGated := map[*simPlayer]bool{}
	for _, p := range gated {
		isGated[p] = true
	}
	for _, p := range ps {
		minRacing := 0
		if isGated[p] {
			minRacing = 3
		}
		pl.scripts[p] = sc.genScript(s.N, minRacing)
		if isGated[p] {
			pl.gates[p] = sc.pickGate(pl.scripts[p])
		}
	}
	return pl
}

var namePool = []string{"Alva", "Elsa", "Noah", "Liam", "Maja", "Hugo", "Saga", "Leo",
	"Ella", "Otto", "Wilma", "Nils", "Astrid", "Oskar", "Ebba", "Theo"}

const badCodeChars = "01IOL" // never in the room-code alphabet

// badCode is a 5-character code that cannot exist (one character outside
// the alphabet), so `not_found` is deterministic even on a busy relay.
func (sc *scenario) badCode() string {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, 5)
	for i := range b {
		b[i] = alphabet[sc.rng.IntN(len(alphabet))]
	}
	b[sc.rng.IntN(5)] = badCodeChars[sc.rng.IntN(len(badCodeChars))]
	return string(b)
}
