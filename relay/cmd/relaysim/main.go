// Command relaysim stress- and behaviour-tests the mc-relay (PROTOCOL.md)
// with randomised, replayable race scenarios against any relay URL.
//
// Every scenario derives its randomness from (-seed, index), so
// `-seed S -only name#i` replays one scenario exactly; with -v each result
// line carries a hash of the scenario's deterministic event trace.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"regexp"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type config struct {
	url, origin string
	seed        int64
	n           int
	concurrency int
	only        string
	timeout     time.Duration
	verbose     bool
	trace       bool
	slow        bool
	jsonPath    string
	connectRate float64
	speed       float64
	maxPlayers  int
	msgInterval time.Duration
}

const hostGrace = 2 * time.Minute

// sim holds what is shared by all scenarios of a run.
type sim struct {
	cfg config
	d   *dialer

	mu         sync.Mutex
	codes      map[string]codeEntry
	latencies  []time.Duration
	errReasons map[string]int
	closeCodes map[int]int
}

type codeEntry struct {
	owner   string
	expires time.Time // zero while the room is in use
}

// registerCode fails if the relay handed out a code that is still live for
// another room of this run (open, or within the host grace period).
func (s *sim) registerCode(code, owner string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.codes[code]; ok && (e.expires.IsZero() || time.Now().Before(e.expires)) {
		return fmt.Errorf("room code %s handed out twice (already used by %s)", code, e.owner)
	}
	s.codes[code] = codeEntry{owner: owner}
	return nil
}

// releaseCode marks code free after linger (the relay keeps a room for the
// host grace period after its host left).
func (s *sim) releaseCode(code string, linger time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.codes[code]; ok {
		e.expires = time.Now().Add(linger)
		s.codes[code] = e
	}
}

func (s *sim) addLatency(d time.Duration) {
	s.mu.Lock()
	s.latencies = append(s.latencies, d)
	s.mu.Unlock()
}

func (s *sim) countError(reason string) {
	s.mu.Lock()
	s.errReasons[reason]++
	s.mu.Unlock()
}

func (s *sim) countClose(code int) {
	s.mu.Lock()
	s.closeCodes[code]++
	s.mu.Unlock()
}

type result struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Index      int      `json:"index"`
	Status     string   `json:"status"` // PASS, FAIL or SKIP
	Error      string   `json:"error,omitempty"`
	DurationMs int64    `json:"duration_ms"`
	Conns      int64    `json:"conns"`
	Desc       string   `json:"desc"`
	TraceHash  string   `json:"trace_hash"`
	Trace      []string `json:"trace,omitempty"`
	Replay     string   `json:"replay,omitempty"`
}

type latencyStats struct {
	N     int     `json:"n"`
	P50Ms float64 `json:"p50_ms"`
	P95Ms float64 `json:"p95_ms"`
	MaxMs float64 `json:"max_ms"`
}

type report struct {
	URL        string         `json:"url"`
	Seed       int64          `json:"seed"`
	StartedAt  time.Time      `json:"started_at"`
	DurationS  float64        `json:"duration_s"`
	Pass       int            `json:"pass"`
	Fail       int            `json:"fail"`
	Skip       int            `json:"skip"`
	Aborted    string         `json:"aborted,omitempty"`
	Conns      int64          `json:"connections"`
	Retries    int64          `json:"handshake_retries"`
	HTTPErrors map[string]int `json:"handshake_http_errors"`
	Latency    latencyStats   `json:"standings_latency"`
	ErrReasons map[string]int `json:"errors_by_reason"`
	CloseCodes map[string]int `json:"close_codes"`
	Scenarios  []result       `json:"scenarios"`
}

func main() { os.Exit(run()) }

