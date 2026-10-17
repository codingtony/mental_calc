package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// inMsg is one message received from the relay, or (closed) the end of a
// connection.
type inMsg struct {
	c      *wsConn
	t      string
	raw    []byte
	f      map[string]json.RawMessage
	at     time.Time
	closed bool
}

func (m inMsg) str(k string) string {
	var s string
	_ = json.Unmarshal(m.f[k], &s)
	return s
}

type outOp struct {
	b         []byte
	binary    bool
	noPace    bool
	stamp     func(time.Time) // called right before the frame is written
	closeCode websocket.StatusCode
}

// wsConn is one simulated WebSocket. A writer goroutine paces outgoing
// frames (minimum interval per connection) so the sim stays under the
// relay's 20 msg/s limit; a reader goroutine answers pings and forwards
// everything else to the owning actor's inbox.
type wsConn struct {
	sc     *scenario
	label  string
	ws     *websocket.Conn
	out    chan outOp
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}

	mu     sync.Mutex
	code   websocket.StatusCode // close code once done (-1: no close frame)
	expect websocket.StatusCode // close code the scenario expects (0: none)
	self   bool                 // closed by the sim itself
}

func (sc *scenario) dial(label string, inbox chan<- inMsg) *wsConn {
	ws := sc.sim.d.dial(sc, label)
	ctx, cancel := context.WithCancel(sc.ctx)
	c := &wsConn{sc: sc, label: label, ws: ws, out: make(chan outOp, 512), ctx: ctx, cancel: cancel, done: make(chan struct{})}
	sc.addConn(c)
	go c.readLoop(inbox)
	go c.writeLoop(sc.sim.cfg.msgInterval)
	return c
}

func (c *wsConn) readLoop(inbox chan<- inMsg) {
	for {
		typ, data, err := c.ws.Read(c.ctx)
		if err != nil {
			c.finish(err)
			select {
			case inbox <- inMsg{c: c, closed: true, at: time.Now()}:
			case <-c.sc.ctx.Done():
			}
			return
		}
		at := time.Now()
		if typ != websocket.MessageText {
			c.sc.failf("%s: binary frame from the relay", c.label)
			continue
		}
		var f map[string]json.RawMessage
		if err := json.Unmarshal(data, &f); err != nil {
			c.sc.failf("%s: invalid JSON from the relay: %s", c.label, data)
			continue
		}
		var t string
		_ = json.Unmarshal(f["t"], &t)
		if t == "ping" {
			c.enqueue(outOp{b: []byte(`{"t":"pong"}`), noPace: true})
			continue
		}
		select {
		case inbox <- inMsg{c: c, t: t, raw: data, f: f, at: at}:
		case <-c.sc.ctx.Done():
			return
		}
	}
}

func (c *wsConn) finish(err error) {
	code := websocket.CloseStatus(err)
	c.mu.Lock()
	c.code = code
	exp, self := c.expect, c.self
	c.mu.Unlock()
	c.cancel()
	close(c.done)
	sc := c.sc
	if self || sc.down.Load() || sc.ctx.Err() != nil {
		return
	}
	switch {
	case exp == 0:
		sc.failf("%s: connection closed unexpectedly (close code %d: %v)", c.label, code, err)
	case exp != code:
		sc.failf("%s: close code %d, want %d (%v)", c.label, code, exp, err)
	default:
		sc.sim.countClose(int(code))
	}
}

func (c *wsConn) writeLoop(pace time.Duration) {
	var last time.Time
	broken := false
	for {
		select {
		case <-c.ctx.Done():
			return
		case op := <-c.out:
			if broken {
				continue
			}
			if op.closeCode != 0 {
				_ = c.ws.Close(op.closeCode, "")
				broken = true
				continue
			}
			if !op.noPace && !last.IsZero() {
				if w := pace - time.Since(last); w > 0 {
					t := time.NewTimer(w)
					select {
					case <-t.C:
					case <-c.ctx.Done():
						t.Stop()
						return
					}
				}
			}
			if op.stamp != nil {
				op.stamp(time.Now())
			}
			typ := websocket.MessageText
			if op.binary {
				typ = websocket.MessageBinary
			}
			ctx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
			err := c.ws.Write(ctx, typ, op.b)
			cancel()
			if !op.noPace {
				last = time.Now()
			}
			if err != nil {
				broken = true // the reader reports how the connection ended
			}
		}
	}
}

