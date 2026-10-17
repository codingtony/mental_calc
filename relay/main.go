// Command relay is the WebSocket relay for multiplayer races of the mental
// calculation game. The teacher's tab (host) owns the race state; the relay
// only forwards messages between the host and up to MAX_PLAYERS players and
// personalises the standings. See PROTOCOL.md.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Config holds the relay settings. Durations are fixed in production and
// shortened by the tests.
type Config struct {
	Listen         string
	AllowedOrigins []string
	MaxPlayers     int
	EventsPath     string
	StatsToken     string

	HostGrace    time.Duration // room closes this long after the host disconnects
	IdleTTL      time.Duration // room closes after this long without messages
	PingInterval time.Duration // relay → client ping period
	ReadTimeout  time.Duration // connection closes after this long without any message
}

const (
	maxMessageBytes = 8 << 10
	msgsPerSecond   = 20
	maxNameRunes    = 32
	writeTimeout    = 10 * time.Second
)

func defaultConfig() Config {
	return Config{
		Listen:         "127.0.0.1:8010",
		AllowedOrigins: []string{"maths.codingtony.com", "localhost:5173", "localhost:4173"},
		MaxPlayers:     60,
		EventsPath:     "/var/log/mc-relay/events.jsonl",
		HostGrace:      2 * time.Minute,
		IdleTTL:        2 * time.Hour,
		PingInterval:   25 * time.Second,
		ReadTimeout:    75 * time.Second,
	}
}

func envOr(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func loadConfig(args []string) (Config, error) {
	cfg := defaultConfig()
	fs := flag.NewFlagSet("relay", flag.ContinueOnError)
	listen := fs.String("listen", envOr("LISTEN", cfg.Listen), "listen address (env LISTEN)")
	origins := fs.String("allowed-origins", envOr("ALLOWED_ORIGINS", strings.Join(cfg.AllowedOrigins, ",")),
		"comma-separated Origin host patterns (env ALLOWED_ORIGINS)")
	maxPlayers := fs.String("max-players", envOr("MAX_PLAYERS", strconv.Itoa(cfg.MaxPlayers)), "players per room (env MAX_PLAYERS)")
	events := fs.String("events-path", envOr("EVENTS_PATH", cfg.EventsPath), "usage events file, empty disables (env EVENTS_PATH)")
	if err := fs.Parse(args); err != nil {
		return cfg, err
	}
	n, err := strconv.Atoi(*maxPlayers)
	if err != nil || n < 1 {
		return cfg, errors.New("MAX_PLAYERS must be a positive integer")
	}
	cfg.Listen = *listen
	cfg.AllowedOrigins = splitList(*origins)
	cfg.MaxPlayers = n
	cfg.EventsPath = *events
	// Env only: a flag would expose the token in the process list.
	cfg.StatsToken = os.Getenv("STATS_TOKEN")
	return cfg, nil
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	cfg, err := loadConfig(os.Args[1:])
	if err != nil {
		logger.Error("config", "err", err)
		os.Exit(2)
	}

	srv := NewServer(cfg, logger)
	httpSrv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		logger.Info("shutting down")
		srv.hub.Shutdown()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()

	logger.Info("listening", "addr", cfg.Listen, "origins", cfg.AllowedOrigins, "max_players", cfg.MaxPlayers,
		"events_path", cfg.EventsPath, "stats", cfg.StatsToken != "")
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("listen", "err", err)
		os.Exit(1)
	}
}