func run() int {
	var cfg config
	flag.StringVar(&cfg.url, "url", "ws://127.0.0.1:8010/ws", "relay WebSocket URL")
	flag.StringVar(&cfg.origin, "origin", "https://maths.codingtony.com", "Origin header of the upgrade (empty: none)")
	flag.Int64Var(&cfg.seed, "seed", 0, "run seed (default: time-based; always printed)")
	flag.IntVar(&cfg.n, "n", 0, "number of scenarios (0 = one pass over the suite: 60, 61 with -slow)")
	flag.IntVar(&cfg.concurrency, "concurrency", 10, "scenarios run in parallel")
	flag.StringVar(&cfg.only, "only", "", "run only `name#i` (exact), or the scenarios whose name#i matches this regexp")
	flag.DurationVar(&cfg.timeout, "timeout", 3*time.Minute, "per-scenario timeout")
	flag.BoolVar(&cfg.verbose, "v", false, "print scenario parameters and trace hashes")
	flag.BoolVar(&cfg.trace, "trace", false, "print every scenario's full event trace")
	flag.StringVar(&cfg.jsonPath, "json", "", "write a JSON report to this file (- for stdout)")
	flag.Float64Var(&cfg.connectRate, "connect-rate", 8, "WebSocket handshakes per second, all scenarios together")
	flag.Float64Var(&cfg.speed, "speed", 20, "race time compression (scripted answer time / speed = real time)")
	flag.IntVar(&cfg.maxPlayers, "max-players", 60, "the relay's MAX_PLAYERS (capacity scenario)")
	flag.DurationVar(&cfg.msgInterval, "msg-interval", 100*time.Millisecond, "minimum interval between messages on one connection (relay limit: 20/s)")
	flag.BoolVar(&cfg.slow, "slow", false, "include slow scenarios (host gone past the 2 min grace)")
	flag.Parse()
	seedSet := false
	flag.Visit(func(f *flag.Flag) { seedSet = seedSet || f.Name == "seed" })
	if !seedSet {
		cfg.seed = time.Now().UnixNano()
	}
	if cfg.connectRate <= 0 || cfg.speed <= 0 || cfg.concurrency < 1 || cfg.maxPlayers < 1 || cfg.n < 0 {
		fmt.Fprintln(os.Stderr, "relaysim: -connect-rate, -speed, -concurrency, -max-players and -n must be positive")
		return 2
	}
	if cfg.n == 0 {
		cfg.n = len(suite(cfg.slow))
	}

	plans, err := selectScenarios(cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "relaysim:", err)
		return 2
	}
	s := &sim{
		cfg:        cfg,
		d:          &dialer{url: cfg.url, origin: cfg.origin, interval: time.Duration(float64(time.Second) / cfg.connectRate), httpStatus: map[int]int{}},
		codes:      map[string]codeEntry{},
		errReasons: map[string]int{},
		closeCodes: map[int]int{},
	}
	fmt.Printf("relaysim url=%s origin=%q seed=%d scenarios=%d concurrency=%d connect-rate=%g/s speed=%g\n",
		cfg.url, cfg.origin, cfg.seed, len(plans), cfg.concurrency, cfg.connectRate, cfg.speed)
	fmt.Printf("replay this run: %s\n", s.replayCmd(""))

	started := time.Now()
	results := make([]result, len(plans))
	jobs := make(chan int)
	var wg sync.WaitGroup
	var printMu sync.Mutex
	for range min(cfg.concurrency, len(plans)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				res := s.runScenario(plans[i])
				results[i] = res
				printMu.Lock()
				s.printResult(res)
				printMu.Unlock()
			}
		}()
	}
	for i := range plans {
		jobs <- i
	}
	close(jobs)
	wg.Wait()

	rep := s.summarize(results, started)
	s.printSummary(rep)
	if cfg.jsonPath != "" {
		b, _ := json.MarshalIndent(rep, "", "  ")
		b = append(b, '\n')
		if cfg.jsonPath == "-" {
			os.Stdout.Write(b)
		} else if err := os.WriteFile(cfg.jsonPath, b, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "relaysim:", err)
			return 1
		}
	}
	if rep.Fail > 0 || rep.Skip > 0 || rep.Aborted != "" {
		return 1
	}
	return 0
}

type scenarioPlan struct {
	idx  int
	arch *archetype
	id   string
}

var exactOnly = regexp.MustCompile(`^([a-z_]+)#(\d+)$`)

func selectScenarios(cfg config) ([]scenarioPlan, error) {
	s := suite(cfg.slow)
	plan := func(i int) scenarioPlan {
		a := s[i%len(s)]
		return scenarioPlan{idx: i, arch: a, id: fmt.Sprintf("%s#%d", a.name, i)}
	}
	if m := exactOnly.FindStringSubmatch(cfg.only); m != nil {
		i, err := strconv.Atoi(m[2])
		if err != nil {
			return nil, err
		}
		p := plan(i)
		if p.arch.name != m[1] {
			return nil, fmt.Errorf("with -seed %d scenario #%d is %s, not %s (check -seed and -slow)", cfg.seed, i, p.id, cfg.only)
		}
		return []scenarioPlan{p}, nil
	}
	var re *regexp.Regexp
	if cfg.only != "" {
		var err error
		if re, err = regexp.Compile(cfg.only); err != nil {
			return nil, fmt.Errorf("-only: %w", err)
		}
	}
	var out []scenarioPlan
	for i := range cfg.n {
		p := plan(i)
		if re == nil || re.MatchString(p.id) {
			out = append(out, p)
		}
	}
	return out, nil
}

