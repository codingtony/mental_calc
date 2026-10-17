package main

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// Application close codes (4000-4999 are free for applications).
const (
	closeKicked   websocket.StatusCode = 4000
	closeReplaced websocket.StatusCode = 4001
	closeRoom     websocket.StatusCode = 4002
)

type outMsg struct {
	data   []byte
	close  bool
	code   websocket.StatusCode
	reason string
}

// client is one WebSocket connection. Any goroutine may call send/closeWith;
// only writeLoop writes to the socket and only the HTTP handler reads from it.
type client struct {
	ws      *websocket.Conn
	out     chan outMsg
	ctx     context.Context
	cancel  context.CancelFunc
	closing atomic.Bool
	ip, ua  string
}

func newClient(ws *websocket.Conn, ip, ua string, queue int) *client {
	ctx, cancel := context.WithCancel(context.Background())
	return &client{ws: ws, out: make(chan outMsg, queue), ctx: ctx, cancel: cancel, ip: ip, ua: ua}
}

// send queues one message. A client that lets its queue fill up is dropped.
func (c *client) send(b []byte) {
	if c.closing.Load() {
		return
	}
	select {
	case c.out <- outMsg{data: b}:
	default:
		c.closing.Store(true)
		c.cancel()
	}
}

func (c *client) sendJSON(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // only relay-built values are marshalled here
	}
	c.send(b)
}

// closeWith sends final (if any) after everything already queued, then closes.
func (c *client) closeWith(code websocket.StatusCode, reason string, final []byte) {
	if !c.closing.CompareAndSwap(false, true) {
		return
	}
	select {
	case c.out <- outMsg{data: final, close: true, code: code, reason: reason}:
	default:
		c.cancel()
	}
}

var pingMsg = []byte(`{"t":"ping"}`)

func (c *client) write(b []byte) error {
	ctx, cancel := context.WithTimeout(c.ctx, writeTimeout)
	defer cancel()
	return c.ws.Write(ctx, websocket.MessageText, b)
}

func (c *client) writeLoop(pingEvery time.Duration) {
	defer c.cancel()
	t := time.NewTicker(pingEvery)
	defer t.Stop()
	for {
		select {
		case <-c.ctx.Done():
			_ = c.ws.CloseNow()
			return
		case m := <-c.out:
			if m.data != nil {
				if err := c.write(m.data); err != nil {
					_ = c.ws.CloseNow()
					return
				}
			}
			if m.close {
				_ = c.ws.Close(m.code, m.reason)
				return
			}
		case <-t.C:
			if err := c.write(pingMsg); err != nil {
				_ = c.ws.CloseNow()
				return
			}
		}
	}
}

func (c *client) logAttrs() []any {
	return []any{"ip", c.ip, "ua", c.ua}
}

// rateLimiter is a token bucket: msgsPerSecond sustained, same burst.
type rateLimiter struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(now time.Time) *rateLimiter {
	return &rateLimiter{tokens: msgsPerSecond, last: now}
}

func (l *rateLimiter) allow(now time.Time) bool {
	l.tokens += now.Sub(l.last).Seconds() * msgsPerSecond
	if l.tokens > msgsPerSecond {
		l.tokens = msgsPerSecond
	}
	l.last = now
	if l.tokens < 1 {
		return false
	}
	l.tokens--
	return true
}

func errorMsg(reason string) []byte {
	b, _ := json.Marshal(struct {
		T      string `json:"t"`
		Reason string `json:"reason"`
	}{"error", reason})
	return b
}
