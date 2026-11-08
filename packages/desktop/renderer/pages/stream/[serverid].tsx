import React from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import xCloudPlayer from 'xbox-xcloud-player'

import { useSettings } from '../../context/userContext'
import StreamComponent from '../../components/ui/streamcomponent'
import StreamPreload from '../../components/ui/streampreload'
import KbmOverlay from '../../components/ui/kbmoverlay'
import Ipc from '../../lib/ipc'
import { createKbmRuntime, KbmRuntime } from '../../lib/kbm/runtime'
import { KbmStatus } from '../../lib/kbm/types'
import LatencyController, { applyDirectLan, resolveLatencySettings } from '../../lib/latency/controller'
import { useTranslation } from 'react-i18next'

function Stream() {
    const router = useRouter()
    const { settings } = useSettings()
    const { t } = useTranslation()

    let streamStateInterval
    let keepaliveInterval

    const [xPlayer, setxPlayer] = React.useState(undefined)
    const [sessionId, setSessionId] = React.useState('')
    const [queueTime, setQueueTime] = React.useState(0)
    const [streamConnected, setStreamConnected] = React.useState(false)

    // The runtime is created lazily, right before the player is constructed, so
    // it always sees the loaded settings instead of the initial defaults.
    const settingsRef = React.useRef(settings)
    settingsRef.current = settings

    const kbmRuntimeRef = React.useRef<KbmRuntime | null>(null)
    const latencyRef = React.useRef<LatencyController | null>(null)
    const [kbmRuntime, setKbmRuntime] = React.useState<KbmRuntime | null>(null)
    const [kbmStatus, setKbmStatus] = React.useState<KbmStatus>({
        supported: false,
        locked: false,
        mode: 'gamepad',
        enabled: false,
    })

    React.useEffect(() => {
        if (kbmRuntime === null) {
            return
        }

        return kbmRuntime.subscribe(setKbmStatus)
    }, [kbmRuntime])

    React.useEffect(() => {
        return () => {
            if (kbmRuntimeRef.current !== null) {
                kbmRuntimeRef.current.destroy()
            }

            if (latencyRef.current !== null) {
                latencyRef.current.stop()
            }
        }
    }, [])

    React.useEffect(() => {
        // Settings can resolve after the session starts. Read them through a
        // ref so this effect can stay keyed on [xPlayer, sessionId] without
        // capturing stale defaults.
        const currentSettings = settingsRef.current

        // Detect stream type and title / server id
        let streamType = 'home'
        let serverId = router.query.serverid
        if((router.query.serverid as string).substr(0, 6) === 'xcloud'){
            streamType = 'cloud'
            serverId = (router.query.serverid as string).substr(7)
        }

        if(xPlayer !== undefined){
            const latencySettings = resolveLatencySettings(currentSettings)

            // Must happen before bind(): it changes the ICE configuration.
            // Host-only candidates cannot reach an xCloud VM, so keep STUN for
            // cloud streams and use direct LAN for console streaming only.
            const directLanApplied = streamType === 'home' ? applyDirectLan(xPlayer, latencySettings) : false

            document.getElementById('streamComponentHolder').innerHTML = '<div id="streamComponent" class="size_'+currentSettings.video_size+'"></div>'
            xPlayer.bind()

            if (latencyRef.current !== null) {
                latencyRef.current.stop()
            }

            latencyRef.current = new LatencyController(xPlayer, latencySettings)
            latencyRef.current.markDirectLanApplied(directLanApplied)
            latencyRef.current.start()

            // Set bitrates & video codec profiles
            if((streamType === 'cloud') ? currentSettings.xcloud_bitrate : currentSettings.xhome_bitrate > 0){
                xPlayer.setVideoBitrate((streamType === 'cloud') ? currentSettings.xcloud_bitrate : currentSettings.xhome_bitrate)
            }

            if(currentSettings.video_profiles.length > 0){
                xPlayer.setCodecPreferences('video/H264', { profiles: currentSettings.video_profiles || [] }) // 4d = high, 42e = mid, 420 = low
            }

            // Stream is ready so we start the player
            xPlayer.setControllerRumble(currentSettings.controller_vibration)
            xPlayer.setSdpHandler((client, offer) => {
                Ipc.send('streaming', 'sendChatSdp', {
                    sessionId: sessionId,
                    sdp: offer.sdp,
                }).then((sdpResponse) => {
                    xPlayer.setRemoteOffer(sdpResponse.sdp)

                }).catch((error) => {
                    console.log('ChatSDP Exchange error:', error)
                    alert(t('errors.chatSDPExchangeError') + ' ' + JSON.stringify(error))
                })
            })

            xPlayer.createOffer().then((offer:any) => {
                Ipc.send('streaming', 'sendSdp', {
                    sessionId: sessionId,
                    sdp: offer.sdp,
                }).then((sdpResult:any) => {
                    xPlayer.setRemoteOffer(sdpResult.sdp)

                    // Gather candidates
                    const iceCandidates = xPlayer.getIceCandidates()
                    const candidates = []
                    for(const candidate in iceCandidates){
                        candidates.push({
                            candidate: iceCandidates[candidate].candidate,
                            sdpMLineIndex: iceCandidates[candidate].sdpMLineIndex,
                            sdpMid: iceCandidates[candidate].sdpMid,
                        })
                    }

                    Ipc.send('streaming', 'sendIce', {
                        sessionId: sessionId,
                        ice: candidates,
                    }).then((iceResult:any) => {
                        console.log(iceResult)
                        xPlayer.setIceCandidates(iceResult)

                        // All done. Waiting for the event 'connectionstate' to be triggered

                    }).catch((error) => {
                        console.log('ICE Exchange error:', error)
                        alert(t('errors.ICEExchangeError') + ' ' + JSON.stringify(error))
                    })

                }).catch((error) => {
                    console.log('SDP Exchange error:', error)
                    alert(t('errors.SDPExchangeError') + ' ' + JSON.stringify(error))
                })
            })

            xPlayer.getEventBus().on('connectionstate', (event) => {
                console.log('connectionstate changed:', event)

                if(event.state === 'connected'){
                    setStreamConnected(true)
                } else if(event.state === 'closed'){
                    setStreamConnected(false)
                }

                const connStatus = document.getElementById('component_streamcomponent_connectionstatus')
                if(connStatus !== null){
                    if(event.state === 'connected'){
                        connStatus.innerText = t('streamWindow.clientHasBeenDisconnected')
                        document.getElementById('component_streamcomponent_loader').className = 'hidden'

                        // Set audio / Video settings
                        // @TODO: Implement api's in xbox-xcloud-player
                        if(currentSettings.audio_enabled === false){
                            xPlayer._audioComponent._audioRender.muted = true
                        }

                        if(currentSettings.video_enabled === false){
                            xPlayer._videoComponent._videoRender.style.opacity = 0
                        }

                        // Start keepalive loop
                        if (keepaliveInterval) {
                            clearInterval(keepaliveInterval)
                        }
                        keepaliveInterval = setInterval(() => {
                            Ipc.send('streaming', 'sendKeepalive', {
                                sessionId: sessionId,
                            }).then((result) => {
                                console.log('StartStream keepalive:', result)
                            }).catch((error) => {
                                console.error('Failed to send keepalive. Error details:\n'+JSON.stringify(error))
                            })
                        }, 30000) // Send every 30 seconds

                    } else if(event.state === 'new'){
                        connStatus.innerText = t('streamWindow.startingConnection')

                    } else if(event.state === 'connecting'){
                        connStatus.innerText = t('streamWindow.connectingToConsole')

                    } else if(event.state === 'closed') {
                        // Client has been disconnected. Lets return to home.
                        // xPlayer.close()
                        console.log('Client has been disconnected. Returning to prev page.')
                        window.history.back()
                    }
                }
            })
        } else if(sessionId === '') {
            // Stream is not ready yet, lets start it...

            Ipc.send('streaming', 'startStream', {
                type: streamType,
                target: serverId,
            }).then((result:string) => {
                console.log('StartStream session:', result)
                setSessionId(result)

            }).catch((error) => {
                alert(t('errors.failedToStartStream') + '\n' + JSON.stringify(error))
            })
        } else {

            streamStateInterval = setInterval(() => {
                Ipc.send('streaming', 'getPlayerState', {
                    sessionId: sessionId,
                }).then((session:any) => {
                    console.log('Player state:', session)

                    switch(session.playerState){
                        case 'pending':
                            // Waiting for console to start
                            break

                        case 'started':
                            // Console is ready
                            clearInterval(streamStateInterval)

                            // Read the settings at construction time; they may
                            // have resolved after this effect was set up.
                            const startSettings = settingsRef.current

                            // Start xPlayer interface
                            let kbm = kbmRuntimeRef.current
                            if (kbm === null) {
                                kbm = createKbmRuntime(startSettings)
                                kbmRuntimeRef.current = kbm
                                setKbmRuntime(kbm)
                            }

                            setxPlayer(new xCloudPlayer('streamComponent', {
                                ui_systemui: [],
                                input_touch: startSettings.input_touch || false,
                                input_mousekeyboard_config: startSettings.input_mousekeyboard_config !== undefined ? {
                                    _keymapping: startSettings.input_mousekeyboard_config,
                                } : undefined as any,
                                ...kbm.playerConfig,
                            }))
                            break

                        case 'failed':
                            // Error
                            clearInterval(streamStateInterval)

                            if(session.errorDetails.code === 'WNSError' && session.errorDetails.message.includes('WaitingForServerToRegister')){
                                // Detected the "WaitingForServerToRegister" error. This means the console is not connected to the xbox servers
                                alert(t('errors.unableToStartStreamSession') + '\n\n' + t('errors.streamErrorResult') + ' ' + session.state + '\n' + t('errors.details') + ' [' + session.errorDetails.code + '] ' + session.errorDetails.message)
                            } else {
                                alert(t('errors.streamErrorResult') + ' ' + session.state + '\n' + t('errors.details') + ' [' + session.errorDetails.code + '] ' + session.errorDetails.message)
                            }
                            console.log('Full stream error:', session.errorDetails)
                            onDisconnect()
                            xPlayer.close()
                            break

                        case 'queued':
                            // Waiting in queue
                            // @TODO: Show queue position
                            if(queueTime === 0){
                                setQueueTime(session.waitingTimes.estimatedTotalWaitTimeInSeconds)
                                console.log('Setting queue to:', session.waitingTimes.estimatedTotalWaitTimeInSeconds)


                            }
                            break
                    }

                }).catch((error) => {
                    alert(t('errors.failedToGetPlayerState') + '\n' + JSON.stringify(error))
                })
            }, 1000)
        }

        // Modal window
        return () => {
            if(xPlayer !== undefined){
                xPlayer.close()
            }

            if(keepaliveInterval){
                clearInterval(keepaliveInterval)
            }

            if(streamStateInterval){
                clearInterval(streamStateInterval)
            }
        }
    }, [xPlayer, sessionId])

    function gamepadSend(button){
        console.log('Pressed button:', button)
        xPlayer.getChannelProcessor('input').pressButton(0, 'Nexus')
    }

    function onDisconnect(){
        Ipc.send('streaming', 'stopStream', {
            sessionId: sessionId,
        }).then((result) => {
            console.log('Stream stopped:', result)
        })

        if(streamStateInterval){
            clearInterval(streamStateInterval)
        }
    }

    return (
        <React.Fragment>
            <Head>
                <title>Greenlight - {t('streamWindow.pageTitle')} {router.query.serverid}</title>
            </Head>

            { (xPlayer !== undefined) ? <React.Fragment>
                <StreamComponent onDisconnect={ () => {
                    onDisconnect()
                }} onMenu={ () => {
                    gamepadSend('nexus')
                } } xPlayer={ xPlayer }></StreamComponent>
                { (streamConnected && kbmRuntime !== null) ? <KbmOverlay
                    status={ kbmStatus }
                    toggleKey={ kbmRuntime.settings.toggleKey }
                ></KbmOverlay> : null }
            </React.Fragment> : (queueTime > 0) ?<StreamPreload onDisconnect={ () => {
                onDisconnect()
            }} waitingTime={ queueTime }></StreamPreload> : <StreamPreload onDisconnect={ () => {
                onDisconnect()
            }}></StreamPreload> }
        </React.Fragment>
    )
}

export default Stream
