import { useEffect, useState } from 'react'
import { Profile } from '../lib/types'
import { SettingsTab } from '../pages/MainPage'
import {
    ArrowLeft,
    Volume2,
    User,
    LogOut,
    Bot,
    Globe,
    Music,
    AudioWaveform
} from 'lucide-react'

interface SettingsSidebarProps {
    activeTab: SettingsTab
    onTabChange: (tab: SettingsTab) => void
    onBack: () => void
    profile: Profile | null
    onLogout: () => void
}

const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: 'My Profile', icon: <User size={18} /> },
    { id: 'audio', label: 'Voice & Audio', icon: <Volume2 size={18} /> },
    { id: 'soundpad', label: 'Soundpad', icon: <Music size={18} /> },
    { id: 'voicechanger', label: 'Voice Changer', icon: <AudioWaveform size={18} /> },
    { id: 'luma', label: 'Luma AI', icon: <Bot size={18} /> },
    { id: 'browser', label: 'Browser', icon: <Globe size={18} /> },
]

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
            setAvatarUrl(localStorage.getItem('luma_user_avatar'))
            setDecoration(localStorage.getItem('luma_user_avatar_decoration') || 'none')
            setUserPanelBorder(localStorage.getItem('luma_user_panel_border') || 'none')
            setNameColor(localStorage.getItem('luma_user_name_color') || 'default')
            setNameFont(localStorage.getItem('luma_user_name_font') || 'default')
            setCustomStatus(localStorage.getItem('luma_user_custom_status') || '')
        }

        checkStorage()
        const handleStorage = () => checkStorage()
        window.addEventListener('storage', handleStorage)
        window.addEventListener('avatar-updated', handleStorage)

        const interval = setInterval(checkStorage, 500)
        return () => {
            window.removeEventListener('storage', handleStorage)
            window.removeEventListener('avatar-updated', handleStorage)
            clearInterval(interval)
        }
    }, [])

    return { avatarUrl, decoration, userPanelBorder, nameColor, nameFont, customStatus }
}

function SettingsSidebar({ activeTab, onTabChange, onBack, profile, onLogout }: SettingsSidebarProps) {
    const { avatarUrl: storedAvatar, decoration, userPanelBorder, nameColor, nameFont, customStatus } = useAvatarSync()

    return (
        <div className="sidebar">
            <div className="sidebar__header">
                <button className="btn btn--icon-sm btn--ghost" onClick={onBack} title="Back to channels">
                    <ArrowLeft size={18} />
                </button>
                <span className="sidebar__title">Settings</span>
            </div>

            <div className="sidebar__list">
                <div className="sidebar__section">
                    {tabs.map(tab => (
                        <div
                            key={tab.id}
                            className={`room-item ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => onTabChange(tab.id)}
                        >
                            <div className="room-item__icon">
                                {tab.icon}
                            </div>
                            <div className="room-item__info">
                                <div className="room-item__name">{tab.label}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* User Panel */}
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
                    </div>
                    <div className="user-panel__info">
                        <div 
                            className="user-panel__name"
                            style={{ 
                                color: nameColor !== 'default' ? NAME_COLORS[nameColor] : undefined,
                                fontFamily: nameFont !== 'default' ? NAME_FONTS[nameFont] : undefined,
                                fontSize: `calc(1em * ${getNameFontScale(nameFont)})`,
                            }}
                        >
                            {profile?.username || 'Loading...'}
                        </div>
                        <div className="user-panel__status" style={{ color: nameColor !== 'default' ? NAME_COLORS[nameColor] : undefined, fontStyle: 'italic' }}>
                            <span className="status-dot status-dot--online" />
                            {customStatus ? `❝${customStatus}❞` : 'Online'}
                        </div>
                    </div>
                    <button className="btn btn--icon-sm btn--ghost" onClick={onLogout} title="Sign out">
                        <LogOut size={16} />
                    </button>
                </div>
            </div>
        </div>
    )
}

export default SettingsSidebar
