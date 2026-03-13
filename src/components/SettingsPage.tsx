import { useState, useEffect, useRef } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { localServer } from '../lib/local-server'
import { Profile } from '../lib/types'
import { SettingsTab } from '../pages/MainPage'
import {
    Mic,
    Headphones,
    Bell,
    User,
    Mail,
    Lock,
    Save,
    Loader2,
    Check,
    Info,
    Bot,
    Key,
    Cpu,
    AudioWaveform,
    Globe,
    Eye,
    MonitorUp,
    Music,
    Trash2,
    Upload,
    Volume2,
    Camera
} from 'lucide-react'
import CustomSelect from './CustomSelect'
import HotkeyInput from './HotkeyInput'
import { getLumaConfig, saveLumaConfig, getAvailableModels, getSTTModels, getVisionModels, PROVIDERS, getProvider, getProviderApiKey } from '../lib/luma'
import { getMCPConfig, saveMCPConfig, startMCP, stopMCP, getMCPStatus, getMCPTools, isMCPAvailable, type MCPTool } from '../lib/mcp'
import { getSoundpadConfig, saveSoundpadConfig, getAllSounds, addCustomSound, removeCustomSound, type SoundpadSound } from '../lib/soundpad'
import { getVoiceChangerConfig, saveVoiceChangerConfig, createVoiceChangerChain, VOICE_EFFECTS, type VoiceEffect, type VoiceChangerChain } from '../lib/voicechanger'
import AvatarCropModal from './AvatarCropModal'

interface SettingsPageProps {
    tab: SettingsTab
    onBack: () => void
    profile: Profile | null
    session: Session
    onProfileUpdated: () => void
}

function SettingsPage({ tab, onBack, profile, session, onProfileUpdated }: SettingsPageProps) {
    return (
        <>
            <div className="main-header">
                <div className="main-header__title">
                    {tab === 'audio' ? 'Voice & Audio' : tab === 'luma' ? 'Luma AI' : tab === 'browser' ? 'Browser' : tab === 'soundpad' ? 'Soundpad' : tab === 'voicechanger' ? 'Voice Changer' : 'My Profile'}
                </div>
            </div>

            <div className="settings-page">
                <div className="settings-page__content">
                    {tab === 'audio' ? (
                        <AudioSettings />
                    ) : tab === 'luma' ? (
                        <LumaSettings />
                    ) : tab === 'browser' ? (
                        <BrowserSettings />
                    ) : tab === 'soundpad' ? (
                        <SoundpadSettings />
                    ) : tab === 'voicechanger' ? (
                        <VoiceChangerSettings />
                    ) : (
                        <ProfileSettings
                            profile={profile}
                            session={session}
                            onProfileUpdated={onProfileUpdated}
                        />
                    )}
                </div>
            </div>
        </>
    )
}

/* ============================
   AUDIO SETTINGS TAB
   ============================ */
