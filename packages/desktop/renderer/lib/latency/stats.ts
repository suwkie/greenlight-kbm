/**
 * Turns a WebRTCRTCStatsReport into the handful of numbers that actually
 * describe stream latency. Kept free of DOM/React so it can be unit tested.
 */
export interface LatencySnapshot {
    rttMs: number | null;
    jitterMs: number | null;
    bufferMs: number | null;
    decodeMs: number | null;
    processingMs: number | null;
    fps: number | null;
    framesDecoded: number;
    framesDropped: number;
    freezeCount: number;
    pauseCount: number;
    packetsLost: number;
    nackCount: number;
    pliCount: number;
    remoteAddress: string;
    remoteCandidateType: string;
    remoteIsLocal: boolean | null;
    codec: string;
    localCandidateType: string;
}

function secondsToMs(value: any): number | null {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.round(parsed * 1000 * 10) / 10 : null
}

function average(total: any, count: any): number | null {
    const t = Number(total)
    const c = Number(count)

    if (!Number.isFinite(t) || !Number.isFinite(c) || c <= 0) {
        return null
    }

    return Math.round((t / c) * 1000 * 10) / 10
}

export function isPrivateAddress(address: string): boolean {
    if (address === undefined || address === null) {
        return false
    }

    // mDNS host candidates look like "abcd-1234.local".
    if (address.endsWith('.local')) {
        return true
    }

    if (address.indexOf(':') >= 0) {
        const lower = address.toLowerCase()

        // IPv4-mapped IPv6 addresses carry an IPv4 address in the last group.
        if (lower.startsWith('::ffff:')) {
            return isPrivateAddress(lower.substring(7))
        }

        return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')
    }

    const parts = address.split('.')
    if (parts.length !== 4) {
        return false
    }

    const a = parseInt(parts[0], 10)
    const b = parseInt(parts[1], 10)

    return a === 10
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 169 && b === 254)
        || (a === 100 && b >= 64 && b <= 127) // RFC 6598 CGNAT
        || a === 127
}

function describeCodec(codec: any): string {
    if (codec === undefined || codec === null) {
        return ''
    }

    const mime = codec.mimeType !== undefined ? codec.mimeType.replace('video/', '').replace('audio/', '') : ''
    const fmtp = codec.sdpFmtpLine !== undefined ? String(codec.sdpFmtpLine) : ''
    const profile = fmtp.match(/profile-level-id=([0-9a-fA-F]+)/)

    if (profile === null) {
        return mime
    }

    const id = profile[1].toLowerCase()

    if (id.indexOf('4d') === 0) {
        return mime + ' High'
    }

    if (id.indexOf('42e') === 0) {
        return mime + ' Normal'
    }

    if (id.indexOf('420') === 0) {
        return mime + ' Low'
    }

    return mime + ' ' + id
}

export function readLatencyStats(reports: any): LatencySnapshot {
    const snapshot: LatencySnapshot = {
        rttMs: null,
        jitterMs: null,
        bufferMs: null,
        decodeMs: null,
        processingMs: null,
        fps: null,
        framesDecoded: 0,
        framesDropped: 0,
        freezeCount: 0,
        pauseCount: 0,
        packetsLost: 0,
        nackCount: 0,
        pliCount: 0,
        remoteAddress: '',
        remoteCandidateType: '',
        remoteIsLocal: null,
        codec: '',
        localCandidateType: '',
    }

    if (reports === undefined || reports === null || typeof reports.forEach !== 'function') {
        return snapshot
    }

    let selectedPair: any = undefined
    let fallbackPair: any = undefined
    let transport: any = undefined
    let inbound: any = undefined
    const candidatePairs: { [id: string]: any } = {}
    const remoteCandidates: { [id: string]: any } = {}
    const localCandidates: { [id: string]: any } = {}
    const codecs: { [id: string]: any } = {}

    reports.forEach((report: any) => {
        if (report.type === 'candidate-pair') {
            candidatePairs[report.id] = report

            if (report.nominated === true || report.selected === true) {
                selectedPair = report
            } else if (fallbackPair === undefined || (report.packetsReceived || 0) > (fallbackPair.packetsReceived || 0)) {
                fallbackPair = report
            }
        } else if (report.type === 'transport') {
            transport = report
        } else if (report.type === 'remote-candidate') {
            remoteCandidates[report.id] = report
        } else if (report.type === 'local-candidate') {
            localCandidates[report.id] = report
        } else if (report.type === 'inbound-rtp' && report.kind === 'video') {
            inbound = report
        } else if (report.type === 'codec') {
            codecs[report.id] = report
        }
    })

    const pair = transport !== undefined && transport.selectedCandidatePairId !== undefined
        ? (candidatePairs[transport.selectedCandidatePairId] || selectedPair || fallbackPair)
        : (selectedPair !== undefined ? selectedPair : fallbackPair)

    if (pair !== undefined) {
        snapshot.rttMs = secondsToMs(pair.currentRoundTripTime)

        const remote = remoteCandidates[pair.remoteCandidateId]
        if (remote !== undefined) {
            snapshot.remoteAddress = remote.address || remote.ip || ''
            snapshot.remoteCandidateType = remote.candidateType || ''
            snapshot.remoteIsLocal = snapshot.remoteAddress !== '' ? isPrivateAddress(snapshot.remoteAddress) : null
        }

        const local = localCandidates[pair.localCandidateId]
        if (local !== undefined) {
            snapshot.localCandidateType = local.candidateType || ''
        }
    }

    if (inbound !== undefined) {
        snapshot.jitterMs = secondsToMs(inbound.jitter)
        snapshot.bufferMs = average(inbound.jitterBufferDelay, inbound.jitterBufferEmittedCount)
        snapshot.decodeMs = average(inbound.totalDecodeTime, inbound.framesDecoded)
        snapshot.processingMs = average(inbound.totalProcessingDelay, inbound.framesDecoded)
        snapshot.fps = Number.isFinite(Number(inbound.framesPerSecond)) ? Number(inbound.framesPerSecond) : null
        snapshot.framesDecoded = Number(inbound.framesDecoded) || 0
        snapshot.framesDropped = Number(inbound.framesDropped) || 0
        snapshot.freezeCount = Number(inbound.freezeCount) || 0
        snapshot.pauseCount = Number(inbound.pauseCount) || 0
        snapshot.packetsLost = Number(inbound.packetsLost) || 0
        snapshot.nackCount = Number(inbound.nackCount) || 0
        snapshot.pliCount = Number(inbound.pliCount) || 0
        snapshot.codec = describeCodec(codecs[inbound.codecId])
    }

    return snapshot
}

