import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Channel, Profile } from '../lib/types'
import { sounds } from '../lib/sounds'
import { localServer, type LocalUser } from '../lib/local-server'
import { getLumaConfig, speechToText, askLuma, askLumaWithVision, captureVideoFrame, speakLuma, lockVoiceCall, unlockVoiceCall, isVoiceCallLocked } from '../lib/luma'
import {
    Mic,
    MicOff,
    Volume2,
    VolumeX,
    PhoneOff,
    Phone,
    Headphones,
    Bot,
    Loader2,
    MonitorUp,
    MonitorOff,
    Maximize2,
    Minimize2,
} from 'lucide-react'
import ScreenShareModal from './ScreenShareModal'
import SoundpadPanel from './SoundpadPanel'
import { getSoundpadConfig, getAllSounds, preloadSound } from '../lib/soundpad'
import { getVoiceChangerConfig, createVoiceChangerChain, type VoiceChangerChain } from '../lib/voicechanger'

interface VoiceRoomProps {
    channel: Channel
    userId: string
    isConnected: boolean
    onJoin: () => void
    onLeave: () => void
    onRegisterDisconnect?: (fn: () => Promise<void>) => void
    onSpeakingChange?: (userId: string, isSpeaking: boolean) => void
}

const NAME_COLORS: Record<string, string> = {
    default: 'var(--text-primary)',
    red: '#ef4444',
    orange: '#f97316',
    yellow: '#eab308',
    green: '#22c55e',
    cyan: '#06b6d4',
    blue: '#3b82f6',
    purple: '#a855f7',
    pink: '#ec4899',
    white: '#ffffff',
}

const NAME_FONTS: Record<string, string> = {
    default: 'inherit',
    unbounded: '"Unbounded", sans-serif',
    righteous: '"Righteous", cursive',
    orbitron: '"Orbitron", sans-serif',
    caveat: '"Caveat", cursive',
    dancing: '"Dancing Script", cursive',
    pacifico: '"Pacifico", cursive',
    marker: '"Permanent Marker", cursive',
    pixel: '"Press Start 2P", cursive',
}

function getNameFontScale(fontId: string): number {
    switch (fontId) {
        case 'pixel':
            return 0.82
        case 'orbitron':
            return 0.92
        case 'unbounded':
            return 0.92
        case 'pacifico':
            return 0.92
        case 'dancing':
            return 0.98
        case 'caveat':
            return 1.02
        case 'marker':
            return 0.96
        case 'righteous':
        default:
            return 1
    }
}

function getNameColorValue(colorId: string): string {
    return NAME_COLORS[colorId] || NAME_COLORS.default
}

function getNameFontValue(fontId: string): string {
    return NAME_FONTS[fontId] || NAME_FONTS.default
}

