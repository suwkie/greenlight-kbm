/**
 * Minimal regression tests for the keyboard & mouse input logic.
 *
 * The KBM module is pure TypeScript with no React or Electron dependency, so it
 * can be compiled and exercised directly with Node:
 *
 *   node scripts/test-kbm.mjs
 *
 * This covers the two bugs that are easy to reintroduce: mouse actions writing
 * to the wrong frame field, and WASD accidentally triggering its keyboard
 * binding. It also pins down the aim shaping math and settings defaults.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(here, '..')
const outDir = mkdtempSync(path.join(tmpdir(), 'greenlight-kbm-'))
const require = createRequire(import.meta.url)

let failures = 0

function check(name, condition, details) {
    if (condition) {
        console.log('  ok   ' + name)
        return
    }

    failures++
    console.error('  FAIL ' + name + (details !== undefined ? ' -> ' + JSON.stringify(details) : ''))
}

function close(a, b, epsilon = 0.0001) {
    return Math.abs(a - b) <= epsilon
}

try {
    execFileSync(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--module', 'commonjs',
        '--target', 'es2020',
        '--moduleResolution', 'node',
        '--lib', 'dom,dom.iterable,esnext',
        '--skipLibCheck',
        '--esModuleInterop',
        '--rootDir', path.join(desktopRoot, 'renderer/lib'),
        '--outDir', outDir,
        path.join(desktopRoot, 'renderer/lib/kbm/types.ts'),
        path.join(desktopRoot, 'renderer/lib/kbm/codes.ts'),
        path.join(desktopRoot, 'renderer/lib/kbm/driver.ts'),
        path.join(desktopRoot, 'renderer/lib/kbm/runtime.ts'),
    ], { stdio: 'inherit' })

    const KbmInputDriver = require(path.join(outDir, 'kbm', 'driver.js')).default
    const { resolveKbmSettings } = require(path.join(outDir, 'kbm', 'runtime.js'))
    const { virtualKeyFor, keyLabelForCode } = require(path.join(outDir, 'kbm', 'codes.js'))

    console.log('settings')
    const defaults = resolveKbmSettings({})
    check('defaults to off', defaults.mode === 'off', defaults.mode)
    check('default sensitivity is 1x', close(defaults.sensitivity, 1), defaults.sensitivity)
    check('default aim deadzone is 0', defaults.deadzone === 0, defaults.deadzone)
    check('left click maps to right trigger', defaults.leftClick === 'rightTrigger', defaults.leftClick)
    check('legacy input_mousekeyboard migrates to native', resolveKbmSettings({ input_mousekeyboard: true }).mode === 'native')
    check('invalid mode falls back to off', resolveKbmSettings({ input_kbm_mode: 'garbage' }).mode === 'off')

    console.log('key codes')
    check('KeyW -> VK_W', virtualKeyFor({ code: 'KeyW', keyCode: 0 }) === 0x57)
    check('AZERTY physical key still maps to VK_W', virtualKeyFor({ code: 'KeyW', keyCode: 0x5a }) === 0x57)
    check('unknown code falls back to keyCode', virtualKeyFor({ code: 'Nope', keyCode: 123 }) === 123)
    check('label for KeyM', keyLabelForCode('KeyM') === 'M')

    console.log('gamepad frame')
    const driver = new KbmInputDriver(resolveKbmSettings({ input_kbm_mode: 'gamepad' }))

    // Private fields are plain properties at runtime; the tests drive them
    // directly instead of synthesising DOM events.
    driver._mouseButtons = 1
    let frame = driver._buildFrame()
    check('left click sets RightTrigger', frame.RightTrigger === 1, frame.RightTrigger)
    check('left click does not create a lower-case field', frame.rightTrigger === undefined)

    driver._mouseButtons = 2
    frame = driver._buildFrame()
    check('right click sets LeftTrigger', frame.LeftTrigger === 1, frame.LeftTrigger)

    const mapped = new KbmInputDriver(resolveKbmSettings({
        input_kbm_mode: 'gamepad',
        input_mousekeyboard_config: { a: 'A', Space: 'A' },
    }))
    check('WASD resolves to no button binding', mapped._resolveButton('a', 'KeyA') === undefined)
    check('the same key on another physical key still resolves', mapped._resolveButton('a', 'KeyE') === 'A')
    check('space resolves through the mapping', mapped._resolveButton(' ', 'Space') === 'A')

    driver._mouseButtons = 0
    driver._heldCodes = {
        KeyW: { key: 'w', keyCode: 87, button: undefined, sentNative: false },
        KeyA: { key: 'a', keyCode: 65, button: undefined, sentNative: false },
    }
    frame = driver._buildFrame()
    check('W+A normalises the left stick', close(Math.hypot(frame.LeftThumbXAxis, frame.LeftThumbYAxis), 1))
    check('W points up (-1)', close(frame.LeftThumbYAxis, -Math.SQRT1_2), frame.LeftThumbYAxis)
    check('A points left (-1)', close(frame.LeftThumbXAxis, -Math.SQRT1_2), frame.LeftThumbXAxis)

    console.log('aim shaping')
    const aimDriver = new KbmInputDriver(resolveKbmSettings({
        input_kbm_mode: 'gamepad',
        input_kbm_sensitivity: 1,
        input_kbm_deadzone: 0.08,
        input_kbm_curve: 1,
    }))

    // A slow movement (3 px in one 8 ms tick) has to produce *some* output.
    // The old additive deadzone returned exactly 0 below 2.4 px and jumped to
    // 0.08 above it.
    aimDriver._aimX = 0
    aimDriver._aimY = 0
    aimDriver._updateAim(3, 0, 8)
    const slow = aimDriver._buildFrame()
    check('slow aim is not dead', slow.RightThumbXAxis > 0 && slow.RightThumbXAxis < 0.05, slow.RightThumbXAxis)

    aimDriver._aimX = 0
    aimDriver._aimY = 0
    aimDriver._updateAim(120, 0, 8)
    const fast = aimDriver._buildFrame()
    check('fast aim saturates', fast.RightThumbXAxis > 0.8 && fast.RightThumbXAxis <= 1, fast.RightThumbXAxis)

    // Frame axes follow the Gamepad API: moving the mouse down is +Y in the
    // frame and the packet writer negates it for the wire.
    aimDriver._aimX = 0
    aimDriver._aimY = 0
    aimDriver._updateAim(0, 120, 8)
    const down = aimDriver._buildFrame()
    check('mouse down is +Y in the frame', down.RightThumbYAxis > 0.8, down.RightThumbYAxis)

    console.log('frame cadence and flushing')
    const fakeChannel = {
        _gamepadFrames: [],
        _mouseFrames: [],
        queueGamepadState(frame) {
            this._gamepadFrames.push(frame)
        },
        getGamepadQueueLength() {
            return this._gamepadFrames.length
        },
    }

    const cadenceDriver = new KbmInputDriver(resolveKbmSettings({ input_kbm_mode: 'gamepad' }))
    cadenceDriver._app = { getChannelProcessor: () => fakeChannel }

    for (let t = 0; t < 1000; t += 8) {
        cadenceDriver._tick(t, 8)
    }

    check('at least 58 gamepad frames per second', fakeChannel._gamepadFrames.length >= 58, fakeChannel._gamepadFrames.length)

    const flushChannel = {
        _gamepadFrames: [],
        _mouseFrames: [],
        queueGamepadState(frame) {
            this._gamepadFrames.push(frame)
        },
        getGamepadQueueLength() {
            return this._gamepadFrames.length
        },
    }

    const flushDriver = new KbmInputDriver(resolveKbmSettings({ input_kbm_mode: 'native' }))
    flushDriver._app = { getChannelProcessor: () => flushChannel }
    flushDriver._nativeChecked = true
    flushDriver._nativeSupported = true
    flushDriver._pushMouseFrame({ X: 1, Y: 0, WheelX: 0, WheelY: 0, Buttons: 0, Relative: 0 })

    check('native mouse frame is queued', flushChannel._mouseFrames.length === 1)
    check('native mouse frame does not inject a gamepad frame', flushChannel._gamepadFrames.length === 0)

    console.log('keyboard state')
    check('pressButton pulses a shadow button', (() => {
        const pressDriver = new KbmInputDriver(resolveKbmSettings({ input_kbm_mode: 'gamepad' }))
        pressDriver.pressButton(0, 'Nexus')
        return pressDriver._buildFrame().Nexus === 1
    })())
} finally {
    rmSync(outDir, { recursive: true, force: true })
}

if (failures > 0) {
    console.error('\n' + failures + ' KBM test(s) failed')
    process.exit(1)
}

console.log('\nAll KBM tests passed')
