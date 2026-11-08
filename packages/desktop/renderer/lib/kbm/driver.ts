import { virtualKeyFor } from './codes'
import { flushInputNow } from '../latency/inputflush'
import {
    GamepadFrame,
    KbmActiveMode,
    KbmStatus,
    KeyboardFrame,
    MouseAction,
    MouseFrame,
    KbmRuntimeSettings,
} from './types'

const LOOP_INTERVAL_MS = 8
const FRAME_INTERVAL_MS = 1000 / 60
// Ticks run on an 8 ms grid. Waiting for a full 16.67 ms would only qualify
// every third tick (24 ms -> 41 Hz), so allow the second tick through and get
// the intended 60 Hz cadence.
const FRAME_GATE_MS = FRAME_INTERVAL_MS - (LOOP_INTERVAL_MS / 2)
const AIM_DECAY_PER_8MS = 0.82
const AIM_REFERENCE_PIXELS = 30
const MAX_PIXELS_PER_EVENT = 2000
const MAX_FRAMES_PER_QUEUE = 24
const MAX_GAMEPAD_QUEUE = 120
const BUTTON_PULSE_MS = 80

const LEFT_STICK_CODES: { [code: string]: boolean } = {
    KeyW: true,
    KeyA: true,
    KeyS: true,
    KeyD: true,
}

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value
}

function clampInt(value: number, limit: number): number {
    return clamp(Math.round(value), -limit, limit)
}

function defaultFrame(): GamepadFrame {
    return {
        GamepadIndex: 0,
        Nexus: 0,
        Menu: 0,
        View: 0,
        A: 0,
        B: 0,
        X: 0,
        Y: 0,
        DPadUp: 0,
        DPadDown: 0,
        DPadLeft: 0,
        DPadRight: 0,
        LeftShoulder: 0,
        RightShoulder: 0,
        LeftThumb: 0,
        RightThumb: 0,
        LeftThumbXAxis: 0,
        LeftThumbYAxis: 0,
        RightThumbXAxis: 0,
        RightThumbYAxis: 0,
        LeftTrigger: 0,
        RightTrigger: 0,
    }
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (target === null || !(target instanceof HTMLElement)) {
        return false
    }

    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
}

/**
 * Drop-in replacement for the player's gamepad driver.
 *
 * xbox-xcloud-player allows passing a custom `input_driver` and calls `run()`
 * once the input channel is up. Taking over the driver gives us a single place
 * where physical gamepad state, keyboard-to-gamepad mappings and mouse-to-stick
 * conversion are merged into one frame per tick. It also guarantees the input
 * channel keeps flushing, so native mouse/keyboard frames (which the channel
 * only sends alongside gamepad data) are not dropped.
 */
export default class KbmInputDriver {
    private _app: any = undefined
    private _settings: KbmRuntimeSettings
    private _activeMode: KbmActiveMode
    private _enabled = true

    private _running = false
    private _loopTimer: any = undefined
    private _lastTick = 0
    private _lastFrameAt = 0

    private _locked = false
    private _lockElement: HTMLElement | null = null
    private _lockRequestPending = false

    private _mouseDx = 0
    private _mouseDy = 0
    private _mouseButtons = 0
    private _lastSentButtons = 0
    private _suppressButtons = false
    private _wheel = 0

    private _aimX = 0
    private _aimY = 0

    private _heldCodes: { [code: string]: { key: string; keyCode: number; button: string | undefined; sentNative: boolean } } = {}
    private _mapping: { [key: string]: string } = {}
    private _shadowButtons: { [button: string]: number } = {}

    private _nativeSupported = false
    private _nativeChecked = false

    private _statusListener: ((status: KbmStatus) => void) | undefined
    private _listenersAttached = false
    private _lastHeartbeatAt = 0

    constructor(settings: KbmRuntimeSettings) {
        this._settings = settings
        this._activeMode = settings.mode === 'native' ? 'native' : 'gamepad'
        this._enabled = settings.mode !== 'off'
        this._rebuildMapping()
    }

    // ---------------------------------------------------------------------
    // Player driver interface
    // ---------------------------------------------------------------------

    setApplication(application: any) {
        this._app = application
    }

    start() {
        if (!this._enabled) {
            return
        }

        this._attachListeners()
        this._syncPointerLockState()
        this._ensureLoop()
    }

