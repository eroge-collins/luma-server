import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { Channel, Message } from '../lib/types'
import { localServer, type LocalMessage } from '../lib/local-server'
import { sounds } from '../lib/sounds'
import { askLuma, getLumaConfig, saveLumaMessage, getLumaMessages, speakLuma, clearLumaMessages } from '../lib/luma'
import { searchTracks, getTrackStreamUrl, Track, formatDuration, checkMusicAvailable } from '../lib/music'
import { Hash, Send, MessageSquare, Bot, Loader2, Volume2, Trash2, Music, Play, Search, ImagePlus, X, Youtube, ExternalLink, Smile, Mic, MicOff, Pause } from 'lucide-react'
import UserProfilePopup from './UserProfilePopup'

interface ChatViewProps {
    channel: Channel
    userId: string
    voiceChannelId?: string | null
}

const EMOJIS = [
    '😀','😁','😂','🤣','😅','😊','😍','😘','😎','🤔','😴','😭','😡','🤯','👍','👎','👏','🙏','💪','🔥','💯','🎉','✨','❤️','💔','⭐','⚡','☕','🍕','🎵','🎮','🚀','🧠','👀','✅','❌','⚠️','','😮','😬','😤','😇','🤩','😈','👑','💎','🕺','💃'
]

// Detect video URLs in message content
const detectVideoUrl = (content: string): string | null => {
    const patterns = [
        // YouTube
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/,
        /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]+)/,
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
        // Vimeo
        /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/,
        // Twitch
        /(?:https?:\/\/)?(?:www\.)?twitch\.tv\/videos\/(\d+)/,
        /(?:https?:\/\/)?(?:www\.)?twitch\.tv\/clip\/([a-zA-Z0-9_-]+)/,
    ]
    
    for (const pattern of patterns) {
        const match = content.match(pattern)
        if (match) {
            return match[0]
        }
    }
    return null
}

// Extract video info from URL
const getVideoInfo = (url: string): { type: 'youtube' | 'vimeo' | 'twitch'; id: string } | null => {
    // YouTube
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/)
    if (ytMatch) return { type: 'youtube', id: ytMatch[1] }
    
    // Vimeo
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/)
    if (vimeoMatch) return { type: 'vimeo', id: vimeoMatch[1] }
    
    // Twitch
    const twitchMatch = url.match(/twitch\.tv\/videos\/(\d+)/)
    if (twitchMatch) return { type: 'twitch', id: twitchMatch[1] }
    
    return null
}

// Message Image component with loading skeleton and retry logic
const MessageImage = ({ src }: { src: string }) => {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [retryCount, setRetryCount] = useState(0)
    const [imgSrc, setImgSrc] = useState(src)
    const MAX_RETRIES = 3
    
    // Reset state when src changes
    useEffect(() => {
        setLoading(true)
        setError(false)
        setRetryCount(0)
        setImgSrc(src)
    }, [src])

    const handleError = () => {
        if (retryCount < MAX_RETRIES) {
            // Retry with cache-busting parameter
            const separator = src.includes('?') ? '&' : '?'
            setRetryCount(prev => prev + 1)
            setImgSrc(`${src}${separator}_retry=${retryCount + 1}&t=${Date.now()}`)
        } else {
            setLoading(false)
            setError(true)
        }
    }

    const handleRetryClick = () => {
        setError(false)
        setLoading(true)
        setRetryCount(0)
        const separator = src.includes('?') ? '&' : '?'
        setImgSrc(`${src}${separator}_force=${Date.now()}`)
    }

    const isGif = src.toLowerCase().includes('.gif')
    
    return (
        <div className="message__image">
            {loading && (
                <div className="message__image-skeleton">
                    <div className="skeleton-pulse" />
                </div>
            )}
            {error ? (
                <div className="message__image-error" onClick={handleRetryClick} style={{ cursor: 'pointer' }}>
                    <ImagePlus size={24} />
                    <span>Failed to load image - click to retry</span>
                </div>
            ) : (
                <img 
                    src={imgSrc} 
                    alt="Attached image" 
                    loading={isGif ? 'eager' : 'lazy'}
                    decoding={isGif ? 'sync' : 'async'}
                    onLoad={() => setLoading(false)}
                    onError={handleError}
                    style={{ display: loading ? 'none' : 'block' }}
                />
            )}
        </div>
    )
}

// Audio Message component with inline player
const MessageAudio = ({ src }: { src: string }) => {
    const [playing, setPlaying] = useState(false)
    const [progress, setProgress] = useState(0)
    const [duration, setDuration] = useState(0)
    const [currentTime, setCurrentTime] = useState(0)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        const audio = new Audio()
        audio.preload = 'metadata'
        audioRef.current = audio

        const updateDuration = () => {
            if (audio.duration && isFinite(audio.duration)) {
                setDuration(audio.duration)
            }
        }

        // WebM often reports Infinity duration initially — workaround: seek to end
        const handleLoaded = () => {
            updateDuration()
            if (!isFinite(audio.duration)) {
                audio.currentTime = 1e10
                audio.addEventListener('timeupdate', function seekBack() {
                    audio.removeEventListener('timeupdate', seekBack)
                    updateDuration()
                    audio.currentTime = 0
                })
            }
        }

        audio.addEventListener('loadedmetadata', handleLoaded)
        audio.addEventListener('durationchange', updateDuration)
        audio.addEventListener('timeupdate', () => {
            setCurrentTime(audio.currentTime)
            if (audio.duration && isFinite(audio.duration)) {
                setProgress(audio.currentTime / audio.duration)
            }
        })
        audio.addEventListener('ended', () => { setPlaying(false); setProgress(0); setCurrentTime(0) })
        audio.src = src
        return () => { audio.pause(); audio.removeAttribute('src'); audio.load() }
    }, [src])

    const toggle = () => {
        if (!audioRef.current) return
        if (playing) { audioRef.current.pause() } else { audioRef.current.play() }
        setPlaying(!playing)
    }

    const seek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioRef.current || !duration || !isFinite(duration)) return
        const rect = e.currentTarget.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        audioRef.current.currentTime = ratio * duration
        setProgress(ratio)
    }

    const fmt = (s: number) => {
        if (!s || !isFinite(s)) return '0:00'
        const m = Math.floor(s / 60)
        const sec = Math.floor(s % 60)
        return `${m}:${sec.toString().padStart(2, '0')}`
    }

    return (
        <div className="message__audio">
            <button type="button" className="message__audio-play" onClick={toggle}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <div className="message__audio-track" onClick={seek}>
                <div className="message__audio-progress" style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="message__audio-time">{fmt(playing ? currentTime : duration)}</span>
        </div>
    )
}

// Pending audio player for recorded voice messages before sending
const PendingAudioPlayer = ({ url, duration, onSend, onDiscard, uploading }: {
    url: string; duration: number; onSend: () => void; onDiscard: () => void; uploading: boolean
}) => {
    const [playing, setPlaying] = useState(false)
    const [progress, setProgress] = useState(0)
    const [currentTime, setCurrentTime] = useState(0)
    const [resolvedDuration, setResolvedDuration] = useState(duration)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        const audio = new Audio()
        audio.preload = 'metadata'
        audioRef.current = audio

        const updateDur = () => {
            if (audio.duration && isFinite(audio.duration)) setResolvedDuration(audio.duration)
        }
        const handleLoaded = () => {
            updateDur()
            if (!isFinite(audio.duration)) {
                audio.currentTime = 1e10
                audio.addEventListener('timeupdate', function seekBack() {
                    audio.removeEventListener('timeupdate', seekBack)
                    updateDur()
                    audio.currentTime = 0
                })
            }
        }
        audio.addEventListener('loadedmetadata', handleLoaded)
        audio.addEventListener('durationchange', updateDur)
        audio.addEventListener('timeupdate', () => {
            setCurrentTime(audio.currentTime)
            if (audio.duration && isFinite(audio.duration)) setProgress(audio.currentTime / audio.duration)
        })
        audio.addEventListener('ended', () => { setPlaying(false); setProgress(0); setCurrentTime(0) })
        audio.src = url
        return () => { audio.pause(); audio.removeAttribute('src'); audio.load() }
    }, [url])

    const toggle = () => {
        if (!audioRef.current) return
        if (playing) audioRef.current.pause(); else audioRef.current.play()
        setPlaying(!playing)
    }

    const seek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioRef.current || !resolvedDuration || !isFinite(resolvedDuration)) return
        const rect = e.currentTarget.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        audioRef.current.currentTime = ratio * resolvedDuration
        setProgress(ratio)
    }

    const fmt = (s: number) => {
        if (!s || !isFinite(s)) return '0:00'
        const m = Math.floor(s / 60); const sec = Math.floor(s % 60)
        return `${m}:${sec.toString().padStart(2, '0')}`
    }

    return (
        <div className="pending-audio-preview">
            <div className="pending-audio-preview__info">
                <Mic size={14} />
                <span>Voice message</span>
            </div>
            <div className="pending-audio-preview__waveform">
                <button type="button" className="pending-audio-preview__play" onClick={toggle}>
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <div className="pending-audio-preview__track" onClick={seek}>
                    <div className="pending-audio-preview__progress" style={{ width: `${progress * 100}%` }} />
                </div>
                <span className="pending-audio-preview__time">{fmt(playing ? currentTime : resolvedDuration)}</span>
            </div>
            <div className="pending-audio-preview__actions">
                <button type="button" className="btn btn--sm btn--primary" onClick={onSend} disabled={uploading}>
                    {uploading ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Send
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={onDiscard}>
                    <X size={14} />
                </button>
            </div>
        </div>
    )
}

