import { useEffect, useRef, useState } from 'react'
import { Channel, Message, Profile } from '../lib/types'
import { localServer, type LocalMessage } from '../lib/local-server'
import { sounds } from '../lib/sounds'
import { Hash, Send } from 'lucide-react'

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

interface ChatViewLocalProps {
    channel: Channel
    userId: string
    voiceChannelId?: string | null
}

function toMessage(m: LocalMessage): Message {
    const profiles: Profile | undefined = m.user
        ? {
              id: m.user.id,
              username: m.user.username,
              avatar_url: m.user.avatar_url,
              status: m.user.status,
              created_at: m.created_at,
              decoration: (m.user as any).decoration,
              border: (m.user as any).border,
          }
        : undefined

    return {
        id: m.id,
        channel_id: m.channel_id,
        user_id: m.user_id,
        content: m.content,
        created_at: m.created_at,
        profiles,
    }
}

function ChatViewLocal({ channel, userId }: ChatViewLocalProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(true)
    const [newMessage, setNewMessage] = useState('')
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const renderedIdsRef = useRef<Set<string>>(new Set())

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    useEffect(() => {
        let cancelled = false
        setLoading(true)

        const handleMessages = (data: any) => {
            if (cancelled) return
            if (data.channelId !== channel.id) return
            const list = (data.messages as LocalMessage[]).map(toMessage)
            setMessages(list)
            setLoading(false)
        }

        const handleMessage = (data: any) => {
            if (data.channelId !== channel.id) return
            const msg = toMessage(data.message as LocalMessage)

            setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev
                return [...prev, msg]
            })

            if (msg.user_id !== userId && !renderedIdsRef.current.has(msg.id)) {
                sounds.messageReceived()
            }
            renderedIdsRef.current.add(msg.id)
        }

        const handleProfileUpdated = (data: any) => {
            // Update messages from this user with new profile data
            setMessages(prev => prev.map(m => {
                if (m.user_id === data.user.id && m.profiles) {
                    return {
                        ...m,
                        profiles: {
                            ...m.profiles,
                            username: data.user.username,
                            avatar_url: data.user.avatar_url,
                            decoration: data.user.decoration,
                            border: data.user.border,
                        }
                    }
                }
                return m
            }))
        }

        localServer.on('messages', handleMessages)
        localServer.on('message', handleMessage)
        localServer.on('profile-updated', handleProfileUpdated)
        localServer.getMessages(channel.id)

        const t = setTimeout(() => {
            if (!cancelled) setLoading(false)
        }, 4000)

        return () => {
            cancelled = true
            clearTimeout(t)
            localServer.off('messages', handleMessages)
            localServer.off('message', handleMessage)
            localServer.off('profile-updated', handleProfileUpdated)
        }
    }, [channel.id, userId])

    useEffect(() => {
        scrollToBottom()
    }, [messages.length])

    const handleSend = () => {
        const content = newMessage.trim()
        if (!content) return
        localServer.sendMessage(channel.id, content)
        sounds.messageSent()
        setNewMessage('')
    }

    return (
        <div className="messages-area">
            <div className="messages-header">
                <div className="messages-header__left">
                    <Hash size={18} />
                    <div className="messages-header__title">{channel.name}</div>
                </div>
            </div>

            <div className="messages-list">
                {loading ? (
                    <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
                ) : messages.length === 0 ? (
                    <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 13 }}>No messages</div>
                ) : (
                    messages.map(m => {
                        const isMine = m.user_id === userId
                        const username = m.profiles?.username || 'User'
                        const avatarUrl = isMine 
                            ? (localStorage.getItem('luma_user_avatar') || m.profiles?.avatar_url)
                            : m.profiles?.avatar_url
                        const decoration = isMine 
                            ? (localStorage.getItem('luma_user_avatar_decoration') || 'none')
                            : (m.profiles as any)?.decoration || 'none'
                        const userPanelBorder = isMine 
                            ? (localStorage.getItem('luma_user_panel_border') || 'none')
                            : (m.profiles?.border || 'none')
                        const nameColor = isMine 
                            ? (localStorage.getItem('luma_user_name_color') || 'default')
                            : ((m.profiles as any)?.name_color || 'default')
                        const nameFont = isMine 
                            ? (localStorage.getItem('luma_user_name_font') || 'default')
                            : ((m.profiles as any)?.name_font || 'default')
                        
                        return (
                        <div key={m.id} className={`message ${isMine ? 'message--mine' : 'message--other'}`}>
                            <div className={`avatar avatar--xs avatar-decoration avatar-decoration--${decoration}`}>
                                {avatarUrl ? (
                                    <img 
                                        src={avatarUrl} 
                                        alt={username} 
                                        className="avatar__image"
                                    />
                                ) : (
                                    username?.charAt(0) || '?'
                                )}
                            </div>
                            <div className="message__bubble-wrap">
                                <div className="message__header">
                                    <span 
                                        className={`message__author ${isMine ? 'message__author--mine' : ''}`}
                                        style={{ 
                                            color: nameColor !== 'default' ? getNameColorValue(nameColor) : undefined,
                                            fontFamily: nameFont !== 'default' ? getNameFontValue(nameFont) : undefined,
                                            fontSize: `calc(1em * ${getNameFontScale(nameFont)})`,
                                        }}
                                    >{username}</span>
                                    <span className="message__time">{new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                </div>
                                <div className={`message__bubble ${isMine ? 'message__bubble--mine' : ''} ${userPanelBorder !== 'none' ? `message__bubble--border message__bubble--border-${userPanelBorder}` : ''}`}>
                                    {m.content}
                                </div>
                            </div>
                        </div>
                        )
                    })
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="message-input">
                <div className="message-input-box">
                    <input
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder={`Message #${channel.name}`}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSend()
                            }
                        }}
                    />
                    <button className="btn btn--icon-sm btn--primary" onClick={handleSend} disabled={!newMessage.trim()}>
                        <Send size={16} />
                    </button>
                </div>
            </div>
        </div>
    )
}

export default ChatViewLocal
