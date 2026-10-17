package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/coder/websocket"
)

// Server serves /ws, /healthz and /stats.
type Server struct {
	cfg    Config
	log    *slog.Logger
	hub    *Hub
	events *EventLog
	mux    *http.ServeMux
}

func NewServer(cfg Config, logger *slog.Logger) *Server {
	events := &EventLog{path: cfg.EventsPath, log: logger}
	s := &Server{cfg: cfg, log: logger, events: events, hub: newHub(cfg, events, logger), mux: http.NewServeMux()}
	s.mux.HandleFunc("/ws", s.serveWS)
	s.mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	s.mux.HandleFunc("/stats", s.serveStats)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	ip, ua := clientIP(r), r.UserAgent()
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.cfg.AllowedOrigins})
	if err != nil {
		s.log.Warn("ws_rejected", "err", err, "origin", r.Header.Get("Origin"), "ip", ip, "ua", ua)
		return
	}
	ws.SetReadLimit(maxMessageBytes)
	// A host resume (handleResume) queues `created` plus up to player_joined +
	// player_left + progress per player at once (181 messages at 60 players);
	// the +64 covers live traffic and lobby broadcast bursts.
	c := newClient(ws, ip, ua, 3*s.cfg.MaxPlayers+64)
	s.log.Info("ws_connect", c.logAttrs()...)
	go c.writeLoop(s.cfg.PingInterval)
	s.readLoop(c)
}

// readLoop runs on the HTTP handler goroutine until the connection ends.
// Before the client belongs to a room it handles create/join itself; after
// that every message goes to the room goroutine.
func (s *Server) readLoop(c *client) {
	var room *Room
	defer func() {
		c.cancel()
		if room != nil {
			room.post(leaveEvent{c: c})
		}
	}()
	limiter := newRateLimiter(time.Now())
	for {
		ctx, cancel := context.WithTimeout(c.ctx, s.cfg.ReadTimeout)
		typ, data, err := c.ws.Read(ctx)
		cancel()
		if err != nil {
			return
		}
		if c.closing.Load() {
			continue
		}
		if !limiter.allow(time.Now()) {
			s.log.Warn("rate_limited", c.logAttrs()...)
			c.closeWith(websocket.StatusPolicyViolation, "rate limited", errorMsg("rate_limited"))
			continue
		}
		var env struct {
			T string `json:"t"`
		}
		if typ != websocket.MessageText || json.Unmarshal(data, &env) != nil {
			c.send(errorMsg("bad_request"))
			continue
		}
		switch env.T {
		case "ping":
			c.send([]byte(`{"t":"pong"}`))
			continue
		case "pong":
			continue
		}
		if room != nil {
			// A closed room has already queued `closed` and the close frame
			// for this connection; keep reading until the socket ends.
			room.post(msgEvent{c: c, t: env.T, raw: data})
			continue
		}
		switch env.T {
		case "create":
			room = s.handleCreate(c, data)
		case "join":
			room = s.handleJoin(c, data)
		default:
			c.send(errorMsg("bad_request"))
		}
	}
}

func (s *Server) handleCreate(c *client, data []byte) *Room {
	var m struct {
		Settings  json.RawMessage `json:"settings"`
		Code      string          `json:"code"`
		HostToken string          `json:"hostToken"`
	}
	if json.Unmarshal(data, &m) != nil {
		c.send(errorMsg("bad_request"))
		return nil
	}
	if m.Code == "" && m.HostToken == "" {
		settings := m.Settings
		if len(settings) == 0 || settings[0] != '{' {
			settings = json.RawMessage("{}")
		}
		return s.hub.create(c, settings)
	}
	room := s.hub.get(normalizeCode(m.Code))
	if room == nil {
		c.send(errorMsg("not_found"))
		return nil
	}
	if reason := room.call(func(reply chan string) any { return resumeReq{c: c, token: m.HostToken, reply: reply} }); reason != "" {
		c.send(errorMsg(reason))
		return nil
	}
	return room
}

func (s *Server) handleJoin(c *client, data []byte) *Room {
	var m struct {
		Code        string `json:"code"`
		Name        string `json:"name"`
		PlayerToken string `json:"playerToken"`
	}
	if json.Unmarshal(data, &m) != nil {
		c.send(errorMsg("bad_request"))
		return nil
	}
	name := cleanName(m.Name)
	if name == "" {
		c.send(errorMsg("bad_name"))
		return nil
	}
	room := s.hub.get(normalizeCode(m.Code))
	if room == nil {
		c.send(errorMsg("not_found"))
		return nil
	}
	if reason := room.call(func(reply chan string) any {
		return joinReq{c: c, name: name, token: m.PlayerToken, reply: reply}
	}); reason != "" {
		c.send(errorMsg(reason))
		return nil
	}
	return room
}

func normalizeCode(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

// cleanName strips control characters, trims spaces and caps the length.
func cleanName(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > maxNameRunes {
		s = strings.TrimSpace(string([]rune(s)[:maxNameRunes]))
	}
	return s
}
