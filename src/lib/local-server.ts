/**
 * Luma Local Server Client
 * 
 * Connects to a locally hosted Luma server (TeamSpeak-like)
 * Replaces Supabase for local/P2P connections
 */

export interface LocalUser {
    id: string
    username: string
    avatar_url: string | null
    status: 'online' | 'offline' | 'busy'
    decoration?: string
    border?: string
}

export interface LocalChannel {
    id: string
    name: string
    type: 'text' | 'voice'
    created_by: string
    created_at: string
}

export interface LocalMessage {
    id: string
    channel_id: string
    user_id: string
    content: string
    created_at: string
    user?: LocalUser
    image_url?: string | null
}

export interface LocalServerInfo {
    name: string
    hasPassword?: boolean
}

export interface LocalServerConfig {
    address: string
    port: number
    password?: string
}

type EventHandler = (data: any) => void

class LocalServerClient {
    private ws: WebSocket | null = null
    private connected: boolean = false
    private currentUser: LocalUser | null = null
    private serverInfo: LocalServerInfo | null = null
    private channels: LocalChannel[] = []
    private handlers: Map<string, Set<EventHandler>> = new Map()
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private reconnectAttempts: number = 0
    private maxReconnectAttempts: number = 5
    private pendingMessages: any[] = []
    private connectionPromise: { resolve: (user: LocalUser) => void; reject: (err: Error) => void } | null = null

    // ──────────────────────────── Connection ────────────────────────────

