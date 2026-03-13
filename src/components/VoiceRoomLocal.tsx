import { useCallback, useEffect, useRef, useState } from 'react'
import { Channel, Profile } from '../lib/types'
import { localServer, type LocalUser } from '../lib/local-server'
import { sounds } from '../lib/sounds'
import { Mic, MicOff, PhoneOff, Phone } from 'lucide-react'

interface VoiceRoomLocalProps {
    channel: Channel
    userId: string
    isConnected: boolean
    onJoin: () => void
    onLeave: () => void
    onRegisterDisconnect?: (fn: () => Promise<void>) => void
    onSpeakingChange?: (userId: string, isSpeaking: boolean) => void
}

function toProfile(u: LocalUser): Profile {
    return {
        id: u.id,
        username: u.username,
        avatar_url: u.avatar_url,
        status: u.status,
        created_at: new Date().toISOString(),
    }
}

function VoiceRoomLocal({
    channel,
    userId,
    isConnected,
    onJoin,
    onLeave,
    onRegisterDisconnect,
    onSpeakingChange,
}: VoiceRoomLocalProps) {
    const [participants, setParticipants] = useState<Profile[]>([])
    const [isMuted, setIsMuted] = useState(false)
    const [isJoining, setIsJoining] = useState(false)

    const localStreamRef = useRef<MediaStream | null>(null)
    const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
    const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
    const channelIdRef = useRef(channel.id)
    const joinedRef = useRef(false)

    useEffect(() => {
        channelIdRef.current = channel.id
    }, [channel.id])

    const cleanup = useCallback(async () => {
        joinedRef.current = false

        try {
            localStreamRef.current?.getTracks().forEach(t => t.stop())
        } catch {
            // ignore
        }
        localStreamRef.current = null

        peersRef.current.forEach(pc => {
            try {
                pc.onicecandidate = null
                pc.ontrack = null
                pc.onconnectionstatechange = null
                pc.close()
            } catch {
                // ignore
            }
        })
        peersRef.current.clear()

        audioElsRef.current.forEach(el => {
            try {
                el.pause()
                el.srcObject = null
                el.remove()
            } catch {
                // ignore
            }
        })
        audioElsRef.current.clear()

        setParticipants([])
    }, [])

    useEffect(() => {
        if (onRegisterDisconnect) {
            onRegisterDisconnect(async () => {
                try {
                    localServer.leaveVoice(channelIdRef.current)
                } catch {
                    // ignore
                }
                await cleanup()
            })
        }
    }, [cleanup, onRegisterDisconnect])

    const ensurePeer = useCallback(
        (remoteUserId: string) => {
            if (remoteUserId === userId) return null
            const existing = peersRef.current.get(remoteUserId)
            if (existing) return existing

            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            })

            // Add local tracks
            const stream = localStreamRef.current
            if (stream) {
                stream.getTracks().forEach(track => pc.addTrack(track, stream))
            }

            pc.onicecandidate = (ev) => {
                if (ev.candidate) {
                    localServer.sendSignal(remoteUserId, { ice: ev.candidate }, channelIdRef.current)
                }
            }

            pc.ontrack = (ev) => {
                const [remoteStream] = ev.streams
                if (!remoteStream) return

                let el = audioElsRef.current.get(remoteUserId)
                if (!el) {
                    el = document.createElement('audio')
                    el.autoplay = true
                    el.volume = 1
                    audioElsRef.current.set(remoteUserId, el)
                    document.body.appendChild(el)
                }
                el.srcObject = remoteStream

                // speaking detection (very lightweight)
                if (onSpeakingChange) {
                    const ctx = new AudioContext()
                    const src = ctx.createMediaStreamSource(remoteStream)
                    const analyser = ctx.createAnalyser()
                    analyser.fftSize = 256
                    src.connect(analyser)
                    const data = new Uint8Array(analyser.frequencyBinCount)

                    const interval = window.setInterval(() => {
                        analyser.getByteFrequencyData(data)
                        let sum = 0
                        for (let i = 0; i < data.length; i++) sum += data[i]
                        const avg = sum / data.length
                        onSpeakingChange(remoteUserId, avg > 20)
                    }, 350)

                    pc.onconnectionstatechange = () => {
                        if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
                            window.clearInterval(interval)
                            try {
                                ctx.close()
                            } catch {
                                // ignore
                            }
                        }
                    }
                }
            }

            peersRef.current.set(remoteUserId, pc)
            return pc
        },
        [onSpeakingChange, userId]
    )

    const handleSignal = useCallback(
        async (payload: any) => {
            if (!payload || payload.channelId !== channelIdRef.current) return

            const fromUserId = payload.fromUserId
            if (!fromUserId || fromUserId === userId) return

            const pc = ensurePeer(fromUserId)
            if (!pc) return

            const sig = payload.signal
            try {
                if (sig?.offer) {
                    await pc.setRemoteDescription(new RTCSessionDescription(sig.offer))
                    const ans = await pc.createAnswer()
                    await pc.setLocalDescription(ans)
                    localServer.sendSignal(fromUserId, { answer: ans }, channelIdRef.current)
                } else if (sig?.answer) {
                    await pc.setRemoteDescription(new RTCSessionDescription(sig.answer))
                } else if (sig?.ice) {
                    await pc.addIceCandidate(new RTCIceCandidate(sig.ice))
                }
            } catch (e) {
                console.error('[VoiceRoomLocal] Failed to handle signal', e)
            }
        },
        [ensurePeer, userId]
    )

    const requestOffers = useCallback(async () => {
        // If server sends participants list, initiate offers to everyone else.
        for (const p of participants) {
            if (p.id === userId) continue
            const pc = ensurePeer(p.id)
            if (!pc) continue
            try {
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                localServer.sendSignal(p.id, { offer }, channelIdRef.current)
            } catch (e) {
                console.error('[VoiceRoomLocal] Failed to create offer', e)
            }
        }
    }, [ensurePeer, participants, userId])

    const join = useCallback(async () => {
        if (joinedRef.current) return
        joinedRef.current = true
        setIsJoining(true)

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: false,
            })

            localStreamRef.current = stream
            sounds.connect()
            localServer.joinVoice(channel.id)
            onJoin()
            setIsJoining(false)
        } catch (e) {
            joinedRef.current = false
            setIsJoining(false)
            console.error('[VoiceRoomLocal] Failed to join voice', e)
            sounds.error()
        }
    }, [channel.id, onJoin])

    const leave = useCallback(async () => {
        try {
            localServer.leaveVoice(channelIdRef.current)
        } catch {
            // ignore
        }
        await cleanup()
        sounds.disconnect()
        onLeave()
    }, [cleanup, onLeave])

    // Auto join when isConnected becomes true
    useEffect(() => {
        if (isConnected) {
            join()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isConnected])

    useEffect(() => {
        const handleVoiceParticipants = (data: any) => {
            if (data.channelId !== channelIdRef.current) return
            const list = (data.participants as LocalUser[])
                .filter(Boolean)
                .map(toProfile)
            setParticipants(list)
        }

        const handleVoiceSession = (data: any) => {
            if (data.channelId !== channelIdRef.current) return
            if (data.action === 'join' && data.user?.id) {
                setParticipants(prev => {
                    if (prev.some(p => p.id === data.user.id)) return prev
                    return [...prev, toProfile(data.user)]
                })
            }
            if (data.action === 'leave' && data.userId) {
                setParticipants(prev => prev.filter(p => p.id !== data.userId))
            }
        }

        localServer.on('voice-participants', handleVoiceParticipants)
        localServer.on('voice-session', handleVoiceSession)
        localServer.on('signal', handleSignal)

        return () => {
            localServer.off('voice-participants', handleVoiceParticipants)
            localServer.off('voice-session', handleVoiceSession)
            localServer.off('signal', handleSignal)
        }
    }, [handleSignal])

    // When participants change and we are connected, ensure offers exist
    useEffect(() => {
        if (!isConnected) return
        if (!localStreamRef.current) return
        requestOffers()
    }, [isConnected, participants, requestOffers])

    const toggleMute = () => {
        const stream = localStreamRef.current
        if (!stream) return
        const next = !isMuted
        stream.getAudioTracks().forEach(t => (t.enabled = !next))
        setIsMuted(next)
    }

    return (
        <div className="voice-room">
            {isJoining ? (
                <div className="voice-room__loading">
                    <div className="voice-room__loading-spinner" />
                    <div className="voice-room__loading-text">Connecting to voice...</div>
                </div>
            ) : (
                <>
                    <div className="voice-room__header">
                        <div className="voice-room__title">{channel.name}</div>
                        <div className="voice-room__actions">
                            <button className="btn btn--icon-sm" onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
                                {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                            </button>
                            <button className="btn btn--icon-sm btn--danger" onClick={leave} title="Leave">
                                <PhoneOff size={16} />
                            </button>
                        </div>
                    </div>

                    <div className="voice-room__participants">
                        {participants.length === 0 ? (
                            <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>No participants</div>
                        ) : (
                            participants.map(p => (
                                <div key={p.id} className="voice-participant">
                                    <div className="avatar avatar--sm">
                                        {p.avatar_url ? (
                                            <img 
                                                src={p.avatar_url} 
                                                alt={p.username || 'Avatar'} 
                                                className="avatar__image"
                                            />
                                        ) : (
                                            p.username?.charAt(0) || '?'
                                        )}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{p.username}</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.id === userId ? 'You' : 'Connected'}</div>
                                    </div>
                                    <Phone size={16} style={{ color: 'var(--green)' }} />
                                </div>
                            ))
                        )}
                    </div>

                    {!isConnected && (
                        <div style={{ padding: 16 }}>
                            <button className="btn btn--primary btn--full" onClick={join}>
                                <Phone size={16} />
                                Join Voice
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

export default VoiceRoomLocal