export interface LatencyRow {
    label: string;
    value: string;
    level: 'ok' | 'warn' | 'bad';
}

function levelFor(value: number | null, warnAt: number, badAt: number): 'ok' | 'warn' | 'bad' {
    if (value === null) {
        return 'ok'
    }

    if (value >= badAt) {
        return 'bad'
    }

    if (value >= warnAt) {
        return 'warn'
    }

    return 'ok'
}

/** Human readable rows for the debug overlay. */
export function describeLatency(snapshot: LatencySnapshot): Array<LatencyRow> {
    const rows: Array<LatencyRow> = []

    if (snapshot.rttMs !== null) {
        rows.push({ label: 'RTT', value: snapshot.rttMs + ' ms', level: levelFor(snapshot.rttMs, 20, 60) })
    }

    if (snapshot.bufferMs !== null) {
        rows.push({ label: 'Jitter buffer', value: snapshot.bufferMs + ' ms', level: levelFor(snapshot.bufferMs, 40, 90) })
    }

    if (snapshot.jitterMs !== null) {
        rows.push({ label: 'Jitter', value: snapshot.jitterMs + ' ms', level: levelFor(snapshot.jitterMs, 15, 40) })
    }

    if (snapshot.decodeMs !== null) {
        rows.push({ label: 'Decode', value: snapshot.decodeMs + ' ms', level: levelFor(snapshot.decodeMs, 8, 20) })
    }

    if (snapshot.processingMs !== null) {
        rows.push({ label: 'Processing', value: snapshot.processingMs + ' ms', level: levelFor(snapshot.processingMs, 15, 40) })
    }

    if (snapshot.fps !== null) {
        rows.push({ label: 'Stream FPS', value: Math.round(snapshot.fps).toString(), level: 'ok' })
    }

    if (snapshot.remoteAddress !== '') {
        rows.push({
            label: 'Path',
            value: (snapshot.remoteIsLocal === true ? 'LAN ' : 'Remote ') + (snapshot.remoteCandidateType || '') + ' ' + snapshot.remoteAddress,
            level: snapshot.remoteIsLocal === true ? 'ok' : 'warn',
        })
    }

    if (snapshot.codec !== '') {
        rows.push({ label: 'Codec', value: snapshot.codec, level: 'ok' })
    }

    if (snapshot.freezeCount > 0 || snapshot.pauseCount > 0) {
        rows.push({
            label: 'Stalls',
            value: 'freezes ' + snapshot.freezeCount + ', pauses ' + snapshot.pauseCount,
            level: 'warn',
        })
    }

    if (snapshot.framesDropped > 0 || snapshot.packetsLost > 0 || snapshot.nackCount > 0) {
        rows.push({
            label: 'Loss',
            value: 'dropped ' + snapshot.framesDropped + ', lost ' + snapshot.packetsLost + ', nack ' + snapshot.nackCount + ', pli ' + snapshot.pliCount,
            level: snapshot.packetsLost > 0 ? 'warn' : 'ok',
        })
    }

    return rows
}