func (s *sim) replayCmd(only string) string {
	cmd := fmt.Sprintf("go run ./cmd/relaysim -url %s -origin %q -seed %d", s.cfg.url, s.cfg.origin, s.cfg.seed)
	if only != "" {
		cmd += " -only " + only
	} else {
		cmd += fmt.Sprintf(" -n %d", s.cfg.n)
		if s.cfg.only != "" {
			cmd += fmt.Sprintf(" -only %q", s.cfg.only)
		}
	}
	if s.cfg.slow {
		cmd += " -slow"
	}
	if s.cfg.maxPlayers != 60 {
		cmd += fmt.Sprintf(" -max-players %d", s.cfg.maxPlayers)
	}
	if s.cfg.speed != 20 {
		cmd += fmt.Sprintf(" -speed %g", s.cfg.speed)
	}
	return cmd
}

var errTimeout = errors.New("scenario timeout")

func (s *sim) runScenario(p scenarioPlan) result {
	res := result{ID: p.id, Name: p.arch.name, Index: p.idx}
	if s.d.aborted.Load() {
		res.Status, res.Error = "SKIP", "run aborted: "+s.d.reason()
		return res
	}
	start := time.Now()
	tctx, cancelT := context.WithTimeoutCause(context.Background(), s.cfg.timeout+p.arch.extra, errTimeout)
	defer cancelT()
	ctx, cancel := context.WithCancelCause(tctx)
	sc := &scenario{sim: s, idx: p.idx, arch: p.arch, id: p.id, rng: scenarioRNG(s.cfg.seed, p.idx), ctx: ctx, cancel: cancel}
	func() {
		defer func() {
			if r := recover(); r != nil && r != errAbort {
				sc.failf("panic: %v\n%s", r, debug.Stack())
			}
		}()
		p.arch.run(sc)
		sc.finalChecks()
	}()
	sc.mu.Lock()
	err := sc.err
	sc.mu.Unlock()
	if err == nil && ctx.Err() != nil {
		err = context.Cause(ctx)
	}
	sc.teardown()
	cancel(nil)

	lines := sc.trace()
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	res.DurationMs = time.Since(start).Milliseconds()
	res.Conns = sc.nconns.Load()
	res.Desc = sc.desc
	res.TraceHash = hex.EncodeToString(sum[:8])
	if s.cfg.trace || s.cfg.jsonPath != "" {
		res.Trace = lines
	}
	if err != nil {
		res.Status, res.Error = "FAIL", err.Error()
		res.Replay = s.replayCmd(p.id)
		if s.d.aborted.Load() {
			res.Replay = ""
		}
	} else {
		res.Status = "PASS"
	}
	return res
}

// finalChecks fails on relay errors nobody expected.
func (sc *scenario) finalChecks() {
	for _, rm := range sc.rooms {
		rm.host.with(func() {
			sc.check(rm.host.errUsed == len(rm.host.errs), "%s: unexpected errors %v", rm.label("host", 0), rm.host.errs[rm.host.errUsed:])
		})
		for _, p := range rm.players {
			p.with(func() {
				sc.check(p.errUsed == len(p.errs), "%s: unexpected errors %v", p.label, p.errs[p.errUsed:])
			})
		}
	}
}

func (sc *scenario) teardown() {
	sc.down.Store(true)
	sc.mu.Lock()
	conns := sc.conns
	rooms := sc.rooms
	sc.mu.Unlock()
	for _, c := range conns {
		_ = c.ws.CloseNow()
	}
	for _, rm := range rooms {
		if code := rm.code(); code != "" {
			sc.sim.releaseCode(code, hostGrace+15*time.Second)
		}
	}
}

