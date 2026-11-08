import { installInputFlusher } from './inputflush'

export interface LatencySettings {
    /** Target video jitter buffer in milliseconds. Negative = leave the browser default. */
    jitterBufferMs: number;
    /** Send input frames immediately instead of waiting for the player's 16 ms batch. */
    immediateInput: boolean;
    /** Gather only host ICE candidates (no STUN). Useful for same-LAN streams. */
    directLan: boolean;
}

export function resolveLatencySettings(settings: any): LatencySettings {
    const jitter = Number(settings?.latency_jitter_buffer_ms)

    return {
        jitterBufferMs: Number.isFinite(jitter) ? jitter : 0,
        immediateInput: settings?.latency_immediate_input !== false,
        directLan: settings?.latency_direct_lan === true,
    }
}

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

    player._webrtcConfiguration = {
        ...config,
        iceServers: [],
        iceTransportPolicy: 'all',
    }

    console.log('[Latency] Direct LAN mode: STUN disabled')
    return true
}

/**
 * Sets the receiver's playout/jitter buffer target. Chromium exposes
 * `jitterBufferTarget` in milliseconds; older builds only have
 * `playoutDelayHint` in seconds.
 */
export function applyJitterBufferTarget(peerConnection: any, targetMs: number): number {
    if (peerConnection === undefined || peerConnection === null || targetMs < 0) {
        return 0
    }

    if (typeof peerConnection.getReceivers !== 'function') {
        return 0
    }

    let applied = 0

    for (const receiver of peerConnection.getReceivers()) {
        if (receiver === null || receiver.track === null || receiver.track.kind !== 'video') {
            continue
        }

        try {
            if ('jitterBufferTarget' in receiver) {
                receiver.jitterBufferTarget = targetMs
                applied++
            } else if ('playoutDelayHint' in receiver) {
                receiver.playoutDelayHint = targetMs / 1000
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
    private _loggedUnsupported = false

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
    }

    getSettings(): LatencySettings {
        return this._settings
    }

    setJitterBufferTarget(targetMs: number) {
        this._settings = { ...this._settings, jitterBufferMs: targetMs }
        this._apply()
    }

    private _installFlusher() {
        if (this._settings.immediateInput !== true) {
            return
        }

        const input = this._getInputChannel()
        if (input !== undefined) {
            installInputFlusher(input)
        }
    }

    private _apply() {
        if (this._settings.jitterBufferMs < 0) {
            return
        }

        const peerConnection = this._player !== undefined ? this._player._webrtcClient : undefined
        if (peerConnection === undefined || peerConnection === null) {
            return
        }

        const applied = applyJitterBufferTarget(peerConnection, this._settings.jitterBufferMs)

        if (applied > 0 && this._loggedApplied === false) {
            this._loggedApplied = true
            console.log('[Latency] Video jitter buffer target set to ' + this._settings.jitterBufferMs + ' ms')
        } else if (applied === 0 && this._loggedUnsupported === false) {
            const receivers = typeof peerConnection.getReceivers === 'function' ? peerConnection.getReceivers() : []
            if (receivers.length > 0) {
                this._loggedUnsupported = true
                console.warn('[Latency] This Chromium build does not expose a video jitter buffer target')
            }
        }
    }

    private _getInputChannel(): any {
        if (this._player === undefined || typeof this._player.getChannelProcessor !== 'function') {
            return undefined
        }

        return this._player.getChannelProcessor('input')
    }
}
