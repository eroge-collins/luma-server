/**
 * Luma Server - WebSocket chat server + Web management dashboard
 */

import { WebSocketServer, WebSocket } from 'ws'
import { createServer, Server as HttpServer, IncomingMessage, ServerResponse } from 'http'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { v4 as uuidv4 } from 'uuid'
import * as os from 'os'

// ──────────────────────────── Types ────────────────────────────

interface User {
    id: string
    username: string
    avatar_url: string | null
    status: 'online' | 'offline' | 'busy'
    decoration?: string
    border?: string
    name_color?: string
    name_font?: string
    ws?: WebSocket
}

interface Channel {
    id: string
    name: string
    type: 'text' | 'voice'
    created_by: string
    created_at: string
}

interface Message {
    id: string
    channel_id: string
    user_id: string
    content: string
    image_url?: string | null
    created_at: string
}

interface VoiceSession {
    id: string
    channel_id: string
    user_id: string
}

export interface ServerConfig {
    name: string
    port: number
    password?: string
    maxUsers?: number
}

interface LogEntry {
    time: string
    level: 'info' | 'warn' | 'error'
    message: string
}

// ──────────────────────────── MIME types ────────────────────────────

const MIME: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
}

// ──────────────────────────── Server Class ────────────────────────────

export class LumaServer {
    private config: ServerConfig
    private httpServer: HttpServer | null = null
    private wss: WebSocketServer | null = null

    private users: Map<string, User> = new Map()
    private channels: Channel[] = []
    private messages: Map<string, Message[]> = new Map()
    private voiceSessions: VoiceSession[] = []
    private connectedClients: Map<string, WebSocket> = new Map()
    private clientIPs: Map<string, string> = new Map()
    private clientConnectedAt: Map<string, string> = new Map()

    private running = false
    private startedAt: Date | null = null
    private totalMessages = 0
    private dataDir: string
    private uiDir: string
    private logs: LogEntry[] = []
    private sseClients: Set<ServerResponse> = new Set()

    private statsInterval: ReturnType<typeof setInterval> | null = null
    private saveTimer: ReturnType<typeof setTimeout> | null = null

    constructor(dataDir: string, uiDir: string) {
        this.dataDir = dataDir
        this.uiDir = uiDir
        // Use PORT from environment (Render) or default to 3737
        const port = process.env.PORT ? parseInt(process.env.PORT) : 3737
        this.config = { name: 'Luma Server', port, maxUsers: 50 }
        this.loadState()
    }

    // ──────────────────────────── Public API ────────────────────────────

    getConfig(): ServerConfig { return { ...this.config } }

    updateConfig(newConfig: Partial<ServerConfig>) {
        this.config = { ...this.config, ...newConfig }
        if ((newConfig as any).password === '') delete this.config.password
        this.saveJSON(join(this.dataDir, 'config.json'), this.config)
        this.log('info', `Configuration saved`)
    }

