# Low-latency streaming

This fork adds receive-side latency controls, immediate input packets and a live
latency readout. Every change is committed separately and can be reverted.

## What was added

| Change | Where | Default |
| --- | --- | --- |
| Immediate input packets (skip the 16 ms batch) | `renderer/lib/latency/inputflush.ts` | On |
| Extra video jitter-buffer margin | `renderer/lib/latency/controller.ts` | Browser default (`-1`) |
| Direct LAN ICE mode (skip STUN) for console streaming | same | Off |
| Live latency panel (RTT, buffer, jitter, decode, path, stalls, loss) | `renderer/components/ui/streamcomponent.tsx` | Collected only while the debug panel is open |
| Background throttling disabled | `main/helpers/create-window.ts`, `main/application.ts` | On |
| VA-API hardware decode flags on Linux | `main/application.ts` | Opt-in: `GREENLIGHT_VAAPI=1` |

Settings live in **Settings → Streaming → Latency**.

## What each option actually does

### Immediate input

The player's input channel batches everything into a packet every 16 ms. This
fork drains the queues and sends as soon as a frame is produced (gamepad frames
via a `queueGamepadState` wrapper; native mouse/keyboard frames directly),
throttled to 6 ms.

- Saving: **~8 ms average, ~15 ms p95** for mouse/keyboard and KBM gamepad
  emulation, because those frames are produced outside the interval.
- The legacy gamepad-only path creates its frame *inside* the interval, so the
  saving there is near zero.
- Rate: at most ~166 packets/s (vs ~60), about 10–30 kB/s extra — under 2 % of a
  20 Mbps stream.
- The player's interval drains all queues and only sends when it finds gamepad,
  metadata or pointer data. When a flush is throttled, the driver leaves one
  gamepad heartbeat frame in the queue (at most every 15 ms) so a pending
  mouse/keyboard frame can never be spliced out and discarded.
- The "Send input immediately" checkbox sets `channel.__latencyImmediate`;
  turning it off restores the original 16 ms behaviour.

### Extra video jitter buffer

`RTCRtpReceiver.jitterBufferTarget` maps to Chromium's **minimum** playout
delay. `0` is already the browser default, so selecting it does **not** lower
latency. Values above 0 deliberately add safety margin for noisy Wi-Fi. The
setting defaults to the browser default (`-1`, no API call). It cannot go below
the jitter estimator's floor.

### Direct LAN

The player hardcodes two Google STUN servers. On a healthy LAN the host↔host
candidate pair wins anyway, so this is not a steady-state RTT win. It removes
STUN gather attempts/timeouts (visible in logs as `stun_port.cc Binding request
timed out`) and prevents a hairpin-NAT path from being selected. It is applied
only to console (`home`) streams; xCloud ignores it. Do not enable it for
internet remote play.

### Latency panel

Open the stream debug panel with the bug button. The panel only calls
`getStats()` while it is visible, so it no longer adds work during normal play
(the pre-existing 33 ms stats/uPlot loop is gated the same way).

| Row | Meaning | Healthy |
| --- | --- | --- |
| RTT | WebRTC round trip to the console | < 20 ms on LAN |
| Jitter buffer | Average receive buffer delay | < 40 ms |
| Jitter | Packet timing variance | < 15 ms |
| Decode | Average video decode time | < 8 ms (hardware) |
| Processing | Frame assembly/processing delay | < 15 ms |
| Path | `LAN`/`Remote`, candidate type, address | `LAN host` |
| Stalls | Freezes / pauses reported by WebRTC | 0 |
| Loss | Dropped frames, lost packets, NACK/PLI | 0 |

If **Path** says `Remote` while the console is on your LAN, the media is going
through the router's public address (hairpin NAT) or a relay. Fix the network
before tuning anything else.

## Hardware decode (optional)

The VA-API feature flags are opt-in because forcing acceleration past a broken
driver can crash the GPU process:

```bash
GREENLIGHT_VAAPI=1 npx nextron
```

Do not set it if `chrome://gpu` already reports `Video Decode:
Hardware accelerated` (Electron may already use VA-API through
`--enable-accelerated-video-decode`).

```bash
# In the running app: open the DevTools console and run
navigator.mediaCapabilities.decodingInfo({
  type: 'file', video: { contentType: 'video/mp4; codecs="avc1.42E01E"',
  width: 1920, height: 1080, bitrate: 8000000, framerate: 60 }
}).then(console.log)
# while streaming, chrome://media-internals should show VaapiVideoDecoder
```

If the GPU process crashes or video goes black after the VA-API flags, remove
them (see rollback) or launch with your own `--enable-features` value, which
takes precedence.

## Console/display checklist

- Xbox display settings: **120 Hz** for titles that support it. A 120 fps stream
  halves the frame interval, worth roughly 8 ms on average — the largest
  remaining client-visible number and it needs no code.
- Wired Ethernet on both ends; if the latency panel's **Path** row says
  `Remote`, fix the LAN/ICE path first.
- Monitor at 120 Hz with game mode enabled, even for a 60 fps stream, to reduce
  present latency.

## Expected total effect

On a clean wired LAN: immediate input removes ~8 ms of client-side delay; the
debug-panel gating removes periodic main-thread jank; hardware decode (if it was
software before) removes ~5–15 ms. Network jitter and Wi-Fi remain the dominant
factors and are not fixable in the client.

## Tests

```bash
cd packages/desktop
node scripts/test-kbm.mjs
node scripts/test-latency.mjs
# or both:
npm test
```

The latency suite covers stats parsing, candidate-pair selection, private/LAN
detection, throttle timing, failure/restore, handshake ordering, the
install/uninstall wrapper, jitter-target units and Direct LAN restore. The KBM
suite covers the immediate flush and the rate-limited heartbeat that protects
throttled frames from being discarded by the player's interval.

## Rolling back

Everything is committed on `feat/low-latency`; nothing was pushed.

```bash
git log --oneline
git checkout latency-v1     # latency work only
git checkout kbm-baseline   # keyboard & mouse, before latency
git checkout main-v2        # pristine upstream
git checkout feat/low-latency
```

You can also revert only the latest fixes with `git revert <commit>`.
