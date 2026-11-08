import { installInputFlusher, uninstallInputFlusher } from './inputflush'

export interface LatencySettings {
    /**
     * Extra receive buffer floor for video, in milliseconds. `-1` leaves the
     * browser default (no API call). Values above 0 can only *add* latency;
     * Chromium's jitter estimator already chooses the minimum safe buffer.
     */
    jitterBufferMs: number;
    /** Send input frames immediately instead of waiting for the player's 16 ms batch. */
    immediateInput: boolean;
    /** Gather only host ICE candidates (no STUN). Useful for same-LAN streams. */
    directLan: boolean;
}

export function resolveLatencySettings(settings: any): LatencySettings {
    const jitter = Number(settings?.latency_jitter_buffer_ms)

    return {
        jitterBufferMs: Number.isFinite(jitter) ? jitter : -1,
        immediateInput: settings?.latency_immediate_input !== false,
        directLan: settings?.latency_direct_lan === true,
    }
}

const appliedJitterTargets = new WeakMap<object, number>()

/**
 * The player hardcodes Google STUN servers. For a stream between two devices on
 * the same LAN, host candidates are enough and skipping STUN avoids a slow
 * gather and the occasional hairpin-NAT path. Must be called before bind().
 */
export function applyDirectLan(player: any, settings: LatencySettings): boolean {
    if (settings.directLan !== true || player === undefined || player === null) {
        return false
    }

    const config = player._webrtcConfiguration

    if (config === undefined || config === null) {
        return false
    }

    // Keep the original so stop()/reconnect can go back to using STUN.
    if (player.__latencyOriginalWebrtcConfig === undefined) {
        player.__latencyOriginalWebrtcConfig = config
    }

    player._webrtcConfiguration = {
        ...config,
        iceServers: [],
    }

    console.log('[Latency] Direct LAN mode: STUN disabled')
    return true
}

export function restoreDirectLan(player: any): boolean {
    if (player === undefined || player === null || player.__latencyOriginalWebrtcConfig === undefined) {
        return false
    }

    player._webrtcConfiguration = player.__latencyOriginalWebrtcConfig
    delete player.__latencyOriginalWebrtcConfig
    return true
}

/**
 * Chromium exposes `jitterBufferTarget` as the *minimum* playout delay in
 * milliseconds. It cannot go below the jitter estimator's floor; a value above
 * 0 deliberately adds safety margin. `-1` clears an earlier target.
 */
export function applyJitterBufferTarget(peerConnection: any, targetMs: number): number {
    if (peerConnection === undefined || peerConnection === null) {
        return 0
    }

    if (typeof peerConnection.getReceivers !== 'function') {
        return 0
    }

    const desired: number | null = targetMs < 0 ? null : targetMs
    let applied = 0

    for (const receiver of peerConnection.getReceivers()) {
        if (receiver === null || receiver.track === null || receiver.track.kind !== 'video') {
            continue
        }

        const previous = appliedJitterTargets.get(receiver)

        if (previous === desired || (previous === undefined && desired === null)) {
            continue
        }

        try {
            if ('jitterBufferTarget' in receiver) {
                // null means "no application preference" per the WebRTC spec.
                receiver.jitterBufferTarget = desired
                appliedJitterTargets.set(receiver, desired)
                applied++
            } else if (desired !== null && 'playoutDelayHint' in receiver) {
                // Older Chromium: seconds, no way to clear it again.
                receiver.playoutDelayHint = desired / 1000
                appliedJitterTargets.set(receiver, desired)
                applied++
            }
        } catch (error) {
            console.warn('[Latency] Could not set jitter buffer target:', error)
        }
    }

    return applied
}

/**
 * Applies the low-latency input/output tweaks for the lifetime of a stream.
 * Receivers appear when the tracks arrive, so the target is re-applied until
 * the video receiver exists (and again on reconnects).
 */
export default class LatencyController {
    private _player: any
    private _settings: LatencySettings
    private _timer: any = undefined
    private _loggedApplied = false
    private _directLanApplied = false

    constructor(player: any, settings: LatencySettings) {
        this._player = player
        this._settings = settings
    }

    start() {
        this._installFlusher()
        this._apply()

        if (this._timer === undefined) {
            this._timer = setInterval(() => {
                this._installFlusher()
                this._apply()
            }, 1000)
        }
    }

    stop() {
        if (this._timer !== undefined) {
            clearInterval(this._timer)
            this._timer = undefined
        }

        uninstallInputFlusher(this._getInputChannel())

        if (this._directLanApplied === true) {
            restoreDirectLan(this._player)
            this._directLanApplied = false
        }
    }

    getSettings(): LatencySettings {
        return this._settings
    }

    setJitterBufferTarget(targetMs: number) {
        this._settings = { ...this._settings, jitterBufferMs: targetMs }
        this._apply()
    }

    markDirectLanApplied(applied: boolean) {
        this._directLanApplied = applied
    }

    private _installFlusher() {
        const input = this._getInputChannel()

        if (input === undefined) {
            return
        }

        if (this._settings.immediateInput === true) {
            installInputFlusher(input)
        } else {
            // The KBM driver calls flushInputNow directly; the flag makes the
            // setting authoritative in one place.
            input.__latencyImmediate = false
            uninstallInputFlusher(input)
        }
    }

    private _apply() {
        const peerConnection = this._player !== undefined ? this._player._webrtcClient : undefined
        if (peerConnection === undefined || peerConnection === null) {
            return
        }

        const applied = applyJitterBufferTarget(peerConnection, this._settings.jitterBufferMs)

        if (applied > 0 && this._loggedApplied === false) {
            this._loggedApplied = true
            console.log('[Latency] Video jitter buffer floor set to ' + this._settings.jitterBufferMs + ' ms')
        }
    }

    private _getInputChannel(): any {
        if (this._player === undefined || typeof this._player.getChannelProcessor !== 'function') {
            return undefined
        }

        return this._player.getChannelProcessor('input')
    }
}