    getStats() {
        return {
            running: this.running,
            uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000) : 0,
            connectedUsers: this.connectedClients.size,
            totalUsers: this.users.size,
            channels: this.channels.length,
            totalMessages: this.totalMessages,
            voiceSessions: this.voiceSessions.length,
        }
    }

    getConnectedUsers() {
        const result: any[] = []
        this.connectedClients.forEach((_, userId) => {
            const u = this.users.get(userId)
            if (u) {
                result.push({
                    id: u.id, username: u.username, avatar_url: u.avatar_url,
                    status: u.status, ip: this.clientIPs.get(userId) || 'unknown',
                    connectedAt: this.clientConnectedAt.get(userId) || '',
                })
            }
        })
        return result
    }

    getNetworkAddresses(): { name: string; address: string }[] {
        const interfaces = os.networkInterfaces()
        const addresses: { name: string; address: string }[] = []
        for (const [name, nets] of Object.entries(interfaces)) {
            if (!nets) continue
            for (const net of nets) {
                if (net.family === 'IPv4' && !net.internal) {
                    addresses.push({ name, address: net.address })
                }
            }
        }
        return addresses
    }

    async start(): Promise<{ success: boolean; error?: string }> {
        if (this.running) return { success: false, error: 'Already running' }

        return new Promise((resolve) => {
            try {
                this.httpServer = createServer((req, res) => this.handleHTTP(req, res))
                this.wss = new WebSocketServer({ server: this.httpServer })
                this.setupWebSocket()

                this.httpServer.on('error', (err: any) => {
                    const msg = err.code === 'EADDRINUSE' ? `Port ${this.config.port} is already in use` : err.message
                    this.log('error', msg)
                    resolve({ success: false, error: msg })
                })

                this.httpServer.listen(this.config.port, '0.0.0.0', () => {
                    this.running = true
                    this.startedAt = new Date()
                    this.log('info', `Server "${this.config.name}" started on port ${this.config.port}`)

                    const addrs = this.getNetworkAddresses()
                    if (addrs.length > 0) {
                        this.log('info', `Dashboard: http://${addrs[0].address}:${this.config.port}`)
                        this.log('info', `WebSocket: ws://${addrs[0].address}:${this.config.port}`)
                    } else {
                        this.log('info', `Dashboard: http://localhost:${this.config.port}`)
                    }

                    this.statsInterval = setInterval(() => this.pushSSE('stats', this.getStats()), 2000)
                    resolve({ success: true })
                })
            } catch (e: any) {
                this.log('error', `Failed to start: ${e.message}`)
                resolve({ success: false, error: e.message })
            }
        })
    }

    async stop(): Promise<void> {
        if (!this.running) return
        this.log('info', 'Stopping server...')

        if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null }
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }

        this.connectedClients.forEach((ws) => { try { ws.close(1000, 'Server shutting down') } catch {} })
        this.connectedClients.clear()
        this.clientIPs.clear()
        this.clientConnectedAt.clear()
        this.voiceSessions = []
        this.users.forEach(u => { u.status = 'offline' })
        this.persistState()

        this.sseClients.forEach(res => { try { res.end() } catch {} })
        this.sseClients.clear()

        if (this.wss) { this.wss.close(); this.wss = null }
        if (this.httpServer) {
            await new Promise<void>((r) => this.httpServer!.close(() => r()))
            this.httpServer = null
        }

        this.running = false
        this.startedAt = null
        this.log('info', 'Server stopped')
    }

    kickUser(userId: string): boolean {
        const ws = this.connectedClients.get(userId)
        if (!ws) return false
        ws.close(1000, 'Kicked by admin')
        return true
    }

    // ──────────────────────────── SSE (Server-Sent Events) ────────────────────────────

    private pushSSE(event: string, data: any) {
        const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        this.sseClients.forEach(res => { try { res.write(msg) } catch {} })
    }

    // ──────────────────────────── Storage ────────────────────────────

    private ensureDataDir() {
        if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true })
    }

    private loadJSON<T>(file: string, defaultValue: T): T {
        try { if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8')) } catch {}
        return defaultValue
    }

    private saveJSON<T>(file: string, data: T) {
        try { writeFileSync(file, JSON.stringify(data, null, 2)) } catch {}
    }

    private debouncedSaveState(delayMs = 2000) {
        if (this.saveTimer) clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => { this.persistState(); this.saveTimer = null }, delayMs)
    }

    private loadState() {
        this.ensureDataDir()
        const configFile = join(this.dataDir, 'config.json')
        this.config = this.loadJSON(configFile, { name: 'Luma Server', port: 3737, maxUsers: 50 })
        this.saveJSON(configFile, this.config)

        const usersData = this.loadJSON<Record<string, any>>(join(this.dataDir, 'users.json'), {})
        this.users = new Map(Object.entries(usersData))

        this.channels = this.loadJSON(join(this.dataDir, 'channels.json'), [
            { id: 'general', name: 'general', type: 'text', created_by: 'system', created_at: new Date().toISOString() },
            { id: 'voice-general', name: 'General', type: 'voice', created_by: 'system', created_at: new Date().toISOString() },
        ])
        this.saveJSON(join(this.dataDir, 'channels.json'), this.channels)

        const msgsData = this.loadJSON<Record<string, Message[]>>(join(this.dataDir, 'messages.json'), {})
        this.messages = new Map(Object.entries(msgsData))
        this.totalMessages = 0
        this.messages.forEach(msgs => { this.totalMessages += msgs.length })
    }

    private persistState() {
        const usersData: Record<string, any> = {}
        this.users.forEach((user, id) => {
            usersData[id] = {
                id: user.id, username: user.username, avatar_url: user.avatar_url,
                status: user.status, decoration: user.decoration || 'none',
                border: user.border || 'none', name_color: user.name_color || 'default',
                name_font: user.name_font || 'default',
            }
        })
        this.saveJSON(join(this.dataDir, 'users.json'), usersData)
        this.saveJSON(join(this.dataDir, 'channels.json'), this.channels)
        this.saveJSON(join(this.dataDir, 'messages.json'), Object.fromEntries(this.messages))
    }

    // ──────────────────────────── Logging ────────────────────────────

    private log(level: 'info' | 'warn' | 'error', message: string) {
        const entry: LogEntry = { time: new Date().toISOString(), level, message }
        this.logs.push(entry)
        if (this.logs.length > 500) this.logs = this.logs.slice(-500)
        this.pushSSE('log', entry)
        const prefix = level === 'error' ? '\x1b[31m[ERROR]\x1b[0m' : level === 'warn' ? '\x1b[33m[WARN]\x1b[0m' : '\x1b[36m[INFO]\x1b[0m'
        console.log(`${prefix} ${message}`)
    }

    // ──────────────────────────── Networking helpers ────────────────────────────

    private broadcast(channelId: string, type: string, data: any, excludeUserId?: string) {
        const message = JSON.stringify({ type, ...data })
        this.connectedClients.forEach((ws, userId) => {
            if (excludeUserId && userId === excludeUserId) return
            if (ws.readyState === WebSocket.OPEN) ws.send(message)
        })
    }

    private sendToUser(userId: string, type: string, data: any) {
        const ws = this.connectedClients.get(userId)
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }))
    }

    // ──────────────────────────── HTTP ────────────────────────────

    private handleHTTP(req: IncomingMessage, res: ServerResponse) {
        const url = req.url || '/'
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

        // ──── Management API ────
        if (url.startsWith('/api/')) return this.handleAPI(req, res, url)

        // ──── Legacy endpoints ────
        if (url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'ok', name: this.config.name, users: this.connectedClients.size, channels: this.channels.length }))
            return
        }
        if (url === '/info') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ name: this.config.name, hasPassword: !!this.config.password }))
            return
        }

        // ──── Dashboard static files ────
        this.serveStatic(req, res, url)
    }

    private handleAPI(req: IncomingMessage, res: ServerResponse, url: string) {
        const json = (data: any) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
        const method = req.method || 'GET'

        if (url === '/api/stats' && method === 'GET') return json(this.getStats())
        if (url === '/api/config' && method === 'GET') return json(this.getConfig())
        if (url === '/api/users' && method === 'GET') return json(this.getConnectedUsers())
        if (url === '/api/channels' && method === 'GET') return json(this.channels)
        if (url === '/api/logs' && method === 'GET') return json(this.logs.slice(-200))
        if (url === '/api/network' && method === 'GET') return json(this.getNetworkAddresses())

        // SSE stream for real-time events
        if (url === '/api/events' && method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            })
            res.write(`event: stats\ndata: ${JSON.stringify(this.getStats())}\n\n`)
            this.sseClients.add(res)
            req.on('close', () => this.sseClients.delete(res))
            return
        }

        // POST endpoints
        if (url === '/api/config' && method === 'POST') {
            let body = ''
            req.on('data', (chunk) => { body += chunk.toString() })
            req.on('end', () => {
                try {
                    const cfg = JSON.parse(body)
                    this.updateConfig(cfg)
                    json({ success: true })
                } catch { res.writeHead(400); res.end('Invalid JSON') }
            })
            return
        }

        if (url.startsWith('/api/kick/') && method === 'POST') {
            const userId = url.replace('/api/kick/', '')
            const ok = this.kickUser(userId)
            return json({ success: ok })
        }

        if (url === '/api/stop' && method === 'POST') {
            this.stop().then(() => json({ success: true }))
            return
        }

        if (url === '/api/start' && method === 'POST') {
            // Restart is not directly supported on the same instance while running
            json({ success: false, error: 'Server is already running' })
            return
        }

        res.writeHead(404); res.end('Not found')
    }

    private serveStatic(req: IncomingMessage, res: ServerResponse, url: string) {
        let filePath = url === '/' ? '/index.html' : url
        // Security: prevent directory traversal
        filePath = filePath.replace(/\.\./g, '')
        const fullPath = join(this.uiDir, filePath)

        try {
            if (!existsSync(fullPath)) {
                // SPA fallback
                const indexPath = join(this.uiDir, 'index.html')
                if (existsSync(indexPath)) {
                    const content = readFileSync(indexPath, 'utf-8')
                    res.writeHead(200, { 'Content-Type': 'text/html' })
                    res.end(content)
                    return
                }
                res.writeHead(404); res.end('Not found')
                return
            }
            const ext = extname(fullPath)
            const mime = MIME[ext] || 'application/octet-stream'
            const content = readFileSync(fullPath)
            res.writeHead(200, { 'Content-Type': mime })
            res.end(content)
        } catch {
            res.writeHead(500); res.end('Internal error')
        }
    }

    // ──────────────────────────── WebSocket ────────────────────────────

    private setupWebSocket() {
        if (!this.wss) return

        this.wss.on('connection', (ws, req) => {
            let currentUser: User | null = null
            const clientIP = req.socket.remoteAddress || 'unknown'
            this.log('info', `Client connected from ${clientIP}`)

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString())
                    this.handleMessage(ws, msg, currentUser, clientIP, (user) => { currentUser = user })
                } catch (e: any) {
                    this.log('error', `Error processing message: ${e.message}`)
                }
            })

            ws.on('close', () => {
                if (currentUser) {
                    this.log('info', `User disconnected: ${currentUser.username}`)
                    currentUser.status = 'offline'
                    this.voiceSessions = this.voiceSessions.filter(vs => vs.user_id !== currentUser!.id)
                    this.connectedClients.delete(currentUser.id)
                    this.clientIPs.delete(currentUser.id)
                    this.clientConnectedAt.delete(currentUser.id)
                    this.broadcast('', 'user-left', { userId: currentUser.id })
                    this.pushSSE('user-disconnected', { userId: currentUser.id })
                    this.pushSSE('stats', this.getStats())
                }
            })

            ws.on('error', (error) => { this.log('error', `WebSocket error: ${error.message}`) })
        })
    }

    private handleMessage(ws: WebSocket, msg: any, currentUser: User | null, clientIP: string, setUser: (u: User) => void) {
        switch (msg.type) {
            case 'auth': {
                const { username, userId, avatar_url, decoration, border } = msg

                if (this.config.password && msg.password !== this.config.password) {
                    ws.send(JSON.stringify({ type: 'auth-error', error: 'Invalid server password' }))
                    return
                }
                if (this.config.maxUsers && this.connectedClients.size >= this.config.maxUsers) {
                    ws.send(JSON.stringify({ type: 'auth-error', error: 'Server is full' }))
                    return
                }

                let user: User
                if (userId && this.users.has(userId)) {
                    user = this.users.get(userId)!
                    user.status = 'online'; user.ws = ws
                    if (avatar_url !== undefined) user.avatar_url = avatar_url
                    if (decoration !== undefined) user.decoration = decoration
                    if (border !== undefined) user.border = border
                    if (msg.name_color !== undefined) user.name_color = msg.name_color
                    if (msg.name_font !== undefined) user.name_font = msg.name_font
                } else {
                    user = {
                        id: userId || uuidv4(), username: username || `User_${Date.now().toString(36)}`,
                        avatar_url: avatar_url || null, status: 'online', ws,
                        decoration: decoration || 'none', border: border || 'none',
                        name_color: msg.name_color || 'default', name_font: msg.name_font || 'default',
                    }
                    this.users.set(user.id, user)
                }

                setUser(user)
                this.connectedClients.set(user.id, ws)
                this.clientIPs.set(user.id, clientIP)
                this.clientConnectedAt.set(user.id, new Date().toISOString())

                ws.send(JSON.stringify({
                    type: 'auth-success',
                    user: { id: user.id, username: user.username, avatar_url: user.avatar_url, status: user.status, decoration: user.decoration, border: user.border, name_color: user.name_color, name_font: user.name_font },
                    server: { name: this.config.name }, channels: this.channels,
                }))
                this.broadcast('', 'user-joined', { user: { id: user.id, username: user.username, avatar_url: user.avatar_url, status: user.status, decoration: user.decoration, border: user.border, name_color: user.name_color, name_font: user.name_font } }, user.id)
                this.log('info', `User authenticated: ${user.username} (${clientIP})`)
                this.pushSSE('user-connected', { id: user.id, username: user.username, ip: clientIP })
                this.pushSSE('stats', this.getStats())
                break
            }

            case 'clear-messages': {
                if (!currentUser) return
                this.messages.set(msg.channelId, [])
                this.persistState()
                this.broadcast('', 'messages-cleared', { channelId: msg.channelId, by: currentUser.id })
                this.log('info', `${currentUser.username} cleared messages in channel ${msg.channelId}`)
                break
            }

            case 'create-channel': {
                if (!currentUser) return
                const channel: Channel = { id: uuidv4(), name: msg.name, type: msg.channelType || 'text', created_by: currentUser.id, created_at: new Date().toISOString() }
                this.channels.push(channel)
                this.persistState()
                this.broadcast('', 'channel-created', { channel })
                this.log('info', `${currentUser.username} created channel: ${msg.name}`)
                break
            }

            case 'delete-channel': {
                if (!currentUser) return
                const ch = this.channels.find(c => c.id === msg.channelId)
                if (ch && ch.created_by === currentUser.id) {
                    this.channels = this.channels.filter(c => c.id !== msg.channelId)
                    this.messages.delete(msg.channelId)
                    this.persistState()
                    this.broadcast('', 'channel-deleted', { channelId: msg.channelId })
                    this.log('info', `${currentUser.username} deleted channel: ${ch.name}`)
                }
                break
            }

            case 'get-messages': {
                if (!currentUser) return
                const channelMessages = this.messages.get(msg.channelId) || []
                const enriched = channelMessages.slice(-100).map(m => {
                    const u = this.users.get(m.user_id)
                    return { ...m, user: u ? { id: u.id, username: u.username, avatar_url: u.avatar_url, status: u.status, decoration: u.decoration || 'none', border: u.border || 'none', name_color: u.name_color || 'default', name_font: u.name_font || 'default' } : undefined }
                })
                ws.send(JSON.stringify({ type: 'messages', channelId: msg.channelId, messages: enriched }))
                break
            }

            case 'send-message': {
                if (!currentUser) return
                const message: Message = {
                    id: uuidv4(), channel_id: msg.channelId, user_id: currentUser.id,
                    content: msg.content, image_url: typeof msg.imageUrl === 'string' ? msg.imageUrl : null,
                    created_at: new Date().toISOString(),
                }
                if (!this.messages.has(msg.channelId)) this.messages.set(msg.channelId, [])
                const channelMsgs = this.messages.get(msg.channelId)!
                channelMsgs.push(message)
                if (channelMsgs.length > 500) this.messages.set(msg.channelId, channelMsgs.slice(-500))
                this.totalMessages++
                this.debouncedSaveState()
                this.broadcast(msg.channelId, 'message', {
                    channelId: msg.channelId,
                    message: { ...message, user: { id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url, status: currentUser.status, decoration: currentUser.decoration, border: currentUser.border, name_color: currentUser.name_color, name_font: currentUser.name_font } },
                })
                break
            }

            case 'get-voice-participants': {
                if (!currentUser) return
                const participants = this.voiceSessions.filter(vs => vs.channel_id === msg.channelId).map(vs => {
                    const u = this.users.get(vs.user_id)
                    return u ? { id: u.id, username: u.username, avatar_url: u.avatar_url, decoration: u.decoration, border: u.border, name_color: u.name_color, name_font: u.name_font, status: u.status } : null
                }).filter(Boolean)
                ws.send(JSON.stringify({ type: 'voice-participants', channelId: msg.channelId, participants }))
                break
            }

            case 'join-voice': {
                if (!currentUser) return
                this.voiceSessions = this.voiceSessions.filter(vs => vs.user_id !== currentUser!.id)
                this.voiceSessions.push({ id: uuidv4(), channel_id: msg.channelId, user_id: currentUser.id })
                this.broadcast('', 'voice-session', { action: 'join', channelId: msg.channelId, user: { id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url, decoration: currentUser.decoration, border: currentUser.border, name_color: currentUser.name_color, name_font: currentUser.name_font } })
                const vp = this.voiceSessions.filter(vs => vs.channel_id === msg.channelId).map(vs => { const u = this.users.get(vs.user_id); return u ? { id: u.id, username: u.username, avatar_url: u.avatar_url, decoration: u.decoration, border: u.border, name_color: u.name_color, name_font: u.name_font } : null }).filter(Boolean)
                ws.send(JSON.stringify({ type: 'voice-participants', channelId: msg.channelId, participants: vp }))
                this.log('info', `${currentUser.username} joined voice channel`)
                break
            }

            case 'leave-voice': {
                if (!currentUser) return
                this.voiceSessions = this.voiceSessions.filter(vs => vs.user_id !== currentUser!.id)
                this.broadcast('', 'voice-session', { action: 'leave', channelId: msg.channelId, userId: currentUser.id })
                this.log('info', `${currentUser.username} left voice channel`)
                break
            }

            case 'signal': {
                if (!currentUser) return
                this.sendToUser(msg.targetUserId, 'signal', { fromUserId: currentUser.id, signal: msg.signal, channelId: msg.channelId })
                break
            }

            case 'screen-start': {
                if (!currentUser) return
                this.broadcast('', 'screen-share', { action: 'start', channelId: msg.channelId, userId: currentUser.id, username: currentUser.username }, currentUser.id)
                break
            }

            case 'screen-stop': {
                if (!currentUser) return
                this.broadcast('', 'screen-share', { action: 'stop', channelId: msg.channelId, userId: currentUser.id }, currentUser.id)
                break
            }

            case 'update-profile': {
                if (!currentUser) return
                if (msg.username) currentUser.username = msg.username
                if (msg.avatar_url !== undefined) currentUser.avatar_url = msg.avatar_url
                if (msg.decoration !== undefined) currentUser.decoration = msg.decoration
                if (msg.border !== undefined) currentUser.border = msg.border
                if (msg.name_color !== undefined) currentUser.name_color = msg.name_color
                if (msg.name_font !== undefined) currentUser.name_font = msg.name_font
                this.debouncedSaveState()
                this.broadcast('', 'profile-updated', {
                    user: { id: currentUser.id, username: currentUser.username, avatar_url: currentUser.avatar_url, status: currentUser.status, decoration: currentUser.decoration, border: currentUser.border, name_color: currentUser.name_color, name_font: currentUser.name_font }
                })
                break
            }
        }
    }
}