func (c *wsConn) enqueue(op outOp) {
	select {
	case c.out <- op:
	case <-c.ctx.Done():
	}
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func (c *wsConn) send(v any)                           { c.enqueue(outOp{b: mustJSON(v)}) }
func (c *wsConn) sendStamped(v any, f func(time.Time)) { c.enqueue(outOp{b: mustJSON(v), stamp: f}) }
func (c *wsConn) sendRaw(b []byte, binary bool)        { c.enqueue(outOp{b: b, binary: binary}) }

func (c *wsConn) expectClose(code websocket.StatusCode) {
	c.mu.Lock()
	c.expect = code
	c.mu.Unlock()
}

// drop closes the socket without a close handshake (a lost Wi-Fi link).
func (c *wsConn) drop() {
	c.mu.Lock()
	c.self = true
	c.mu.Unlock()
	_ = c.ws.CloseNow()
}

// awaitClosed waits until the relay closed the connection and returns the
// close code.
func (c *wsConn) awaitClosed(d time.Duration) websocket.StatusCode {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-c.done:
	case <-t.C:
		c.sc.fatalf("%s: timeout (%s) waiting for the relay to close the connection", c.label, d)
	case <-c.sc.ctx.Done():
		panic(errAbort)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.code
}

// dialer paces handshakes across all scenarios (nginx limit_req on /ws) and
// retries 429/503 with exponential backoff. A 403 aborts the whole run: it
// is either a Cloudflare challenge or an Origin the relay refuses, and
// retrying would only hammer the edge.
type dialer struct {
	url, origin string
	interval    time.Duration

	mu         sync.Mutex
	next       time.Time
	httpStatus map[int]int
	abortMsg   string

	aborted atomic.Bool
	conns   atomic.Int64
	retries atomic.Int64
}

func (d *dialer) slot(ctx context.Context) {
	d.mu.Lock()
	now := time.Now()
	if d.next.Before(now) {
		d.next = now
	}
	at := d.next
	d.next = d.next.Add(d.interval)
	d.mu.Unlock()
	sleepCtx(ctx, time.Until(at))
}

func (d *dialer) abort(msg string) {
	d.mu.Lock()
	if d.abortMsg == "" {
		d.abortMsg = msg
	}
	d.mu.Unlock()
	d.aborted.Store(true)
}

func (d *dialer) reason() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.abortMsg
}

func (d *dialer) dial(sc *scenario, label string) *websocket.Conn {
	hdr := http.Header{"User-Agent": {"mc-relaysim/1"}}
	if d.origin != "" {
		hdr.Set("Origin", d.origin)
	}
	for attempt := 0; ; attempt++ {
		if d.aborted.Load() {
			sc.fatalf("run aborted: %s", d.reason())
		}
		d.slot(sc.ctx)
		ctx, cancel := context.WithTimeout(sc.ctx, 15*time.Second)
		ws, resp, err := websocket.Dial(ctx, d.url, &websocket.DialOptions{HTTPHeader: hdr})
		cancel()
		if err == nil {
			ws.SetReadLimit(1 << 20)
			d.conns.Add(1)
			sc.nconns.Add(1)
			return ws
		}
		if sc.ctx.Err() != nil {
			panic(errAbort)
		}
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		d.mu.Lock()
		d.httpStatus[status]++
		d.mu.Unlock()
		if status == http.StatusForbidden {
			d.abort(fmt.Sprintf("handshake refused with HTTP 403 (Cloudflare challenge or Origin %q not allowed)", d.origin))
			sc.fatalf("%s: HTTP 403 on the WebSocket upgrade: %v", label, err)
		}
		retry := status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable ||
			status == http.StatusBadGateway || (status == 0 && attempt < 2)
		if !retry || attempt >= 5 {
			sc.fatalf("%s: dial failed after %d attempt(s) (HTTP %d): %v", label, attempt+1, status, err)
		}
		d.retries.Add(1)
		sleepCtx(sc.ctx, time.Second<<attempt)
	}
}

// sleepCtx sleeps for d, aborting the scenario if its context ends.
func sleepCtx(ctx context.Context, d time.Duration) {
	if d <= 0 {
		if ctx.Err() != nil {
			panic(errAbort)
		}
		return
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
	case <-ctx.Done():
		panic(errAbort)
	}
}
