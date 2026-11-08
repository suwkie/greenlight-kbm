# Keyboard & Mouse for Xbox remote play

Greenlight can drive Xbox remote play with a keyboard and mouse. The feature is
implemented in the desktop renderer and does **not** need a virtual gamepad
driver, `uinput`, ViGEmBus or any OS-level input hook.

## Modes

The mode is selected in **Settings → Input → Keyboard & Mouse**.

| Mode | What is sent to the console | Use it for |
| --- | --- | --- |
| **Off** | Nothing. Controller input works as before. | Normal controller play |
| **Native** | Real mouse and keyboard reports over the input channel | Games that support keyboard & mouse on Xbox |
| **Gamepad emulation** | The mouse becomes the right thumbstick; keys become controller buttons | Every other game |

Native mode only works in titles where the Xbox version accepts keyboard &
mouse input. The console silently ignores the reports in other games; switch to
gamepad emulation (or press the switch hotkey) when that happens.

## Capturing the mouse

1. Start a stream.
2. Click the video. The mouse is locked and hidden.
3. Press **Esc** to release it again (the gamebar becomes usable). Escape is
   still forwarded to the game in native mode before the browser releases the
   lock, so pause menus keep working.

While the mouse is captured, a small badge shows the active mode and the hotkey
to switch between native and gamepad emulation. The hotkey defaults to **F8**
and can be changed in the settings.

## Settings

| Setting | Description |
| --- | --- |
| Mouse sensitivity | Multiplier applied to mouse movement. `1.00x` sends raw pixels in native mode and is the starting point for gamepad emulation. |
| Invert vertical axis | Flips the Y direction in both modes. |
| Switch mode hotkey | Key used to toggle native/gamepad while streaming. |
| Aim deadzone | Ignores tiny mouse movements. Keep at `0` for the most responsive aiming (gamepad mode only). |
| Aim response curve | Shapes small mouse movements. `< 1` is faster, `> 1` is more precise (gamepad mode only). |
| Left/right/middle click | Controller action triggered by each mouse button (gamepad mode only). |
| Keyboard mappings | Key → controller button bindings (gamepad emulation and the built-in keyboard-to-gamepad mode). `W`, `A`, `S`, `D` always drive the left thumbstick and cannot be bound. |

The **Reset** button restores the sensitivity, deadzone, curve, mouse button
actions, hotkey and key bindings to their defaults.

## How it works

The released `xbox-xcloud-player` (0.2.11) already knows how to serialise mouse
and keyboard reports, but its capture code hardcodes a 10x mouse multiplier, has
no coalescing and competes with the keyboard-to-gamepad mapping. Instead of
patching the dependency, Greenlight installs its **own input driver** through the
public `input_driver` constructor option:

- `renderer/lib/kbm/driver.ts` implements the driver interface the player calls
  (`setApplication`, `start`, `stop`, `run`, `pressButton`, ...). It owns
  pointer lock, keyboard state, the mouse→stick conversion and merging with a
  physical controller, and queues one gamepad frame per 60 Hz tick. Those frames
  also keep the input channel flushing, which is required for mouse/keyboard
  reports to be sent at all.
- `renderer/lib/kbm/runtime.ts` maps the flat settings object to the driver
  configuration and returns the `input_driver`, `input_legacykeyboard`,
  `input_mousekeyboard` and `input_mousekeyboard_config` values that are spread
  into the player constructor.
- Mouse and keyboard reports are queued into the input channel's frame arrays.
  The runtime feature-detects the newer `queueMouseFrame`/`queueKeyboardFrame`
  methods and falls back to the 0.2.11 frame arrays. Native mode is disabled with
  a visible warning if neither is available.

The player's built-in keyboard driver is neutralised (empty mapping +
`input_legacykeyboard: false`) so input is not applied twice.

## Limitations

- **Game support**: only titles with Xbox keyboard & mouse support respond to
  native mode. There is no reliable way to detect this from the client.
- **Keyboard queue**: the 0.2.11 input channel sends at most one keyboard frame
  per packet (every ~16 ms). Very fast key sequences can lag slightly. Mouse
  frames are coalesced, so they are not affected.
- **Layouts**: native keyboard reports use a physical-key → VK mapping, so
  `WASD` stays in place on AZERTY/Dvorak. Key bindings in the settings UI still
  use the produced character, which matches the previous behaviour.
- **Wheel**: the wheel is forwarded as a `WheelY` step in native mode. Its
  meaning is game-dependent.
- **Pointer lock**: `unadjustedMovement` is requested first and falls back to a
  normal pointer lock. On some Wayland setups raw movement is still filtered by
  the compositor.
- **Multi controller**: the driver merges input from the first connected
  controller only.
- **Multiple gamepads / legacy setting**: while a keyboard & mouse mode is
  active, Greenlight's own driver replaces the built-in one. The *Enable
  Keyboard to Gamepad* option is ignored during that session.

## Tests

The input logic is plain TypeScript and can be exercised without Electron:

```bash
cd packages/desktop
node scripts/test-kbm.mjs
```

It compiles `renderer/lib/kbm` with the local TypeScript and asserts the
settings defaults, VK mapping, trigger field mapping, WASD handling, left stick
normalisation, aim shaping, the 60 Hz gamepad frame cadence and the native
mouse/keyboard flush heartbeat.

## Testing checklist

1. Start a stream with gamepad emulation and no controller connected: the mouse
   should move the right stick, WASD the left stick, `Space` should press A
   (after assigning it in the key mappings).
2. Connect a controller: both the controller and the mouse should keep working.
3. Switch to native mode in a supported title (for example a game from the Xbox
   keyboard & mouse list): the game should receive real key presses and raw
   mouse deltas.
4. Press Esc, move the mouse to the gamebar and interact with it.
5. Alt-tab away and back: no key should stay stuck.
6. Press F8 during a stream: the badge should switch between native and gamepad
   emulation without interrupting the video.