    async connect(config: LocalServerConfig, username?: string): Promise<LocalUser> {
        return new Promise((resolve, reject) => {
            const address = config.address.includes('://') ? config.address : `ws://${config.address}:${config.port}`
            
            console.log('[LocalServer] Connecting to', address)
            
            try {
                this.ws = new WebSocket(address)
                this.connectionPromise = { resolve, reject }
                
                this.ws.onopen = () => {
                    console.log('[LocalServer] WebSocket connected')
                    
                    // Send auth
                    const storedUserId = localStorage.getItem('luma_local_user_id')
                    const storedUsername = localStorage.getItem('luma_local_username')
                    const storedAvatar = localStorage.getItem('luma_user_avatar')
                    const storedDecoration = localStorage.getItem('luma_user_avatar_decoration')
                    const storedBorder = localStorage.getItem('luma_user_panel_border')
                    const storedNameColor = localStorage.getItem('luma_user_name_color')
                    const storedNameFont = localStorage.getItem('luma_user_name_font')
                    
                    this.send({
                        type: 'auth',
                        userId: storedUserId || undefined,
                        username: username || storedUsername || undefined,
                        avatar_url: storedAvatar || undefined,
                        decoration: storedDecoration || undefined,
                        border: storedBorder || undefined,
                        name_color: storedNameColor || undefined,
                        name_font: storedNameFont || undefined,
                        password: config.password,
                    })
                }
                
                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data)
                        this.handleMessage(data)
                    } catch (e) {
                        console.error('[LocalServer] Error parsing message:', e)
                    }
                }
                
                this.ws.onclose = (event) => {
                    console.log('[LocalServer] WebSocket closed:', event.code, event.reason)
                    const wasConnected = this.connected
                    this.connected = false
                    this.emit('disconnected', { code: event.code, reason: event.reason })
                    
                    // Only attempt reconnect if we were previously connected (not a failed initial connection)
                    if (wasConnected && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.reconnectAttempts++
                        console.log(`[LocalServer] Reconnecting in 2s (attempt ${this.reconnectAttempts})`)
                        this.reconnectTimer = setTimeout(() => {
                            this.connect(config)
                        }, 2000)
                    } else if (!wasConnected && this.connectionPromise) {
                        // Failed initial connection - reject the promise
                        this.connectionPromise.reject(new Error('Connection failed - check server address'))
                        this.connectionPromise = null
                    }
                }
                
                this.ws.onerror = (error) => {
                    console.error('[LocalServer] WebSocket error:', error)
                    if (this.connectionPromise) {
                        this.connectionPromise.reject(new Error('Connection failed'))
                        this.connectionPromise = null
                    }
                }
            } catch (e: any) {
                reject(new Error(`Failed to connect: ${e.message}`))
            }
        })
    }

    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        this.reconnectAttempts = this.maxReconnectAttempts // Prevent auto-reconnect
        
        if (this.ws) {
            this.ws.close()
            this.ws = null
        }
        
        this.connected = false
        this.currentUser = null
        this.channels = []
    }

    private send(data: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data))
        } else {
            // Queue message for when connection is ready
            this.pendingMessages.push(data)
        }
    }

    private handleMessage(data: any) {
        switch (data.type) {
            case 'auth-success': {
                this.connected = true
                this.currentUser = data.user
                this.serverInfo = data.server
                this.channels = data.channels
                
                // Store user ID for reconnection
                localStorage.setItem('luma_local_user_id', data.user.id)
                localStorage.setItem('luma_local_username', data.user.username)
                
                // Send pending messages
                while (this.pendingMessages.length > 0) {
                    const msg = this.pendingMessages.shift()!
                    this.send(msg)
                }
                
                if (this.connectionPromise) {
                    this.connectionPromise.resolve(data.user)
                    this.connectionPromise = null
                }
                
                this.emit('connected', { user: data.user, server: data.server, channels: data.channels })
                break
            }
            
            case 'auth-error': {
                if (this.connectionPromise) {
                    this.connectionPromise.reject(new Error(data.error))
                    this.connectionPromise = null
                }
                break
            }
            
            case 'channel-created': {
                this.channels.push(data.channel)
                this.emit('channel-created', data)
                break
            }
            
            case 'channel-deleted': {
                this.channels = this.channels.filter(c => c.id !== data.channelId)
                this.emit('channel-deleted', data)
                break
            }
            
            case 'messages': {
                this.emit('messages', data)
                break
            }
            
            case 'message': {
                this.emit('message', data)
                break
            }

            case 'messages-cleared': {
                this.emit('messages-cleared', data)
                break
            }
            
            case 'user-joined': {
                this.emit('user-joined', data)
                break
            }
            
            case 'user-left': {
                this.emit('user-left', data)
                break
            }
            
            case 'voice-session': {
                this.emit('voice-session', data)
                break
            }
            
            case 'voice-participants': {
                this.emit('voice-participants', data)
                break
            }
            
            case 'signal': {
                this.emit('signal', data)
                break
            }
            
            case 'screen-share': {
                this.emit('screen-share', data)
                break
            }
            
            case 'profile-updated': {
                if (this.currentUser && data.user.id === this.currentUser.id) {
                    this.currentUser = data.user
                }
                this.emit('profile-updated', data)
                break
            }
        }
    }

    // ──────────────────────────── Event Handling ────────────────────────────

    on(event: string, handler: EventHandler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set())
        }
        this.handlers.get(event)!.add(handler)
    }

    off(event: string, handler: EventHandler) {
        this.handlers.get(event)?.delete(handler)
    }

    private emit(event: string, data: any) {
        this.handlers.get(event)?.forEach(handler => {
            try {
                handler(data)
            } catch (e) {
                console.error(`[LocalServer] Error in handler for ${event}:`, e)
            }
        })
    }

    // ──────────────────────────── Getters ────────────────────────────

    isConnected(): boolean {
        return this.connected && this.ws?.readyState === WebSocket.OPEN
    }

    getUser(): LocalUser | null {
        return this.currentUser
    }

    getServerInfo(): LocalServerInfo | null {
        return this.serverInfo
    }

    getChannels(): LocalChannel[] {
        return this.channels
    }

    // ──────────────────────────── Actions ────────────────────────────

    createChannel(name: string, channelType: 'text' | 'voice' = 'text') {
        this.send({ type: 'create-channel', name, channelType })
    }

    deleteChannel(channelId: string) {
        this.send({ type: 'delete-channel', channelId })
    }

    getMessages(channelId: string) {
        this.send({ type: 'get-messages', channelId })
    }

    sendMessage(channelId: string, content: string, imageUrl?: string | null) {
        this.send({ type: 'send-message', channelId, content, imageUrl })
    }

    clearMessages(channelId: string) {
        this.send({ type: 'clear-messages', channelId })
    }

    getVoiceParticipants(channelId: string) {
        this.send({ type: 'get-voice-participants', channelId })
    }

    joinVoice(channelId: string) {
        this.send({ type: 'join-voice', channelId })
    }

    leaveVoice(channelId: string) {
        this.send({ type: 'leave-voice', channelId })
    }

    // WebRTC Signaling
    sendSignal(targetUserId: string, signal: any, channelId: string) {
        this.send({ type: 'signal', targetUserId, signal, channelId })
    }

    // Screen share
    startScreenShare(channelId: string) {
        this.send({ type: 'screen-start', channelId })
    }

    stopScreenShare(channelId: string) {
        this.send({ type: 'screen-stop', channelId })
    }

    // Profile
    updateProfile(data: { username?: string; status?: string; avatar_url?: string | null; decoration?: string; border?: string; name_color?: string; name_font?: string }) {
        this.send({ type: 'update-profile', username: data.username, status: data.status, avatar_url: data.avatar_url, decoration: data.decoration, border: data.border, name_color: data.name_color, name_font: data.name_font })
    }
}

// Singleton instance
export const localServer = new LocalServerClient()

// ──────────────────────────── Server Hosting (via Electron IPC) ────────────────────────────

export interface HostedServerConfig {
    name: string
    port: number
    password?: string
}

export async function startLocalServer(config: HostedServerConfig): Promise<{ success: boolean; error?: string }> {
    try {
        const result = await window.localServerAPI.start(config)
        return result
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

export async function stopLocalServer(): Promise<{ success: boolean }> {
    try {
        const result = await window.localServerAPI.stop()
        return result
    } catch {
        return { success: true }
    }
}

export async function getLocalServerStatus(): Promise<{ running: boolean; config?: HostedServerConfig; address?: string }> {
    try {
        const result = await window.localServerAPI.status()
        return result
    } catch {
        return { running: false }
    }
}

export async function getLocalIpAddress(): Promise<string> {
    try {
        const result = await window.networkAPI.getLocalIp()
        return result.ip || '127.0.0.1'
    } catch {
        return '127.0.0.1'
    }
}