    stop() {
        this._detachListeners()
        this._suppressButtons = false
        this._releaseAllKeys()
        this._running = false

        if (this._loopTimer !== undefined) {
            clearTimeout(this._loopTimer)
            this._loopTimer = undefined
        }

        if (typeof document !== 'undefined' && document.pointerLockElement !== null) {
            document.exitPointerLock()
        }

        this._setLocked(false)
    }

    run() {
        if (!this._enabled) {
            return
        }

        this._ensureLoop()
    }

    requestStates(): Array<GamepadFrame> {
        return [this._buildFrame()]
    }

    mapStateLabels(buttons: ReadonlyArray<GamepadButton>, axes: ReadonlyArray<number>): GamepadFrame {
        const frame = defaultFrame()
        this._applyPhysicalGamepad(frame, buttons, axes)
        return frame
    }

    pressButton(index: number, button: string) {
        if (button === undefined || button === '') {
            return
        }

        this._shadowButtons[button] = 1
        this._queueFrame()

        setTimeout(() => {
            this._shadowButtons[button] = 0
            this._queueFrame()
        }, BUTTON_PULSE_MS)
    }

    // ---------------------------------------------------------------------
    // Public API used by the settings UI / overlay
    // ---------------------------------------------------------------------

    setStatusListener(listener: (status: KbmStatus) => void) {
        this._statusListener = listener
        this._emitStatus()
    }

    getStatus(): KbmStatus {
        return {
            supported: this._nativeSupported,
            locked: this._locked,
            mode: this._effectiveMode(),
            enabled: this._enabled,
        }
    }

    toggleMode() {
        if (!this._enabled) {
            return
        }

        if (this._nativeChecked && !this._nativeSupported) {
            return
        }

        this._setActiveMode(this._effectiveMode() === 'native' ? 'gamepad' : 'native')
    }

    // ---------------------------------------------------------------------
    // Mode handling
    // ---------------------------------------------------------------------

    private _effectiveMode(): KbmActiveMode {
        // Native frames are impossible on player builds that do not expose them.
        if (this._activeMode === 'native' && this._nativeChecked && !this._nativeSupported) {
            return 'gamepad'
        }

        return this._activeMode
    }

    private _setActiveMode(mode: KbmActiveMode) {
        if (mode === this._activeMode) {
            return
        }

        this._releaseAllKeys()
        this._activeMode = mode
        this._aimX = 0
        this._aimY = 0
        this._mouseDx = 0
        this._mouseDy = 0
        this._emitStatus()
    }

    // ---------------------------------------------------------------------
    // Loop
    // ---------------------------------------------------------------------

    private _ensureLoop() {
        if (this._running) {
            return
        }

        this._running = true
        this._lastTick = performance.now()
        this._ensureNativeSupport()
        this._loopTimer = setTimeout(this._loop, LOOP_INTERVAL_MS)
    }

    private _loop = () => {
        if (!this._running) {
            return
        }

        const now = performance.now()
        const dt = clamp(now - this._lastTick, 0, 50)
        this._lastTick = now

        try {
            this._tick(now, dt)
        } catch (error) {
            console.warn('[KBM] Failed to process input frame:', error)
        }

        if (this._running) {
            this._loopTimer = setTimeout(this._loop, LOOP_INTERVAL_MS)
        }
    }

    private _tick(now: number, dt: number) {
        if (!this._enabled) {
            return
        }

        this._ensureNativeSupport()

        if (this._effectiveMode() === 'gamepad') {
            const dx = this._mouseDx
            const dy = this._mouseDy
            this._mouseDx = 0
            this._mouseDy = 0

            this._updateAim(dx, dy, dt)
            // The wheel has no gamepad mapping.
            this._wheel = 0
        }

        // The input channel only sends packets when it has gamepad data. Queue
        // a frame at the same cadence as the original driver so native frames
        // and physical gamepads keep flowing.
        if (now - this._lastFrameAt >= FRAME_GATE_MS) {
            this._lastFrameAt = now
            this._queueFrame()
        }
    }