func (s *sim) printResult(r result) {
	if r.Status == "SKIP" {
		fmt.Printf("SKIP %-26s %s\n", r.ID, r.Error)
		return
	}
	fmt.Printf("%s %-26s %6.1fs conns=%-3d %s", r.Status, r.ID, float64(r.DurationMs)/1000, r.Conns, r.Desc)
	if s.cfg.verbose {
		fmt.Printf(" trace=%s", r.TraceHash)
	}
	fmt.Println()
	if r.Status == "FAIL" {
		fmt.Printf("     error: %s\n", r.Error)
		if r.Replay != "" {
			fmt.Printf("     replay: %s\n", r.Replay)
		}
	}
	if s.cfg.trace {
		for _, l := range r.Trace {
			fmt.Printf("     | %s\n", l)
		}
	}
}

func percentile(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	i := int(p*float64(len(sorted))+0.999999) - 1 // nearest rank
	return sorted[max(0, min(i, len(sorted)-1))]
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }

func (s *sim) summarize(results []result, started time.Time) report {
	rep := report{URL: s.cfg.url, Seed: s.cfg.seed, StartedAt: started.UTC(), DurationS: time.Since(started).Seconds(),
		Aborted: s.d.reason(), Conns: s.d.conns.Load(), Retries: s.d.retries.Load(), Scenarios: results,
		HTTPErrors: map[string]int{}, ErrReasons: map[string]int{}, CloseCodes: map[string]int{}}
	for _, r := range results {
		switch r.Status {
		case "PASS":
			rep.Pass++
		case "FAIL":
			rep.Fail++
		default:
			rep.Skip++
		}
	}
	s.mu.Lock()
	lat := append([]time.Duration(nil), s.latencies...)
	for k, v := range s.errReasons {
		rep.ErrReasons[k] = v
	}
	for k, v := range s.closeCodes {
		rep.CloseCodes[strconv.Itoa(k)] = v
	}
	s.mu.Unlock()
	s.d.mu.Lock()
	for k, v := range s.d.httpStatus {
		rep.HTTPErrors[strconv.Itoa(k)] = v
	}
	s.d.mu.Unlock()
	sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
	rep.Latency = latencyStats{N: len(lat), P50Ms: ms(percentile(lat, 0.5)), P95Ms: ms(percentile(lat, 0.95))}
	if len(lat) > 0 {
		rep.Latency.MaxMs = ms(lat[len(lat)-1])
	}
	return rep
}

func fmtCounts(m map[string]int) string {
	if len(m) == 0 {
		return "none"
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = fmt.Sprintf("%s=%d", k, m[k])
	}
	return strings.Join(parts, " ")
}

func (s *sim) printSummary(rep report) {
	byArch := map[string][2]int{}
	for _, r := range rep.Scenarios {
		c := byArch[r.Name]
		c[1]++
		if r.Status == "PASS" {
			c[0]++
		}
		byArch[r.Name] = c
	}
	names := make([]string, 0, len(byArch))
	for k := range byArch {
		names = append(names, k)
	}
	sort.Strings(names)
	parts := make([]string, len(names))
	for i, k := range names {
		parts[i] = fmt.Sprintf("%s %d/%d", k, byArch[k][0], byArch[k][1])
	}
	fmt.Printf("\n--- summary (seed=%d, %s) ---\n", rep.Seed, rep.URL)
	fmt.Printf("scenarios: %d  pass=%d fail=%d skip=%d  in %s\n", len(rep.Scenarios), rep.Pass, rep.Fail, rep.Skip,
		time.Duration(rep.DurationS*float64(time.Second)).Round(100*time.Millisecond))
	fmt.Printf("by archetype (pass/total): %s\n", strings.Join(parts, ", "))
	fmt.Printf("connections: %d  handshake retries: %d  handshake HTTP errors: %s\n", rep.Conns, rep.Retries, fmtCounts(rep.HTTPErrors))
	fmt.Printf("standings latency host→player: n=%d p50=%.2fms p95=%.2fms max=%.2fms\n",
		rep.Latency.N, rep.Latency.P50Ms, rep.Latency.P95Ms, rep.Latency.MaxMs)
	fmt.Printf("relay errors received (all expected unless a scenario failed): %s\n", fmtCounts(rep.ErrReasons))
	fmt.Printf("expected close codes: %s\n", fmtCounts(rep.CloseCodes))
	if rep.Aborted != "" {
		fmt.Printf("ABORTED: %s\n", rep.Aborted)
	}
	for _, r := range rep.Scenarios {
		if r.Status == "FAIL" {
			fmt.Printf("FAILED %s: %s\n  replay: %s\n", r.ID, firstLine(r.Error), r.Replay)
		}
	}
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
