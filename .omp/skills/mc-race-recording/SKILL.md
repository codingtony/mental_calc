---
name: mc-race-recording
description: Record a video of the mental_calc teacher (host) screen running a multiplayer race with up to 60 bots; use when asked to record, film or screenshot a hosted race.
---

# Recording a hosted race with bots (mental_calc)

Local stack only (no production traffic, no stats pollution). All commands from the mental_calc repo.

## 1. Services (supervised, non-pty)

```sh
# relay (from relay/): origin must match the page origin exactly (localhost, not 127.0.0.1)
LISTEN=127.0.0.1:8010 ALLOWED_ORIGINS=localhost:5173 EVENTS_PATH= go run .
# client (repo root): bind 127.0.0.1 explicitly, otherwise vite listens on ::1 only and a port-readiness check times out
npx vite --port 5173 --strictPort --host 127.0.0.1
```

Open the page as `http://localhost:5173/?relay=ws%3A%2F%2F127.0.0.1%3A8010%2Fws`.

## 2. Browser: headed + recordStart (the only reliable combination)

- Use `browser.open({name, headed: true, persist: true, url, viewport: {width: 1440, height: 810}})`.
- Every later `browser.open({name})` for that tab MUST repeat `headed: true`, else
  "Tab is bound to a different browser".
- `tab.recordStart("/tmp/<dir>/<file>.mp4")` → drive the page → `tab.recordStop()` returns
  `{path, durationMs, frames, bytes}`. ~30 fps H.264, ~14 MB/min. The headed window chrome eats
  some height (1440x810 viewport recorded as 1440x702).
- Sanity check before recording: count `requestAnimationFrame` callbacks for 1 s via `tab.evaluate`
  (expect ~60). 0 means the compositor is stalled: close with `browser.close({all: true, kill: true})`
  and reopen.

What failed (don't repeat):
- Headless + `recordStart`: the Babylon/WebGL canvas stalled (rAF stopped), the video had 0 frames,
  `recordStop` and screenshots timed out after 29 s.
- A background screenshot loop while also clicking the same tab: "Tab is busy" (tab operations are
  serialised); awaiting that loop later hung the eval cell until it was force-killed.
- Fallback that does work if recording is unavailable: periodic `tab.screenshot({path})` from the
  driving cell itself, then `ffmpeg -framerate 4 -i frames/%04d.png -pix_fmt yuv420p out.mp4`.

## 3. Script (each step its own eval cell, short timeouts; long cells risk a VM reset)

1. Wait ~3 s for the intro, click `#host-btn`, poll `#host-code` until `/^[A-Z2-9]{5}$/`.
2. Bots (from relay/, supervised): `go run ./cmd/racebots -code <CODE> -players 60 -connect-rate 6 -speed 2`
   (`-connect-rate 6` makes the lobby fill visibly over ~10 s; `-speed 2` halves race time;
   defaults: crash 5 %, drop/reconnect 5 %, origin http://localhost:5173, relay ws://127.0.0.1:8010/ws).
3. Poll `#host-players li` count to 60; click `#host-players-more` (▼) until it gets class `hidden`,
   then `#host-players-less` (▲) back to the top, to show the list scrolling; click `#host-start`.
4. After ~12 s click `#host-showall`; click `#lanes-more` (▼) until hidden, then `#lanes-less` (▲) back up.
5. Poll until `#host-podium` loses class `hidden` (race over; ~70 s for 30 questions at speed 2),
   wait a few seconds on the podium, `recordStop`. Known quirk: bots answer before the countdown
   ends, so some show 2/30 at "KÖR!".
6. Cleanup: `pkill -f "racebots -code <CODE>"` (exit 143 from the supervised job is expected),
   kill the vite/relay services, `browser.close`.

Preview the result with `read <file>.mp4` (frame grid + metadata); hand it to the user with `open <file>`.