    private _queueFrame() {
        const channel = this._getInputChannel()
        if (channel === undefined || typeof channel.queueGamepadState !== 'function') {
            return
        }

        if (Array.isArray(channel._gamepadFrames) && channel._gamepadFrames.length >= MAX_GAMEPAD_QUEUE) {
            // The channel is not draining (closed/reconnecting); do not grow
            // the queue without bound.
            return
        }

        channel.queueGamepadState(this._buildFrame())
    }

    // ---------------------------------------------------------------------
    // Frame generation
    // ---------------------------------------------------------------------

    private _buildFrame(): GamepadFrame {
        const frame = defaultFrame()
        const mode = this._effectiveMode()

        this._applyConnectedGamepad(frame)

        if (mode === 'gamepad' && this._enabled) {
            this._applyKeyboardToGamepad(frame)
            this._applyMouseToStick(frame)
            this._applyMouseButtons(frame)
        }

        for (const button in this._shadowButtons) {
            if (this._shadowButtons[button] > 0) {
                frame[button] = 1
            }
        }

        // View + Menu at the same time opens the Xbox guide. Keep both bits,
        // matching the behaviour of the driver this replaces.
        if (frame.View > 0 && frame.Menu > 0) {
            frame.Nexus = 1
        }

        frame.GamepadIndex = 0

        return frame
    }

    private _applyConnectedGamepad(frame: GamepadFrame) {
        if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
            return
        }

