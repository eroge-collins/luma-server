import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Channel, Profile } from '../lib/types'
import { sounds } from '../lib/sounds'
import { 
    localServer,
} from '../lib/local-server'
import { View } from '../pages/MainPage'
import ConfirmModal from './ConfirmModal'
import {
    Hash,
    Volume2,
    Plus,
    Settings,
    LogOut,
    Phone,
    PhoneOff,
    Trash2,
    Server,
    X,
} from 'lucide-react'

interface SidebarProps {
    textChannels: Channel[]
    voiceChannels: Channel[]
    activeChannel: Channel | null
    voiceChannelId: string | null
    profile: Profile | null
    view: View
    isSpeaking: boolean
    onSelectChannel: (channel: Channel) => void
    onJoinVoice: (channelId: string) => void
    onLeaveVoice: () => void
    onCreateChannel: () => void
    onOpenSettings: () => void
    onLogout: () => void
}

// Hook to sync with localStorage avatar
function useAvatarSync() {
    const [avatarUrl, setAvatarUrl] = useState<string | null>(() => {
        return localStorage.getItem('luma_user_avatar')
    })
    const [decoration, setDecoration] = useState<string>(() => {
        return localStorage.getItem('luma_user_avatar_decoration') || 'none'
    })
    const [userPanelBorder, setUserPanelBorder] = useState<string>(() => {
        return localStorage.getItem('luma_user_panel_border') || 'none'
    })
    const [nameColor, setNameColor] = useState<string>(() => {
        return localStorage.getItem('luma_user_name_color') || 'default'
    })
    const [nameFont, setNameFont] = useState<string>(() => {
        return localStorage.getItem('luma_user_name_font') || 'default'
    })
    const [customStatus, setCustomStatus] = useState<string>(() => {
        return localStorage.getItem('luma_user_custom_status') || ''
    })

    useEffect(() => {
        const checkStorage = () => {
            const stored = localStorage.getItem('luma_user_avatar')
            const storedDeco = localStorage.getItem('luma_user_avatar_decoration') || 'none'
            const storedBorder = localStorage.getItem('luma_user_panel_border') || 'none'
            const storedNameColor = localStorage.getItem('luma_user_name_color') || 'default'
            const storedNameFont = localStorage.getItem('luma_user_name_font') || 'default'
            const storedCustomStatus = localStorage.getItem('luma_user_custom_status') || ''
            setAvatarUrl(stored)
            setDecoration(storedDeco)
            setUserPanelBorder(storedBorder)
            setNameColor(storedNameColor)
            setNameFont(storedNameFont)
            setCustomStatus(storedCustomStatus)
        }
        
        // Check on mount and when storage changes
        checkStorage()
        
        // Listen for storage events (from other tabs) and custom events
        const handleStorage = () => checkStorage()
        window.addEventListener('storage', handleStorage)
        window.addEventListener('avatar-updated', handleStorage)
        
        // Also check periodically when view changes
        const interval = setInterval(checkStorage, 500)
        
        return () => {
            window.removeEventListener('storage', handleStorage)
            window.removeEventListener('avatar-updated', handleStorage)
            clearInterval(interval)
        }
    }, [])

    return { avatarUrl, decoration, userPanelBorder, nameColor, nameFont, customStatus }
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

function Sidebar({
    textChannels,
    voiceChannels,
    activeChannel,
    voiceChannelId,
    profile,
    view,
    isSpeaking,
    onSelectChannel,
    onJoinVoice,
    onLeaveVoice,
    onCreateChannel,
    onOpenSettings,
    onLogout,
}: SidebarProps) {
    const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null)
    
    // Sync avatar from localStorage
    const { avatarUrl: storedAvatar, decoration, userPanelBorder, nameColor, nameFont, customStatus } = useAvatarSync()
    
    // Local server state
    const [showServerModal, setShowServerModal] = useState(false)
    
    // Connect to server state
    const [connectAddress, setConnectAddress] = useState('')
    const [connectPassword, setConnectPassword] = useState('')
    const [connecting, setConnecting] = useState(false)
    const [connectedServer, setConnectedServer] = useState<{ address: string; name: string } | null>(null)

    useEffect(() => {
        // Check if already connected on mount
    }, [])

    const parseServerAddress = (raw: string): { address: string; port: number } => {
        const input = raw.trim()
        if (!input) {
            throw new Error('Enter server address')
        }

        // Accept ws:// / http:// inputs; normalize to hostname + port for the WS client
        if (input.includes('://')) {
            try {
                const u = new URL(input)
                const port = u.port ? parseInt(u.port) : 3737
                if (!Number.isFinite(port) || port < 1 || port > 65535) {
                    throw new Error('Invalid port')
                }
                return { address: u.hostname, port }
            } catch {
                throw new Error('Invalid address format')
            }
        }

        // host:port or host
        const idx = input.lastIndexOf(':')
        if (idx > -1 && idx !== input.length - 1) {
            const host = input.slice(0, idx).trim()
            const portStr = input.slice(idx + 1).trim()
            const port = portStr ? parseInt(portStr) : 3737
            if (!host) throw new Error('Invalid address')
            if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error('Invalid port')
            return { address: host, port }
        }

        return { address: input, port: 3737 }
    }

    const handleConnectToServer = async () => {
        let parsed: { address: string; port: number }
        try {
            parsed = parseServerAddress(connectAddress)
        } catch (e: any) {
            alert(e.message || 'Invalid address')
            return
        }

        setConnecting(true)
        
        try {
            // Use Supabase identity as the local server identity
            if (profile?.id) {
                localStorage.setItem('luma_local_user_id', profile.id)
            }
            if (profile?.username) {
                localStorage.setItem('luma_local_username', profile.username)
            }

            const user = await localServer.connect({
                address: parsed.address,
                port: parsed.port,
                password: connectPassword.trim() ? connectPassword : undefined,
            }, profile?.username)
            
            const serverName = localServer.getServerInfo()?.name || user.username
            setConnectedServer({ address: connectAddress, name: serverName })
            sounds.connect()
        } catch (err: any) {
            alert(err.message || 'Failed to connect')
        } finally {
            setConnecting(false)
        }
    }

    const handleDisconnectFromServer = () => {
        localServer.disconnect()
        setConnectedServer(null)
        sounds.disconnect()
    }

    const handleDeleteChannel = async () => {
        if (!deleteTarget) return
        if (!localServer.isConnected()) {
            setDeleteTarget(null)
            return
        }
        localServer.deleteChannel(deleteTarget.id)
        sounds.click()
        setDeleteTarget(null)
    }

    const renderChannel = (channel: Channel, icon: React.ReactNode) => (
        <div
            key={channel.id}
            className={`room-item ${view === 'chat' && activeChannel?.id === channel.id ? 'active' : ''}`}
            onClick={() => onSelectChannel(channel)}
        >
            <div className="room-item__icon">
                {icon}
            </div>
            <div className="room-item__info">
                <div className="room-item__name">{channel.name}</div>
                {channel.type === 'voice' && voiceChannelId === channel.id && (
                    <div className="room-item__meta" style={{ color: 'var(--green)' }}>Connected</div>
                )}
            </div>
            {channel.created_by === profile?.id && (
                <button
                    className="room-item__delete"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(channel) }}
                    title="Delete channel"
                >
                    <Trash2 size={14} />
                </button>
            )}
        </div>
    )

    return (
        <div className="sidebar">
            <div className="sidebar__header">
                <span className="sidebar__title">Channels</span>
                <div className="sidebar__actions">
                    <button
                        className="btn btn--icon-sm btn--ghost"
                        onClick={() => setShowServerModal(true)}
                        title="Local Server"
                        style={connectedServer ? { color: 'var(--green)' } : {}}
                    >
                        <Server size={16} />
                    </button>
                    <button
                        className="btn btn--icon-sm btn--ghost"
                        onClick={onCreateChannel}
                        title="New channel"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>

            <div className="sidebar__list">
                <div className="sidebar__section">
                    <div className="sidebar__section-label">Messages</div>
                    {textChannels.length === 0 ? (
                        <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-muted)', opacity: 0.5 }}>
                            No channels
                        </div>
                    ) : (
                        textChannels.map(ch => renderChannel(ch, <Hash size={15} />))
                    )}
                </div>

                <div className="sidebar__section">
                    <div className="sidebar__section-label">Voice</div>
                    {voiceChannels.length === 0 ? (
                        <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-muted)', opacity: 0.5 }}>
                            No channels
                        </div>
                    ) : (
                        voiceChannels.map(ch => renderChannel(ch, <Volume2 size={15} />))
                    )}
                </div>
            </div>

            <div className={`voice-bar ${voiceChannelId ? '' : 'voice-bar--hidden'}`}>
                <div className="voice-bar__info">
                    <Phone size={14} />
                    Voice Connected
                </div>
                <button
                    className="btn btn--sm btn--danger"
                    onClick={onLeaveVoice}
                >
                    <PhoneOff size={14} />
                    End
                </button>
            </div>

            <div className={`user-panel-border user-panel-border--${userPanelBorder}`}>
                <div className="user-panel">
                    <div className={`avatar avatar--sm avatar-decoration avatar-decoration--${decoration}`} style={{ position: 'relative' }}>
                        {storedAvatar || profile?.avatar_url ? (
                            <img 
                                src={storedAvatar || profile?.avatar_url || ''} 
                                alt={profile?.username || 'Avatar'} 
                                className="avatar__image"
                            />
                        ) : (
                            profile?.username?.charAt(0) || '?'
                        )}
                        {voiceChannelId && isSpeaking && <div className="speaking-ring speaking-ring--sidebar" />}
                    </div>
                    <div className="user-panel__info">
                        <div 
                            className="user-panel__name"
                            style={{ 
                                color: nameColor !== 'default' ? getNameColorValue(nameColor) : undefined,
                                fontFamily: nameFont !== 'default' ? getNameFontValue(nameFont) : undefined,
                                fontSize: `calc(1em * ${getNameFontScale(nameFont)})`,
                            }}
                        >{profile?.username || 'Loading...'}</div>
                        <div className="user-panel__status" style={{ color: nameColor !== 'default' ? getNameColorValue(nameColor) : undefined, fontStyle: 'italic' }}>
                            <span className="status-dot status-dot--online" />
                            {customStatus ? `❝${customStatus}❞` : 'Online'}
                        </div>
                    </div>
                    <button className="btn btn--icon-sm btn--ghost" onClick={onOpenSettings} title="Settings">
                        <Settings size={16} />
                    </button>
                    <button className="btn btn--icon-sm btn--ghost" onClick={onLogout} title="Sign out">
                        <LogOut size={16} />
                    </button>
                </div>
            </div>

            {deleteTarget && createPortal(
                <ConfirmModal
                    title="Delete Channel"
                    message={`Are you sure you want to delete #${deleteTarget.name}? This action cannot be undone.`}
                    confirmLabel="Delete"
                    danger
                    onConfirm={handleDeleteChannel}
                    onCancel={() => setDeleteTarget(null)}
                />,
                document.body
            )}

            {showServerModal && createPortal(
                <div className="modal-overlay" onClick={() => setShowServerModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal__header">
                            <h2>Local Server</h2>
                            <button className="modal__close" onClick={() => setShowServerModal(false)}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="modal__body">
                            {connectedServer ? (
                                    <div className="server-running">
                                        <div className="server-running__status">
                                            <span className="status-dot status-dot--online" />
                                            <span>Connected to {connectedServer.name}</span>
                                        </div>
                                        
                                        <div className="server-running__details">
                                            <div className="server-running__detail">
                                                <span className="server-running__detail-label">Address</span>
                                                <span className="server-running__detail-value">{connectedServer.address}</span>
                                            </div>
                                        </div>

                                        <button 
                                            className="btn btn--danger btn--full"
                                            onClick={handleDisconnectFromServer}
                                        >
                                            Disconnect
                                        </button>
                                    </div>
                                ) : (
                                    <div className="server-setup">
                                        <p className="server-setup__desc">
                                            Connect to a friend's server using their IP address and password.
                                        </p>

                                        <div className="form-group">
                                            <label className="label">Server Address</label>
                                            <input
                                                className="input"
                                                type="text"
                                                value={connectAddress}
                                                onChange={(e) => setConnectAddress(e.target.value)}
                                                placeholder="192.168.1.100:3737"
                                            />
                                            <small className="form-help">Format: IP:Port (e.g., 192.168.1.100:3737)</small>
                                        </div>

                                        <div className="form-group">
                                            <label className="label">Password *</label>
                                            <input
                                                className="input"
                                                type="password"
                                                value={connectPassword}
                                                onChange={(e) => setConnectPassword(e.target.value)}
                                                placeholder="If required"
                                            />
                                        </div>

                                        <button 
                                            className="btn btn--primary btn--full"
                                            onClick={handleConnectToServer}
                                            disabled={connecting || !connectAddress.trim()}
                                        >
                                            {connecting ? 'Connecting...' : 'Connect'}
                                        </button>
                                    </div>
                                )
                            }
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}

export default Sidebar
