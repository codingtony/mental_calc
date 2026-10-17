#!/usr/bin/env bash
# Start a built relay binary on localhost and run the scenario simulator against it.
# Usage (from relay/): scripts/ci-sim.sh ./mc-relay-linux-amd64 [relaysim flags...]
set -euo pipefail

bin=$1; shift
port=${PORT:-18011}
events=$(mktemp)
log=$(mktemp)

LISTEN=127.0.0.1:$port ALLOWED_ORIGINS=maths.codingtony.com EVENTS_PATH=$events "$bin" >"$log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null; rm -f "$events" "$log"' EXIT

for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && break
  sleep 0.1
done
curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null

# No nginx in front locally, so handshakes need no production pacing.
if ! go run ./cmd/relaysim -url "ws://127.0.0.1:$port/ws" -n 100 -connect-rate 50 "$@"; then
  echo "--- relay log (last 100 lines) ---"
  tail -n 100 "$log"
  exit 1
fi
