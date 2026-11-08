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
        path.join(desktopRoot, 'renderer/lib/latency/controller.ts'),
    ], { stdio: 'inherit' })

    const { readLatencyStats, describeLatency, isPrivateAddress } = require(path.join(outDir, 'latency', 'stats.js'))
    const { flushInputNow, installInputFlusher, uninstallInputFlusher, MIN_FLUSH_INTERVAL_MS } = require(path.join(outDir, 'latency', 'inputflush.js'))
    const { resolveLatencySettings, applyJitterBufferTarget, applyDirectLan, restoreDirectLan } = require(path.join(outDir, 'latency', 'controller.js'))

    console.log('stats parsing')

    const reports = new Map()
    reports.set('transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' })
    reports.set('pair', {
        id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true,
        currentRoundTripTime: 0.004, remoteCandidateId: 'remote', localCandidateId: 'local', packetsReceived: 120,
    })
    reports.set('pair6', {
        id: 'pair6', type: 'candidate-pair', state: 'succeeded', nominated: true,
        currentRoundTripTime: 0.25, remoteCandidateId: 'remote6', localCandidateId: 'local', packetsReceived: 1,
    })
    reports.set('remote', { id: 'remote', type: 'remote-candidate', address: '192.168.1.50', candidateType: 'host' })
    reports.set('remote6', { id: 'remote6', type: 'remote-candidate', ip: '2001:db8::1', candidateType: 'srflx' })
    reports.set('local', { id: 'local', type: 'local-candidate', address: '192.168.1.10', candidateType: 'host' })
    reports.set('video', {
        id: 'video', type: 'inbound-rtp', kind: 'video', codecId: 'codec',
        jitter: 0.002, jitterBufferDelay: 0.480, jitterBufferEmittedCount: 60,
        totalDecodeTime: 0.120, totalProcessingDelay: 0.300, framesDecoded: 60,
        framesDropped: 0, freezeCount: 2, pauseCount: 0, packetsLost: 0, nackCount: 0, pliCount: 0, framesPerSecond: 59.94,
    })
    reports.set('codec', { id: 'codec', type: 'codec', mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f' })

    const snapshot = readLatencyStats(reports)
    check('RTT in ms', snapshot.rttMs === 4, snapshot.rttMs)
    check('uses the selected candidate pair, not the last nominated one', snapshot.remoteAddress === '192.168.1.50', snapshot.remoteAddress)
    check('jitter in ms', snapshot.jitterMs === 2, snapshot.jitterMs)
    check('jitter buffer average in ms', snapshot.bufferMs === 8, snapshot.bufferMs)
    check('decode average in ms', snapshot.decodeMs === 2, snapshot.decodeMs)
    check('processing average in ms', snapshot.processingMs === 5, snapshot.processingMs)
    check('FPS', snapshot.fps === 59.94, snapshot.fps)
    check('LAN detected', snapshot.remoteIsLocal === true, snapshot.remoteIsLocal)
    check('codec profile', snapshot.codec === 'H264 Normal', snapshot.codec)
    check('freeze count', snapshot.freezeCount === 2, snapshot.freezeCount)

    check('10/8 is private', isPrivateAddress('10.0.0.5'))
    check('172.16/12 is private', isPrivateAddress('172.20.1.1'))
    check('192.168/16 is private', isPrivateAddress('192.168.1.1'))
    check('public IPv4 is not private', isPrivateAddress('8.8.8.8') === false)
    check('link-local IPv6 is private', isPrivateAddress('fe80::1'))
    check('public IPv6 is not private', isPrivateAddress('2001:db8::1') === false)
    check('mDNS host candidate is local', isPrivateAddress('abcd-1234.local'))
    check('IPv4-mapped IPv6 is local', isPrivateAddress('::ffff:192.168.1.5'))
    check('CGNAT is treated as local', isPrivateAddress('100.64.0.1'))
    check('public 100/8 is not local', isPrivateAddress('100.128.0.1') === false)

    const rows = describeLatency(snapshot)
    check('rows include RTT', rows.some((row) => row.label === 'RTT' && row.value === '4 ms'))
    check('rows include LAN path', rows.some((row) => row.label === 'Path' && row.value.indexOf('LAN') === 0))
    check('rows include jitter buffer', rows.some((row) => row.label === 'Jitter buffer' && row.value === '8 ms'))
    check('rows include stalls', rows.some((row) => row.label === 'Stalls'))

    const empty = readLatencyStats(new Map())
    check('empty report is safe', empty.rttMs === null && empty.framesDecoded === 0)
    check('empty rows are empty', describeLatency(empty).length === 0)

    console.log('input flush')

    function makeChannel(settings = {}) {
        return {
            _inputInterval: 1,
            _frameMetadataQueue: [],
            _gamepadFrames: [],
            _pointerFrames: [],
            _mouseFrames: [],
            _keyboardFrames: [],
            sent: [],
            _createInputPacket(reportType, metadata, gamepad, pointer, mouse, keyboard) {
                return { reportType, metadata, gamepad, pointer, mouse, keyboard }
            },
            send(packet) {
                this.sent.push(packet)
            },
            getClient() {
                return { getDataChannel: () => ({ readyState: 'open' }) }
            },
            getMetadataQueue(size = 30) {
                return this._frameMetadataQueue.splice(0, size - 1)
            },
            getGamepadQueue(size = 30) {
                return this._gamepadFrames.splice(0, size - 1)
            },
            getGamepadQueueLength() {
                return this._gamepadFrames.length
            },
            getPointerQueue(size = 2) {
                return this._pointerFrames.splice(0, size - 1)
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
            ...settings,
        }
    }

    const channel = makeChannel()
    channel._mouseFrames.push({ X: 1 })
    check('flush sends pending mouse data', flushInputNow(channel, false, 0) === true, channel.sent.length)
    check('flush drains the queue', channel._mouseFrames.length === 0)
    check('flush produced one packet', channel.sent.length === 1, channel.sent.length)
    check('packet contains the mouse frame', channel.sent[0].mouse.length === 1)

    channel._mouseFrames.push({ X: 2 })
    check('flush is throttled', flushInputNow(channel, false, 3) === false)
    check('frames survive a throttled flush', channel._mouseFrames.length === 1)
    check('flush resumes after the window', flushInputNow(channel, false, MIN_FLUSH_INTERVAL_MS + 1) === true)
    check('forced flush bypasses the throttle', (() => {
        channel._mouseFrames.push({ X: 3 })
        return flushInputNow(channel, true, MIN_FLUSH_INTERVAL_MS + 2) === true
    })())
    check('throttle window is sane', MIN_FLUSH_INTERVAL_MS > 0 && MIN_FLUSH_INTERVAL_MS <= 16, MIN_FLUSH_INTERVAL_MS)

    const broken = makeChannel({
        _createInputPacket() {
            throw new Error('packet builder failed')
        },
    })
    broken._mouseFrames.push({ X: 1 }, { X: 2 })
    broken._keyboardFrames.push({ pressed: false, keyCode: 87, key: 'w' })
    broken._gamepadFrames.push({ A: 1 })
    check('a failing packet builder is handled', flushInputNow(broken, false, 10) === false)
    check('mouse frames are restored after a failure', broken._mouseFrames.length === 2, broken._mouseFrames.length)
    check('key-up is restored after a failure', broken._keyboardFrames.length === 1 && broken._keyboardFrames[0].pressed === false)
    check('gamepad frame is restored after a failure', broken._gamepadFrames.length === 1)

    const early = makeChannel({ _inputInterval: undefined })
    early._mouseFrames.push({ X: 1 })
    check('does not race the metadata handshake', flushInputNow(early, false, 20) === false)
    check('frames wait for the handshake', early._mouseFrames.length === 1)

    const closed = makeChannel({ getClient: () => ({ getDataChannel: () => ({ readyState: 'connecting' }) }) })
    closed._mouseFrames.push({ X: 3 })
    check('closed channel is not flushed', flushInputNow(closed, false, 30) === false)
    check('closed channel keeps its frames', closed._mouseFrames.length === 1)

    const wrapped = makeChannel()
    check('flusher installs', installInputFlusher(wrapped) === true)
    check('flusher is idempotent', installInputFlusher(wrapped) === false)
    check('flusher sets the immediate flag', wrapped.__latencyImmediate === true)
    wrapped.queueGamepadState({ A: 1 })
    check('gamepad frame is sent immediately', wrapped.sent.length === 1, wrapped.sent.length)
    check('gamepad queue was drained', wrapped._gamepadFrames.length === 0)
    check('flusher uninstalls', uninstallInputFlusher(wrapped) === true)
    check('uninstall restores the original method', wrapped.__latencyFlusherInstalled === false)

    const disabled = makeChannel()
    disabled.__latencyImmediate = false
    disabled._mouseFrames.push({ X: 4 })
    check('the setting can disable flushing', flushInputNow(disabled, false, 40) === false)
    check('disabled flushing keeps frames', disabled._mouseFrames.length === 1)

    console.log('controller')

    const defaults = resolveLatencySettings({})
    check('jitter buffer defaults to browser default', defaults.jitterBufferMs === -1, defaults.jitterBufferMs)
    check('immediate input defaults to on', defaults.immediateInput === true)
    check('direct LAN defaults to off', defaults.directLan === false)
    check('jitter buffer values parse', resolveLatencySettings({ latency_jitter_buffer_ms: 30 }).jitterBufferMs === 30)

    let receiver = { track: { kind: 'video' }, jitterBufferTarget: null }
    const fakePeer = { getReceivers: () => [receiver, { track: { kind: 'audio' }, jitterBufferTarget: null }] }
    check('jitter target is applied in milliseconds', applyJitterBufferTarget(fakePeer, 30) === 1)
    check('jitter target value', receiver.jitterBufferTarget === 30, receiver.jitterBufferTarget)
    check('same target is not re-applied', applyJitterBufferTarget(fakePeer, 30) === 0)
    check('negative target clears the preference', applyJitterBufferTarget(fakePeer, -1) === 1)
    check('jitter target cleared to null', receiver.jitterBufferTarget === null, receiver.jitterBufferTarget)
    check('default target is a no-op', applyJitterBufferTarget(fakePeer, -1) === 0)

    const player = { _webrtcConfiguration: { iceServers: [{ urls: 'stun:example.org' }] } }
    check('direct LAN applies', applyDirectLan(player, { directLan: true }) === true)
    check('STUN servers are removed', player._webrtcConfiguration.iceServers.length === 0, player._webrtcConfiguration.iceServers)
    check('direct LAN is restorable', restoreDirectLan(player) === true)
    check('STUN servers are restored', player._webrtcConfiguration.iceServers.length === 1, player._webrtcConfiguration.iceServers)
    check('direct LAN can stay off', applyDirectLan(player, { directLan: false }) === false)
} finally {
    rmSync(outDir, { recursive: true, force: true })
}

if (failures > 0) {
    console.error('\n' + failures + ' latency test(s) failed')
    process.exit(1)
}

console.log('\nAll latency tests passed')