function AudioSettings() {
    const [inputVolume, setInputVolume] = useState(80)
    const [outputVolume, setOutputVolume] = useState(100)
    const [micLevel, setMicLevel] = useState(0)
    const [noiseSuppression, setNoiseSuppression] = useState(true)
    const [notifications, setNotifications] = useState(true)
    const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
    const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
    const [selectedInput, setSelectedInput] = useState('')
    const [selectedOutput, setSelectedOutput] = useState('')
    const [testing, setTesting] = useState(false)
    // Voice input settings
    const [voiceMode, setVoiceMode] = useState<'push-to-talk' | 'voice-activity'>(() => {
        const stored = localStorage.getItem('voice_settings')
        return stored ? JSON.parse(stored).voiceMode || 'voice-activity' : 'voice-activity'
    })
    const [pushToTalkKey, setPushToTalkKey] = useState(() => {
        const stored = localStorage.getItem('voice_settings')
        return stored ? JSON.parse(stored).pushToTalkKey || 'KeyV' : 'KeyV'
    })
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    const streamRef = useRef<MediaStream | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const animationRef = useRef<number | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const gainNodeRef = useRef<GainNode | null>(null)

    useEffect(() => {
        const getDevices = async () => {
            try {
                const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
                tempStream.getTracks().forEach(t => t.stop())
                const devices = await navigator.mediaDevices.enumerateDevices()
                setInputDevices(devices.filter(d => d.kind === 'audioinput'))
                setOutputDevices(devices.filter(d => d.kind === 'audiooutput'))
            } catch (err) {
                console.error('Cannot enumerate devices:', err)
            }
        }
        getDevices()
    }, [])

    const startMicTest = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: selectedInput ? { exact: selectedInput } : undefined,
                    echoCancellation: false,
                    noiseSuppression,
                    autoGainControl: true,
                },
            })
            streamRef.current = stream

            const audioContext = new AudioContext()
            audioContextRef.current = audioContext
            const source = audioContext.createMediaStreamSource(stream)

            const analyser = audioContext.createAnalyser()
            analyser.fftSize = 256
            source.connect(analyser)
            analyserRef.current = analyser

            const gainNode = audioContext.createGain()
            gainNode.gain.value = inputVolume / 100
            source.connect(gainNode)
            gainNode.connect(audioContext.destination)
            gainNodeRef.current = gainNode

            setTesting(true)

            const updateLevel = () => {
                if (!analyserRef.current) return
                const data = new Uint8Array(analyserRef.current.frequencyBinCount)
                analyserRef.current.getByteFrequencyData(data)
                const avg = data.reduce((a, b) => a + b, 0) / data.length
                setMicLevel(Math.min(100, (avg / 128) * 100))
                animationRef.current = requestAnimationFrame(updateLevel)
            }
            updateLevel()
        } catch (err) {
            console.error('Mic test failed:', err)
        }
    }

    const stopMicTest = () => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        if (animationRef.current) cancelAnimationFrame(animationRef.current)
        analyserRef.current = null
        if (audioContextRef.current) {
            audioContextRef.current.close()
            audioContextRef.current = null
        }
        gainNodeRef.current = null
        setTesting(false)
        setMicLevel(0)
    }

    useEffect(() => {
        if (gainNodeRef.current) gainNodeRef.current.gain.value = inputVolume / 100
    }, [inputVolume])

    useEffect(() => { return () => { stopMicTest() } }, [])

    const saveVoiceSettings = () => {
        setSaving(true)
        localStorage.setItem('voice_settings', JSON.stringify({ voiceMode, pushToTalkKey }))
        // Dispatch event to notify VoiceRoom
        window.dispatchEvent(new CustomEvent('voice-settings-changed'))
        setTimeout(() => {
            setSaving(false)
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
        }, 500)
    }

    return (
        <>
            <div className="settings-section">
                <div className="settings-section__title">
                    <Mic size={18} />
                    Microphone
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Input Device</div>
                        <div className="settings-row__desc">Select your microphone</div>
                    </div>
                    <div className="settings-row__control">
                        <CustomSelect
                            value={selectedInput}
                            onChange={setSelectedInput}
                            options={[
                                { value: '', label: 'Default' },
                                ...inputDevices.map(d => ({
                                    value: d.deviceId,
                                    label: d.label || `Microphone ${d.deviceId.slice(0, 5)}`
                                }))
                            ]}
                            placeholder="Default"
                        />
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Input Volume</div>
                        <div className="settings-row__desc">Adjust microphone sensitivity</div>
                    </div>
                    <div className="settings-row__control">
                        <input type="range" className="slider volume-slider" min={0} max={100}
                            value={inputVolume} onChange={(e) => setInputVolume(Number(e.target.value))} />
                        <span className="settings-row__value">{inputVolume}%</span>
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Mic Test</div>
                        <div className="settings-row__desc">
                            {testing ? 'Listening... speak to hear yourself' : 'Test your microphone'}
                        </div>
                    </div>
                    <div className="settings-row__control" style={{ gap: 12 }}>
                        <div className="mic-level-bar">
                            <div className="mic-level-bar__fill" style={{ width: `${micLevel}%` }} />
                        </div>
                        <button
                            className={`btn btn--sm ${testing ? 'btn--danger' : 'btn--primary'}`}
                            onClick={testing ? stopMicTest : startMicTest}
                        >
                            {testing ? 'Stop' : 'Test'}
                        </button>
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Noise Suppression</div>
                        <div className="settings-row__desc">Reduce background noise</div>
                    </div>
                    <div className="settings-row__control">
                        <div className={`toggle ${noiseSuppression ? 'active' : ''}`}
                            onClick={() => setNoiseSuppression(!noiseSuppression)} />
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Input Mode</div>
                        <div className="settings-row__desc">How your microphone transmits voice</div>
                    </div>
                    <div className="settings-row__control">
                        <CustomSelect
                            value={voiceMode}
                            onChange={(mode) => setVoiceMode(mode as 'push-to-talk' | 'voice-activity')}
                            options={[
                                { value: 'voice-activity', label: 'Voice Activity' },
                                { value: 'push-to-talk', label: 'Push to Talk' },
                            ]}
                        />
                    </div>
                </div>

                {voiceMode === 'push-to-talk' && (
                    <div className="settings-row">
                        <div>
                            <div className="settings-row__label">Push to Talk Key</div>
                            <div className="settings-row__desc">Hold this key to transmit voice</div>
                        </div>
                        <div className="settings-row__control">
                            <HotkeyInput
                                value={pushToTalkKey}
                                onChange={(key) => setPushToTalkKey(key)}
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Headphones size={18} />
                    Audio Output
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Output Device</div>
                        <div className="settings-row__desc">Select your speakers or headphones</div>
                    </div>
                    <div className="settings-row__control">
                        <CustomSelect
                            value={selectedOutput}
                            onChange={setSelectedOutput}
                            options={[
                                { value: '', label: 'Default' },
                                ...outputDevices.map(d => ({
                                    value: d.deviceId,
                                    label: d.label || `Speaker ${d.deviceId.slice(0, 5)}`
                                }))
                            ]}
                            placeholder="Default"
                        />
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Output Volume</div>
                        <div className="settings-row__desc">Adjust speaker/headphone volume</div>
                    </div>
                    <div className="settings-row__control">
                        <input type="range" className="slider volume-slider" min={0} max={100}
                            value={outputVolume} onChange={(e) => setOutputVolume(Number(e.target.value))} />
                        <span className="settings-row__value">{outputVolume}%</span>
                    </div>
                </div>
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Bell size={18} />
                    Notifications
                </div>
                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Sound Effects</div>
                        <div className="settings-row__desc">Play sounds for messages, calls, etc.</div>
                    </div>
                    <div className="settings-row__control">
                        <div className={`toggle ${notifications ? 'active' : ''}`}
                            onClick={() => setNotifications(!notifications)} />
                    </div>
                </div>
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Info size={18} />
                    About
                </div>
                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Luma</div>
                        <div className="settings-row__desc">Version 1.0.0 · Voice-first communication</div>
                    </div>
                </div>
            </div>

            <div className="settings-buttons">
                <button
                    className={`btn ${saved ? 'btn--success' : 'btn--primary'}`}
                    onClick={saveVoiceSettings}
                    disabled={saving}
                    style={{ minWidth: 100 }}
                >
                    {saving ? <Loader2 size={16} className="spin" /> :
                        saved ? <><Check size={16} /> Saved</> :
                            <><Save size={16} /> Save Settings</>}
                </button>
            </div>
        </>
    )
}

/* ============================
   PROFILE SETTINGS TAB
   ============================ */

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

function getNameColorValue(colorId: string): string {
    return NAME_COLORS[colorId] || NAME_COLORS.default
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

function getNameFontValue(fontId: string): string {
    return NAME_FONTS[fontId] || NAME_FONTS.default
}

function ProfileSettings({ profile, session, onProfileUpdated }: {
    profile: Profile | null
    session: Session
    onProfileUpdated: () => void
}) {
    const [username, setUsername] = useState(profile?.username || '')
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [customStatus, setCustomStatus] = useState(() => {
        return localStorage.getItem('luma_user_custom_status') || ''
    })

    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [passwordSaving, setPasswordSaving] = useState(false)
    const [passwordMsg, setPasswordMsg] = useState('')
    const [passwordError, setPasswordError] = useState('')

    const [newEmail, setNewEmail] = useState('')
    const [emailSaving, setEmailSaving] = useState(false)
    const [emailMsg, setEmailMsg] = useState('')
    const [emailError, setEmailError] = useState('')

    const [avatarModalOpen, setAvatarModalOpen] = useState(false)
    const [avatarUrl, setAvatarUrl] = useState<string | null>(() => {
        // Load from localStorage first (local avatar)
        const stored = localStorage.getItem('luma_user_avatar')
        return stored || profile?.avatar_url || null
    })
    const [avatarDecoration, setAvatarDecoration] = useState<string>(() => {
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

    useEffect(() => {
        if (profile) {
            setUsername(profile.username || '')
            // Prefer localStorage avatar over Supabase
            const storedAvatar = localStorage.getItem('luma_user_avatar')
            setAvatarUrl(storedAvatar || profile.avatar_url)
            // Sync profile customization from Supabase (source of truth) to localStorage (cache)
            if (profile.decoration) {
                setAvatarDecoration(profile.decoration)
                localStorage.setItem('luma_user_avatar_decoration', profile.decoration)
            }
            if (profile.border) {
                setUserPanelBorder(profile.border)
                localStorage.setItem('luma_user_panel_border', profile.border)
            }
            if (profile.name_color) {
                setNameColor(profile.name_color)
                localStorage.setItem('luma_user_name_color', profile.name_color)
            }
            if (profile.name_font) {
                setNameFont(profile.name_font)
                localStorage.setItem('luma_user_name_font', profile.name_font)
            }
        }
    }, [profile])

    const handleSaveProfile = async () => {
        if (!profile) return
        setSaving(true)
        setSaved(false)

        // Save username
        if (username.trim()) {
            await supabase
                .from('profiles')
                .update({ username: username.trim() })
                .eq('id', profile.id)
            localStorage.setItem('luma_user_username', username.trim())
            localServer.updateProfile({ username: username.trim() })
        }

        // Save custom status
        localStorage.setItem('luma_user_custom_status', customStatus)
        localServer.updateProfile({ status: customStatus })

        // Save decoration
        localStorage.setItem('luma_user_avatar_decoration', avatarDecoration)
        if (profile.id) {
            await supabase.from('profiles').update({ decoration: avatarDecoration }).eq('id', profile.id)
        }
        localServer.updateProfile({ decoration: avatarDecoration })

        // Save border
        localStorage.setItem('luma_user_panel_border', userPanelBorder)
        if (profile.id) {
            await supabase.from('profiles').update({ border: userPanelBorder }).eq('id', profile.id)
        }
        localServer.updateProfile({ border: userPanelBorder })

        // Save name color
        localStorage.setItem('luma_user_name_color', nameColor)
        if (profile.id) {
            await supabase.from('profiles').update({ name_color: nameColor }).eq('id', profile.id)
        }
        localServer.updateProfile({ name_color: nameColor })

        // Save name font
        localStorage.setItem('luma_user_name_font', nameFont)
        if (profile.id) {
            await supabase.from('profiles').update({ name_font: nameFont }).eq('id', profile.id)
        }
        localServer.updateProfile({ name_font: nameFont })

        // Save email if changed
        if (newEmail && newEmail.includes('@') && newEmail !== session.user.email) {
            setEmailError('')
            setEmailMsg('')
            const { error } = await supabase.auth.updateUser({ email: newEmail })
            if (error) {
                setEmailError(error.message)
            } else {
                setEmailMsg('Confirmation email sent! Check your inbox.')
                setNewEmail('')
                setTimeout(() => setEmailMsg(''), 5000)
            }
        }

        // Save password if changed
        if (newPassword) {
            if (newPassword.length < 6) {
                setPasswordError('Password must be at least 6 characters')
            } else {
                setPasswordError('')
                setPasswordMsg('')
                const { error } = await supabase.auth.updateUser({ password: newPassword })
                if (error) {
                    setPasswordError(error.message)
                } else {
                    setPasswordMsg('Password updated successfully')
                    setCurrentPassword('')
                    setNewPassword('')
                    setTimeout(() => setPasswordMsg(''), 3000)
                }
            }
        }

        window.dispatchEvent(new CustomEvent('avatar-updated'))
        onProfileUpdated()
        setSaving(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    const handleChangePassword = async () => {
        if (!newPassword || newPassword.length < 6) {
            setPasswordError('Password must be at least 6 characters')
            return
        }
        setPasswordSaving(true)
        setPasswordError('')
        setPasswordMsg('')

        const { error } = await supabase.auth.updateUser({ password: newPassword })

        if (error) {
            setPasswordError(error.message)
        } else {
            setPasswordMsg('Password updated successfully')
            setCurrentPassword('')
            setNewPassword('')
            setTimeout(() => setPasswordMsg(''), 3000)
        }
        setPasswordSaving(false)
    }

    const handleChangeEmail = async () => {
        if (!newEmail || !newEmail.includes('@')) {
            setEmailError('Please enter a valid email address')
            return
        }
        if (newEmail === session.user.email) {
            setEmailError('New email must be different from current email')
            return
        }
        setEmailSaving(true)
        setEmailError('')
        setEmailMsg('')

        const { error } = await supabase.auth.updateUser({ email: newEmail })

        if (error) {
            setEmailError(error.message)
        } else {
            setEmailMsg('Confirmation email sent! Check your inbox to verify the new email address.')
            setNewEmail('')
            setTimeout(() => setEmailMsg(''), 5000)
        }
        setEmailSaving(false)
    }

    const handleAvatarUpdated = (url: string) => {
        setAvatarUrl(url)
        onProfileUpdated()
        // Dispatch event to notify Sidebar
        window.dispatchEvent(new CustomEvent('avatar-updated'))
    }

    const handleDecorationChange = (decoration: string) => {
        setAvatarDecoration(decoration)
    }

    const handleUserPanelBorderChange = (border: string) => {
        setUserPanelBorder(border)
    }

    const handleNameColorChange = (name_color: string) => {
        setNameColor(name_color)
    }

    const handleNameFontChange = (name_font: string) => {
        setNameFont(name_font)
    }

    return (
        <>
            <AvatarCropModal
                isOpen={avatarModalOpen}
                onClose={() => setAvatarModalOpen(false)}
                currentAvatar={avatarUrl}
                userId={profile?.id || ''}
                onAvatarUpdated={handleAvatarUpdated}
            />

            <div className="settings-section">
                <div className="settings-section__title">
                    <User size={18} />
                    Profile
                </div>

                <div className={`profile-card ${userPanelBorder !== 'none' ? `user-panel-border user-panel-border--${userPanelBorder}` : ''}`}>
                    <div 
                        className={`avatar avatar--xl profile-avatar-editable avatar-decoration avatar-decoration--${avatarDecoration}`}
                        onClick={() => setAvatarModalOpen(true)}
                    >
                        {avatarUrl ? (
                            <img
                                src={avatarUrl}
                                alt={profile?.username || 'Avatar'}
                                className="avatar__image"
                            />
                        ) : (
                            (profile?.username?.charAt(0) || '?')
                        )}
                        <div className="profile-avatar-overlay">
                            <Camera size={20} />
                        </div>
                    </div>
                    <div className="profile-card__info">
                        <div 
                            className="profile-card__name"
                            style={{ 
                                color: nameColor !== 'default' ? getNameColorValue(nameColor) : undefined,
                                fontFamily: nameFont !== 'default' ? getNameFontValue(nameFont) : undefined,
                            }}
                        >{profile?.username || 'Loading...'}</div>
                        <div className="profile-card__email">{session.user.email}</div>
                        {customStatus && (
                            <div className="profile-card__status" style={{ color: nameColor !== 'default' ? getNameColorValue(nameColor) : undefined, fontStyle: 'italic' }}>❝{customStatus}❞</div>
                        )}
                    </div>
                </div>

                {/* Avatar Decoration Selector */}
                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                    <div className="settings-row__label">Avatar Decoration</div>
                    <div className="decoration-grid">
                        {[
                            { id: 'none', name: 'None' },
                            { id: 'glow', name: 'Glow Ring' },
                            { id: 'neon', name: 'Neon Pulse' },
                            { id: 'fire', name: 'Fire Ring' },
                            { id: 'ice', name: 'Ice Crystal' },
                            { id: 'rainbow', name: 'Rainbow' },
                            { id: 'galaxy', name: 'Galaxy' },
                            { id: 'gold', name: 'Gold Ring' },
                            { id: 'cyber', name: 'Cyberpunk' },
                            { id: 'nature', name: 'Nature' },
                            { id: 'heart', name: 'Heart' },
                            { id: 'starry', name: 'Starry' },
                            { id: 'diamond', name: 'Diamond' },
                            { id: 'shadow', name: 'Shadow' },
                        ].map(deco => (
                            <button
                                key={deco.id}
                                className={`decoration-option ${avatarDecoration === deco.id ? 'decoration-option--active' : ''}`}
                                onClick={() => handleDecorationChange(deco.id)}
                                title={deco.name}
                            >
                                <div className={`decoration-preview avatar-decoration avatar-decoration--${deco.id}`}>
                                    <div className="decoration-preview__inner" />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                    <div className="settings-row__label">Profile Border</div>
                    <div className="decoration-grid">
                        {[
                            { id: 'none', name: 'None' },
                            { id: 'sunset', name: 'Sunset' },
                            { id: 'ocean', name: 'Ocean' },
                            { id: 'forest', name: 'Forest' },
                            { id: 'candy', name: 'Candy' },
                            { id: 'mono', name: 'Mono' },
                            { id: 'galaxy', name: 'Galaxy' },
                            { id: 'neon', name: 'Neon' },
                            { id: 'gold', name: 'Gold' },
                            { id: 'lava', name: 'Lava' },
                            { id: 'circuit', name: 'Circuit' },
                            { id: 'carbon', name: 'Carbon' },
                            { id: 'holo', name: 'Holo' },
                        ].map(b => (
                            <button
                                key={b.id}
                                className={`decoration-option ${userPanelBorder === b.id ? 'decoration-option--active' : ''}`}
                                onClick={() => handleUserPanelBorderChange(b.id)}
                                title={b.name}
                            >
                                <div className={`user-panel-border-preview user-panel-border--${b.id}`} />
                            </button>
                        ))}
                    </div>
                </div>

                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                    <div className="settings-row__label">Name Color</div>
                    <div className="decoration-grid">
                        {[
                            { id: 'default', name: 'Default', color: 'var(--text-primary)' },
                            { id: 'red', name: 'Red', color: '#ef4444' },
                            { id: 'orange', name: 'Orange', color: '#f97316' },
                            { id: 'yellow', name: 'Yellow', color: '#eab308' },
                            { id: 'green', name: 'Green', color: '#22c55e' },
                            { id: 'cyan', name: 'Cyan', color: '#06b6d4' },
                            { id: 'blue', name: 'Blue', color: '#3b82f6' },
                            { id: 'purple', name: 'Purple', color: '#a855f7' },
                            { id: 'pink', name: 'Pink', color: '#ec4899' },
                            { id: 'white', name: 'White', color: '#ffffff' },
                        ].map(c => (
                            <button
                                key={c.id}
                                className={`decoration-option ${nameColor === c.id ? 'decoration-option--active' : ''}`}
                                onClick={() => handleNameColorChange(c.id)}
                                title={c.name}
                                style={{ width: 32, height: 32, padding: 0 }}
                            >
                                <div style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 6,
                                    background: c.color,
                                    border: c.id === 'default' ? '1px solid var(--border)' : 'none',
                                }} />
                            </button>
                        ))}
                    </div>
                </div>

                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                    <div className="settings-row__label">Name Font</div>
                    <div className="font-grid">
                        {[
                            { id: 'default', name: 'Default', font: 'inherit', category: 'modern' },
                            { id: 'unbounded', name: 'Unbounded', font: '"Unbounded", sans-serif', category: 'display' },
                            { id: 'righteous', name: 'Righteous', font: '"Righteous", cursive', category: 'display' },
                            { id: 'orbitron', name: 'Orbitron', font: '"Orbitron", sans-serif', category: 'display' },
                            { id: 'caveat', name: 'Caveat', font: '"Caveat", cursive', category: 'script' },
                            { id: 'dancing', name: 'Dancing', font: '"Dancing Script", cursive', category: 'script' },
                            { id: 'pacifico', name: 'Pacifico', font: '"Pacifico", cursive', category: 'script' },
                            { id: 'marker', name: 'Marker', font: '"Permanent Marker", cursive', category: 'script' },
                            { id: 'pixel', name: 'Pixel', font: '"Press Start 2P", cursive', category: 'retro' },
                        ].map(f => (
                            <button
                                key={f.id}
                                className={`font-option ${nameFont === f.id ? 'font-option--active' : ''}`}
                                onClick={() => handleNameFontChange(f.id)}
                                title={f.name}
                            >
                                <span className="font-option__preview" style={{ fontFamily: f.font, fontSize: `calc(1em * ${getNameFontScale(f.id)})` }}>
                                    {f.name}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                    <div className="settings-row__label">Username</div>
                    <input
                        className="input"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.slice(0, 32))}
                        placeholder="Enter username"
                        maxLength={32}
                    />
                </div>

                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                    <div className="settings-row__label">Status Message</div>
                    <input
                        className="input"
                        value={customStatus}
                        onChange={(e) => setCustomStatus(e.target.value.slice(0, 128))}
                        placeholder="Enter a status message"
                        maxLength={128}
                    />
                </div>

            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Mail size={18} />
                    Email
                </div>

                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                    <div className="settings-row__label">Current Email</div>
                    <input
                        className="input"
                        value={session.user.email || ''}
                        disabled
                        style={{ opacity: 0.6, cursor: 'not-allowed' }}
                    />
                </div>

                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                    <div className="settings-row__label">New Email</div>
                    <input
                        className="input"
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="Enter new email address"
                    />
                    {emailError && (
                        <div className="auth-form__error">{emailError}</div>
                    )}
                    {emailMsg && (
                        <div className="settings-alert settings-alert--success">{emailMsg}</div>
                    )}
                </div>
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Lock size={18} />
                    Change Password
                </div>

                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                    <div className="settings-row__label">New Password</div>
                    <input
                        className="input"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password (min 6 chars)"
                    />
                    {passwordError && (
                        <div className="auth-form__error">{passwordError}</div>
                    )}
                    {passwordMsg && (
                        <div className="settings-alert settings-alert--success">{passwordMsg}</div>
                    )}
                </div>
            </div>

            <button
                className="btn btn--primary btn--full"
                onClick={handleSaveProfile}
                disabled={saving}
                style={{ marginTop: 8 }}
            >
                {saving ? <><Loader2 size={16} className="spin" /> Saving...</> : saved ? <><Check size={16} /> Saved!</> : <><Save size={16} /> Save Changes</>}
            </button>
        </>
    )
}

export default SettingsPage

/* ============================
   LUMA AI SETTINGS TAB
   ============================ */
function LumaSettings() {
    const [config, setConfig] = useState(getLumaConfig)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

    const currentProvider = getProvider(config.provider)
    const models = getAvailableModels(config.provider)
    const sttModels = getSTTModels(config.provider)
    const visionModels = getVisionModels(config.provider)
    const currentApiKey = config.providerKeys[config.provider] || config.apiKey || ''

    const providerOptions = PROVIDERS.map(p => ({ value: p.id, label: p.name }))

    const handleProviderChange = (providerId: string) => {
        const p = getProvider(providerId)
        const newKeys = { ...config.providerKeys }
        // Migrate legacy apiKey to providerKeys for groq if needed
        if (config.apiKey && !newKeys['groq']) {
            newKeys['groq'] = config.apiKey
        }
        setConfig(c => ({
            ...c,
            provider: providerId,
            providerKeys: newKeys,
            model: p.textModels[0]?.value || c.model,
            sttModel: p.sttModels.length > 0 ? p.sttModels[0].value : c.sttModel,
            visionModel: p.visionModels.length > 0 ? p.visionModels[0].value : c.visionModel,
        }))
        setTestResult(null)
    }

    const handleApiKeyChange = (key: string) => {
        setConfig(c => ({
            ...c,
            apiKey: c.provider === 'groq' ? key : c.apiKey,
            providerKeys: { ...c.providerKeys, [c.provider]: key },
        }))
    }

    const handleSave = () => {
        setSaving(true)
        saveLumaConfig(config)
        setTimeout(() => {
            setSaving(false)
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
        }, 500)
    }

    const handleTest = async () => {
        const key = config.providerKeys[config.provider] || config.apiKey || ''
        if (currentProvider.apiKeyRequired && !key) {
            setTestResult({ success: false, message: 'Please enter an API key first' })
            return
        }

        setTesting(true)
        setTestResult(null)

        try {
            if (currentProvider.id === 'apifreellm') {
                const response = await fetch(`${currentProvider.baseUrl}/chat`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ message: 'Say hello in one word.', model: config.model }),
                })
                if (response.ok) {
                    setTestResult({ success: true, message: 'API key is valid! APIFreeLLM is ready to use.' })
                } else {
                    const error = await response.json().catch(() => ({}))
                    setTestResult({ success: false, message: error.error || 'Invalid API key or request failed' })
                }
            } else {
                const response = await fetch(`${currentProvider.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key || 'unused'}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: config.model,
                        messages: [{ role: 'user', content: 'Say "Hello!" in one word.' }],
                        max_tokens: 10,
                    }),
                })

                if (response.ok) {
                    setTestResult({ success: true, message: `API key is valid! ${currentProvider.name} is ready to use.` })
                } else {
                    const error = await response.json().catch(() => ({}))
                    setTestResult({ success: false, message: error.error?.message || 'Invalid API key' })
                }
            }
        } catch (e: any) {
            setTestResult({ success: false, message: e.message || 'Connection failed' })
        }

        setTesting(false)
    }

    return (
        <>
            <div className="settings-section">
                <div className="settings-section__title">
                    <Bot size={18} />
                    Luma AI Assistant
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Enable Luma</div>
                        <div className="settings-row__desc">Show Luma AI responses in your chat (local setting)</div>
                    </div>
                    <div className="settings-row__control">
                        <div
                            className={`toggle ${config.enabled ? 'active' : ''}`}
                            onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                        />
                    </div>
                </div>
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Key size={18} />
                    API Configuration
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Provider</div>
                        <div className="settings-row__desc">Choose your AI provider</div>
                    </div>
                    <div className="settings-row__control">
                        <CustomSelect
                            value={config.provider}
                            onChange={handleProviderChange}
                            options={providerOptions}
                        />
                    </div>
                </div>

                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                    <div className="settings-row__label">{currentProvider.apiKeyLabel || 'API Key'}</div>
                    <input
                        className="input"
                        type="password"
                        value={currentApiKey}
                        onChange={(e) => handleApiKeyChange(e.target.value)}
                        placeholder={currentProvider.apiKeyRequired ? 'Enter your API key...' : 'Optional token for higher rate limits'}
                    />
                    <div className="settings-row__desc" style={{ marginTop: -4 }}>
                        {config.provider === 'groq' && <>Get your key from <a href="https://console.groq.com/keys" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>console.groq.com/keys</a></>}
                        {config.provider === 'openai' && <>Get your key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>platform.openai.com/api-keys</a></>}
                        {config.provider === 'gemini' && <>Get your key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>aistudio.google.com/apikey</a></>}
                        {config.provider === 'llm7' && <>Get a token from <a href="https://token.llm7.io" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>token.llm7.io</a> (optional, works without key)</>}
                        {config.provider === 'apifreellm' && <>Get your key from <a href="https://apifreellm.com/en/api-access" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>apifreellm.com</a> — Sign in with Google</>}
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Test Connection</div>
                        <div className="settings-row__desc">Verify your API key works with {currentProvider.name}</div>
                    </div>
                    <div className="settings-row__control">
                        <button
                            className={`btn btn--sm ${testing ? '' : 'btn--primary'}`}
                            onClick={handleTest}
                            disabled={testing || (currentProvider.apiKeyRequired && !currentApiKey)}
                        >
                            {testing ? <Loader2 size={14} className="spin" /> : 'Test'}
                        </button>
                    </div>
                </div>

                {testResult && (
                    <div className={`settings-alert ${testResult.success ? 'settings-alert--success' : 'settings-alert--error'}`}>
                        {testResult.message}
                    </div>
                )}

                {config.provider !== 'groq' && currentProvider.ttsModels.length === 0 && (
                    <div style={{
                        padding: 'var(--s-3) var(--s-4)',
                        borderRadius: 'var(--r-md)',
                        background: 'var(--accent-soft)',
                        color: 'var(--text-secondary)',
                        fontSize: 12,
                        marginTop: 8,
                        lineHeight: 1.5,
                    }}>
                        <strong>Note:</strong> {currentProvider.name} does not support TTS/STT. Voice features will use Groq as fallback — make sure your Groq API key is also set.
                    </div>
                )}
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Cpu size={18} />
                    Model Selection
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">AI Model</div>
                        <div className="settings-row__desc">Choose the {currentProvider.name} model for responses</div>
                    </div>
                    <div className="settings-row__control">
                        <CustomSelect
                            value={config.model}
                            onChange={(model) => setConfig(c => ({ ...c, model }))}
                            options={models}
                        />
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Speech-to-Text Model</div>
                        <div className="settings-row__desc">
                            {currentProvider.sttModels.length > 0
                                ? `${currentProvider.name} model for voice recognition`
                                : 'Groq Whisper model for voice recognition (fallback)'}
                        </div>
                    </div>
                    <div className="settings-row__control">
                        <CustomSelect
                            value={config.sttModel}
                            onChange={(sttModel) => setConfig(c => ({ ...c, sttModel }))}
                            options={sttModels}
                        />
                    </div>
                </div>
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Eye size={18} />
                    Screen Vision
                </div>

                {visionModels.length > 0 ? (
                    <>
                        <div className="settings-row">
                            <div>
                                <div className="settings-row__label">Enable Screen Vision</div>
                                <div className="settings-row__desc">Let Luma see your screen share and answer questions about it</div>
                            </div>
                            <div className="settings-row__control">
                                <div
                                    className={`toggle ${config.visionEnabled ? 'active' : ''}`}
                                    onClick={() => setConfig(c => ({ ...c, visionEnabled: !c.visionEnabled }))}
                                />
                            </div>
                        </div>

                        <div className="settings-row">
                            <div>
                                <div className="settings-row__label">Vision Model</div>
                                <div className="settings-row__desc">{currentProvider.name} multimodal model for image understanding</div>
                            </div>
                            <div className="settings-row__control">
                                <CustomSelect
                                    value={config.visionModel}
                                    onChange={(visionModel) => setConfig(c => ({ ...c, visionModel }))}
                                    options={visionModels}
                                />
                            </div>
                        </div>

                        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, padding: 'var(--s-3) 0' }}>
                            <p style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <MonitorUp size={14} />
                                When enabled and screen sharing is active, Luma captures a screenshot when you talk to her and can describe or answer questions about what's on screen.
                            </p>
                        </div>
                    </>
                ) : (
                    <div style={{
                        padding: 'var(--s-4)',
                        fontSize: 13,
                        color: 'var(--text-muted)',
                        lineHeight: 1.6,
                    }}>
                        {currentProvider.name} does not support vision models. Switch to Groq, OpenAI, Gemini, or LLM7 to use Screen Vision.
                    </div>
                )}
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Mic size={18} />
                    Voice Settings
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Input Mode</div>
                        <div className="settings-row__desc">How Luma listens to your voice</div>
                    </div>
                    <div className="settings-row__control">
                        <CustomSelect
                            value={config.voiceMode}
                            onChange={(mode) => setConfig(c => ({ ...c, voiceMode: mode as 'push-to-talk' | 'voice-activity' }))}
                            options={[
                                { value: 'push-to-talk', label: 'Push to Talk' },
                                { value: 'voice-activity', label: 'Voice Activity' },
                            ]}
                        />
                    </div>
                </div>

                {config.voiceMode === 'push-to-talk' && (
                    <div className="settings-row">
                        <div>
                            <div className="settings-row__label">Push to Talk Key</div>
                            <div className="settings-row__desc">Hold this key to talk to Luma</div>
                        </div>
                        <div className="settings-row__control">
                            <HotkeyInput
                                value={config.pushToTalkKey}
                                onChange={(key) => setConfig(c => ({ ...c, pushToTalkKey: key }))}
                            />
                        </div>
                    </div>
                )}

                {config.voiceMode === 'voice-activity' && (
                    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                        <div className="settings-row__label">Voice Activity Threshold</div>
                        <input
                            type="range"
                            className="slider"
                            min="0"
                            max="1"
                            step="0.1"
                            value={config.voiceActivityThreshold}
                            onChange={(e) => setConfig(c => ({ ...c, voiceActivityThreshold: parseFloat(e.target.value) }))}
                        />
                        <div className="settings-row__desc" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>More sensitive</span>
                            <span>Less sensitive</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="settings-section" style={{ marginTop: 24 }}>
                <div className="settings-section__title">
                    <Info size={18} />
                    How to Use
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    <p style={{ marginBottom: 8 }}>Type <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: 4 }}>/ask your question</code> in any chat channel to ask Luma AI.</p>
                    <p style={{ marginBottom: 8 }}>Use <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: 4 }}>/speak your question</code> to get a voice response.</p>
                    <p>Use <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: 4 }}>/clear</code> to clear all messages in the channel.</p>
                </div>
            </div>

            <div className="settings-buttons">
                <button
                    className={`btn ${saved ? 'btn--success' : 'btn--primary'}`}
                    onClick={handleSave}
                    disabled={saving}
                    style={{ minWidth: 100 }}
                >
                    {saving ? <Loader2 size={16} className="spin" /> :
                        saved ? <><Check size={16} /> Saved</> :
                            <><Save size={16} /> Save Settings</>}
                </button>
            </div>
        </>
    )
}

/* ============================
   BROWSER MCP SETTINGS TAB
   ============================ */
function BrowserSettings() {
    const [config, setConfig] = useState(getMCPConfig)
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
    const [tools, setTools] = useState<MCPTool[]>([])
    const [errorMsg, setErrorMsg] = useState('')
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    const available = isMCPAvailable()

    // Check status on mount and auto-reconnect if was connected
    useEffect(() => {
        if (!available) return
        
        // Auto-reconnect if was connected before
        if (config.connected && config.enabled) {
            setStatus('connecting')
            startMCP(config.provider || 'playwright').then(result => {
                if (result.success) {
                    setStatus('connected')
                    getMCPTools(config.provider || 'playwright').then(t => setTools(t))
                } else {
                    setStatus('disconnected')
                    // Clear connected state if failed
                    const newConfig = { ...config, connected: false }
                    setConfig(newConfig)
                    saveMCPConfig(newConfig)
                }
            })
            return
        }
        
        // Otherwise just check current status
        getMCPStatus().then(s => {
            if (s.running) {
                setStatus('connected')
                getMCPTools().then(t => setTools(t))
            }
        })
    }, [available])

    const handleConnect = async () => {
        setStatus('connecting')
        setErrorMsg('')
        setTools([])
        const result = await startMCP(config.provider || 'playwright')
        if (result.success) {
            setStatus('connected')
            // Save connected state
            const newConfig = { ...config, connected: true }
            setConfig(newConfig)
            saveMCPConfig(newConfig)
            // Fetch tools after connecting
            const fetchedTools = await getMCPTools(config.provider || 'playwright')
            setTools(fetchedTools)
        } else {
            setStatus('error')
            setErrorMsg(result.error || 'Failed to start MCP server')
        }
    }

    const handleDisconnect = async () => {
        await stopMCP(config.provider || 'playwright')
        setStatus('disconnected')
        setTools([])
        // Save disconnected state
        const newConfig = { ...config, connected: false }
        setConfig(newConfig)
        saveMCPConfig(newConfig)
    }

    const handleSave = () => {
        setSaving(true)
        saveMCPConfig(config)
        // Auto-connect or disconnect based on toggle
        if (config.enabled && status === 'disconnected') {
            handleConnect()
        } else if (!config.enabled && status === 'connected') {
            handleDisconnect()
        }
        setTimeout(() => {
            setSaving(false)
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
        }, 500)
    }

    const statusColor = status === 'connected' ? 'var(--green)' : status === 'error' ? 'var(--red)' : status === 'connecting' ? 'var(--yellow, #f59e0b)' : 'var(--text-muted)'
    const statusLabel = status === 'connected' ? 'Connected' : status === 'error' ? 'Error' : status === 'connecting' ? 'Connecting...' : 'Disconnected'

    return (
        <>
            <div className="settings-section">
                <div className="settings-section__title">
                    <Globe size={18} />
                    Browser
                </div>

                {!available && (
                    <div style={{
                        padding: 'var(--s-3) var(--s-4)',
                        borderRadius: 'var(--r-md)',
                        background: 'var(--red-soft)',
                        color: 'var(--red)',
                        fontSize: 13,
                        marginBottom: 12
                    }}>
                        MCP is only available in the desktop app (Electron)
                    </div>
                )}

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Enable Browser Automation</div>
                        <div className="settings-row__desc">Allow Luma AI to automate a browser using an MCP provider</div>
                    </div>
                    <div className="settings-row__control">
                        <div
                            className={`toggle ${config.enabled ? 'active' : ''}`}
                            onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                        />
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Provider</div>
                        <div className="settings-row__desc">Choose which MCP backend to use</div>
                    </div>
                    <div className="settings-row__control">
                        <CustomSelect
                            value={config.provider || 'playwright'}
                            onChange={(provider) => setConfig(c => ({ ...c, provider: provider as 'playwright' | 'chrome-cdp' }))}
                            options={[
                                { value: 'playwright', label: 'Playwright (recommended)' },
                                { value: 'chrome-cdp', label: 'Chrome CDP (your browser)' },
                            ]}
                            disabled={!config.enabled}
                        />
                    </div>
                </div>
            </div>

            {config.enabled && (
                <>
                    <div className="settings-section">
                        <div className="settings-section__title">
                            <Info size={18} />
                            Connection
                        </div>

                        <div className="settings-row">
                            <div>
                                <div className="settings-row__label">Status</div>
                                <div className="settings-row__desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{
                                        width: 8, height: 8, borderRadius: '50%',
                                        background: statusColor,
                                        display: 'inline-block',
                                        boxShadow: status === 'connected' ? '0 0 6px var(--green)' : undefined,
                                    }} />
                                    {statusLabel}
                                </div>
                            </div>
                            <div className="settings-row__control">
                                {status === 'connected' ? (
                                    <button className="btn btn--sm btn--danger" onClick={handleDisconnect}>
                                        Disconnect
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn--sm btn--primary"
                                        onClick={handleConnect}
                                        disabled={!available || status === 'connecting'}
                                    >
                                        {status === 'connecting' ? <Loader2 size={14} className="spin" /> : 'Connect'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {errorMsg && (
                            <div style={{
                                padding: 'var(--s-3) var(--s-4)',
                                borderRadius: 'var(--r-md)',
                                background: 'var(--red-soft)',
                                color: 'var(--red)',
                                fontSize: 13,
                                marginTop: 8
                            }}>
                                {errorMsg}
                            </div>
                        )}
                    </div>

                    {tools.length > 0 && (
                        <div className="settings-section">
                            <div className="settings-section__title">
                                <Cpu size={18} />
                                Available Tools ({tools.length})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {tools.map(tool => (
                                    <div key={tool.name} className="settings-row" style={{ padding: '8px 12px' }}>
                                        <div>
                                            <div className="settings-row__label" style={{ fontSize: 13, fontFamily: 'monospace' }}>
                                                {tool.name}
                                            </div>
                                            {tool.description && (
                                                <div className="settings-row__desc" style={{ fontSize: 12 }}>
                                                    {tool.description}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            <div className="settings-section">
                <div className="settings-section__title">
                    <Info size={18} />
                    About
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    <p style={{ marginBottom: 8 }}>Browser MCP uses the <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: 4 }}>@browsermcp/mcp</code> package to give Luma AI browser automation capabilities.</p>
                    <p style={{ marginBottom: 8 }}>When enabled, Luma can navigate pages, fill forms, click elements, extract data, and more — all through your existing browser.</p>
                    <p>The MCP server runs locally on your machine. Your browser data stays private.</p>
                </div>
            </div>

            <div className="settings-buttons">
                <button
                    className={`btn ${saved ? 'btn--success' : 'btn--primary'}`}
                    onClick={handleSave}
                    disabled={saving}
                    style={{ minWidth: 100 }}
                >
                    {saving ? <Loader2 size={16} className="spin" /> :
                        saved ? <><Check size={16} /> Saved</> :
                            <><Save size={16} /> Save Settings</>}
                </button>
            </div>
        </>
    )
}

/* ===== Soundpad Settings ===== */
function SoundpadSettings() {
    const [config, setConfig] = useState(() => getSoundpadConfig())
    const [soundsList, setSoundsList] = useState<SoundpadSound[]>(() => getAllSounds())
    const [saved, setSaved] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleSave = () => {
        saveSoundpadConfig(config)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files) return
        Array.from(files).forEach(file => {
            if (!file.name.endsWith('.mp3') && !file.name.endsWith('.wav') && !file.name.endsWith('.ogg')) return
            const reader = new FileReader()
            reader.onload = () => {
                const dataUrl = reader.result as string
                const name = file.name.replace(/\.(mp3|wav|ogg)$/, '').replace(/[-_]/g, ' ')
                addCustomSound(name, file.name, dataUrl)
                setSoundsList(getAllSounds())
            }
            reader.readAsDataURL(file)
        })
        e.target.value = ''
    }

    const handleRemoveCustom = (id: string) => {
        const rawId = id.replace('custom-', '')
        removeCustomSound(rawId)
        setSoundsList(getAllSounds())
    }

    const defaultSounds = soundsList.filter(s => !s.isCustom)
    const customSounds = soundsList.filter(s => s.isCustom)

    return (
        <>
            <div className="settings-section">
                <div className="settings-section__title">
                    <Music size={18} />
                    Soundpad
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Enable Soundpad</div>
                        <div className="settings-row__desc">Play sound effects during voice calls that everyone can hear</div>
                    </div>
                    <div className="settings-row__control">
                        <div
                            className={`toggle ${config.enabled ? 'active' : ''}`}
                            onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                        />
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Volume</div>
                        <div className="settings-row__desc">Soundpad playback volume</div>
                    </div>
                    <div className="settings-row__control">
                        <div className="settings-row__value">{Math.round(config.volume * 100)}%</div>
                        <input
                            type="range"
                            className="slider volume-slider"
                            min="0"
                            max="1"
                            step="0.05"
                            value={config.volume}
                            onChange={(e) => setConfig(c => ({ ...c, volume: parseFloat(e.target.value) }))}
                        />
                    </div>
                </div>
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Volume2 size={18} />
                    Default Sounds ({defaultSounds.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                    {defaultSounds.map(s => (
                        <div key={s.id} style={{
                            padding: '8px 12px',
                            background: 'var(--bg-app)',
                            borderRadius: 'var(--r-md)',
                            border: '1px solid var(--border)',
                            fontSize: 12,
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}>
                            <Music size={12} />
                            {s.name}
                        </div>
                    ))}
                </div>
            </div>

            <div className="settings-section">
                <div className="settings-section__title" style={{ justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                        <Upload size={18} />
                        Custom Sounds ({customSounds.length})
                    </span>
                    <button
                        className="btn btn--sm btn--primary"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <Upload size={14} /> Import
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".mp3,.wav,.ogg"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleImport}
                    />
                </div>

                {customSounds.length === 0 ? (
                    <div style={{
                        padding: 'var(--s-6)',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        fontSize: 13,
                    }}>
                        No custom sounds imported yet. Click "Import" to add your own MP3, WAV, or OGG files.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {customSounds.map(s => (
                            <div key={s.id} style={{
                                padding: '8px 12px',
                                background: 'var(--bg-app)',
                                borderRadius: 'var(--r-md)',
                                border: '1px solid var(--border)',
                                fontSize: 13,
                                color: 'var(--text-secondary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Music size={14} />
                                    {s.name}
                                </span>
                                <button
                                    className="btn btn--icon-sm btn--ghost"
                                    onClick={() => handleRemoveCustom(s.id)}
                                    title="Remove"
                                    style={{ color: 'var(--red)' }}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="settings-buttons">
                <button
                    className={`btn ${saved ? 'btn--success' : 'btn--primary'}`}
                    onClick={handleSave}
                    style={{ minWidth: 100 }}
                >
                    {saved ? <><Check size={16} /> Saved</> : <><Save size={16} /> Save Settings</>}
                </button>
            </div>
        </>
    )
}

/* ===== Voice Changer Settings ===== */
function VoiceChangerSettings() {
    const [config, setConfig] = useState(() => getVoiceChangerConfig())
    const [saved, setSaved] = useState(false)
    const [testingMic, setTestingMic] = useState(false)
    const testAudioContextRef = useRef<AudioContext | null>(null)
    const testStreamRef = useRef<MediaStream | null>(null)
    const testChainRef = useRef<VoiceChangerChain | null>(null)
    const testPassthroughSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

    const stopMicTest = async () => {
        if (testChainRef.current) {
            testChainRef.current.cleanup()
            testChainRef.current = null
        }

        if (testPassthroughSourceRef.current) {
            try { testPassthroughSourceRef.current.disconnect() } catch {}
            testPassthroughSourceRef.current = null
        }

        if (testStreamRef.current) {
            testStreamRef.current.getTracks().forEach(track => track.stop())
            testStreamRef.current = null
        }

        if (testAudioContextRef.current) {
            try { await testAudioContextRef.current.close() } catch {}
            testAudioContextRef.current = null
        }

        setTestingMic(false)
    }

    const startMicTest = async () => {
        await stopMicTest()

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

            const ctx = new AudioContext({ sampleRate: 48000 })
            if (ctx.state === 'suspended') {
                await ctx.resume().catch(() => {})
            }

            testStreamRef.current = stream
            testAudioContextRef.current = ctx

            if (config.enabled && config.effect !== 'none') {
                testChainRef.current = createVoiceChangerChain(ctx, stream, config.effect, config.intensity, ctx.destination)
            } else {
                const source = ctx.createMediaStreamSource(stream)
                testPassthroughSourceRef.current = source
                source.connect(ctx.destination)
            }

            setTestingMic(true)
        } catch (err) {
            console.error('[VoiceChangerSettings] Failed to start mic test:', err)
            await stopMicTest()
        }
    }

    const handleSave = () => {
        saveVoiceChangerConfig(config)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    useEffect(() => {
        return () => {
            stopMicTest()
        }
    }, [])

    const effectOptions = VOICE_EFFECTS.map(e => ({ value: e.value, label: e.label }))

    return (
        <>
            <div className="settings-section">
                <div className="settings-section__title">
                    <AudioWaveform size={18} />
                    Voice Changer
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Enable Voice Changer</div>
                        <div className="settings-row__desc">Apply real-time effects to your voice in calls</div>
                    </div>
                    <div className="settings-row__control">
                        <div
                            className={`toggle ${config.enabled ? 'active' : ''}`}
                            onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                        />
                    </div>
                </div>

                <div className="settings-row">
                    <div>
                        <div className="settings-row__label">Effect</div>
                        <div className="settings-row__desc">Choose a voice effect</div>
                    </div>
                    <div className="settings-row__control">
                        <CustomSelect
                            value={config.effect}
                            onChange={(effect) => setConfig(c => ({ ...c, effect: effect as VoiceEffect }))}
                            options={effectOptions}
                        />
                    </div>
                </div>

                {config.effect !== 'none' && (
                    <div className="settings-row">
                        <div>
                            <div className="settings-row__label">Intensity</div>
                            <div className="settings-row__desc">
                                {VOICE_EFFECTS.find(e => e.value === config.effect)?.description || 'Adjust effect strength'}
                            </div>
                        </div>
                        <div className="settings-row__control">
                            <div className="settings-row__value">{Math.round(config.intensity * 100)}%</div>
                            <input
                                type="range"
                                className="slider volume-slider"
                                min="0"
                                max="1"
                                step="0.05"
                                value={config.intensity}
                                onChange={(e) => setConfig(c => ({ ...c, intensity: parseFloat(e.target.value) }))}
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Info size={18} />
                    Available Effects
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {VOICE_EFFECTS.map(effect => (
                        <div
                            key={effect.value}
                            style={{
                                padding: '10px 14px',
                                background: config.effect === effect.value ? 'var(--accent-soft)' : 'var(--bg-app)',
                                borderRadius: 'var(--r-md)',
                                border: `1px solid ${config.effect === effect.value ? 'var(--accent)' : 'var(--border)'}`,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                            }}
                            onClick={() => setConfig(c => ({ ...c, effect: effect.value, enabled: effect.value !== 'none' }))}
                        >
                            <div style={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: config.effect === effect.value ? 'var(--accent)' : 'var(--text-primary)',
                                marginBottom: 2,
                            }}>
                                {effect.label}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {effect.description}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="settings-section">
                <div className="settings-section__title">
                    <Mic size={18} />
                    Microphone Test
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                    Use headphones when possible. This preview plays your processed microphone locally so you can test the selected effect before joining a call.
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        className={`btn ${testingMic ? 'btn--danger' : 'btn--primary'}`}
                        onClick={testingMic ? stopMicTest : startMicTest}
                    >
                        <Mic size={16} />
                        {testingMic ? 'Stop Mic Test' : 'Start Mic Test'}
                    </button>
                    <div style={{ fontSize: 12, color: testingMic ? 'var(--green)' : 'var(--text-muted)' }}>
                        {testingMic ? 'Mic test active' : 'Mic test inactive'}
                    </div>
                </div>
            </div>

            <div style={{
                padding: 'var(--s-3) var(--s-4)',
                borderRadius: 'var(--r-md)',
                background: 'var(--accent-soft)',
                color: 'var(--text-secondary)',
                fontSize: 12,
                lineHeight: 1.5,
                marginTop: 8,
            }}>
                <strong>Note:</strong> Voice changer settings are applied when you join a voice call. If you're already in a call, you'll need to disconnect and reconnect for changes to take effect.
            </div>

            <div className="settings-buttons">
                <button
                    className={`btn ${saved ? 'btn--success' : 'btn--primary'}`}
                    onClick={handleSave}
                    style={{ minWidth: 100 }}
                >
                    {saved ? <><Check size={16} /> Saved</> : <><Save size={16} /> Save Settings</>}
                </button>
            </div>
        </>
    )
}