// Detect if a URL points to an audio file
const isAudioUrl = (url: string): boolean => {
    if (!url) return false
    const lower = url.toLowerCase()
    return lower.endsWith('.webm') || lower.endsWith('.ogg') || lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.m4a')
}

// Video Preview component
const VideoPreview = ({ url }: { url: string }) => {
    const videoInfo = getVideoInfo(url)
    const [expanded, setExpanded] = useState(false)
    
    if (!videoInfo) return null
    
    const getThumbnail = () => {
        if (videoInfo.type === 'youtube') {
            return `https://img.youtube.com/vi/${videoInfo.id}/hqdefault.jpg`
        }
        return null
    }
    
    const thumbnail = getThumbnail()
    
    return (
        <div className="video-preview">
            {expanded ? (
                <div className="video-preview__embed">
                    {videoInfo.type === 'youtube' && (
                        <iframe
                            src={`https://www.youtube.com/embed/${videoInfo.id}?autoplay=1`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    )}
                    {videoInfo.type === 'vimeo' && (
                        <iframe
                            src={`https://player.vimeo.com/video/${videoInfo.id}?autoplay=1`}
                            allow="autoplay; fullscreen; picture-in-picture"
                            allowFullScreen
                        />
                    )}
                    {videoInfo.type === 'twitch' && (
                        <iframe
                            src={`https://player.twitch.tv/?video=${videoInfo.id}&parent=localhost`}
                            allowFullScreen
                        />
                    )}
                </div>
            ) : (
                <div className="video-preview__thumbnail" onClick={() => setExpanded(true)}>
                    {thumbnail ? (
                        <>
                            <img src={thumbnail} alt="Video thumbnail" />
                            <div className="video-preview__play">
                                <Play size={32} />
                            </div>
                        </>
                    ) : (
                        <div className="video-preview__placeholder">
                            <Youtube size={32} />
                        </div>
                    )}
                    <a 
                        href={url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="video-preview__link"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <ExternalLink size={14} />
                    </a>
                </div>
            )}
        </div>
    )
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

function ChatView({ channel, userId, voiceChannelId }: ChatViewProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(true)
    const [newMessage, setNewMessage] = useState('')
    const [lumaLoading, setLumaLoading] = useState(false)
    const [speakLoading, setSpeakLoading] = useState(false)
    const [commandSuggestions, setCommandSuggestions] = useState<{ cmd: string; desc: string; insert: string }[]>([])
    const [musicSearchResults, setMusicSearchResults] = useState<Track[]>([])
    const [musicSearching, setMusicSearching] = useState(false)
    const [musicAvailable, setMusicAvailable] = useState(false)
    const [currentMusicTrack, setCurrentMusicTrack] = useState<Track | null>(null)
    const [musicQueue, setMusicQueue] = useState<Track[]>([])
    const [isMusicPlaying, setIsMusicPlaying] = useState(false)
    const [isMusicPaused, setIsMusicPaused] = useState(false)
    const [musicVolume, setMusicVolume] = useState(0.5)
    const [musicLoading, setMusicLoading] = useState(false)
    const [messageHistory, setMessageHistory] = useState<string[]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)
    const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null)
    const [uploadingImage, setUploadingImage] = useState(false)
    const [showEmojiPicker, setShowEmojiPicker] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
    const [recordingDuration, setRecordingDuration] = useState(0)
    const [pendingAudio, setPendingAudio] = useState<{ blob: Blob; url: string; duration: number } | null>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const recordingStreamRef = useRef<MediaStream | null>(null)
    const [profilePopup, setProfilePopup] = useState<{
        username: string; avatarUrl: string | null; decoration: string; border: string;
        nameColor: string; nameFont: string; status?: string; position: { x: number; y: number }
    } | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const emojiPickerRef = useRef<HTMLDivElement>(null)
    const musicAudioRef = useRef<HTMLAudioElement | null>(null)
    const renderedMsgIdsRef = useRef<Set<string>>(new Set())

    // Local username state that syncs with localStorage
    const [localUsername, setLocalUsername] = useState(() => localStorage.getItem('luma_user_username') || '')

    useEffect(() => {
        const syncLocalUsername = () => {
            setLocalUsername(localStorage.getItem('luma_user_username') || '')
        }
        window.addEventListener('storage', syncLocalUsername)
        window.addEventListener('avatar-updated', syncLocalUsername as any)
        return () => {
            window.removeEventListener('storage', syncLocalUsername)
            window.removeEventListener('avatar-updated', syncLocalUsername as any)
        }
    }, [])

    useEffect(() => {
        if (!showEmojiPicker) return

        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node | null
            if (!target) return
            if (emojiPickerRef.current && emojiPickerRef.current.contains(target)) return
            setShowEmojiPicker(false)
        }

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowEmojiPicker(false)
                inputRef.current?.focus()
            }
        }

        document.addEventListener('mousedown', onMouseDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [showEmojiPicker])

    const insertEmoji = (emoji: string) => {
        const el = inputRef.current
        if (!el) {
            setNewMessage(prev => prev + emoji)
            return
        }

        const start = el.selectionStart ?? newMessage.length
        const end = el.selectionEnd ?? newMessage.length
        const next = newMessage.slice(0, start) + emoji + newMessage.slice(end)
        setNewMessage(next)

        requestAnimationFrame(() => {
            el.focus()
            const caret = start + emoji.length
            el.setSelectionRange(caret, caret)
        })
    }

    useEffect(() => {
        // Skip Supabase realtime when using local server - profiles come via WebSocket
        if (localServer.isConnected()) {
            const handleProfileUpdate = (data: any) => {
                const updated = data.user
                if (!updated?.id) return
                setMessages(prev => prev.map(m => {
                    if (m.user_id === updated.id && m.profiles) {
                        return {
                            ...m,
                            profiles: {
                                ...m.profiles,
                                username: updated.username ?? m.profiles.username,
                                avatar_url: updated.avatar_url ?? m.profiles.avatar_url,
                                decoration: updated.decoration ?? (m.profiles as any).decoration,
                                border: updated.border ?? (m.profiles as any).border,
                                name_color: updated.name_color ?? (m.profiles as any).name_color,
                                name_font: updated.name_font ?? (m.profiles as any).name_font,
                            } as any,
                        }
                    }
                    return m
                }))
            }
            localServer.on('profile-updated', handleProfileUpdate)
            return () => { localServer.off('profile-updated', handleProfileUpdate) }
        }

        const sub = supabase
            .channel(`profiles-updates:${channel.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'profiles',
                },
                (payload: any) => {
                    const updated = payload?.new
                    if (!updated?.id) return
                    setMessages(prev => prev.map(m => {
                        if (m.user_id === updated.id && m.profiles) {
                            return {
                                ...m,
                                profiles: {
                                    ...m.profiles,
                                    username: updated.username ?? m.profiles.username,
                                    avatar_url: updated.avatar_url ?? m.profiles.avatar_url,
                                    decoration: updated.decoration ?? (m.profiles as any).decoration,
                                    border: updated.border ?? (m.profiles as any).border,
                                    name_color: updated.name_color ?? (m.profiles as any).name_color,
                                    name_font: updated.name_font ?? (m.profiles as any).name_font,
                                } as any,
                            }
                        }
                        return m
                    }))
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(sub)
        }
    }, [channel.id])

    const persistMessage = async (content: string, imageUrl?: string | null) => {
        if (localServer.isConnected()) {
            localServer.sendMessage(channel.id, content, imageUrl)
            return
        }
        await supabase.from('messages').insert({
            channel_id: channel.id,
            user_id: userId,
            content,
            image_url: imageUrl,
        })
    }

    const parseMusicBotDbContent = (content: string) => {
        const prefix = '[MUSIC_BOT]['
        if (!content.startsWith(prefix)) return null
        const end = content.indexOf('] ', prefix.length)
        if (end === -1) return null
        const clientId = content.slice(prefix.length, end)
        const text = content.slice(end + 2)
        return { clientId, text }
    }

    const stripLegacyMusicBotPrefix = (content: string) => {
        if (!content.startsWith('[MUSIC_BOT] ')) return null
        return { text: content.replace('[MUSIC_BOT] ', '') }
    }

    const normalizeMessage = (msg: Message): Message => {
        const parsed = parseMusicBotDbContent(msg.content)
        if (parsed) {
            return {
                ...msg,
                user_id: 'music-bot',
                content: parsed.text,
                profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' } as any,
            }
        }

        const legacy = stripLegacyMusicBotPrefix(msg.content)
        if (legacy) {
            return {
                ...msg,
                user_id: 'music-bot',
                content: legacy.text,
                profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' } as any,
            }
        }

        if (msg.content.startsWith('[LUMA] ')) {
            return {
                ...msg,
                user_id: 'luma',
                content: msg.content.slice(7),
                profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' } as any,
            }
        }

        return msg
    }

    const toMessage = (m: LocalMessage): Message => {
        return {
            id: m.id,
            channel_id: m.channel_id,
            user_id: m.user_id,
            content: m.content,
            created_at: m.created_at,
            image_url: m.image_url,
            profiles: m.user
                ? {
                      id: m.user.id,
                      username: m.user.username,
                      avatar_url: m.user.avatar_url,
                      status: m.user.status,
                      created_at: m.created_at,
                      decoration: (m.user as any).decoration,
                      border: (m.user as any).border,
                      name_color: (m.user as any).name_color,
                      name_font: (m.user as any).name_font,
                  }
                : undefined,
        }
    }

    // Upload image to Supabase Storage
    const uploadImage = async (file: File): Promise<{ url: string | null; error?: string }> => {
        try {
            const nameParts = (file.name || '').split('.')
            const extFromName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''
            const fileExt = (extFromName || (file.type?.split('/')[1] ?? '') || 'png').toLowerCase()
            const fileName = `${userId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${fileExt}`

            const contentType = file.type || `application/octet-stream`

            const { error } = await supabase.storage
                .from('chat-images')
                .upload(fileName, file, { contentType, upsert: false })

            if (error) {
                console.error('[Chat] Upload error:', error)
                return { url: null, error: error.message || 'Upload failed' }
            }

            const { data } = supabase.storage
                .from('chat-images')
                .getPublicUrl(fileName)

            return { url: data.publicUrl }
        } catch (e) {
            console.error('[Chat] Upload exception:', e)
            return { url: null, error: e instanceof Error ? e.message : 'Upload failed' }
        }
    }

    // Handle image selection
    const handleImageSelect = (file: File) => {
        const ext = (file.name || '').split('.').pop()?.toLowerCase() || ''
        const isImageByType = !!file.type && file.type.startsWith('image/')
        const isImageByExt = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)
        if (!isImageByType && !isImageByExt) return
        if (file.size > 25 * 1024 * 1024) {
            setMessages(prev => [...prev, {
                id: `upload-error-${Date.now()}`,
                channel_id: channel.id,
                user_id: 'luma',
                content: `Error: image too large (${Math.round(file.size / (1024 * 1024))}MB). Max is 25MB. (${file.name || 'file'} | ${file.type || 'unknown'})`,
                created_at: new Date().toISOString(),
                profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' },
            } as any])
            return
        }
        
        const preview = URL.createObjectURL(file)
        setPendingImage({ file, preview })
    }

    // Handle paste event
    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault()
                const file = item.getAsFile()
                if (file) handleImageSelect(file)
                break
            }
        }
    }

    // Clear pending image
    const clearPendingImage = () => {
        if (pendingImage?.preview) {
            URL.revokeObjectURL(pendingImage.preview)
        }
        setPendingImage(null)
    }

    // Audio recording
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            recordingStreamRef.current = stream
            audioChunksRef.current = []
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
            mediaRecorderRef.current = recorder

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data)
            }
            recorder.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
                const url = URL.createObjectURL(blob)
                setPendingAudio({ blob, url, duration: recordingDuration })
                stream.getTracks().forEach(t => t.stop())
                recordingStreamRef.current = null
            }

            recorder.start()
            setIsRecording(true)
            setRecordingDuration(0)
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration(d => d + 1)
            }, 1000)
        } catch {
            // Mic permission denied or unavailable
        }
    }

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
        }
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current)
            recordingTimerRef.current = null
        }
        setIsRecording(false)
    }

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.ondataavailable = null
            mediaRecorderRef.current.onstop = null
            mediaRecorderRef.current.stop()
        }
        if (recordingStreamRef.current) {
            recordingStreamRef.current.getTracks().forEach(t => t.stop())
            recordingStreamRef.current = null
        }
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current)
            recordingTimerRef.current = null
        }
        setIsRecording(false)
        setRecordingDuration(0)
    }

    const clearPendingAudio = () => {
        if (pendingAudio?.url) URL.revokeObjectURL(pendingAudio.url)
        setPendingAudio(null)
    }

    const uploadAudio = async (blob: Blob): Promise<{ url: string | null; error?: string }> => {
        try {
            const fileName = `${userId}/${Date.now()}-${Math.random().toString(16).slice(2)}.webm`
            const { error } = await supabase.storage
                .from('chat-images')
                .upload(fileName, blob, { contentType: 'audio/webm', upsert: false })
            if (error) return { url: null, error: error.message }
            const { data } = supabase.storage.from('chat-images').getPublicUrl(fileName)
            return { url: data.publicUrl }
        } catch (e) {
            return { url: null, error: e instanceof Error ? e.message : 'Upload failed' }
        }
    }

    const sendAudioMessage = async () => {
        if (!pendingAudio) return
        setUploadingImage(true)
        const { url, error } = await uploadAudio(pendingAudio.blob)
        setUploadingImage(false)
        if (!url) {
            setMessages(prev => [...prev, {
                id: `upload-error-${Date.now()}`,
                channel_id: channel.id,
                user_id: 'luma',
                content: `Error: failed to upload audio. ${error || ''}`,
                created_at: new Date().toISOString(),
                profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' },
            } as any])
            clearPendingAudio()
            return
        }
        const msg = {
            id: `user-${Date.now()}`,
            channel_id: channel.id,
            user_id: userId,
            content: '',
            image_url: url,
            created_at: new Date().toISOString(),
            profiles: null as any,
        }
        setMessages(prev => [...prev, msg as any])
        await persistMessage('', url)
        clearPendingAudio()
    }

    const formatRecordingTime = (seconds: number) => {
        const m = Math.floor(seconds / 60)
        const s = seconds % 60
        return `${m}:${s.toString().padStart(2, '0')}`
    }

    // Check if music is available on mount
    useEffect(() => {
        checkMusicAvailable().then(setMusicAvailable)
    }, [])

    // Play music locally
    const playMusicLocal = async (track: Track): Promise<{ success: boolean; error?: string }> => {
        setMusicLoading(true)
        
        try {
            console.log('[Music] Getting stream URL for:', track.title)
            const result = await getTrackStreamUrl(track.url)
            
            if (!result.success || !result.streamUrl) {
                console.error('[Music] Failed to get stream URL:', result.error)
                setMusicLoading(false)
                return { success: false, error: result.error }
            }

            // Stop previous audio
            if (musicAudioRef.current) {
                musicAudioRef.current.pause()
                musicAudioRef.current = null
            }

            // Create and play audio
            const audio = new Audio(result.streamUrl)
            audio.volume = musicVolume
            musicAudioRef.current = audio
            
            audio.onended = () => {
                // Play next from queue
                setMusicQueue(prev => {
                    const next = prev[0]
                    const rest = prev.slice(1)
                    if (next) {
                        playMusicLocal(next)
                    } else {
                        setCurrentMusicTrack(null)
                        setIsMusicPlaying(false)
                    }
                    return rest
                })
            }

            await audio.play()
            setCurrentMusicTrack(track)
            setIsMusicPlaying(true)
            setIsMusicPaused(false)
            setMusicLoading(false)
            return { success: true }
        } catch (e: any) {
            console.error('[Music] Error playing track:', e)
            setMusicLoading(false)
            return { success: false, error: e.message }
        }
    }

    // Music controls
    const pauseMusic = () => {
        if (musicAudioRef.current && isMusicPlaying) {
            musicAudioRef.current.pause()
            setIsMusicPaused(true)
            setIsMusicPlaying(false)
        }
    }

    const resumeMusic = () => {
        if (musicAudioRef.current && isMusicPaused) {
            musicAudioRef.current.play()
            setIsMusicPaused(false)
            setIsMusicPlaying(true)
        }
    }

    const stopMusic = () => {
        if (musicAudioRef.current) {
            musicAudioRef.current.pause()
            musicAudioRef.current = null
        }
        setCurrentMusicTrack(null)
        setMusicQueue([])
        setIsMusicPlaying(false)
        setIsMusicPaused(false)
    }

    const skipMusic = async () => {
        if (musicQueue.length > 0) {
            const next = musicQueue[0]
            setMusicQueue(prev => prev.slice(1))
            await playMusicLocal(next)
        } else {
            stopMusic()
        }
    }

    const setMusicVolumeControl = (volume: number) => {
        setMusicVolume(volume)
        if (musicAudioRef.current) {
            musicAudioRef.current.volume = volume
        }
    }

    const addToQueue = (track: Track) => {
        if (currentMusicTrack && isMusicPlaying) {
            setMusicQueue(prev => [...prev, track])
            return false // Added to queue
        }
        return true // Can play now
    }

    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const dragCounterRef = useRef(0)

    const scrollToBottom = () => {
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 50)
    }

    // Drag-and-drop handlers
    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounterRef.current++
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragging(true)
        }
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounterRef.current--
        if (dragCounterRef.current === 0) {
            setIsDragging(false)
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
        dragCounterRef.current = 0

        const files = e.dataTransfer.files
        if (files.length > 0) {
            const file = files[0]
            const ext = (file.name || '').split('.').pop()?.toLowerCase() || ''
            const isImage = file.type.startsWith('image/') || ['png','jpg','jpeg','gif','webp','bmp'].includes(ext)
            const isAudio = file.type.startsWith('audio/') || ['mp3','wav','ogg','webm','m4a','flac','aac'].includes(ext)
            const isVideo = file.type.startsWith('video/') || ['mp4','webm','mov','avi','mkv'].includes(ext)
            
            if (isImage) {
                handleImageSelect(file)
            } else if (isAudio || isVideo) {
                handleMediaFileDrop(file)
            }
        }
    }

    const handleMediaFileDrop = async (file: File) => {
        if (file.size > 50 * 1024 * 1024) {
            setMessages(prev => [...prev, {
                id: `upload-error-${Date.now()}`,
                channel_id: channel.id,
                user_id: 'luma',
                content: `Error: file too large (${Math.round(file.size / (1024 * 1024))}MB). Max is 50MB.`,
                created_at: new Date().toISOString(),
                profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' },
            } as any])
            return
        }
        setUploadingImage(true)
        const { url, error } = await uploadImage(file)
        setUploadingImage(false)
        if (!url) {
            setMessages(prev => [...prev, {
                id: `upload-error-${Date.now()}`,
                channel_id: channel.id,
                user_id: 'luma',
                content: `Error: failed to upload file. ${error || ''}`,
                created_at: new Date().toISOString(),
                profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' },
            } as any])
            return
        }
        const msg = {
            id: `user-${Date.now()}`,
            channel_id: channel.id,
            user_id: userId,
            content: '',
            image_url: url,
            created_at: new Date().toISOString(),
            profiles: null as any,
        }
        setMessages(prev => [...prev, msg as any])
        await persistMessage('', url)
    }

    const ALL_COMMANDS: { cmd: string; desc: string; insert?: string }[] = [
        { cmd: '/ask', desc: 'Ask Luma AI a question', insert: '/ask ' },
        { cmd: '/speak', desc: 'Have Luma respond with voice', insert: '/speak ' },
        { cmd: '/clear', desc: 'Clear all messages in this channel', insert: '/clear' },
        { cmd: '/play', desc: 'Search and play music', insert: '/play ' },
        { cmd: '/stop', desc: 'Stop music and clear the queue', insert: '/stop' },
        { cmd: '/pause', desc: 'Pause the current song', insert: '/pause' },
        { cmd: '/resume', desc: 'Resume the paused song', insert: '/resume' },
        { cmd: '/skip', desc: 'Skip to the next song in queue', insert: '/skip' },
        { cmd: '/queue', desc: 'Show the current music queue', insert: '/queue' },
        { cmd: '/volume', desc: 'Set playback volume (0-100)', insert: '/volume ' },
    ]

    useEffect(() => {
        // Don't clear messages immediately - avoid flicker
        // Use a loading state approach instead
        let cancelled = false
        setLoading(true)

        if (localServer.isConnected()) {
            const handleMessages = (data: any) => {
                if (cancelled) return
                if (data.channelId !== channel.id) return
                const list = (data.messages as LocalMessage[]).map(toMessage).map(normalizeMessage)
                setMessages(list)
                setLoading(false)
            }

            const handleMessage = (data: any) => {
                if (data.channelId !== channel.id) return
                const msg = normalizeMessage(toMessage((data.message || data) as LocalMessage))
                setMessages(prev => {
                    // De-dupe by ID
                    if (prev.some(m => m.id === msg.id)) return prev

                    // Replace optimistic message (used by command flows) when server echo arrives.
                    // Optimistic IDs are user-*, luma-*, music-* and profiles may be null.
                    const optimisticIndex = prev.findIndex(m => {
                        // Match user messages
                        if (msg.user_id === userId && String(m.id).startsWith('user-') && m.user_id === userId) {
                            // For image messages, also match by image_url
                            const msgImageUrl = (msg as any).image_url
                            const mImageUrl = (m as any).image_url
                            if (msgImageUrl || mImageUrl) {
                                return msgImageUrl === mImageUrl
                            }
                            // For text messages, match by content
                            return m.content === msg.content
                        }
                        // Match Luma messages
                        if (msg.user_id === 'luma' && String(m.id).startsWith('luma-') && m.user_id === 'luma' && m.content === msg.content) {
                            return true
                        }
                        // Match Music Bot messages (by clientId in content or matching content)
                        if (msg.user_id === 'music-bot' && String(m.id).startsWith('music-') && m.user_id === 'music-bot' && m.content === msg.content) {
                            return true
                        }
                        return false
                    })
                    
                    if (optimisticIndex !== -1) {
                        const newMessages = [...prev]
                        const existing = prev[optimisticIndex] as any
                        // Keep optimistic ID to avoid flicker.
                        newMessages[optimisticIndex] = {
                            ...msg,
                            image_url: (msg as any).image_url ?? existing.image_url,
                            id: prev[optimisticIndex].id,
                        }
                        return newMessages
                    }

                    return [...prev, msg]
                })
                if (msg.user_id !== userId) {
                    sounds.messageReceived()
                }
            }

            localServer.on('messages', handleMessages)
            localServer.on('message', handleMessage)
            const handleCleared = (data: any) => {
                if (data.channelId !== channel.id) return
                setMessages([])
                clearLumaMessages(channel.id)
            }

            localServer.on('messages-cleared', handleCleared)
            localServer.getMessages(channel.id)

            return () => {
                cancelled = true
                localServer.off('messages', handleMessages)
                localServer.off('message', handleMessage)
                localServer.off('messages-cleared', handleCleared)
            }
        }

        const fetchMessages = async () => {
            const { data } = await supabase
                .from('messages')
                .select('*, profiles(username, avatar_url, decoration, border)')
                .eq('channel_id', channel.id)
                .order('created_at', { ascending: true })
                .limit(100)

            if (data && !cancelled) {
                // Process messages - detect MUSIC_BOT and LUMA messages and convert to bot users
                const processedData = data.map(msg => {
                    // Music bot messages
                    const parsed = parseMusicBotDbContent(msg.content)
                    if (parsed) {
                        return {
                            ...msg,
                            user_id: 'music-bot',
                            content: parsed.text,
                            profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                        }
                    }

                    // Backwards-compat: older saved format
                    const legacy = stripLegacyMusicBotPrefix(msg.content)
                    if (legacy) {
                        return {
                            ...msg,
                            user_id: 'music-bot',
                            content: legacy.text,
                            profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                        }
                    }

                    // Luma AI messages
                    if (msg.content.startsWith('[LUMA] ')) {
                        return {
                            ...msg,
                            user_id: 'luma',
                            content: msg.content.slice(7),
                            profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' }
                        }
                    }

                    return msg
                })
                // Merge with Luma messages from localStorage (for audio URLs)
                // But avoid duplicates - only add localStorage messages not already in DB
                const lumaMsgs = getLumaMessages(channel.id).filter(lm => 
                    !processedData.some(pm => pm.user_id === 'luma' && pm.content === lm.content)
                )
                // Don't sort - keep insertion order
                setMessages([...processedData, ...lumaMsgs])
                setLoading(false)
            }
        }

        fetchMessages()

        const sub = supabase
            .channel(`messages:${channel.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `channel_id=eq.${channel.id}`,
                },
                async (payload) => {
                    const { data } = await supabase
                        .from('messages')
                        .select('*, profiles(username, avatar_url, decoration, border)')
                        .eq('id', payload.new.id)
                        .single()

                    if (data) {
                        // Process MUSIC_BOT and LUMA messages
                        const parsed = parseMusicBotDbContent(data.content)
                        const legacy = stripLegacyMusicBotPrefix(data.content)
                        const isLumaMsg = data.content.startsWith('[LUMA] ')
                        const processedData = parsed ? {
                            ...data,
                            user_id: 'music-bot',
                            content: parsed.text,
                            profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                        } : legacy ? {
                            ...data,
                            user_id: 'music-bot',
                            content: legacy.text,
                            profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                        } : isLumaMsg ? {
                            ...data,
                            user_id: 'luma',
                            content: data.content.slice(7),
                            profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' }
                        } : data
                        
                        setMessages(prev => {
                            // Check if this is replacing a temp/user message from same user with same content
                            // For Luma messages, compare with processed content (without [LUMA] prefix)
                            const tempIndex = prev.findIndex(m => 
                                (String(m.id).startsWith('temp-') || String(m.id).startsWith('user-') || String(m.id).startsWith('luma-')) && 
                                m.user_id === processedData.user_id && 
                                m.content === processedData.content
                            )
                            
                            if (tempIndex !== -1) {
                                // Replace temp message with real data from DB, but keep profiles if missing
                                const newMessages = [...prev]
                                const existingMsg = prev[tempIndex]
                                newMessages[tempIndex] = {
                                    ...processedData,
                                    profiles: processedData.profiles || existingMsg.profiles
                                }
                                return newMessages
                            }
                            
                            // If we have an optimistic Music Bot message with the same clientId, replace it
                            if (parsed?.clientId) {
                                const optimisticIndex = prev.findIndex(m => String(m.id) === parsed.clientId)
                                if (optimisticIndex !== -1) {
                                    const newMessages = [...prev]
                                    // Preserve the optimistic ID to avoid React re-render flicker
                                    newMessages[optimisticIndex] = { ...processedData, id: parsed.clientId }
                                    return newMessages
                                }
                            }

                            // If this is a legacy MUSIC_BOT message (no clientId), try to replace the most recent optimistic one
                            // to avoid duplication.
                            if (!parsed?.clientId && (legacy || processedData.user_id === 'music-bot')) {
                                const now = Date.now()
                                const targetText = (processedData as any).content
                                const optimisticIndex = [...prev].reverse().findIndex(m => {
                                    if (m.user_id !== 'music-bot') return false
                                    if (m.content !== targetText) return false
                                    const t = new Date(m.created_at).getTime()
                                    return Math.abs(now - t) < 3000
                                })
                                if (optimisticIndex !== -1) {
                                    const realIndex = prev.length - 1 - optimisticIndex
                                    const newMessages = [...prev]
                                    newMessages[realIndex] = processedData
                                    return newMessages
                                }
                            }

                            // Check if already exists by ID
                            const exists = prev.some(m => m.id === data.id)
                            if (exists) return prev
                            
                            // Add new message at end (don't reorder)
                            return [...prev, processedData]
                        })
                        if (data.user_id !== userId) {
                            sounds.messageReceived()
                        }
                    }
                }
            )
            .subscribe()

        return () => {
            cancelled = true
            supabase.removeChannel(sub)
        }
    }, [channel.id, userId])

    // Show command preview based on input
    useEffect(() => {
        const trimmed = newMessage.trim()
        const firstToken = trimmed.split(/\s+/)[0] || ''

        if (trimmed === '/' || (firstToken.startsWith('/') && firstToken.length >= 1 && trimmed !== '' && !trimmed.startsWith('/play '))) {
            const q = trimmed === '/' ? '' : firstToken.toLowerCase()
            const base = q
                ? ALL_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(q))
                : ALL_COMMANDS.filter(c => c.cmd === '/ask' || c.cmd === '/play' || c.cmd === '/speak' || c.cmd === '/clear')

            const filtered = base
                .slice(0, 5)
                .map(c => ({ cmd: c.cmd, desc: c.desc, insert: c.insert || c.cmd }))
            setCommandSuggestions(filtered)
        } else {
            setCommandSuggestions([])
        }

        if (!trimmed.startsWith('/')) {
            setMusicSearchResults([])
        }
    }, [newMessage])

    const applyCommandSuggestion = (insert: string) => {
        setNewMessage(insert)
        // Focus & move cursor to end
        requestAnimationFrame(() => {
            const el = inputRef.current
            if (el) {
                el.focus()
                const end = insert.length
                try { el.setSelectionRange(end, end) } catch {}
            }
        })
    }

    // Search music when /play query changes
    useEffect(() => {
        if (!newMessage.startsWith('/play ')) {
            setMusicSearchResults([])
            return
        }
        
        const query = newMessage.slice(6).trim()
        if (!query || query.length < 2) {
            setMusicSearchResults([])
            return
        }

        const searchTimeout = setTimeout(async () => {
            if (!musicAvailable) return
            setMusicSearching(true)
            const result = await searchTracks(query)
            if (result.success && result.tracks) {
                setMusicSearchResults(result.tracks.slice(0, 5))
            }
            setMusicSearching(false)
        }, 500)

        return () => clearTimeout(searchTimeout)
    }, [newMessage, musicAvailable])

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    const buildMusicBotDbContent = (clientId: string, text: string) => `[MUSIC_BOT][${clientId}] ${text}`

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault()
        const content = newMessage.trim()
        
        // If there's a pending image, upload and send it
        if (pendingImage) {
            setUploadingImage(true)
            const { url: imageUrl, error: uploadError } = await uploadImage(pendingImage.file)
            setUploadingImage(false)

            if (!imageUrl) {
                setMessages(prev => [...prev, {
                    id: `upload-error-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'luma',
                    content: `Error: failed to upload image. ${uploadError || ''} (${pendingImage.file.name || 'file'} | ${pendingImage.file.type || 'unknown'} | ${Math.round(pendingImage.file.size / (1024 * 1024))}MB)`.trim(),
                    created_at: new Date().toISOString(),
                    profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' },
                } as any])
                return
            }

            sounds.messageSent()

            // Add optimistic message
            const msgId = `user-${Date.now()}`
            const msg = {
                id: msgId,
                channel_id: channel.id,
                user_id: userId,
                content: content || '',
                image_url: imageUrl,
                created_at: new Date().toISOString(),
                profiles: null as any,
            }
            setMessages(prev => [...prev, msg as any])

            await persistMessage(content || '', imageUrl)

            clearPendingImage()
            setNewMessage('')
            return
        }
        
        if (!content) return

        setNewMessage('')
        sounds.messageSent()

        // Add to message history (avoid duplicates)
        if (content && !messageHistory.includes(content)) {
            setMessageHistory(prev => [content, ...prev].slice(0, 50)) // Keep last 50
        }
        setHistoryIndex(-1)

        // /clear command
        if (content === '/clear') {
            // Animate messages out before clearing
            const messagesArea = document.querySelector('.messages-area')
            if (messagesArea) {
                messagesArea.classList.add('messages-area--clearing')
                await new Promise(r => setTimeout(r, 200))
            }
            setMessages([])
            clearLumaMessages(channel.id)
            if (localServer.isConnected()) {
                localServer.clearMessages(channel.id)
            } else {
                // Also delete from Supabase
                supabase.from('messages').delete().eq('channel_id', channel.id).then(({ error }) => {
                    if (error) console.log('[Chat] Failed to clear messages in DB:', error.message)
                })
            }
            if (messagesArea) {
                messagesArea.classList.remove('messages-area--clearing')
            }
            return
        }

        // Music commands
        if (content === '/stop') {
            stopMusic()
            const clientId = `music-${Date.now()}`
            const botMsg = {
                id: clientId,
                channel_id: channel.id,
                user_id: 'music-bot',
                content: 'Music stopped and queue cleared.',
                created_at: new Date().toISOString(),
                profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
            }
            setMessages(prev => [...prev, botMsg as any])
            await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            return
        }

        if (content === '/pause') {
            if (isMusicPlaying && currentMusicTrack) {
                pauseMusic()
                const clientId = `music-${Date.now()}`
                const botMsg = {
                    id: clientId,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: `Paused: ${currentMusicTrack.title}`,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            } else {
                const clientId = `music-${Date.now()}`
                const botMsg = {
                    id: clientId,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: 'No music playing to pause.',
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            }
            return
        }

        if (content === '/resume') {
            if (isMusicPaused && currentMusicTrack) {
                resumeMusic()
                const clientId = `music-${Date.now()}`
                const botMsg = {
                    id: clientId,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: `Resumed: ${currentMusicTrack.title}`,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            } else {
                const clientId = `music-${Date.now()}`
                const botMsg = {
                    id: clientId,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: 'No paused music to resume.',
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            }
            return
        }

        if (content === '/skip') {
            if (currentMusicTrack) {
                const skipped = currentMusicTrack.title
                await skipMusic()
                const clientId = `music-${Date.now()}`
                const botMsg = {
                    id: clientId,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: musicQueue.length > 0 
                        ? `Skipped ${skipped}. Playing next in queue.`
                        : `Skipped ${skipped}. Queue is empty.`,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            } else {
                const clientId = `music-${Date.now()}`
                const botMsg = {
                    id: clientId,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: 'No music playing to skip.',
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            }
            return
        }

        if (content.startsWith('/volume ')) {
            const vol = parseInt(content.slice(8).trim())
            if (!isNaN(vol) && vol >= 0 && vol <= 100) {
                setMusicVolumeControl(vol / 100)
                const clientId = `music-${Date.now()}`
                const botMsg = {
                    id: clientId,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: `Volume set to ${vol}%`,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            } else {
                const clientId = `music-${Date.now()}`
                const botMsg = {
                    id: clientId,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: 'Usage: /volume 0-100 (e.g. /volume 50)',
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            }
            return
        }

        if (content === '/queue') {
            const clientId = `music-${Date.now()}`
            const queueList = musicQueue.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
            const botMsg = {
                id: clientId,
                channel_id: channel.id,
                user_id: 'music-bot',
                content: musicQueue.length === 0 ? 'Queue is empty.' : `Queue (${musicQueue.length}):\n${queueList}`,
                created_at: new Date().toISOString(),
                profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' },
            }
            setMessages(prev => [...prev, botMsg as any])
            await persistMessage(buildMusicBotDbContent(clientId, botMsg.content))
            return
        }

        // /ask command (renamed from /luma)
        if (content.startsWith('/ask ')) {
            const config = getLumaConfig()
            if (!config.enabled || !config.apiKey) {
                setMessages(prev => [...prev, {
                    id: `luma-error-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'luma',
                    content: 'Luma AI is not configured. Go to Settings > Luma AI to set up your API key.',
                    created_at: new Date().toISOString(),
                    profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' }
                } as any])
                return
            }

            const prompt = content.slice(5).trim()
            if (!prompt) return

            const userTimestamp = new Date().toISOString()
            const userMsgId = `user-${Date.now()}-${content.slice(0, 20).replace(/\s/g, '-')}`
            setMessages(prev => [...prev, {
                id: userMsgId,
                channel_id: channel.id,
                user_id: userId,
                content,
                created_at: userTimestamp,
                profiles: null as any
            } as any])

            // Persist through the active server when connected
            persistMessage(content).then()

            setLumaLoading(true)

            try {
                const recentMessages = messages.slice(-5).map(m => 
                    `${(m.profiles as any)?.username || 'User'}: ${m.content}`
                ).join('\n')

                const response = await askLuma(prompt, recentMessages)

                const lumaMsg = {
                    id: `luma-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'luma',
                    content: response,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' }
                }
                
                // Add Luma response at the end
                setMessages(prev => [...prev, lumaMsg as any])
                
                // Persist the Luma response so it survives channel reload/restart
                await persistMessage(`[LUMA] ${response}`)

                // Save to localStorage for audio URL caching etc.
                saveLumaMessage(channel.id, lumaMsg)
            } catch (error: any) {
                setMessages(prev => [...prev, {
                    id: `luma-error-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'luma',
                    content: `Error: ${error.message}`,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' }
                } as any])
            } finally {
                setLumaLoading(false)
            }
        } else if (content.startsWith('/speak ')) {
            // /speak command - TTS
            const config = getLumaConfig()
            if (!config.enabled || !config.apiKey) {
                setMessages(prev => [...prev, {
                    id: `luma-error-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'luma',
                    content: 'Luma AI is not configured. Go to Settings > Luma AI to set up your API key.',
                    created_at: new Date().toISOString(),
                    profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' }
                } as any])
                return
            }

            const prompt = content.slice(7).trim()
            if (!prompt) return

            const userTimestamp = new Date().toISOString()
            // Use stable ID based on content hash to avoid flick
            const userMsgId = `user-${Date.now()}-${content.slice(0, 20).replace(/\s/g, '-')}`
            setMessages(prev => [...prev, {
                id: userMsgId,
                channel_id: channel.id,
                user_id: userId,
                content,
                created_at: userTimestamp,
                profiles: null as any
            } as any])

            persistMessage(content).then()

            setSpeakLoading(true)

            try {
                const recentMessages = messages.slice(-5).map(m => 
                    `${(m.profiles as any)?.username || 'User'}: ${m.content}`
                ).join('\n')

                // First get text response
                const textResponse = await askLuma(prompt, recentMessages)
                
                // Then convert to speech
                const audioUrl = await speakLuma(textResponse)

                const lumaMsg = {
                    id: `luma-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'luma',
                    content: textResponse,
                    audioUrl,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' }
                }
                
                setMessages(prev => {
                    const idx = prev.findIndex(m => m.id === userMsgId)
                    if (idx !== -1) {
                        const newMessages = [...prev]
                        newMessages.splice(idx + 1, 0, lumaMsg as any)
                        return newMessages
                    }
                    return [...prev, lumaMsg] as any
                })
                
                // Persist the Luma response so it survives channel reload/restart
                await persistMessage(`[LUMA] ${textResponse}`)

                // Save to localStorage for audio URL caching
                saveLumaMessage(channel.id, lumaMsg)
                
                // Auto-play audio
                const audio = new Audio(audioUrl)
                audio.play()
            } catch (error: any) {
                setMessages(prev => [...prev, {
                    id: `luma-error-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'luma',
                    content: `Error: ${error.message}`,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'luma', username: 'Luma', avatar_url: null, status: 'online', created_at: '' }
                } as any])
            } finally {
                setSpeakLoading(false)
            }
        } else if (content.startsWith('/play ')) {
            // /play command - Music Bot
            const query = content.slice(6).trim()
            if (!query) return

            // Add user message as command - use stable ID
            const userMsgId = `user-${Date.now()}-${content.slice(0, 20).replace(/\s/g, '-')}`
            setMessages(prev => [...prev, {
                id: userMsgId,
                channel_id: channel.id,
                user_id: userId,
                content,
                created_at: new Date().toISOString(),
                profiles: null as any
            } as any])

            persistMessage(content).then()

            setMusicSearchResults([])

            // Search for music
            if (!musicAvailable) {
                const botMsg = {
                    id: `music-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: 'yt-dlp is not installed. Install it to use the music bot.',
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(botMsg.id, botMsg.content))
                return
            }

            try {
                const result = await searchTracks(query)
                if (!result.success || !result.tracks?.length) {
                    const botMsg = {
                        id: `music-${Date.now()}`,
                        channel_id: channel.id,
                        user_id: 'music-bot',
                        content: `No results found for "${query}"`,
                        created_at: new Date().toISOString(),
                        profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                    }
                    setMessages(prev => [...prev, botMsg as any])
                    await persistMessage(buildMusicBotDbContent(botMsg.id, botMsg.content))
                    return
                }

                // Get first result
                const track = result.tracks[0]
                
                // Check if should add to queue or play now
                const canPlayNow = addToQueue(track)
                
                if (!canPlayNow) {
                    // Added to queue
                    const botMsg = {
                        id: `music-${Date.now()}`,
                        channel_id: channel.id,
                        user_id: 'music-bot',
                        content: `Added to queue: ${track.title}`,
                        created_at: new Date().toISOString(),
                        profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                    }
                    setMessages(prev => [...prev, botMsg as any])
                    await persistMessage(buildMusicBotDbContent(botMsg.id, botMsg.content))
                } else {
                    // Tocar agora
                    const loadingMsg = {
                        id: `music-loading-${Date.now()}`,
                        channel_id: channel.id,
                        user_id: 'music-bot',
                        content: `Loading: ${track.title}...`,
                        created_at: new Date().toISOString(),
                        profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                    }
                    setMessages(prev => [...prev, loadingMsg as any])
                    
                    const playResult = await playMusicLocal(track)
                    
                    // Remove mensagem de carregando
                    setMessages(prev => prev.filter(m => m.id !== loadingMsg.id))
                    
                    if (playResult.success) {
                        const botMsg = {
                            id: `music-${Date.now()}`,
                            channel_id: channel.id,
                            user_id: 'music-bot',
                            content: `Now playing: ${track.title}`,
                            created_at: new Date().toISOString(),
                            profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                        }
                        setMessages(prev => [...prev, botMsg as any])
                        await persistMessage(buildMusicBotDbContent(botMsg.id, botMsg.content))
                    } else {
                        const botMsg = {
                            id: `music-${Date.now()}`,
                            channel_id: channel.id,
                            user_id: 'music-bot',
                            content: `Error loading music: ${playResult.error || 'Unknown error'}`,
                            created_at: new Date().toISOString(),
                            profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                        }
                        setMessages(prev => [...prev, botMsg as any])
                        await persistMessage(buildMusicBotDbContent(botMsg.id, botMsg.content))
                    }
                }
            } catch (e: any) {
                const botMsg = {
                    id: `music-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: `Error searching music: ${e.message}`,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, botMsg as any])
                await persistMessage(buildMusicBotDbContent(botMsg.id, botMsg.content))
            }
        } else {
            // Normal message
            await persistMessage(content)
        }
    }

    const handleSelectTrack = async (track: Track) => {
        console.log('[Music] handleSelectTrack called for:', track.title)
        
        // Fecha resultados imediatamente
        setMusicSearchResults([])
        setNewMessage('')
        
        // Verifica se deve adicionar à fila ou tocar agora
        const canPlayNow = addToQueue(track)
        
        if (!canPlayNow) {
            // Adicionado à fila
            const botMsg = {
                id: `music-${Date.now()}`,
                channel_id: channel.id,
                user_id: 'music-bot',
                content: `Added to queue: ${track.title}`,
                created_at: new Date().toISOString(),
                profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
            }
            setMessages(prev => [...prev, botMsg as any])
            await persistMessage(`[MUSIC_BOT] ${botMsg.content}`)
        } else {
            // Tocar agora
            const loadingMsg = {
                id: `music-loading-${Date.now()}`,
                channel_id: channel.id,
                user_id: 'music-bot',
                content: `Loading: ${track.title}...`,
                created_at: new Date().toISOString(),
                profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
            }
            setMessages(prev => [...prev, loadingMsg as any])
            
            const result = await playMusicLocal(track)
            
            // Remove mensagem de carregando
            setMessages(prev => prev.filter(m => m.id !== loadingMsg.id))
            
            if (result.success) {
                const trackMsg = {
                    id: `music-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: `Now playing: ${track.title}`,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, trackMsg as any])
                await persistMessage(buildMusicBotDbContent(trackMsg.id, trackMsg.content))
            } else {
                const errorMsg = {
                    id: `music-error-${Date.now()}`,
                    channel_id: channel.id,
                    user_id: 'music-bot',
                    content: `Error loading music: ${result.error || 'Unknown error'}`,
                    created_at: new Date().toISOString(),
                    profiles: { id: 'music-bot', username: 'Music Bot', avatar_url: null, status: 'online', created_at: '' }
                }
                setMessages(prev => [...prev, errorMsg as any])
                await persistMessage(buildMusicBotDbContent(errorMsg.id, errorMsg.content))
            }
        }
    }

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr)
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    return (
    <>
        <div
            className="chat-view-wrapper"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{ display: 'contents' }}
        >
            {isDragging && (
                <div className="drop-overlay">
                    <div className="drop-overlay__content">
                        <ImagePlus size={48} />
                        <span>Drop file here</span>
                        <span style={{ fontSize: 12, opacity: 0.7 }}>Images, audio, or video</span>
                    </div>
                </div>
            )}
            <div className="main-header">
                <div className="main-header__icon">
                    <Hash size={20} />
                </div>
                <div className="main-header__title">{channel.name}</div>
            </div>

            <div className="messages-area">
                {!loading && messages.length === 0 && commandSuggestions.length === 0 && (
                    <div className="empty-state empty-state--overlay empty-state--animated">
                        <div className="empty-state__icon">
                            <MessageSquare />
                        </div>
                        <div className="empty-state__title">No messages yet</div>
                        <div className="empty-state__desc">
                            Be the first to say something in #{channel.name}
                        </div>
                    </div>
                )}
                {messages.length > 0 && messages.map(msg => {
                        const isLumaMessage = msg.user_id === 'luma'
                        const isMusicBot = msg.user_id === 'music-bot'
                        const isMine = msg.user_id === userId && !isLumaMessage && !isMusicBot
                        const username = isLumaMessage
                            ? 'Luma'
                            : isMusicBot
                                ? 'Music Bot'
                                : (isMine ? (localUsername || msg.profiles?.username) : msg.profiles?.username) || 'Unknown'
                        // For own messages, use localStorage avatar; for others use profile avatar
                        const avatarUrl = isMine 
                            ? (localStorage.getItem('luma_user_avatar') || msg.profiles?.avatar_url)
                            : msg.profiles?.avatar_url
                        // Get decoration from localStorage for current user, or from profile for others
                        const decoration = isMine 
                            ? (localStorage.getItem('luma_user_avatar_decoration') || 'none')
                            : (msg.profiles?.decoration || 'none')
                        // Get user panel border from localStorage for current user, or from profile for others
                        const userPanelBorder = isMine 
                            ? (localStorage.getItem('luma_user_panel_border') || 'none')
                            : (msg.profiles?.border || 'none')
                        // Get name color from localStorage for current user, or from profile for others
                        const nameColor = isMine 
                            ? (localStorage.getItem('luma_user_name_color') || 'default')
                            : (msg.profiles?.name_color || 'default')
                        // Get name font from localStorage for current user, or from profile for others
                        const nameFont = isMine 
                            ? (localStorage.getItem('luma_user_name_font') || 'default')
                            : (msg.profiles?.name_font || 'default')
                        
                        // Detect command messages
                        const isAskCommand = msg.content.startsWith('/ask ')
                        const isSpeakCommand = msg.content.startsWith('/speak ')
                        const isPlayCommand = msg.content.startsWith('/play ')
                        const isCommand = isAskCommand || isSpeakCommand || isPlayCommand
                        const commandType = isAskCommand ? 'ask' : isSpeakCommand ? 'speak' : isPlayCommand ? 'play' : null
                        const promptText = isAskCommand ? msg.content.slice(5) : isSpeakCommand ? msg.content.slice(7) : isPlayCommand ? msg.content.slice(6) : msg.content

                        // Detect video URLs for preview
                        const videoUrl = detectVideoUrl(msg.content)

                        return (
                            <div 
                                key={msg.id} 
                                className={`message ${isMine ? 'message--mine' : 'message--other'} ${isLumaMessage ? 'message--luma' : ''} ${isMusicBot ? 'message--music' : ''} ${renderedMsgIdsRef.current.has(msg.id) ? 'message--no-animation' : ''}`}
                                ref={() => { renderedMsgIdsRef.current.add(msg.id) }}
                            >
                                <div 
                                    className={`avatar avatar--sm avatar-decoration avatar-decoration--${decoration} ${isLumaMessage ? 'avatar--luma' : ''} ${isMusicBot ? 'avatar--music' : ''} ${!isLumaMessage && !isMusicBot ? 'avatar--clickable' : ''}`}
                                    onClick={!isLumaMessage && !isMusicBot ? (e: React.MouseEvent) => {
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                        setProfilePopup({ username, avatarUrl: avatarUrl ?? null, decoration, border: userPanelBorder, nameColor, nameFont, position: { x: rect.left, y: rect.bottom } })
                                    } : undefined}
                                >
                                    {isLumaMessage ? <Bot size={14} /> : isMusicBot ? <Music size={14} /> : 
                                        avatarUrl ? (
                                            <img 
                                                src={avatarUrl} 
                                                alt={username} 
                                                className="avatar__image"
                                            />
                                        ) : (
                                            (username || '?').charAt(0)
                                        )
                                    }
                                </div>
                                <div className="message__bubble-wrap">
                                    <div className="message__header">
                                        <span 
                                            className={`message__author ${isLumaMessage ? 'message__author--luma' : ''} ${isMusicBot ? 'message__author--music' : ''} ${!isLumaMessage && !isMusicBot ? 'message__author--clickable' : ''}`}
                                            style={{ 
                                                color: nameColor !== 'default' ? getNameColorValue(nameColor) : undefined,
                                                fontFamily: nameFont !== 'default' ? getNameFontValue(nameFont) : undefined,
                                                fontSize: `calc(1em * ${getNameFontScale(nameFont)})`,
                                            }}
                                            onClick={!isLumaMessage && !isMusicBot ? (e: React.MouseEvent) => {
                                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                                setProfilePopup({ username, avatarUrl: avatarUrl ?? null, decoration, border: userPanelBorder, nameColor, nameFont, position: { x: rect.left, y: rect.bottom } })
                                            } : undefined}
                                        >{username}</span>
                                        <span className="message__time">{formatTime(msg.created_at)}</span>
                                    </div>
                                    <div className={`message__bubble ${isMine ? 'message__bubble--mine' : ''} ${isCommand ? 'message__bubble--command' : ''} ${userPanelBorder !== 'none' ? `message__bubble--border message__bubble--border-${userPanelBorder}` : ''} ${msg.image_url && !isAudioUrl(msg.image_url) ? 'message__bubble--image' : ''} ${videoUrl ? 'message__bubble--video' : ''}`}>
                                        {msg.image_url && isAudioUrl(msg.image_url) && (
                                            <MessageAudio src={msg.image_url} />
                                        )}
                                        {msg.image_url && !isAudioUrl(msg.image_url) && (
                                            <MessageImage src={msg.image_url} />
                                        )}
                                        {videoUrl && !msg.image_url && (
                                            <VideoPreview url={videoUrl} />
                                        )}
                                        {isCommand ? (
                                            <div className="command-message">
                                                <div className="command-message__header">
                                                    {commandType === 'speak' ? <Volume2 size={14} /> : 
                                                     commandType === 'play' ? <Music size={14} /> : 
                                                     <Bot size={14} />}
                                                    <span className="command-message__label">
                                                        {commandType === 'speak' ? 'Voice Prompt' : 
                                                         commandType === 'play' ? 'Play Music' : 
                                                         'Ask Luma'}
                                                    </span>
                                                </div>
                                                <div className="command-message__text">{promptText}</div>
                                            </div>
                                        ) : (
                                            msg.content && <span>{msg.content}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                <div ref={messagesEndRef} />
            </div>

            <div className="message-input-area">
                {commandSuggestions.length > 0 && (
                    <div className="command-preview-panel">
                        <div className="command-preview-panel__header">
                            <div className="command-preview-panel__icon">
                                <Hash size={16} />
                            </div>
                            <div className="command-preview-panel__info">
                                <span className="command-preview-panel__name">Commands</span>
                                <span className="command-preview-panel__desc">
                                    {newMessage.trim() === '/' ? 'Choose a command' : 'Suggestions'}
                                </span>
                            </div>
                        </div>
                        <div className="command-preview-panel__list">
                            {commandSuggestions.map(s => {
                                const isLuma = s.cmd === '/ask' || s.cmd === '/speak'
                                const isMusic = s.cmd === '/play' || s.cmd === '/stop' || s.cmd === '/pause' || s.cmd === '/resume' || s.cmd === '/skip' || s.cmd === '/queue' || s.cmd === '/volume'
                                const isClear = s.cmd === '/clear'
                                const icon = isClear ? <Trash2 size={14} /> : isMusic ? <Music size={14} /> : isLuma ? <Bot size={14} /> : <Hash size={14} />
                                const label = isClear ? 'Clear Chat' : isMusic ? 'Music Bot' : 'Luma AI'

                                return (
                                    <button
                                        key={s.cmd}
                                        type="button"
                                        className={`command-preview-item ${isMusic ? 'command-preview-item--music' : ''}`}
                                        onClick={() => applyCommandSuggestion(s.insert)}
                                    >
                                        <div className={`command-preview-item__icon ${isMusic ? 'command-preview-item__icon--music' : ''}`}>{icon}</div>
                                        <div className="command-preview-item__content">
                                            <div className="command-preview-item__top">
                                                <span className="command-preview-item__cmd">{s.cmd}</span>
                                                <span className={`command-preview-item__label ${isMusic ? 'command-preview-item__label--music' : ''}`}>{label}</span>
                                            </div>
                                            <div className="command-preview-item__desc">{s.desc}</div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                        <div className="command-preview-panel__hint">
                            <span>Tip: press</span> <code>Tab</code> <span>to autocomplete</span>
                        </div>
                    </div>
                )}

                {/* Music search results */}
                {newMessage.startsWith('/play ') && newMessage.slice(6).trim().length > 0 && (
                    <div className="music-search-results">
                        {musicSearching ? (
                            <div className="music-search-loading">
                                <Loader2 size={16} className="spin" />
                                <span>Searching...</span>
                            </div>
                        ) : !musicAvailable ? (
                            <div className="music-search-error">
                                <Music size={16} />
                                <span>yt-dlp not installed. Install it to use music features.</span>
                            </div>
                        ) : musicSearchResults.length > 0 ? (
                            musicSearchResults.map((track, idx) => (
                                <button
                                    key={track.id}
                                    className="music-search-item"
                                    onClick={() => handleSelectTrack(track)}
                                >
                                    <img src={track.thumbnail} alt="" className="music-search-item__thumb" />
                                    <div className="music-search-item__info">
                                        <div className="music-search-item__title">{track.title}</div>
                                        <div className="music-search-item__duration">{formatDuration(track.duration)}</div>
                                    </div>
                                    <Play size={16} className="music-search-item__play" />
                                </button>
                            ))
                        ) : newMessage.slice(6).trim().length >= 2 ? (
                            <div className="music-search-empty">No results found</div>
                        ) : null}
                    </div>
                )}

                {/* Recording indicator - above input */}
                {isRecording && (
                    <div className="recording-indicator">
                        <span className="recording-indicator__dot" />
                        <span>Recording... {formatRecordingTime(recordingDuration)}</span>
                        <button type="button" className="btn btn--sm btn--primary" onClick={stopRecording}>
                            <Pause size={14} /> Stop
                        </button>
                        <button type="button" className="btn btn--sm btn--ghost" onClick={cancelRecording}>
                            <X size={14} /> Cancel
                        </button>
                    </div>
                )}

                {/* Pending audio preview - above input */}
                {pendingAudio && (
                    <PendingAudioPlayer
                        url={pendingAudio.url}
                        duration={pendingAudio.duration}
                        onSend={sendAudioMessage}
                        onDiscard={clearPendingAudio}
                        uploading={uploadingImage}
                    />
                )}

                <form className="message-input-box" onSubmit={handleSend}>
                    {/* Hidden file input */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,audio/*,video/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) {
                                const ext = (file.name || '').split('.').pop()?.toLowerCase() || ''
                                const isImage = file.type.startsWith('image/') || ['png','jpg','jpeg','gif','webp','bmp'].includes(ext)
                                if (isImage) {
                                    handleImageSelect(file)
                                } else {
                                    handleMediaFileDrop(file)
                                }
                            }
                            e.target.value = ''
                        }}
                    />
                    
                    {/* Pending image preview */}
                    {pendingImage && (
                        <div className="pending-image-preview">
                            <img src={pendingImage.preview} alt="Preview" />
                            <button
                                type="button"
                                className="pending-image-preview__remove"
                                onClick={clearPendingImage}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}
                    
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder={`Message #${channel.name}${lumaLoading ? ' (Luma is thinking...)' : ''}${speakLoading ? ' (Luma is speaking...)' : ''}`}
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                            if (commandSuggestions.length > 0 && e.key === 'Tab') {
                                e.preventDefault()
                                const first = commandSuggestions[0]
                                if (first) applyCommandSuggestion(first.insert)
                            }
                            // Message history navigation
                            if (e.key === 'ArrowUp' && !commandSuggestions.length) {
                                e.preventDefault()
                                if (messageHistory.length > 0) {
                                    const newIndex = historyIndex < messageHistory.length - 1 ? historyIndex + 1 : historyIndex
                                    setHistoryIndex(newIndex)
                                    setNewMessage(messageHistory[newIndex] || '')
                                }
                            }
                            if (e.key === 'ArrowDown' && !commandSuggestions.length) {
                                e.preventDefault()
                                if (historyIndex > 0) {
                                    const newIndex = historyIndex - 1
                                    setHistoryIndex(newIndex)
                                    setNewMessage(messageHistory[newIndex] || '')
                                } else if (historyIndex === 0) {
                                    setHistoryIndex(-1)
                                    setNewMessage('')
                                }
                            }
                        }}
                        autoFocus
                        disabled={lumaLoading || speakLoading || uploadingImage}
                    />
                    <button
                        type="button"
                        className="attach-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={lumaLoading || speakLoading || uploadingImage || isRecording}
                    >
                        <ImagePlus size={18} />
                    </button>
                    <button
                        type="button"
                        className={`attach-btn ${isRecording ? 'recording' : ''}`}
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={lumaLoading || speakLoading || uploadingImage || !!pendingAudio}
                        title={isRecording ? 'Stop recording' : 'Record voice message'}
                    >
                        {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
                    </button>
                    <div className="emoji-picker-anchor" ref={emojiPickerRef}>
                        <button
                            type="button"
                            className="emoji-btn"
                            onClick={() => {
                                setShowEmojiPicker(v => !v)
                                requestAnimationFrame(() => inputRef.current?.focus())
                            }}
                            disabled={lumaLoading || speakLoading || uploadingImage}
                        >
                            <Smile size={18} />
                        </button>
                        {showEmojiPicker && (
                            <div className="emoji-picker">
                                <div className="emoji-picker__grid">
                                    {EMOJIS.map((e) => (
                                        <button
                                            key={e}
                                            type="button"
                                            className="emoji-picker__item"
                                            onClick={() => {
                                                insertEmoji(e)
                                                setShowEmojiPicker(false)
                                            }}
                                        >
                                            {e}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <button
                        type="submit"
                        className="send-btn"
                        disabled={(!newMessage.trim() && !pendingImage) || lumaLoading || speakLoading || uploadingImage}
                    >
                        {uploadingImage ? <Loader2 size={16} className="spin" /> : lumaLoading || speakLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                    </button>
                </form>
            </div>
        </div>

        {profilePopup && createPortal(
            <UserProfilePopup
                username={profilePopup.username}
                avatarUrl={profilePopup.avatarUrl}
                decoration={profilePopup.decoration}
                border={profilePopup.border}
                nameColor={profilePopup.nameColor}
                nameFont={profilePopup.nameFont}
                status={profilePopup.status}
                position={profilePopup.position}
                onClose={() => setProfilePopup(null)}
            />,
            document.body
        )}
    </>
    )
}

export default ChatView
