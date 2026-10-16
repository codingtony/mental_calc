package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const waitFor = 3 * time.Second

func testConfig() Config {
	cfg := defaultConfig()
	cfg.AllowedOrigins = []string{"maths.codingtony.com"}
	cfg.EventsPath = ""
	cfg.PingInterval = time.Hour
	return cfg
}

type testRelay struct {
	srv  *Server
	http *httptest.Server
	url  string
}

func startRelay(t *testing.T, cfg Config) *testRelay {
	t.Helper()
	s := NewServer(cfg, discardLogger())
	hs := httptest.NewServer(s)
	t.Cleanup(func() {
		s.hub.Shutdown()
		hs.Close()
	})
	return &testRelay{srv: s, http: hs, url: "ws" + strings.TrimPrefix(hs.URL, "http") + "/ws"}
}

// msg is a decoded relay message; raw keeps the exact bytes.
type msg struct {
	T   string
	m   map[string]any
	raw []byte
}

func (m msg) str(k string) string { s, _ := m.m[k].(string); return s }

type testClient struct {
	t      *testing.T
	ws     *websocket.Conn
	msgs   chan msg
	closed chan websocket.StatusCode
}

func dial(t *testing.T, url string) *testClient {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), waitFor)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	ws.SetReadLimit(1 << 20)
	c := &testClient{t: t, ws: ws, msgs: make(chan msg, 1024), closed: make(chan websocket.StatusCode, 1)}
	go func() {
		for {
			_, data, err := ws.Read(context.Background())
			if err != nil {
				c.closed <- websocket.CloseStatus(err)
				close(c.msgs)
				return
			}
			var m map[string]any
			if err := json.Unmarshal(data, &m); err != nil {
				t.Errorf("bad json from relay: %s", data)
				continue
			}
			t, _ := m["t"].(string)
			if t == "ping" {
				_ = ws.Write(context.Background(), websocket.MessageText, []byte(`{"t":"pong"}`))
				continue
			}
			c.msgs <- msg{T: t, m: m, raw: data}
		}
	}()
	t.Cleanup(func() { _ = ws.CloseNow() })
	return c
}

func (c *testClient) send(v any) {
	c.t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		c.t.Fatal(err)
	}
	if err := c.ws.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatalf("write: %v", err)
	}
}

// expect returns the next message and fails unless its type is t. `lobby`
// updates are skipped unless t is "lobby".
func (c *testClient) expect(t string) msg {
	c.t.Helper()
	deadline := time.After(waitFor)
	for {
		select {
		case m, ok := <-c.msgs:
			if !ok {
				c.t.Fatalf("connection closed while waiting for %q", t)
			}
			if m.T == "lobby" && t != "lobby" {
				continue
			}
			if m.T != t {
				c.t.Fatalf("want %q, got %s", t, m.raw)
			}
			return m
		case <-deadline:
			c.t.Fatalf("timeout waiting for %q", t)
		}
	}
}

// expectNone fails if a message other than `lobby` arrives within d.
func (c *testClient) expectNone(d time.Duration) {
	c.t.Helper()
	deadline := time.After(d)
	for {
		select {
		case m, ok := <-c.msgs:
			if !ok {
				return
			}
			if m.T != "lobby" {
				c.t.Fatalf("unexpected message %s", m.raw)
			}
		case <-deadline:
			return
		}
	}
}

// skipTo discards messages until one of type t arrives.
func (c *testClient) skipTo(t string) msg {
	c.t.Helper()
	deadline := time.After(waitFor)
	for {
		select {
		case m, ok := <-c.msgs:
			if !ok {
				c.t.Fatalf("connection closed while waiting for %q", t)
			}
			if m.T == t {
				return m
			}
		case <-deadline:
			c.t.Fatalf("timeout waiting for %q", t)
		}
	}
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// expectClosed drains messages until the connection closes and returns the
// close code.
func (c *testClient) expectClosed() websocket.StatusCode {
	c.t.Helper()
	deadline := time.After(waitFor)
	for {
		select {
		case _, ok := <-c.msgs:
			if !ok {
				return <-c.closed
			}
		case <-deadline:
			c.t.Fatal("timeout waiting for close")
		}
	}
}

func (c *testClient) close() { _ = c.ws.Close(websocket.StatusNormalClosure, "") }

var testSettings = map[string]any{"cup": "mul", "n": 10, "difficulty": "easy"}

func createRoom(t *testing.T, url string) (*testClient, msg) {
	t.Helper()
	h := dial(t, url)
	h.send(map[string]any{"t": "create", "settings": testSettings})
	return h, h.expect("created")
}

// joinRoom joins code and consumes `joined` and the first `lobby`.
func joinRoom(t *testing.T, url, code, name string) (*testClient, msg) {
	t.Helper()
	p := dial(t, url)
	p.send(map[string]any{"t": "join", "code": code, "name": name})
	j := p.expect("joined")
	p.expect("lobby")
	return p, j
}
