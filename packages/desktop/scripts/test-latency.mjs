/**
 * Regression tests for the latency helpers.
 *
 *   node scripts/test-latency.mjs
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(here, '..')
const outDir = mkdtempSync(path.join(tmpdir(), 'greenlight-latency-'))
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

try {
    execFileSync(require.resolve('typescript/bin/tsc'), [
        '--module', 'commonjs',
        '--target', 'es2020',
        '--moduleResolution', 'node',
        '--lib', 'dom,dom.iterable,esnext',
        '--skipLibCheck',
        '--esModuleInterop',
        '--rootDir', path.join(desktopRoot, 'renderer/lib'),
        '--outDir', outDir,
        path.join(desktopRoot, 'renderer/lib/latency/stats.ts'),
        path.join(desktopRoot, 'renderer/lib/latency/inputflush.ts'),
    ], { stdio: 'inherit' })

    const { readLatencyStats, describeLatency, isPrivateAddress } = require(path.join(outDir, 'latency', 'stats.js'))
    const { flushInputNow, installInputFlusher, MIN_FLUSH_INTERVAL_MS } = require(path.join(outDir, 'latency', 'inputflush.js'))

    console.log('stats parsing')

    const reports = new Map()
    reports.set('pair', {
        id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true,
        currentRoundTripTime: 0.004, remoteCandidateId: 'remote', localCandidateId: 'local', packetsReceived: 120,
    })
    reports.set('remote', { id: 'remote', type: 'remote-candidate', address: '192.168.1.50', candidateType: 'host' })
    reports.set('local', { id: 'local', type: 'local-candidate', address: '192.168.1.10', candidateType: 'host' })
    reports.set('video', {
        id: 'video', type: 'inbound-rtp', kind: 'video', codecId: 'codec',
        jitter: 0.002, jitterBufferDelay: 0.480, jitterBufferEmittedCount: 60,
        totalDecodeTime: 0.120, totalProcessingDelay: 0.300, framesDecoded: 60,
        framesDropped: 0, packetsLost: 0, nackCount: 0, pliCount: 0, framesPerSecond: 59.94,
    })
    reports.set('codec', { id: 'codec', type: 'codec', mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f' })

    const snapshot = readLatencyStats(reports)
    check('RTT in ms', snapshot.rttMs === 4, snapshot.rttMs)
    check('jitter in ms', snapshot.jitterMs === 2, snapshot.jitterMs)
    check('jitter buffer average in ms', snapshot.bufferMs === 8, snapshot.bufferMs)
    check('decode average in ms', snapshot.decodeMs === 2, snapshot.decodeMs)
    check('processing average in ms', snapshot.processingMs === 5, snapshot.processingMs)
    check('FPS', snapshot.fps === 59.94, snapshot.fps)
    check('remote address', snapshot.remoteAddress === '192.168.1.50', snapshot.remoteAddress)
    check('LAN detected', snapshot.remoteIsLocal === true, snapshot.remoteIsLocal)
    check('codec profile', snapshot.codec === 'H264 Normal', snapshot.codec)

    check('10/8 is private', isPrivateAddress('10.0.0.5'))
    check('172.16/12 is private', isPrivateAddress('172.20.1.1'))
    check('192.168/16 is private', isPrivateAddress('192.168.1.1'))
    check('public IPv4 is not private', isPrivateAddress('8.8.8.8') === false)
    check('link-local IPv6 is private', isPrivateAddress('fe80::1'))
    check('public IPv6 is not private', isPrivateAddress('2001:db8::1') === false)

    const rows = describeLatency(snapshot)
    check('rows include RTT', rows.some((row) => row.label === 'RTT' && row.value === '4 ms'))
    check('rows include LAN path', rows.some((row) => row.label === 'Path' && row.value.indexOf('LAN') === 0))
    check('rows include jitter buffer', rows.some((row) => row.label === 'Jitter buffer' && row.value === '8 ms'))

    const empty = readLatencyStats(new Map())
    check('empty report is safe', empty.rttMs === null && empty.framesDecoded === 0)
    check('empty rows are empty', describeLatency(empty).length === 0)

    console.log('input flush')

    const sent = []
    const channel = {
        _gamepadFrames: [],
        _mouseFrames: [],
        _keyboardFrames: [],
        _createInputPacket(reportType, metadata, gamepad, pointer, mouse, keyboard) {
            return { reportType, metadata, gamepad, pointer, mouse, keyboard }
        },
        send(packet) {
            sent.push(packet)
        },
        getClient() {
            return { getDataChannel: () => ({ readyState: 'open' }) }
        },
        getGamepadQueue(size = 30) {
            return this._gamepadFrames.splice(0, size - 1)
        },
        getGamepadQueueLength() {
            return this._gamepadFrames.length
        },
        getMouseQueue(size = 30) {
            return this._mouseFrames.splice(0, size - 1)
        },
        getKeyboardQueue(size = 2) {
            return this._keyboardFrames.splice(0, size - 1)
        },
        queueGamepadState(frame) {
            this._gamepadFrames.push(frame)
        },
    }

    channel._mouseFrames.push({ X: 1 })
    check('flush sends pending mouse data', flushInputNow(channel) === true, sent.length)
    check('flush drains the queue', channel._mouseFrames.length === 0)
    check('flush produced one packet', sent.length === 1, sent.length)
    check('packet contains the mouse frame', sent[0].mouse.length === 1)

    channel._mouseFrames.push({ X: 2 })
    check('flush is throttled', flushInputNow(channel) === false)
    check('forced flush bypasses the throttle', flushInputNow(channel, true) === true)
    check('throttle window is sane', MIN_FLUSH_INTERVAL_MS > 0 && MIN_FLUSH_INTERVAL_MS <= 16, MIN_FLUSH_INTERVAL_MS)

    const wrapped = {
        _gamepadFrames: [],
        _createInputPacket() { return {} },
        send(packet) { this.sent = (this.sent || 0) + 1 },
        getClient() { return { getDataChannel: () => ({ readyState: 'open' }) } },
        getGamepadQueue(size = 30) { return this._gamepadFrames.splice(0, size - 1) },
        queueGamepadState(frame) { this._gamepadFrames.push(frame) },
    }

    check('flusher installs', installInputFlusher(wrapped) === true)
    check('flusher is idempotent', installInputFlusher(wrapped) === false)
    wrapped.queueGamepadState({ A: 1 })
    check('gamepad frame is sent immediately', wrapped.sent === 1, wrapped.sent)
    check('gamepad queue was drained', wrapped._gamepadFrames.length === 0)

    const closed = {
        ...channel,
        getClient() { return { getDataChannel: () => ({ readyState: 'connecting' }) } },
    }
    closed._mouseFrames.push({ X: 3 })
    check('closed channel is not flushed', flushInputNow(closed) === false)
    check('closed channel keeps its frames', closed._mouseFrames.length === 1)
} finally {
    rmSync(outDir, { recursive: true, force: true })
}

if (failures > 0) {
    console.error('\n' + failures + ' latency test(s) failed')
    process.exit(1)
}

console.log('\nAll latency tests passed')
