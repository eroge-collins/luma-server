import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { localServer } from '../lib/local-server'
import { Channel, Profile } from '../lib/types'
import { resumeAudioContext } from '../lib/sounds'
import Sidebar from '../components/Sidebar'
import SettingsSidebar from '../components/SettingsSidebar'
import ChatView from '../components/ChatView'
import VoiceRoom from '../components/VoiceRoom'
import SettingsPage from '../components/SettingsPage'
import CreateChannelModal from '../components/CreateChannelModal'
import { MessageCircle } from 'lucide-react'

interface MainPageProps {
    session: Session
}

export type View = 'chat' | 'settings'
export type SettingsTab = 'audio' | 'profile' | 'luma' | 'browser' | 'soundpad' | 'voicechanger'

function MainPage({ session }: MainPageProps) {
    const [channels, setChannels] = useState<Channel[]>([])
    const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
    const [profile, setProfile] = useState<Profile | null>(null)
    const [showCreateChannel, setShowCreateChannel] = useState(false)
    const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null)
    const [view, setView] = useState<View>('chat')
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile')
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [initialLoad, setInitialLoad] = useState(true)
    const [serverConnected, setServerConnected] = useState(false)

    // Ref to VoiceRoom's disconnect function so sidebar can call it
    const voiceDisconnectRef = useRef<(() => Promise<void>) | null>(null)


    useEffect(() => {
        const handler = () => {
            resumeAudioContext()
            document.removeEventListener('click', handler)
        }
        document.addEventListener('click', handler)
        return () => document.removeEventListener('click', handler)
    }, [])

    const fetchProfile = useCallback(async () => {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()

        if (error) {
            const username = session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'User'
            const { data: newProfile } = await supabase
                .from('profiles')
                .insert({ id: session.user.id, username, status: 'online' })
                .select()
                .single()
            if (newProfile) {
                setProfile(newProfile)
                syncProfileToLocalStorage(newProfile)
            }
        } else {
            setProfile(data)
            syncProfileToLocalStorage(data)
            await supabase.from('profiles').update({ status: 'online' }).eq('id', session.user.id)
        }
    }, [session])

    // Sync Supabase profile settings to localStorage so they persist across local servers
    const syncProfileToLocalStorage = (p: Profile) => {
        if (p.username) localStorage.setItem('luma_user_username', p.username)
        if (p.decoration) localStorage.setItem('luma_user_avatar_decoration', p.decoration)
        if (p.border) localStorage.setItem('luma_user_panel_border', p.border)
        if (p.name_color) localStorage.setItem('luma_user_name_color', p.name_color)
        if (p.name_font) localStorage.setItem('luma_user_name_font', p.name_font)
        // Sync avatar from Supabase if it's a proper URL (not a data: URI from local crop)
        // Always update if Supabase has a URL and localStorage either is empty or has a Supabase URL
        if (p.avatar_url) {
            const currentLocal = localStorage.getItem('luma_user_avatar')
            const isLocalDataUri = currentLocal?.startsWith('data:')
            // If localStorage has a data URI, keep it (it's a locally cropped avatar not yet uploaded)
            // Otherwise, use the Supabase URL as the source of truth
            if (!currentLocal || !isLocalDataUri) {
                localStorage.setItem('luma_user_avatar', p.avatar_url)
            }
        }
        // Sync user ID for local server identity
        localStorage.setItem('luma_local_user_id', p.id)
        window.dispatchEvent(new CustomEvent('avatar-updated'))
    }

    useEffect(() => {
        fetchProfile()
        setInitialLoad(false)
    }, [fetchProfile])

    useEffect(() => {
        const sync = () => {
            const connected = localServer.isConnected()
            setServerConnected(connected)
            if (connected) {
                setChannels(localServer.getChannels() as unknown as Channel[])
            } else {
                setChannels([])
                setActiveChannel(null)
                setVoiceChannelId(null)
            }
        }

        const onConnected = () => sync()
        const onDisconnected = () => sync()
        const onChannelCreated = () => setChannels(localServer.getChannels() as unknown as Channel[])
        const onChannelDeleted = () => setChannels(localServer.getChannels() as unknown as Channel[])

        localServer.on('connected', onConnected)
        localServer.on('disconnected', onDisconnected)
        localServer.on('channel-created', onChannelCreated)
        localServer.on('channel-deleted', onChannelDeleted)
        sync()

        return () => {
            localServer.off('connected', onConnected)
            localServer.off('disconnected', onDisconnected)
            localServer.off('channel-created', onChannelCreated)
            localServer.off('channel-deleted', onChannelDeleted)
        }
    }, [])

    const handleChannelCreated = () => {
        setShowCreateChannel(false)
    }

    const handleSelectChannel = (channel: Channel) => {
        setActiveChannel(channel)
        setView('chat')
    }

    // Full disconnect: calls VoiceRoom's cleanup + clears state
    const handleFullDisconnect = async () => {
        if (voiceDisconnectRef.current) {
            await voiceDisconnectRef.current()
        }
        setVoiceChannelId(null)
    }

    const handleLogout = async () => {
        if (voiceDisconnectRef.current) {
            await voiceDisconnectRef.current()
        }
        if (localServer.isConnected()) {
            localServer.disconnect()
        }
        await supabase.from('profiles').update({ status: 'offline' }).eq('id', session.user.id)
        await supabase.auth.signOut()
    }

    const textChannels = channels.filter(c => c.type === 'text')
    const voiceChannels = channels.filter(c => c.type === 'voice')

    // Find the voice channel object
    const connectedVoiceChannel = channels.find(c => c.id === voiceChannelId)

    // Determine what to show in main area
    const showingVoice = view === 'chat' && activeChannel?.type === 'voice' && activeChannel.id === voiceChannelId

    return (
        <div className="app-layout">
            {initialLoad ? (
                // Keep sidebar width during loading to avoid expansion flick
                <div style={{ 
                    width: '300px', 
                    flexShrink: 0,
                    background: 'var(--bg-sidebar)',
                    borderRight: '1px solid var(--border)'
                }} />
            ) : view === 'settings' ? (
                <SettingsSidebar
                    activeTab={settingsTab}
                    onTabChange={setSettingsTab}
                    onBack={() => setView('chat')}
                    profile={profile}
                    onLogout={handleLogout}
                />
            ) : (
                <Sidebar
                    textChannels={textChannels}
                    voiceChannels={voiceChannels}
                    activeChannel={activeChannel}
                    voiceChannelId={voiceChannelId}
                    profile={profile}
                    view={view}
                    isSpeaking={isSpeaking}
                    onSelectChannel={handleSelectChannel}
                    onJoinVoice={(id: string) => setVoiceChannelId(id)}
                    onLeaveVoice={handleFullDisconnect}
                    onCreateChannel={() => {
                        if (!serverConnected) return
                        setShowCreateChannel(true)
                    }}
                    onOpenSettings={() => { setView('settings'); setSettingsTab('profile') }}
                    onLogout={handleLogout}
                />
            )}

            <div className="main-content">
                {/* VoiceRoom - always exists when voiceChannelId is set, never unmounts */}
                {/* Rendered FIRST to ensure stream is created before any cleanup */}
                {serverConnected && voiceChannelId && connectedVoiceChannel && (
                    <div
                        className="voice-room-container"
                        style={{
                            display: view === 'chat' && activeChannel?.id === voiceChannelId ? 'flex' : 'none',
                        }}
                    >
                        <VoiceRoom
                            key={`connected-${voiceChannelId}`}
                            channel={connectedVoiceChannel}
                            userId={session.user.id}
                            isConnected={true}
                            onJoin={() => { }}
                            onLeave={() => setVoiceChannelId(null)}
                            onRegisterDisconnect={(fn: () => Promise<void>) => { voiceDisconnectRef.current = fn }}
                            onSpeakingChange={(_id: string, speaking: boolean) => setIsSpeaking(speaking)}
                        />
                    </div>
                )}

                {/* Main content - shown when NOT viewing connected channel OR in settings */}
                {(view === 'settings' || !voiceChannelId || activeChannel?.id !== voiceChannelId) && (
                    view === 'settings' ? (
                        <SettingsPage
                            tab={settingsTab}
                            onBack={() => setView('chat')}
                            profile={profile}
                            session={session}
                            onProfileUpdated={fetchProfile}
                        />
                    ) : !serverConnected ? (
                        <div className="no-channel">
                            <div className="empty-state empty-state--overlay empty-state--animated">
                                <div className="empty-state__icon">
                                    <MessageCircle />
                                </div>
                                <div className="empty-state__title">Not connected to a server</div>
                                <div className="empty-state__desc">
                                    Open the server menu in the sidebar to host or connect.
                                </div>
                            </div>
                        </div>
                    ) : activeChannel ? (
                        activeChannel.type === 'text' ? (
                            <ChatView 
                                channel={activeChannel} 
                                userId={session.user.id} 
                                voiceChannelId={voiceChannelId}
                            />
                        ) : (
                            /* Viewing a voice channel we're NOT connected to */
                            <div className="voice-room-container">
                                <VoiceRoom
                                    channel={activeChannel}
                                    userId={session.user.id}
                                    isConnected={false}
                                    onJoin={() => setVoiceChannelId(activeChannel.id)}
                                    onLeave={() => setVoiceChannelId(null)}
                                />
                            </div>
                        )
                    ) : (
                        <div className="no-channel">
                            <div className="empty-state empty-state--overlay empty-state--animated">
                                <div className="empty-state__icon">
                                    <MessageCircle />
                                </div>
                                <div className="empty-state__title">No conversation selected</div>
                                <div className="empty-state__desc">
                                    Select a conversation to start
                                </div>
                            </div>
                        </div>
                    )
                )}
            </div>

            {/* Placeholder to sync height with ChatView/VoiceRoom */}
            {!activeChannel && (
                <div className="voice-controls-placeholder" />
            )}

            {showCreateChannel && createPortal(
                <CreateChannelModal
                    userId={session.user.id}
                    onCreated={handleChannelCreated}
                    onClose={() => setShowCreateChannel(false)}
                />,
                document.body
            )}
        </div>
    )
}

export default MainPage
