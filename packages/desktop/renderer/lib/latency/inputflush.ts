/**
 * The released player batches input into a packet every 16 ms. For a local
 * stream that is up to 16 ms of avoidable input lag. This module drains the
 * input channel's queues and sends immediately, throttled so a 1000 Hz mouse
 * cannot flood the SCTP channel.
 */
export const MIN_FLUSH_INTERVAL_MS = 6

const lastFlushAt = new WeakMap<object, number>()

export function canSendInput(channel: any): boolean {
    if (channel === undefined || channel === null) {
        return false
    }

    const client = typeof channel.getClient === 'function' ? channel.getClient() : undefined
    const dataChannel = client !== undefined && typeof client.getDataChannel === 'function'
        ? client.getDataChannel('input')
        : undefined

    // If we cannot inspect the channel state, try anyway; send() has its own
    // readyState check.
    if (dataChannel === undefined) {
        return true
    }

    return dataChannel.readyState === 'open'
}

export function flushInputNow(channel: any, force = false): boolean {
    if (channel === undefined || channel === null || typeof channel._createInputPacket !== 'function') {
        return false
    }

    if (canSendInput(channel) === false) {
        return false
    }

    const now = performance.now()
    const last = lastFlushAt.get(channel)

    if (force !== true && last !== undefined && now - last < MIN_FLUSH_INTERVAL_MS) {
        return false
    }

    const metadataQueue = typeof channel.getMetadataQueue === 'function' ? channel.getMetadataQueue() : []
    const gamepadQueue = typeof channel.getGamepadQueue === 'function' ? channel.getGamepadQueue() : []
    const pointerQueue = typeof channel.getPointerQueue === 'function' ? channel.getPointerQueue() : []
    const mouseQueue = typeof channel.getMouseQueue === 'function' ? channel.getMouseQueue() : []
    const keyboardQueue = typeof channel.getKeyboardQueue === 'function' ? channel.getKeyboardQueue() : []

    const hasData = metadataQueue.length > 0
        || gamepadQueue.length > 0
        || pointerQueue.length > 0
        || mouseQueue.length > 0
        || keyboardQueue.length > 0

    if (hasData === false) {
        return false
    }

    try {
        const packet = channel._createInputPacket(0, metadataQueue, gamepadQueue, pointerQueue, mouseQueue, keyboardQueue)
        channel.send(packet)
        lastFlushAt.set(channel, now)
        return true
    } catch (error) {
        console.warn('[Latency] Failed to flush input packet:', error)
        return false
    }
}

/**
 * Wraps queueGamepadState so every gamepad frame is sent as soon as it is
 * produced instead of waiting for the 16 ms interval. The interval still runs
 * for metadata/touch frames.
 */
export function installInputFlusher(channel: any): boolean {
    if (channel === undefined || channel === null) {
        return false
    }

    if (channel.__latencyFlusherInstalled === true) {
        return false
    }

    if (typeof channel.queueGamepadState !== 'function') {
        return false
    }

    const original = channel.queueGamepadState.bind(channel)

    channel.queueGamepadState = (frame: any) => {
        const result = original(frame)
        flushInputNow(channel)
        return result
    }

    channel.__latencyFlusherInstalled = true
    return true
}
