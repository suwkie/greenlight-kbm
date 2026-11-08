# Low-latency streaming

This fork adds receive-side latency controls and a live latency readout. The
changes are layered so each one can be disabled independently.

## What was added

| Change | Where | Default |
| --- | --- | --- |
| Immediate input packets (no 16 ms batch wait) | `renderer/lib/latency/inputflush.ts` | On |
| Configurable video jitter buffer target (`RTCRtpReceiver.jitterBufferTarget`, ms) | `renderer/lib/latency/controller.ts` | `0` (ultra low) |
| Direct LAN ICE mode (skip STUN) | same | Off |
| Live latency panel (RTT, jitter buffer, jitter, decode, processing, path, loss) | `renderer/components/ui/streamcomponent.tsx` | Always collected |
| Background throttling disabled (input/render timers keep full rate when unfocused) | `main/helpers/create-window.ts`, `main/application.ts` | On |
| VA-API hardware decode flags on Linux | `main/application.ts` | On (Linux only) |

Settings live in **Settings → Streaming → Latency**:

- **Video jitter buffer**: `0 ms` (ultra low), `30 ms`, `100 ms`, or browser
  default. Chromium clamps the value to a safe minimum. If the stream stutters
  on Wi-Fi, try `30` or `100`.
- **Send input immediately**: flushes mouse, keyboard and gamepad packets as
  soon as they are produced instead of waiting up to 16 ms for the player's
  input loop. Mouse/keyboard input also requires keyboard & mouse mode.
- **Prefer direct LAN (disable STUN)**: only gathers local ICE candidates.
  Use it when the PC and console are on the same network. Internet remote play
  will not connect with it enabled.

## Reading the latency panel

Open the stream debug panel (bug button in the gamebar, or `~`). The new
**Stream latency** grid shows:

| Row | Meaning | Healthy |
| --- | --- | --- |
| RTT | WebRTC round trip to the console | < 20 ms on LAN |
| Jitter buffer | Average receive buffer delay | < 40 ms |
| Jitter | Packet timing variance | < 15 ms |
| Decode | Average video decode time | < 8 ms (hardware) |
| Processing | Frame assembly/processing delay | < 15 ms |
| Path | `LAN`/`Remote`, candidate type, address | `LAN host` |
| Loss | Dropped frames, lost packets, NACK/PLI | all zero |

If **Path** says `Remote` while the console is on your LAN, the media is going
through the router's public address (hairpin NAT) or a relay. That is the
single biggest avoidable RTT; fix the network/topology before tuning anything
else.

## Expected gains

- Immediate input flush: 1–16 ms (average ~8 ms).
- Jitter buffer target: 10–60 ms depending on the previous buffer size.
- Hardware decode, if the GPU was falling back to software: 5–15 ms.
- Background throttling fix: prevents 1 Hz timer throttling when the window is
  unfocused (a much larger stall than any tuning).
- Direct LAN: removes STUN gather/relay paths, typically 0–30 ms.

These are independent of the console/network. Wire both ends if possible; no
client change can beat Wi-Fi jitter and bufferbloat.

## Running the tests

```bash
cd packages/desktop
node scripts/test-kbm.mjs
node scripts/test-latency.mjs
```

## Rolling back

Everything is committed on the `feat/low-latency` branch.

```bash
git log --oneline                     # see the commits
git checkout kbm-baseline             # keyboard & mouse only, before latency work
git checkout main-v2                  # pristine upstream branch
git checkout feat/low-latency         # come back
```

Tags and commits are local; nothing was pushed.