function VoiceRoom({ channel, userId, isConnected, onJoin, onLeave, onRegisterDisconnect, onSpeakingChange }: VoiceRoomProps) {
    const [participants, setParticipants] = useState<Profile[]>([])
    const [exitingIds, setExitingIds] = useState<Set<string>>(new Set())
    const [isExiting, setIsExiting] = useState(false)
    const [isJoining, setIsJoining] = useState(false)
    const [isConnecting, setIsConnecting] = useState(false)
    const [isMuted, setIsMuted] = useState(false)
    const [isDeafened, setIsDeafened] = useState(false)
    const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set())
    const [isListeningToLuma, setIsListeningToLuma] = useState(false)
    const [lumaProcessing, setLumaProcessing] = useState(false)
    const [isScreenSharing, setIsScreenSharing] = useState(false)
    const [showScreenShareModal, setShowScreenShareModal] = useState(false)
    const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null)
    const [screenSharerId, setScreenSharerId] = useState<string | null>(null)
    const [isScreenFullscreen, setIsScreenFullscreen] = useState(false)
    const screenStreamRef = useRef<MediaStream | null>(null)
    const remoteVideoTrackRef = useRef<MediaStreamTrack | null>(null)
    const remoteScreenStreamRef = useRef<MediaStream | null>(null)
    const screenVideoElRef = useRef<HTMLVideoElement | null>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const localStreamRef = useRef<MediaStream | null>(null)
    const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
    const signalingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
    const audioAnalysersRef = useRef<Map<string, { analyser: AnalyserNode; ctx: AudioContext }>>(new Map())
    const localAnalyserRef = useRef<{ analyser: AnalyserNode; ctx: AudioContext } | null>(null)
    const speakingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const channelIdRef = useRef(channel.id)
    const hasJoinedRef = useRef(false)
    const wasConnectedRef = useRef(false)
    const prevParticipantsRef = useRef<Profile[]>([])
    const participantsCacheRef = useRef<Map<string, Profile>>(new Map())
    const renderedParticipantsRef = useRef<Set<string>>(new Set())
    const voiceModeRef = useRef<'push-to-talk' | 'voice-activity'>('voice-activity')
    const pushToTalkKeyRef = useRef('KeyV')
    const isMutedRef = useRef(isMuted)
    const lumaAbortRef = useRef<AbortController | null>(null)
    const lumaAudioRef = useRef<HTMLAudioElement | null>(null)
    // Audio processing chain refs (voice changer + soundpad mixer)
    const mixerCtxRef = useRef<AudioContext | null>(null)
    const mixerDestRef = useRef<MediaStreamAudioDestinationNode | null>(null)
    const voiceChangerRef = useRef<VoiceChangerChain | null>(null)
    const processedStreamRef = useRef<MediaStream | null>(null)
    const soundpadGainRef = useRef<GainNode | null>(null)
    const passthroughSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
    const passthroughGainRef = useRef<GainNode | null>(null)
    const localAnalyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
    channelIdRef.current = channel.id
    isMutedRef.current = isMuted

    // Keep voice settings refs in sync with localStorage
    const syncVoiceSettingsRefs = useCallback(() => {
        const stored = localStorage.getItem('voice_settings')
        const settings = stored ? JSON.parse(stored) : { voiceMode: 'voice-activity', pushToTalkKey: 'KeyV' }
        voiceModeRef.current = settings.voiceMode
        pushToTalkKeyRef.current = settings.pushToTalkKey || 'KeyV'
    }, [])

    const ICE_SERVERS: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
        ],
    }

    const isLocalMode = () => localServer.isConnected()

    const toProfile = (u: LocalUser): Profile => ({
        id: u.id,
        username: u.username,
        avatar_url: u.avatar_url,
        status: u.status,
        created_at: new Date().toISOString(),
        decoration: (u as any).decoration || 'none',
        border: (u as any).border || 'none',
        name_color: (u as any).name_color || 'default',
        name_font: (u as any).name_font || 'default',
    })

    const fetchParticipants = useCallback(async () => {
        if (isLocalMode()) {
            return
        }
        const { data } = await supabase
            .from('voice_sessions')
            .select('user_id, profiles(id, username, avatar_url, status)')
            .eq('channel_id', channel.id)

        if (data) {
            const profiles = data
                .map((d: any) => d.profiles)
                .filter(Boolean) as Profile[]
            setParticipants(profiles)
        }
    }, [channel.id])

    // Listen for voice_sessions changes
    useEffect(() => {
        if (isLocalMode()) {
            const handleParticipants = (data: any) => {
                if (data.channelId !== channel.id) return
                const list = (data.participants as LocalUser[]).filter(Boolean).map(toProfile)
                setParticipants(list)
            }

            const handleVoiceSession = (data: any) => {
                if (data.channelId !== channel.id) return
                if (data.action === 'join' && data.user) {
                    setParticipants(prev => {
                        if (prev.some(p => p.id === data.user.id)) return prev
                        return [...prev, toProfile(data.user as LocalUser)]
                    })
                }
                if (data.action === 'leave' && data.userId) {
                    setParticipants(prev => prev.filter(p => p.id !== data.userId))
                }
            }

            const handleProfileUpdated = (data: any) => {
                // Update participant data when profile changes
                if (data.user) {
                    setParticipants(prev => prev.map(p => {
                        if (p.id === data.user.id) {
                            return {
                                ...p,
                                username: data.user.username,
                                avatar_url: data.user.avatar_url,
                                decoration: data.user.decoration,
                                border: data.user.border,
                            }
                        }
                        return p
                    }))
                }
            }

            localServer.on('voice-participants', handleParticipants)
            localServer.on('voice-session', handleVoiceSession)
            localServer.on('profile-updated', handleProfileUpdated)

            // Request current participants so we see who's already in the channel
            localServer.getVoiceParticipants(channel.id)

            return () => {
                localServer.off('voice-participants', handleParticipants)
                localServer.off('voice-session', handleVoiceSession)
                localServer.off('profile-updated', handleProfileUpdated)
            }
        }

        fetchParticipants()

        const sub = supabase
            .channel(`voice-presence:${channel.id}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'voice_sessions', filter: `channel_id=eq.${channel.id}` },
                () => { fetchParticipants() }
            )
            .subscribe()

        return () => { supabase.removeChannel(sub) }
    }, [channel.id, fetchParticipants])

    // Refresh participants when window gains focus
    useEffect(() => {
        if (isLocalMode()) return
        const handleFocus = () => { fetchParticipants() }
        window.addEventListener('focus', handleFocus)
        return () => window.removeEventListener('focus', handleFocus)
    }, [fetchParticipants])

    // Create peer connections when new participants join in local mode
    useEffect(() => {
        if (!isLocalMode() || !localStreamRef.current || !processedStreamRef.current) return
        
        participants.forEach(p => {
            if (p.id !== userId && !peersRef.current.has(p.id)) {
                console.log('[VoiceRoom] Creating peer connection for participant:', p.id)
                const pc = createPeerConnection(p.id)
                pc.createOffer().then(offer => {
                    pc.setLocalDescription(offer)
                    localServer.sendSignal(p.id, { offer }, channel.id)
                })
            }
        })
    }, [participants, isConnected, channel.id, userId])

    // Auto-join voice when isConnected becomes true
    useEffect(() => {
        if (isConnected && !hasJoinedRef.current) {
            hasJoinedRef.current = true
            joinVoice()
        }
    }, [isConnected])

    // Speaking detection - usar ref para evitar loop de re-renders
    const speakingUsersRef = useRef<Set<string>>(new Set())
    isMutedRef.current = isMuted

    useEffect(() => {
        if (!isConnected) return

        speakingIntervalRef.current = setInterval(() => {
            const newSpeaking = new Set<string>()

            if (localAnalyserRef.current && !isMutedRef.current) {
                const data = new Uint8Array(localAnalyserRef.current.analyser.frequencyBinCount)
                localAnalyserRef.current.analyser.getByteFrequencyData(data)
                const avg = data.reduce((a, b) => a + b, 0) / data.length
                if (avg > 15) newSpeaking.add(userId)
            }

            audioAnalysersRef.current.forEach((val, peerId) => {
                const data = new Uint8Array(val.analyser.frequencyBinCount)
                val.analyser.getByteFrequencyData(data)
                const avg = data.reduce((a, b) => a + b, 0) / data.length
                if (avg > 15) newSpeaking.add(peerId)
            })

            // Only update state if changed (avoid unnecessary re-renders)
            const prevSpeaking = speakingUsersRef.current
            const changed = newSpeaking.size !== prevSpeaking.size ||
                [...newSpeaking].some(id => !prevSpeaking.has(id))

            if (changed) {
                // Notify about local user speaking change
                if (onSpeakingChange) {
                    const wasSpeaking = prevSpeaking.has(userId)
                    const nowSpeaking = newSpeaking.has(userId)
                    if (wasSpeaking !== nowSpeaking) {
                        onSpeakingChange(userId, nowSpeaking)
                    }
                }
                speakingUsersRef.current = newSpeaking
                setSpeakingUsers(newSpeaking)
            }
        }, 100)

        return () => {
            if (speakingIntervalRef.current) clearInterval(speakingIntervalRef.current)
        }
    }, [isConnected, userId])

    // Track participants leaving for exit animation
    useEffect(() => {
        // Cache participant data
        participants.forEach(p => participantsCacheRef.current.set(p.id, p))

        // Check who left compared to previous render
        const prevIds = new Set(prevParticipantsRef.current.map(p => p.id))
        const currentIds = new Set(participants.map(p => p.id))
        const leftIds = [...prevIds].filter(id => !currentIds.has(id))

        if (leftIds.length > 0) {
            // Add to exiting state
            setExitingIds(prev => new Set([...prev, ...leftIds]))

            // Remove after animation completes (500ms)
            setTimeout(() => {
                setExitingIds(prev => {
                    const next = new Set(prev)
                    leftIds.forEach(id => next.delete(id))
                    return next
                })
                leftIds.forEach(id => participantsCacheRef.current.delete(id))
            }, 500)
        }

        prevParticipantsRef.current = participants
    }, [participants])

    const createPeerConnection = (peerId: string): RTCPeerConnection => {
        const pc = new RTCPeerConnection(ICE_SERVERS)

        // Add audio track - use processed stream (voice changer + soundpad) if available
        const audioStream = processedStreamRef.current || localStreamRef.current
        console.log('[VoiceRoom] createPeerConnection for', peerId, {
            hasProcessedStream: !!processedStreamRef.current,
            hasLocalStream: !!localStreamRef.current,
            audioTracks: audioStream?.getAudioTracks().length || 0,
            audioTrackStates: audioStream?.getAudioTracks().map(t => ({ enabled: t.enabled, muted: t.muted, readyState: t.readyState })) || []
        })
        if (audioStream) {
            audioStream.getAudioTracks().forEach(track => {
                console.log('[VoiceRoom] Adding audio track to peer', peerId, { enabled: track.enabled, readyState: track.readyState })
                pc.addTrack(track, audioStream)
            })
        }

        // If we're already screen sharing, add the video track too
        if (screenStreamRef.current) {
            const videoTrack = screenStreamRef.current.getVideoTracks()[0]
            if (videoTrack) {
                pc.addTrack(videoTrack, screenStreamRef.current)
            }
        }

        pc.ontrack = (event) => {
            const track = event.track
            const stream = event.streams[0] || new MediaStream([track])
            
            console.log('[VoiceRoom] ontrack from', peerId, { kind: track.kind, id: track.id, enabled: track.enabled, muted: track.muted, readyState: track.readyState })
            
            // Handle video track (screen share)
            if (track.kind === 'video') {
                // Skip if we already have this exact track (renegotiation fires ontrack again)
                if (remoteVideoTrackRef.current === track) {
                    console.log('[VoiceRoom] Same video track from', peerId, '- skipping')
                    return
                }
                console.log('[VoiceRoom] New video track from', peerId)
                remoteVideoTrackRef.current = track
                const videoStream = new MediaStream([track])
                remoteScreenStreamRef.current = videoStream
                setRemoteScreenStream(videoStream)
                setScreenSharerId(peerId)
                
                track.onended = () => {
                    console.log('[VoiceRoom] Video track ended')
                    remoteVideoTrackRef.current = null
                    remoteScreenStreamRef.current = null
                    setRemoteScreenStream(null)
                    setScreenSharerId(null)
                    setIsScreenFullscreen(false)
                }
                track.onmute = () => {
                    console.log('[VoiceRoom] Video track muted from', peerId)
                }
                track.onunmute = () => {
                    console.log('[VoiceRoom] Video track unmuted from', peerId)
                }
                return
            }
            
            // Handle audio track
            let audio = audioElementsRef.current.get(peerId)
            if (!audio) {
                audio = new Audio()
                audio.autoplay = true
                audioElementsRef.current.set(peerId, audio)
            }
            audio.srcObject = stream
            console.log('[VoiceRoom] Audio element for', peerId, {
                srcObject: !!audio.srcObject,
                autoplay: audio.autoplay,
                paused: audio.paused,
                muted: audio.muted,
                volume: audio.volume
            })
            audio.play().then(() => {
                console.log('[VoiceRoom] Audio playing for', peerId)
            }).catch(err => {
                console.error('[VoiceRoom] Audio play failed for', peerId, err)
            })

            try {
                const ctx = new AudioContext()
                console.log('[VoiceRoom] Remote AudioContext state for', peerId, ctx.state)
                if (ctx.state === 'suspended') {
                    ctx.resume().catch(() => {})
                }
                const source = ctx.createMediaStreamSource(stream)
                const analyser = ctx.createAnalyser()
                analyser.fftSize = 256
                source.connect(analyser)
                audioAnalysersRef.current.set(peerId, { analyser, ctx })
            } catch (err) {
                console.warn('Could not create analyser:', err)
            }
        }

        pc.onicecandidate = (event) => {
            if (!event.candidate) return
            if (isLocalMode()) {
                localServer.sendSignal(peerId, { candidate: event.candidate.toJSON() }, channelIdRef.current)
                return
            }
            if (signalingChannelRef.current) {
                signalingChannelRef.current.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: {
                        from: userId,
                        to: peerId,
                        data: { candidate: event.candidate.toJSON() },
                    },
                })
            }
        }

        peersRef.current.set(peerId, pc)
        return pc
    }

    const handleSignal = async (from: string, data: any) => {
        if (from === userId) return

        // Perfect negotiation: determine who is "polite" (rolls back) vs "impolite" (ignores)
        // Lower user ID is polite - rolls back on glare
        const isPolite = userId < from

        if (data.candidate) {
            const pc = peersRef.current.get(from)
            if (pc && pc.remoteDescription) {
                try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)) }
                catch (err) { console.warn('ICE error:', err) }
            }
        } else if (data.offer) {
            let pc = peersRef.current.get(from)
            if (!pc) {
                pc = createPeerConnection(from)
            }
            
            const state = pc.signalingState
            
            // Ignore offers if already have remote description (connection established or establishing)
            if (pc.remoteDescription) {
                console.log('[VoiceRoom] Ignoring stale offer - already have remote description from', from)
                return
            }
            
            if (state === 'stable') {
                // No local offer pending - accept remote offer
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.offer))
                    const answer = await pc.createAnswer()
                    await pc.setLocalDescription(answer)
                    
                    if (isLocalMode()) {
                        localServer.sendSignal(from, { answer }, channel.id)
                    } else {
                        signalingChannelRef.current?.send({
                            type: 'broadcast',
                            event: 'signal',
                            payload: { from: userId, to: from, data: { answer } },
                        })
                    }
                } catch (e) {
                    console.warn('[VoiceRoom] Failed to handle offer:', e)
                }
            } else if (state === 'have-local-offer') {
                // Glare: both sides sent offers simultaneously
                if (isPolite) {
                    // Polite peer rolls back and accepts remote offer
                    try {
                        await pc.setLocalDescription({ type: 'rollback' })
                        await pc.setRemoteDescription(new RTCSessionDescription(data.offer))
                        const answer = await pc.createAnswer()
                        await pc.setLocalDescription(answer)
                        
                        if (isLocalMode()) {
                            localServer.sendSignal(from, { answer }, channel.id)
                        } else {
                            signalingChannelRef.current?.send({
                                type: 'broadcast',
                                event: 'signal',
                                payload: { from: userId, to: from, data: { answer } },
                            })
                        }
                    } catch (e) {
                        console.warn('[VoiceRoom] Polite glare handling failed:', e)
                    }
                } else {
                    // Impolite peer ignores the offer - our offer stands
                    console.log('[VoiceRoom] Ignoring offer (impolite peer)')
                }
            } else if (state === 'have-remote-offer') {
                // Already handling an offer - ignore this one
                console.log('[VoiceRoom] Ignoring duplicate offer')
            }
        } else if (data.answer) {
            const pc = peersRef.current.get(from)
            if (pc && pc.signalingState === 'have-local-offer') {
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.answer))
                } catch (e) {
                    console.warn('[VoiceRoom] setRemoteDescription(answer) failed:', e)
                }
            } else if (pc && pc.signalingState === 'stable') {
                // Connection already established - ignore duplicate answer
                console.log('[VoiceRoom] Ignoring duplicate answer (already connected)')
            }
        }
    }

    // Trigger join animation when isConnected transitions to true
    useEffect(() => {
        if (isConnected && !wasConnectedRef.current) {
            setIsJoining(true)
            const timer = setTimeout(() => setIsJoining(false), 400)
            return () => clearTimeout(timer)
        }
        wasConnectedRef.current = isConnected
    }, [isConnected])

    const joinVoice = async () => {
        setIsConnecting(true)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1,
                },
                video: false,
            })
            localStreamRef.current = stream

            // Set up audio processing chain: mic → voice changer → mixer ← soundpad → peers
            try {
                const mixerCtx = new AudioContext({ sampleRate: 48000 })
                if (mixerCtx.state === 'suspended') {
                    await mixerCtx.resume().catch(() => {})
                }
                console.log('[VoiceRoom] AudioContext state:', mixerCtx.state)
                mixerCtxRef.current = mixerCtx
                const mixerDest = mixerCtx.createMediaStreamDestination()
                mixerDestRef.current = mixerDest

                // Voice changer
                const vcConfig = getVoiceChangerConfig()
                console.log('[VoiceRoom] Voice changer config:', vcConfig)
                if (vcConfig.enabled && vcConfig.effect !== 'none') {
                    const chain = createVoiceChangerChain(mixerCtx, stream, vcConfig.effect, vcConfig.intensity, mixerDest)
                    voiceChangerRef.current = chain
                    console.log('[VoiceRoom] Voice changer chain created')
                } else {
                    // Direct passthrough with gain control for muting
                    const source = mixerCtx.createMediaStreamSource(stream)
                    const passthroughGain = mixerCtx.createGain()
                    passthroughGain.gain.value = 1.0
                    source.connect(passthroughGain)
                    passthroughGain.connect(mixerDest)
                    passthroughSourceRef.current = source
                    passthroughGainRef.current = passthroughGain
                    console.log('[VoiceRoom] Direct passthrough connected with gain control')
                }

                // Soundpad gain node for mixing sound effects
                const spGain = mixerCtx.createGain()
                const spConfig = getSoundpadConfig()
                spGain.gain.value = spConfig.volume
                spGain.connect(mixerDest)
                soundpadGainRef.current = spGain

                processedStreamRef.current = mixerDest.stream
                console.log('[VoiceRoom] Processed stream created:', {
                    hasStream: !!mixerDest.stream,
                    audioTracks: mixerDest.stream.getAudioTracks().length,
                    trackStates: mixerDest.stream.getAudioTracks().map(t => ({ id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState }))
                })

                // Local analyser for speaking detection (use raw mic)
                const analyser = mixerCtx.createAnalyser()
                analyser.fftSize = 256
                const rawSource = mixerCtx.createMediaStreamSource(stream)
                localAnalyserSourceRef.current = rawSource
                rawSource.connect(analyser)
                localAnalyserRef.current = { analyser, ctx: mixerCtx }

                // Preload soundpad sounds
                const allSounds = getAllSounds()
                allSounds.forEach(s => preloadSound(s.path, mixerCtx))
            } catch (e) {
                console.error('[VoiceRoom] Audio processing chain setup failed, using raw stream:', e)
                processedStreamRef.current = stream
            }

            if (isLocalMode()) {
                const handleWsSignal = (payload: any) => {
                    if (payload.channelId !== channel.id) return
                    handleSignal(payload.fromUserId, payload.signal)
                }
                localServer.on('signal', handleWsSignal)
                localServer.joinVoice(channel.id)
                sounds.connect()
                // Request current participants before switching UI to the in-call state
                localServer.getVoiceParticipants(channel.id)
                onJoin()
                return
            }

            const sigChannel = supabase.channel(`voice-signal:${channel.id}`, {
                config: { broadcast: { self: false } },
            })

            sigChannel.on('broadcast', { event: 'signal' }, ({ payload }) => {
                if (payload.to === userId || !payload.to) {
                    handleSignal(payload.from, payload.data)
                }
            })

            // Listen for soundpad broadcasts from other participants
            sigChannel.on('broadcast', { event: 'soundpad' }, ({ payload }) => {
                if (payload.from !== userId && payload.soundId) {
                    handleRemoteSoundpadPlay(payload.soundId)
                }
            })

            await sigChannel.subscribe()
            signalingChannelRef.current = sigChannel

            await supabase.from('voice_sessions').upsert({
                channel_id: channel.id,
                user_id: userId,
                signal_data: null,
            }, { onConflict: 'channel_id,user_id' })

            sounds.connect()
            await fetchParticipants()

            // Apply voice settings immediately after joining
            syncVoiceSettingsRefs()
            if (voiceModeRef.current === 'push-to-talk') {
                stream.getAudioTracks().forEach(track => { track.enabled = false })
                setIsMuted(true)
            }

            const { data: existingSessions } = await supabase
                .from('voice_sessions')
                .select('user_id')
                .eq('channel_id', channel.id)
                .neq('user_id', userId)

            if (existingSessions) {
                for (const sess of existingSessions) {
                    const pc = createPeerConnection(sess.user_id)
                    const offer = await pc.createOffer()
                    await pc.setLocalDescription(offer)

                    sigChannel.send({
                        type: 'broadcast',
                        event: 'signal',
                        payload: { from: userId, to: sess.user_id, data: { offer } },
                    })
                }
            }

            // Switch UI to in-call only after we've finished joining setup
            onJoin()
        } catch (err) {
            console.error('Failed to join voice:', err)
            sounds.error()
        } finally {
            setIsConnecting(false)
        }
    }

    // Remote soundpad event handler - sound already arrives through WebRTC mixer
    // This is kept for potential UI sync (showing which sound is playing)
    const handleRemoteSoundpadPlay = async (_soundId: string) => {
        // No audio playback needed - the sound is already mixed into the
        // sender's WebRTC stream via soundpadGain → mixerDest
    }

    // Broadcast soundpad play event to other participants
    const broadcastSoundpadPlay = (soundId: string) => {
        signalingChannelRef.current?.send({
            type: 'broadcast',
            event: 'soundpad',
            payload: { from: userId, soundId },
        })
    }

    const cleanupVoice = useCallback(async () => {
        // Stop screen share if active
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop())
            screenStreamRef.current = null
        }
        setIsScreenSharing(false)

        // Stop local media
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop())
        }
        localStreamRef.current = null
        processedStreamRef.current = null
        hasJoinedRef.current = false // Reset flag para permitir reconectar

        // Clean up voice changer chain
        if (voiceChangerRef.current) {
            voiceChangerRef.current.cleanup()
            voiceChangerRef.current = null
        }
        if (passthroughSourceRef.current) {
            try { passthroughSourceRef.current.disconnect() } catch {}
            passthroughSourceRef.current = null
        }
        if (localAnalyserSourceRef.current) {
            try { localAnalyserSourceRef.current.disconnect() } catch {}
            localAnalyserSourceRef.current = null
        }
        soundpadGainRef.current = null
        mixerDestRef.current = null

        // Close mixer AudioContext (also closes localAnalyser since they share the context)
        if (mixerCtxRef.current) {
            try { mixerCtxRef.current.close() } catch {}
            mixerCtxRef.current = null
            localAnalyserRef.current = null
        }

        // Close peers
        peersRef.current.forEach(pc => pc.close())
        peersRef.current.clear()

        // Clean audio elements
        audioElementsRef.current.forEach(audio => {
            audio.pause()
            audio.srcObject = null
        })
        audioElementsRef.current.clear()

        // Clean analysers
        audioAnalysersRef.current.forEach(val => val.ctx.close())
        audioAnalysersRef.current.clear()
        if (localAnalyserRef.current) {
            try { localAnalyserRef.current.ctx.close() } catch {}
            localAnalyserRef.current = null
        }

        // Leave signaling
        if (signalingChannelRef.current) {
            supabase.removeChannel(signalingChannelRef.current)
            signalingChannelRef.current = null
        }

        // Update UI
        renderedParticipantsRef.current.clear()
        setParticipants(prev => prev.filter(p => p.id !== userId))
        setSpeakingUsers(new Set())

        // Leave voice session
        if (isLocalMode()) {
            localServer.leaveVoice(channelIdRef.current)
        } else {
            await supabase
                .from('voice_sessions')
                .delete()
                .eq('channel_id', channelIdRef.current)
                .eq('user_id', userId)
        }
    }, [userId])

    const leaveVoice = useCallback(async () => {
        // Start exit animation
        setIsExiting(true)
        
        // Wait for fade animation to complete
        await new Promise(resolve => setTimeout(resolve, 300))
        
        await cleanupVoice()
        sounds.disconnect()
        onLeave()
        setIsExiting(false)
    }, [cleanupVoice, onLeave])

    // Register disconnect callback for parent to call
    useEffect(() => {
        if (isConnected && onRegisterDisconnect) {
            onRegisterDisconnect(leaveVoice)
        }
    }, [isConnected, onRegisterDisconnect, leaveVoice])

    const toggleMute = () => {
        if (localStreamRef.current) {
            const newMuted = !isMuted
            localStreamRef.current.getAudioTracks().forEach(track => {
                track.enabled = !newMuted
            })
            // Also control passthrough gain for local monitoring
            if (passthroughGainRef.current) {
                passthroughGainRef.current.gain.value = newMuted ? 0 : 1
            }
            // And voice changer output if active
            if (voiceChangerRef.current?.outputGain) {
                voiceChangerRef.current.outputGain.gain.value = newMuted ? 0 : 1
            }
            newMuted ? sounds.mute() : sounds.unmute()
            setIsMuted(newMuted)
        }
    }

    const toggleDeafen = () => {
        const newDeafened = !isDeafened
        audioElementsRef.current.forEach(audio => { audio.muted = newDeafened })
        setIsDeafened(newDeafened)
        sounds.click()
    }

    const renegotiateWithPeer = async (peerId: string, pc: RTCPeerConnection) => {
        // Only create offer if in stable state
        if (pc.signalingState !== 'stable') {
            console.log('[VoiceRoom] Skipping renegotiation - not in stable state:', pc.signalingState)
            return
        }
        
        try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            if (isLocalMode()) {
                localServer.sendSignal(peerId, { offer }, channel.id)
            } else {
                signalingChannelRef.current?.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: { from: userId, to: peerId, data: { offer } },
                })
            }
        } catch (err) {
            console.error('Failed to renegotiate with', peerId, err)
        }
    }

    const startScreenShare = async (sourceId: string | null, framerate: 30 | 60) => {
        if (isScreenSharing) return
        try {
            let actualSourceId = sourceId
            
            if (!actualSourceId && window.screenAPI) {
                const result = await window.screenAPI.getSources()
                if (result.success && result.sources && result.sources.length > 0) {
                    const screen = result.sources.find(s => s.id.includes('screen')) || result.sources[0]
                    actualSourceId = screen.id
                }
            }
            
            if (!actualSourceId) {
                console.error('No screen source available')
                sounds.error()
                return
            }
            
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: actualSourceId,
                        maxFrameRate: framerate,
                    } as any,
                } as any,
                audio: false,
            })
            screenStreamRef.current = stream

            const videoTrack = stream.getVideoTracks()[0]
            if (!videoTrack) {
                console.warn('No video track in screen stream')
                stream.getTracks().forEach(t => t.stop())
                screenStreamRef.current = null
                return
            }

            // Add video track to all peers and renegotiate sequentially
            for (const [peerId, pc] of peersRef.current.entries()) {
                pc.addTrack(videoTrack, stream)
                await renegotiateWithPeer(peerId, pc)
            }

            videoTrack.onended = () => stopScreenShare()

            setIsScreenSharing(true)
            sounds.connect()
        } catch (err: any) {
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') return
            console.error('Failed to start screen share:', err)
            sounds.error()
        }
    }

    const stopScreenShare = async () => {
        if (!screenStreamRef.current) return
        screenStreamRef.current.getTracks().forEach(t => t.stop())
        screenStreamRef.current = null

        // Remove video senders and renegotiate sequentially
        for (const [peerId, pc] of peersRef.current.entries()) {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video' || (s.track === null && pc.getTransceivers().find(t => t.sender === s && t.mid !== null && t.receiver.track?.kind === 'video')))
            if (sender) {
                try { pc.removeTrack(sender) } catch { }
            }
            await renegotiateWithPeer(peerId, pc)
        }

        remoteVideoTrackRef.current = null
        remoteScreenStreamRef.current = null
        setRemoteScreenStream(null)
        setScreenSharerId(null)
        setIsScreenFullscreen(false)
        setIsScreenSharing(false)
        sounds.disconnect()
    }

    const toggleScreenShare = () => {
        if (isScreenSharing) {
            stopScreenShare()
        } else {
            setShowScreenShareModal(true)
        }
    }

    // Luma voice interaction
    const startListeningToLuma = async () => {
        const config = getLumaConfig()
        if (!config.enabled || !config.apiKey) {
            sounds.error()
            return
        }

        // Check if another user is already using Luma
        if (isVoiceCallLocked() && !lockVoiceCall(userId)) {
            sounds.error()
            return
        }

        // Cancel any running request from this user (same author can cancel)
        if (lumaAbortRef.current) {
            lumaAbortRef.current.abort()
            lumaAbortRef.current = null
        }
        // Stop any currently playing TTS audio
        if (lumaAudioRef.current) {
            lumaAudioRef.current.pause()
            lumaAudioRef.current.currentTime = 0
            lumaAudioRef.current = null
        }
        // Stop any running media recorder
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            try { mediaRecorderRef.current.stop() } catch { }
        }

        // Lock voice call for this user
        lockVoiceCall(userId)

        // Create new abort controller for this request
        const abortController = new AbortController()
        lumaAbortRef.current = abortController

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

            // Check if already aborted before we even started
            if (abortController.signal.aborted) {
                stream.getTracks().forEach(t => t.stop())
                return
            }

            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
            mediaRecorderRef.current = mediaRecorder
            audioChunksRef.current = []

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data)
                }
            }

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop())

                // If aborted, don't process
                if (abortController.signal.aborted) {
                    setLumaProcessing(false)
                    return
                }

                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })

                console.log('[Luma] Audio blob size:', audioBlob.size)

                setLumaProcessing(true)
                try {
                    // STT: Speech to text
                    const text = await speechToText(audioBlob)
                    console.log('[Luma] Transcribed text:', text)

                    if (!text.trim()) {
                        console.warn('[Luma] Empty transcription, skipping')
                        setLumaProcessing(false)
                        unlockVoiceCall(userId)
                        return
                    }

                    // Check abort after STT
                    if (abortController.signal.aborted) {
                        setLumaProcessing(false)
                        return
                    }

                    // Build voice context with participants
                    const participantNames = participants.map(p => p.username || 'Unknown')
                    const callerProfile = participants.find(p => p.id === userId)
                    const callerName = callerProfile?.username || 'User'

                    // AI: Generate response with voice context
                    // Check if we should use vision (screen share active + vision enabled)
                    const freshConfig = getLumaConfig()
                    const hasScreenShare = !!(remoteScreenStream || screenStreamRef.current)
                    const useVision = freshConfig.visionEnabled && hasScreenShare
                    let screenFrame: string | null = null

                    if (useVision) {
                        // Try to capture from remote screen share video element
                        if (screenVideoElRef.current) {
                            screenFrame = captureVideoFrame(screenVideoElRef.current)
                        }
                        // Fallback: capture from our own screen share stream
                        if (!screenFrame && screenStreamRef.current) {
                            const tempVideo = document.createElement('video')
                            tempVideo.srcObject = screenStreamRef.current
                            tempVideo.muted = true
                            await tempVideo.play().catch(() => {})
                            // Wait a frame for the video to render
                            await new Promise(r => setTimeout(r, 100))
                            screenFrame = captureVideoFrame(tempVideo)
                            tempVideo.pause()
                            tempVideo.srcObject = null
                        }
                        if (screenFrame) {
                            console.log('[Luma] Captured screen frame for vision')
                        }
                    }

                    const voiceCtx = {
                        channelName: channel.name,
                        participants: participantNames,
                        caller: callerName
                    }

                    console.log('[Luma] Sending prompt to AI:', text, useVision && screenFrame ? '(with vision)' : '')
                    const response = useVision && screenFrame
                        ? await askLumaWithVision(text, screenFrame, undefined, voiceCtx)
                        : await askLuma(text, undefined, voiceCtx)
                    console.log('[Luma] AI response:', response)

                    // Check abort after AI response
                    if (abortController.signal.aborted) {
                        setLumaProcessing(false)
                        return
                    }

                    // TTS: Text to speech
                    const audioUrl = await speakLuma(response)

                    // Check abort before playing
                    if (abortController.signal.aborted) {
                        setLumaProcessing(false)
                        return
                    }

                    // Play response (track the audio element for cancellation)
                    const audio = new Audio(audioUrl)
                    lumaAudioRef.current = audio
                    audio.onended = () => {
                        lumaAudioRef.current = null
                    }
                    audio.play()
                } catch (err: any) {
                    // Ignore abort errors
                    if (abortController.signal.aborted) {
                        setLumaProcessing(false)
                        return
                    }
                    console.error('[Luma] Voice error:', err)
                    sounds.error()
                    // Play error TTS message
                    try {
                        const errorAudioUrl = await speakLuma('Sorry, an error occurred while processing your request.')
                        const audio = new Audio(errorAudioUrl)
                        lumaAudioRef.current = audio
                        audio.play()
                    } catch { }
                }
                setLumaProcessing(false)
                unlockVoiceCall(userId)
            }

            mediaRecorder.start()
            setIsListeningToLuma(true)
        } catch (err) {
            console.error('Failed to start recording:', err)
            sounds.error()
            unlockVoiceCall(userId)
            lumaAbortRef.current = null
        }
    }

    const stopListeningToLuma = () => {
        if (mediaRecorderRef.current && isListeningToLuma) {
            mediaRecorderRef.current.stop()
            setIsListeningToLuma(false)
        }
    }

    // Global hotkey for Luma voice
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const config = getLumaConfig() // Read FRESH config on every keypress
            if (config.voiceMode === 'push-to-talk' && e.code === config.pushToTalkKey) {
                if (!isListeningToLuma && !lumaProcessing) {
                    startListeningToLuma()
                }
            }
        }

        const handleKeyUp = (e: KeyboardEvent) => {
            const config = getLumaConfig() // Read FRESH config on every keyrelease
            if (config.voiceMode === 'push-to-talk' && e.code === config.pushToTalkKey) {
                stopListeningToLuma()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
        }
    }, [isListeningToLuma, lumaProcessing])

    // Global hotkey for microphone push-to-talk — reads from refs to avoid stale closures
    useEffect(() => {
        const applyVoiceSettings = () => {
            syncVoiceSettingsRefs()

            // Apply initial state based on mode when connected
            if (isConnected && localStreamRef.current) {
                const tracks = localStreamRef.current.getAudioTracks()
                if (voiceModeRef.current === 'push-to-talk') {
                    // In push-to-talk mode, start muted (user must press key to talk)
                    tracks.forEach(track => { track.enabled = false })
                    setIsMuted(true)
                } else {
                    // In voice-activity mode, start unmuted
                    tracks.forEach(track => { track.enabled = true })
                    setIsMuted(false)
                }
            }
        }

        applyVoiceSettings()

        // Listen for settings changes
        window.addEventListener('voice-settings-changed', applyVoiceSettings)

        // Key handlers read from REFS (always up to date)
        const handleKeyDown = (e: KeyboardEvent) => {
            if (voiceModeRef.current === 'push-to-talk' && e.code === pushToTalkKeyRef.current) {
                if (isMutedRef.current && localStreamRef.current) {
                    localStreamRef.current.getAudioTracks().forEach(track => { track.enabled = true })
                    setIsMuted(false)
                }
            }
        }

        const handleKeyUp = (e: KeyboardEvent) => {
            if (voiceModeRef.current === 'push-to-talk' && e.code === pushToTalkKeyRef.current) {
                if (!isMutedRef.current && localStreamRef.current) {
                    localStreamRef.current.getAudioTracks().forEach(track => { track.enabled = false })
                    setIsMuted(true)
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)

        return () => {
            window.removeEventListener('voice-settings-changed', applyVoiceSettings)
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
        }
    }, [isConnected, syncVoiceSettingsRefs])

    // Cleanup on unmount - only runs if still connected
    useEffect(() => {
        return () => {
            // Only cleanup if there's an active stream
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(t => t.stop())
                localStreamRef.current = null

                peersRef.current.forEach(pc => pc.close())
                peersRef.current.clear()

                audioElementsRef.current.forEach(a => { a.pause(); a.srcObject = null })
                audioElementsRef.current.clear()

                audioAnalysersRef.current.forEach(v => v.ctx.close())
                audioAnalysersRef.current.clear()

                if (signalingChannelRef.current) {
                    supabase.removeChannel(signalingChannelRef.current)
                    signalingChannelRef.current = null
                }

                // Leave voice session
                if (isLocalMode()) {
                    localServer.leaveVoice(channelIdRef.current)
                } else {
                    // Delete session via fetch (keepalive para funcionar mesmo durante unmount)
                    const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/voice_sessions?channel_id=eq.${channelIdRef.current}&user_id=eq.${userId}`
                    fetch(url, {
                        method: 'DELETE',
                        headers: {
                            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                        },
                        keepalive: true,
                    }).catch(() => { })
                }
            }
        }
    }, [userId])

    // Page unload cleanup - full disconnect on app close/reload
    useEffect(() => {
        const handleUnload = () => {
            if (!isConnected) return

            // Stop all media
            screenStreamRef.current?.getTracks().forEach(t => t.stop())
            localStreamRef.current?.getTracks().forEach(t => t.stop())

            // Close all peer connections
            peersRef.current.forEach(pc => pc.close())
            peersRef.current.clear()

            // Clean audio elements
            audioElementsRef.current.forEach(audio => {
                audio.pause()
                audio.srcObject = null
            })
            audioElementsRef.current.clear()

            // Remove signaling channel
            if (signalingChannelRef.current) {
                supabase.removeChannel(signalingChannelRef.current)
                signalingChannelRef.current = null
            }

            // Leave voice session
            if (localServer.isConnected()) {
                localServer.leaveVoice(channelIdRef.current)
            } else {
                // Delete voice session via fetch with keepalive (works during unload)
                const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/voice_sessions?channel_id=eq.${channelIdRef.current}&user_id=eq.${userId}`
                fetch(url, {
                    method: 'DELETE',
                    headers: {
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    },
                    keepalive: true,
                }).catch(() => { })
            }
        }
        window.addEventListener('beforeunload', handleUnload)

        // Electron: listen for app close event from main process
        let removeElectronListener: (() => void) | null = null
        if ((window as any).electronAPI?.onBeforeClose) {
            removeElectronListener = (window as any).electronAPI.onBeforeClose(handleUnload)
        }

        return () => {
            window.removeEventListener('beforeunload', handleUnload)
            removeElectronListener?.()
        }
    }, [isConnected, userId])

    const showEmpty = participants.length === 0 && !isConnected && !isExiting
    const showConnected = !showEmpty

    return (
        <>
            <div className="main-header">
                <div className="main-header__icon">
                    <Volume2 size={20} />
                </div>
                <div className="main-header__title">{channel.name}</div>
                <div className={`voice-connected-badge ${isConnected ? '' : 'voice-connected-badge--hidden'}`}>
                    <span className="status-dot status-dot--call" />
                    Connected
                </div>
            </div>

            <div className="voice-room">
                {/* Connecting loading state */}
                {isConnecting && (
                    <div className="voice-room__loading">
                        <div className="voice-room__loading-spinner" />
                        <div className="voice-room__loading-text">Connecting to voice...</div>
                    </div>
                )}

                {/* Empty state - always rendered, toggled with CSS */}
                <div className={`empty-state empty-state--overlay ${showEmpty && !isConnecting ? '' : 'empty-state--hidden'}`}>
                    <div className="empty-state__icon">
                        <Headphones />
                    </div>
                    <div className="empty-state__title">No one is here</div>
                    <div className="empty-state__desc">
                        Join the voice channel to start talking
                    </div>
                    <button className="btn btn--primary btn--join-voice" onClick={joinVoice}>
                        <Phone size={16} /> Join Voice
                    </button>
                </div>

                {/* Connected state - always rendered, toggled with CSS */}
                <div className={`voice-room__center ${showConnected && !isConnecting ? '' : 'voice-room__center--hidden'} ${isExiting ? 'voice-room__center--exiting' : ''} ${isJoining ? 'voice-room__center--joining' : ''}`}>
                    <div className="voice-room__participants">
                        {participants.map(participant => {
                            const isSpeaking = speakingUsers.has(participant.id)
                            const isMe = participant.id === userId
                            const isNew = !renderedParticipantsRef.current.has(participant.id)
                            if (isNew) renderedParticipantsRef.current.add(participant.id)
                            // Get decoration from localStorage for current user, or from participant data
                            const decoration = isMe 
                                ? (localStorage.getItem('luma_user_avatar_decoration') || 'none')
                                : (participant as any).decoration || 'none'
                            // Get border from participant data for other users
                            const userBorder = isMe 
                                ? (localStorage.getItem('luma_user_panel_border') || 'none')
                                : (participant as any).border || 'none'
                            // Get name color from participant data
                            const nameColor = isMe 
                                ? (localStorage.getItem('luma_user_name_color') || 'default')
                                : (participant as any).name_color || 'default'
                            // Get name font from participant data
                            const nameFont = isMe 
                                ? (localStorage.getItem('luma_user_name_font') || 'default')
                                : (participant as any).name_font || 'default'
                            const localAvatar = isMe ? localStorage.getItem('luma_user_avatar') : null
                            const avatarUrl = localAvatar || participant.avatar_url
                            
                            return (
                                <div key={participant.id} className={`voice-participant-wrapper${isNew ? ' enter' : ''}`}>
                                    <div className="voice-participant-circle">
                                        <div className={`avatar avatar--lg avatar-decoration avatar-decoration--${decoration}`}>
                                            {avatarUrl ? (
                                                <img 
                                                    src={avatarUrl} 
                                                    alt={participant.username || 'Avatar'} 
                                                    className="avatar__image"
                                                />
                                            ) : (
                                                participant.username?.charAt(0) || '?'
                                            )}
                                        </div>
                                        {isSpeaking && <div className="speaking-ring" />}
                                    </div>
                                    <div
                                        className="voice-participant__name"
                                        style={{
                                            color: nameColor !== 'default' ? getNameColorValue(nameColor) : undefined,
                                            fontFamily: nameFont !== 'default' ? getNameFontValue(nameFont) : undefined,
                                            fontSize: `calc(1em * ${getNameFontScale(nameFont)})`,
                                        }}
                                    >{participant.username}</div>
                                    <div className="voice-participant__status">
                                        {isMe && isMuted ? (
                                            <><MicOff size={12} /> Muted</>
                                        ) : isSpeaking ? (
                                            <><Mic size={12} style={{ color: 'var(--green)' }} /> Speaking</>
                                        ) : (
                                            <><Mic size={12} /> Silent</>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                        {[...participantsCacheRef.current.entries()]
                            .filter(([id]) => !participants.find(p => p.id === id))
                            .map(([id, participant]) => (
                                <div key={id} className="voice-participant-wrapper exit">
                                    <div className="voice-participant-circle">
                                        <div className="avatar avatar--lg">
                                            {participant.avatar_url ? (
                                                <img 
                                                    src={participant.avatar_url} 
                                                    alt={participant.username || 'Avatar'} 
                                                    className="avatar__image"
                                                />
                                            ) : (
                                                participant.username?.charAt(0) || '?'
                                            )}
                                        </div>
                                    </div>
                                    <div 
                                        className="voice-participant__name"
                                        style={{ 
                                            color: (participant as any).name_color && (participant as any).name_color !== 'default' 
                                                ? getNameColorValue((participant as any).name_color) : undefined,
                                            fontFamily: (participant as any).name_font && (participant as any).name_font !== 'default' 
                                                ? getNameFontValue((participant as any).name_font) : undefined,
                                        }}
                                    >{participant.username}</div>
                                </div>
                            ))
                        }
                    </div>
                    {/* Remote screen share display */}
                    {remoteScreenStream && (
                        <div className={`screen-share-view ${isScreenFullscreen ? 'screen-share-view--fullscreen' : ''}`}>
                            <video
                                ref={el => {
                                    screenVideoElRef.current = el
                                    if (el && el.srcObject !== remoteScreenStream) {
                                        el.srcObject = remoteScreenStream
                                    }
                                }}
                                autoPlay
                                playsInline
                                className="screen-share-video"
                            />
                            <div className="screen-share-view__controls">
                                <span className="screen-share-label">Screen share</span>
                                <button
                                    className="screen-share-view__fullscreen-btn"
                                    onClick={() => setIsScreenFullscreen(f => !f)}
                                    title={isScreenFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                                >
                                    {isScreenFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Controls - always rendered, swap between connected/disconnected */}
                    <div className="voice-actions">
                        <div className={`voice-controls ${isConnected ? '' : 'voice-controls--hidden'}`}>
                            <button
                                className={`btn btn--icon btn--voice-ctrl ${isMuted ? 'muted' : ''}`}
                                onClick={toggleMute}
                                title={isMuted ? 'Unmute' : 'Mute'}
                            >
                                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                            </button>
                            <button
                                className={`btn btn--icon btn--voice-ctrl ${isDeafened ? 'muted' : ''}`}
                                onClick={toggleDeafen}
                                title={isDeafened ? 'Undeafen' : 'Deafen'}
                            >
                                {isDeafened ? <VolumeX size={20} /> : <Volume2 size={20} />}
                            </button>
                            <button
                                className={`btn btn--icon btn--voice-ctrl ${isListeningToLuma ? 'luma-active' : ''}`}
                                onMouseDown={startListeningToLuma}
                                onMouseUp={stopListeningToLuma}
                                onMouseLeave={stopListeningToLuma}
                                disabled={lumaProcessing}
                                title="Hold to talk to Luma AI"
                            >
                                {lumaProcessing ? <Loader2 size={20} className="spin" /> : <Bot size={20} />}
                            </button>
                            <button
                                className={`btn btn--icon btn--voice-ctrl ${isScreenSharing ? 'screen-active' : ''}`}
                                onClick={toggleScreenShare}
                                title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
                            >
                                {isScreenSharing ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
                            </button>
                            <button
                                className="btn btn--icon btn--disconnect"
                                onClick={leaveVoice}
                                title="Disconnect"
                            >
                                <PhoneOff size={20} />
                            </button>
                        </div>
                        <button className={`btn btn--primary btn--join-voice ${isConnected ? 'btn--join-voice--hidden' : ''}`} onClick={joinVoice}>
                            <Phone size={18} />
                            Join Voice
                        </button>
                    </div>
                </div>

                {/* Soundpad - positioned relative to voice-room, not voice-room__center */}
                <div className={`soundpad-wrapper ${isConnected ? '' : 'soundpad-wrapper--hidden'}`}>
                    <SoundpadPanel
                        audioContext={mixerCtxRef.current}
                        destination={soundpadGainRef.current}
                        onPlaySound={broadcastSoundpadPlay}
                    />
                </div>
            </div>

            <div className="voice-controls-placeholder" />

            <ScreenShareModal
                isOpen={showScreenShareModal}
                onClose={() => setShowScreenShareModal(false)}
                onStartShare={startScreenShare}
            />
        </>
    )
}

export default VoiceRoom