        const gamepads = navigator.getGamepads()
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i]
            if (gamepad !== null && gamepad !== undefined && gamepad.connected) {
                this._applyPhysicalGamepad(frame, gamepad.buttons, gamepad.axes)
                return
            }
        }
    }

    private _applyPhysicalGamepad(frame: GamepadFrame, buttons: ReadonlyArray<GamepadButton>, axes: ReadonlyArray<number>) {
        frame.A = buttons[0] ? buttons[0].value : 0
        frame.B = buttons[1] ? buttons[1].value : 0
        frame.X = buttons[2] ? buttons[2].value : 0
        frame.Y = buttons[3] ? buttons[3].value : 0
        frame.LeftShoulder = buttons[4] ? buttons[4].value : 0
        frame.RightShoulder = buttons[5] ? buttons[5].value : 0
        frame.LeftTrigger = buttons[6] ? buttons[6].value : 0
        frame.RightTrigger = buttons[7] ? buttons[7].value : 0
        frame.View = buttons[8] ? buttons[8].value : 0
        frame.Menu = buttons[9] ? buttons[9].value : 0
        frame.LeftThumb = buttons[10] ? buttons[10].value : 0
        frame.RightThumb = buttons[11] ? buttons[11].value : 0
        frame.DPadUp = buttons[12] ? buttons[12].value : 0
        frame.DPadDown = buttons[13] ? buttons[13].value : 0
        frame.DPadLeft = buttons[14] ? buttons[14].value : 0
        frame.DPadRight = buttons[15] ? buttons[15].value : 0
        frame.Nexus = buttons[16] ? buttons[16].value : 0

        frame.LeftThumbXAxis = axes[0] || 0
        frame.LeftThumbYAxis = axes[1] || 0
        frame.RightThumbXAxis = axes[2] || 0
        frame.RightThumbYAxis = axes[3] || 0
    }

    private _applyKeyboardToGamepad(frame: GamepadFrame) {
        const leftX = (this._isDown('KeyD') ? 1 : 0) - (this._isDown('KeyA') ? 1 : 0)
        const leftY = (this._isDown('KeyS') ? 1 : 0) - (this._isDown('KeyW') ? 1 : 0)

        if (leftX !== 0 || leftY !== 0) {
            const length = Math.sqrt(leftX * leftX + leftY * leftY)
            // Keep keyboard movement on the same axis convention as the
            // Gamepad API (up = -1, down = 1).
            frame.LeftThumbXAxis = leftX / length
            frame.LeftThumbYAxis = leftY / length
        }

        for (const code in this._heldCodes) {
            const held = this._heldCodes[code]
            if (held.button !== undefined) {
                frame[held.button] = 1
            }
        }
    }

    private _applyMouseToStick(frame: GamepadFrame) {
        const magnitude = Math.sqrt(this._aimX * this._aimX + this._aimY * this._aimY)
        if (magnitude <= 0.0001) {
            return
        }

        const clamped = Math.min(1, magnitude)
        const deadzone = clamp(this._settings.deadzone, 0, 0.95)
        const curve = Math.max(0.1, this._settings.curve)

        if (clamped <= deadzone) {
            return
        }

        // Subtractive deadzone: the output starts at zero and grows smoothly.
        // An additive floor would make slow aiming jump straight to the floor.
        const normalized = clamp((clamped - deadzone) / (1 - deadzone), 0, 1)
        const shaped = Math.pow(normalized, curve)

        if (shaped <= 0) {
            return
        }

        const scale = shaped / magnitude
        const invert = this._settings.invertY ? -1 : 1

        // Frame axes follow the Gamepad API convention (down = +1).
        frame.RightThumbXAxis = clamp(this._aimX * scale, -1, 1)
        frame.RightThumbYAxis = clamp(this._aimY * scale * invert, -1, 1)
    }

    private _applyMouseButtons(frame: GamepadFrame) {
        if (this._mouseButtons & 1) {
            this._applyMouseAction(frame, this._settings.leftClick)
        }

        if (this._mouseButtons & 2) {
            this._applyMouseAction(frame, this._settings.rightClick)
        }

        if (this._mouseButtons & 4) {
            this._applyMouseAction(frame, this._settings.middleClick)
        }
    }

    private _applyMouseAction(frame: GamepadFrame, action: MouseAction) {
        if (action === 'none' || action === undefined) {
            return
        }

        // Settings use lower camel case names; frame fields are Pascal case.
        const field = action === 'rightTrigger' ? 'RightTrigger' : action === 'leftTrigger' ? 'LeftTrigger' : action
        frame[field] = 1
    }

    private _updateAim(dx: number, dy: number, dt: number) {
        const decay = Math.pow(AIM_DECAY_PER_8MS, dt / 8)

        if (dx === 0 && dy === 0) {
            this._aimX *= decay
            this._aimY *= decay

            if (Math.abs(this._aimX) < 0.001) {
                this._aimX = 0
            }

            if (Math.abs(this._aimY) < 0.001) {
                this._aimY = 0
            }

            return
        }

        const sensitivity = clamp(this._settings.sensitivity, 0.05, 20)
        const reference = AIM_REFERENCE_PIXELS / sensitivity

        this._aimX = clamp(this._aimX * decay + dx / reference, -1, 1)
        this._aimY = clamp(this._aimY * decay + dy / reference, -1, 1)
    }

    // ---------------------------------------------------------------------
    // Native mouse / keyboard frames
    // ---------------------------------------------------------------------

    private _flushNativeMouse(dx: number, dy: number) {
        try {
            const sensitivity = clamp(this._settings.sensitivity, 0.05, 20)
            const invert = this._settings.invertY ? -1 : 1
            const moved = dx !== 0 || dy !== 0
            const buttons = this._suppressButtons ? 0 : this._mouseButtons
            const buttonsChanged = buttons !== this._lastSentButtons
            const wheel = this._wheel

            if (!moved && !buttonsChanged && wheel === 0) {
                return
            }

            this._wheel = 0
            this._lastSentButtons = buttons

            const frame: MouseFrame = {
                X: clampInt(dx * sensitivity, 8192),
                Y: clampInt(dy * sensitivity * invert, 8192),
                WheelX: 0,
                WheelY: clampInt(wheel, 1),
                Buttons: buttons,
                Relative: 0,
            }

            this._pushMouseFrame(frame)
        } catch (error) {
            console.warn('[KBM] Failed to queue native mouse frame:', error)
        }
    }

    private _pushMouseFrame(frame: MouseFrame) {
        const channel = this._getInputChannel()
        if (channel === undefined) {
            return
        }

        // Queue first: the flush below may drain everything in one packet.
        if (typeof channel.queueMouseFrame === 'function') {
            channel.queueMouseFrame(frame)
        } else if (Array.isArray(channel._mouseFrames)) {
            if (channel._mouseFrames.length >= MAX_FRAMES_PER_QUEUE) {
                channel._mouseFrames.splice(0, channel._mouseFrames.length - MAX_FRAMES_PER_QUEUE + 1)
            }

            channel._mouseFrames.push(frame)
        }

        this._flushInput(channel)
    }

    private _pushKeyboardFrame(frame: KeyboardFrame) {
        const channel = this._getInputChannel()
        if (channel === undefined) {
            return
        }

        // Queue first: the flush below may drain everything in one packet.
        if (typeof channel.queueKeyboardFrame === 'function') {
            channel.queueKeyboardFrame(frame)
        } else if (Array.isArray(channel._keyboardFrames)) {
            if (channel._keyboardFrames.length >= MAX_FRAMES_PER_QUEUE) {
                this._trimKeyboardQueue(channel._keyboardFrames)

                // All remaining frames are key-ups and the channel is not
                // draining. Preserve them and drop this new frame instead of
                // growing the queue without bound.
                if (channel._keyboardFrames.length >= MAX_FRAMES_PER_QUEUE * 2) {
                    return
                }
            }

            channel._keyboardFrames.push(frame)
        }

        this._flushInput(channel)
    }

    /**
     * The player's 16 ms interval drains every queue and only sends when it
     * finds gamepad, metadata or pointer data. If a flush is throttled, leave a
     * gamepad frame behind (at most every 15 ms) so queued mouse/keyboard
     * frames can never be spliced out and discarded.
     */
    private _flushInput(channel: any) {
        const sent = flushInputNow(channel)
        const now = performance.now()

        if (sent === true) {
            return
        }

        if (channel.__latencyFlusherInstalled !== true || now - this._lastHeartbeatAt < 15) {
            return
        }

        if (Array.isArray(channel._gamepadFrames) && channel._gamepadFrames.length === 0) {
            channel._gamepadFrames.push(this._buildFrame())
            this._lastHeartbeatAt = now
        }
    }

    private _trimKeyboardQueue(queue: Array<KeyboardFrame>) {
        // Drop the oldest key-down first. Dropping an old key-up would leave
        // the key stuck on the console. If the queue only contains key-ups
        // (releasing a lot of held keys at once), let it grow instead.
        for (let i = 0; i < queue.length; i++) {
            if (queue[i].pressed === true) {
                queue.splice(i, 1)
                return
            }
        }
    }

    private _ensureNativeSupport() {
        if (this._nativeChecked) {
            return
        }

        const channel = this._getInputChannel()
        if (channel === undefined) {
            return
        }

        const hasQueueMethods = typeof channel.queueMouseFrame === 'function' && typeof channel.queueKeyboardFrame === 'function'
        const hasFrameArrays = Array.isArray(channel._mouseFrames) && Array.isArray(channel._keyboardFrames)

        this._nativeSupported = hasQueueMethods || hasFrameArrays
        this._nativeChecked = true
        this._emitStatus()
    }

    private _getInputChannel(): any {
        if (this._app === undefined || typeof this._app.getChannelProcessor !== 'function') {
            return undefined
        }

        return this._app.getChannelProcessor('input')
    }

    // ---------------------------------------------------------------------
    // DOM listeners
    // ---------------------------------------------------------------------

    private _attachListeners() {
        if (this._listenersAttached) {
            return
        }

        this._listenersAttached = true
        document.addEventListener('pointermove', this._onPointerMove, true)
        document.addEventListener('pointerdown', this._onPointerDown, true)
        document.addEventListener('pointerup', this._onPointerUp, true)
        document.addEventListener('wheel', this._onWheel, { capture: true, passive: false })
        document.addEventListener('contextmenu', this._onContextMenu, true)
        document.addEventListener('pointerlockchange', this._onPointerLockChange, false)
        window.addEventListener('keydown', this._onKeyDown, true)
        window.addEventListener('keyup', this._onKeyUp, true)
        window.addEventListener('blur', this._onBlur, false)
    }

    private _detachListeners() {
        if (!this._listenersAttached) {
            return
        }

        this._listenersAttached = false
        document.removeEventListener('pointermove', this._onPointerMove, true)
        document.removeEventListener('pointerdown', this._onPointerDown, true)
        document.removeEventListener('pointerup', this._onPointerUp, true)
        document.removeEventListener('wheel', this._onWheel, true)
        document.removeEventListener('contextmenu', this._onContextMenu, true)
        document.removeEventListener('pointerlockchange', this._onPointerLockChange, false)
        window.removeEventListener('keydown', this._onKeyDown, true)
        window.removeEventListener('keyup', this._onKeyUp, true)
        window.removeEventListener('blur', this._onBlur, false)
    }

    private _onPointerMove = (event: PointerEvent) => {
        if (!this._locked) {
            return
        }

        const dx = clamp(event.movementX || 0, -MAX_PIXELS_PER_EVENT, MAX_PIXELS_PER_EVENT)
        const dy = clamp(event.movementY || 0, -MAX_PIXELS_PER_EVENT, MAX_PIXELS_PER_EVENT)

        // Ignore the button state of the click that captured the pointer until
        // it is released, otherwise capturing would fire an action.
        this._mouseButtons = this._suppressButtons ? 0 : (event.buttons || 0)

        if (this._effectiveMode() === 'native') {
            // Send immediately instead of waiting for the next tick. The
            // browser already coalesces pointermove to one event per frame.
            this._flushNativeMouse(dx, dy)
        } else {
            this._mouseDx += dx
            this._mouseDy += dy
        }

        if (event.cancelable) {
            event.preventDefault()
        }
    }

    private _onPointerDown = (event: PointerEvent) => {
        if (!this._enabled || event.pointerType === 'touch') {
            return
        }

        if (this._locked) {
            this._mouseButtons = event.buttons || 0

            if (this._effectiveMode() === 'native') {
                this._flushNativeMouse(0, 0)
            }

            return
        }

        const target = event.target as HTMLElement
        if (target === null || target.tagName !== 'VIDEO') {
            return
        }

        // Suppress the click that captures the pointer (native: no accidental
        // shot, gamepad: no accidental trigger).
        this._suppressButtons = true
        this._mouseButtons = 0
        this._lastSentButtons = 0
        this._lockElement = target
        this._requestPointerLock(target)
    }

    private _onPointerUp = (event: PointerEvent) => {
        if (!this._locked) {
            this._suppressButtons = false
            this._mouseButtons = 0
            return
        }

        if (this._suppressButtons) {
            this._suppressButtons = false
            this._mouseButtons = 0
            return
        }

        this._mouseButtons = event.buttons || 0

        if (this._effectiveMode() === 'native') {
            this._flushNativeMouse(0, 0)
        }
    }

    private _onWheel = (event: WheelEvent) => {
        if (!this._locked) {
            return
        }

        const wheel = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY
        this._wheel += clamp(wheel, -120, 120)

        if (this._effectiveMode() === 'native') {
            this._flushNativeMouse(0, 0)
        }

        if (event.cancelable) {
            event.preventDefault()
        }
    }

    private _onContextMenu = (event: MouseEvent) => {
        if (this._locked && event.cancelable) {
            event.preventDefault()
        }
    }

    private _onPointerLockChange = () => {
        const element = document.pointerLockElement
        const locked = element !== null && (element === this._lockElement || element.tagName === 'VIDEO')
        this._setLocked(locked)
    }

    private _onBlur = () => {
        this._releaseAllKeys()
        this._mouseButtons = 0
        this._suppressButtons = false
    }

    private _syncPointerLockState() {
        const element = document.pointerLockElement as HTMLElement | null
        if (element !== null && element.tagName === 'VIDEO') {
            this._lockElement = element
            this._setLocked(true)
        }
    }

    private _requestPointerLock(element: HTMLElement) {
        if (this._lockRequestPending) {
            return
        }

        this._lockRequestPending = true

        const done = () => {
            this._lockRequestPending = false
        }

        try {
            const result = (element as any).requestPointerLock({ unadjustedMovement: true })

            if (result !== undefined && typeof result.then === 'function') {
                // `unadjustedMovement` is not available on every platform
                // (notably some Wayland setups). Fall back to a regular lock.
                result.then(done).catch(() => {
                    try {
                        const fallback = element.requestPointerLock() as any
                        if (fallback !== undefined && typeof fallback.catch === 'function') {
                            fallback.catch(() => {}).then(done)
                        } else {
                            done()
                        }
                    } catch (error) {
                        done()
                    }
                })
            } else {
                done()
            }
        } catch (error) {
            // Older Chromium versions do not accept options.
            try {
                const fallback = element.requestPointerLock() as any
                if (fallback !== undefined && typeof fallback.catch === 'function') {
                    fallback.catch(() => {}).then(done)
                } else {
                    done()
                }
            } catch (fallbackError) {
                done()
            }
        }
    }

    private _setLocked(locked: boolean) {
        if (locked === this._locked) {
            return
        }

        this._locked = locked

        if (!locked) {
            this._suppressButtons = false
            this._releaseAllKeys()
        }

        this._emitStatus()
    }

    // ---------------------------------------------------------------------
    // Keyboard handling
    // ---------------------------------------------------------------------

    private _onKeyDown = (event: KeyboardEvent) => {
        if (!this._enabled) {
            return
        }

        if (this._isToggleKey(event)) {
            // Do not steal the hotkey while the user is typing in a field.
            if (isEditableTarget(event.target)) {
                return
            }

            if (event.cancelable) {
                event.preventDefault()
            }

            event.stopPropagation()

            if (!event.repeat) {
                this.toggleMode()
            }

            return
        }

        if (!this._locked) {
            return
        }

        if (event.repeat) {
            if (event.cancelable) {
                event.preventDefault()
            }

            return
        }

        const isEscape = event.code === 'Escape'
        const existing = this._heldCodes[event.code]

        if (existing === undefined) {
            const sentNative = this._effectiveMode() === 'native'
            const keyCode = virtualKeyFor(event)

            this._heldCodes[event.code] = {
                key: event.key,
                keyCode,
                button: this._resolveButton(event.key, event.code),
                sentNative,
            }

            if (sentNative) {
                this._pushKeyboardFrame({
                    pressed: true,
                    key: event.key,
                    keyCode,
                })
            }
        }

        // Never prevent Escape: it has to reach the browser so pointer lock can
        // be released. The key report above still reaches the game.
        if (event.cancelable && !isEscape) {
            event.preventDefault()
        }
    }

    private _onKeyUp = (event: KeyboardEvent) => {
        if (!this._enabled) {
            return
        }

        if (this._isToggleKey(event)) {
            return
        }

        const held = this._heldCodes[event.code]
        delete this._heldCodes[event.code]

        if (held !== undefined && held.sentNative) {
            this._pushKeyboardFrame({
                pressed: false,
                key: held.key,
                keyCode: held.keyCode,
            })
        }

        if (this._locked && event.cancelable && event.code !== 'Escape') {
            event.preventDefault()
        }
    }

    private _releaseAllKeys() {
        if (Object.keys(this._heldCodes).length === 0 && this._mouseButtons === 0 && this._lastSentButtons === 0 && this._aimX === 0 && this._aimY === 0 && this._wheel === 0) {
            return
        }

        for (const code in this._heldCodes) {
            const held = this._heldCodes[code]
            if (held.sentNative) {
                this._pushKeyboardFrame({
                    pressed: false,
                    key: held.key,
                    keyCode: held.keyCode,
                })
            }
        }

        this._heldCodes = {}
        this._mouseButtons = 0
        this._lastSentButtons = -1
        this._wheel = 0
        this._aimX = 0
        this._aimY = 0

        if (this._effectiveMode() === 'native') {
            this._flushNativeMouse(0, 0)
        }
    }

    private _isToggleKey(event: KeyboardEvent): boolean {
        const toggleKey = this._settings.toggleKey
        return toggleKey !== undefined && toggleKey !== '' && event.code === toggleKey
    }

    // ---------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------

    private _isDown(code: string): boolean {
        return this._heldCodes[code] !== undefined
    }

    private _rebuildMapping() {
        this._mapping = {}
        const source = this._settings.keyMapping || {}

        for (const key in source) {
            this._mapping[key] = source[key]
            this._mapping[key.toLowerCase()] = source[key]
        }
    }

    private _resolveButton(key: string, code: string): string | undefined {
        // W/A/S/D drive the left stick. Resolve them to nothing so the default
        // `a -> A` binding cannot fire while strafing.
        if (LEFT_STICK_CODES[code] === true) {
            return undefined
        }

        if (this._mapping[key] !== undefined) {
            return this._mapping[key]
        }

        if (this._mapping[key.toLowerCase()] !== undefined) {
            return this._mapping[key.toLowerCase()]
        }

        if (this._mapping[code] !== undefined) {
            return this._mapping[code]
        }

        return undefined
    }

    private _emitStatus() {
        if (this._statusListener === undefined) {
            return
        }

        this._statusListener(this.getStatus())
    }
}
