import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron'
import path from 'path'
import fs from 'fs'
import { chromium, Browser, Page, BrowserContext } from 'playwright'
import { spawn } from 'child_process'

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
    ? process.env.DIST
    : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

// ──────────────────────────── Native MCP Server ────────────────────────────

let browser: Browser | null = null
let context: BrowserContext | null = null
let page: Page | null = null
let mcpReady = false

// Chrome CDP (connects to existing Chrome)
let cdpBrowser: Browser | null = null
let cdpContext: BrowserContext | null = null
let cdpPage: Page | null = null
let cdpReady = false

type MCPProvider = 'playwright' | 'chrome-cdp'

// ──────────────────────────── Chrome CDP (connect to existing Chrome) ────────────────────────────

const CDP_PORT = 9222

// Common Chrome paths on Windows
const CHROME_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : '',
    process.env.PROGRAMFILES ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe` : '',
]

function findChrome(): string | null {
    for (const p of CHROME_PATHS) {
        if (p && fs.existsSync(p)) {
            return p
        }
    }
    return null
}

async function launchChromeWithCDP(): Promise<boolean> {
    const chromePath = findChrome()
    
    if (!chromePath) {
        console.error('[ChromeCDP] Chrome not found in any known location')
        return false
    }
    
    console.log('[ChromeCDP] Launching Chrome with CDP:', chromePath)
    
    // Use a separate user data directory to avoid conflict with existing Chrome
    const userDataDir = path.join(app.getPath('userData'), 'chrome-cdp-profile')
    
    // Launch Chrome with remote debugging port using spawn (detached)
    const child = spawn(chromePath, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
    ], {
        detached: true,
        stdio: 'ignore',
        shell: false,
    })
    
    // Don't wait for child - let it run independently
    child.unref()
    
    // Wait for Chrome to start
    await new Promise(resolve => setTimeout(resolve, 3000))
    return true
}

async function startChromeCDP(): Promise<{ success: boolean; error?: string }> {
    // Don't connect yet - just mark as ready
    // Connection will happen on first tool call
    cdpReady = true
    return { success: true }
}

async function ensureCDPConnection(): Promise<void> {
    if (cdpBrowser) return
    
    console.log('[ChromeCDP] Connecting to Chrome on port', CDP_PORT)
    
    // Try to connect to existing Chrome with CDP enabled
    try {
        cdpBrowser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)
        
        const contexts = cdpBrowser.contexts()
        if (contexts.length > 0) {
            cdpContext = contexts[0]
            const pages = cdpContext.pages()
            cdpPage = pages.length > 0 ? pages[0] : await cdpContext.newPage()
        } else {
            cdpContext = await cdpBrowser.newContext()
            cdpPage = await cdpContext.newPage()
        }
        
        console.log('[ChromeCDP] Connected successfully')
        return
    } catch (err: any) {
        console.log('[ChromeCDP] Connection failed:', err.message)
    }
    
    // Try to launch Chrome with CDP
    console.log('[ChromeCDP] Attempting to launch Chrome...')
    const launched = await launchChromeWithCDP()
    if (!launched) {
        throw new Error('Could not find Chrome. Please install Google Chrome.')
    }
    
    // Try to connect with retries
    for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        try {
            console.log(`[ChromeCDP] Connection attempt ${attempt + 1}/5...`)
            cdpBrowser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`)
            
            const contexts = cdpBrowser.contexts()
            if (contexts.length > 0) {
                cdpContext = contexts[0]
                const pages = cdpContext.pages()
                cdpPage = pages.length > 0 ? pages[0] : await cdpContext.newPage()
            } else {
                cdpContext = await cdpBrowser.newContext()
                cdpPage = await cdpContext.newPage()
            }
            
            console.log('[ChromeCDP] Connected successfully after launch')
            return
        } catch (err: any) {
            console.log(`[ChromeCDP] Attempt ${attempt + 1} failed:`, err.message)
        }
    }
    
    throw new Error('Could not connect to Chrome after launching. Try closing all Chrome windows and trying again.')
}

async function stopChromeCDP() {
    cdpReady = false
    if (cdpBrowser) {
        // Don't close the browser - just disconnect
        // await cdpBrowser.close() would close the user's Chrome
        cdpBrowser = null
        cdpContext = null
        cdpPage = null
    }
}

const cdpTools = [
    { name: 'browser_navigate', description: 'Navigate to a URL in your Chrome', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
    { name: 'browser_click', description: 'Click on an element', inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } },
    { name: 'browser_type', description: 'Type text into an element', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] } },
    { name: 'browser_screenshot', description: 'Take a screenshot', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_get_content', description: 'Get page text content', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_wait', description: 'Wait for seconds', inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] } },
    { name: 'browser_get_url', description: 'Get current page URL', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_get_title', description: 'Get current page title', inputSchema: { type: 'object', properties: {} } },
]

async function handleCDPToolCall(name: string, args: Record<string, any>): Promise<any> {
    await ensureCDPConnection()
    if (!cdpPage) throw new Error('Chrome CDP not connected')
    
    switch (name) {
        case 'browser_navigate': {
            await cdpPage.goto(args.url)
            return { success: true, url: args.url }
        }
        case 'browser_click': {
            await cdpPage.click(args.selector)
            return { success: true }
        }
        case 'browser_type': {
            await cdpPage.fill(args.selector, args.text)
            return { success: true }
        }
        case 'browser_screenshot': {
            const screenshot = await cdpPage.screenshot({ fullPage: true })
            return { success: true, screenshot: screenshot.toString('base64'), mimeType: 'image/png' }
        }
        case 'browser_get_content': {
            const content = await cdpPage.textContent('body')
            return { success: true, content }
        }
        case 'browser_wait': {
            await new Promise(resolve => setTimeout(resolve, args.seconds * 1000))
            return { success: true }
        }
        case 'browser_get_url': {
            const url = cdpPage.url()
            return { success: true, url }
        }
        case 'browser_get_title': {
            const title = await cdpPage.title()
            return { success: true, title }
        }
        default:
            throw new Error(`Unknown tool: ${name}`)
    }
}

const mcpTools = [
    { name: 'browser_navigate', description: 'Navigate to a URL', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
    { name: 'browser_click', description: 'Click on an element', inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } },
    { name: 'browser_type', description: 'Type text into an element', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] } },
    { name: 'browser_screenshot', description: 'Take a screenshot', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_get_content', description: 'Get page text content', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_wait', description: 'Wait for seconds', inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] } },
    { name: 'browser_close', description: 'Close the browser', inputSchema: { type: 'object', properties: {} } },
]

async function ensureBrowser(): Promise<void> {
    if (!browser) {
        console.log('[MCP] Launching browser...')
        browser = await chromium.launch({ headless: false })
        context = await browser.newContext()
        page = await context.newPage()
        console.log('[MCP] Browser launched successfully')
    }
}

async function handleMCPToolCall(name: string, args: Record<string, any>): Promise<any> {
    await ensureBrowser()
    
    switch (name) {
        case 'browser_navigate': {
            if (!page) throw new Error('No page available')
            await page.goto(args.url)
            return { success: true, url: args.url }
        }
        case 'browser_click': {
            if (!page) throw new Error('No page available')
            await page.click(args.selector)
            return { success: true }
        }
        case 'browser_type': {
            if (!page) throw new Error('No page available')
            await page.fill(args.selector, args.text)
            return { success: true }
        }
        case 'browser_screenshot': {
            if (!page) throw new Error('No page available')
            const screenshot = await page.screenshot({ fullPage: true })
            return { success: true, screenshot: screenshot.toString('base64'), mimeType: 'image/png' }
        }
        case 'browser_get_content': {
            if (!page) throw new Error('No page available')
            const content = await page.textContent('body')
            return { success: true, content }
        }
        case 'browser_wait': {
            await new Promise(resolve => setTimeout(resolve, args.seconds * 1000))
            return { success: true }
        }
        case 'browser_close': {
            if (browser) {
                await browser.close()
                browser = null
                context = null
                page = null
            }
            return { success: true }
        }
        default:
            throw new Error(`Unknown tool: ${name}`)
    }
}

async function startMCPServer(): Promise<{ success: boolean; error?: string }> {
    // Don't launch browser yet - just mark as ready
    // Browser will be launched on first tool call
    mcpReady = true
    return { success: true }
}

async function stopMCPServer() {
    mcpReady = false
    if (browser) {
        await browser.close()
        browser = null
        context = null
        page = null
    }
}

// ──────────────────────────── Window ────────────────────────────

function createWindow() {
    // In dev, use the icon from build/icons; in production, use the packaged icon
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'build', 'icons', 'icon.ico')
        : path.join(__dirname, '..', 'build', 'icons', 'icon.ico')

    win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#e0e5ec',
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // Need child_process access for MCP
        },
    })

    // Notify renderer to cleanup voice before closing
    win.on('close', (e) => {
        if (win && !win.isDestroyed()) {
            e.preventDefault()
            win.webContents.send('app:before-close')
            // Give renderer time to cleanup, then force close
            setTimeout(() => {
                if (win && !win.isDestroyed()) {
                    win.destroy()
                }
            }, 500)
        }
    })

    // F12 to open DevTools
    win.webContents.on('before-input-event', (_, input) => {
        if (input.key === 'F12') {
            win?.webContents.toggleDevTools()
        }
    })

    // Window control IPC handlers
    ipcMain.on('window:minimize', () => win?.minimize())
    ipcMain.on('window:maximize', () => {
        if (win?.isMaximized()) {
            win.unmaximize()
        } else {
            win?.maximize()
        }
    })
    ipcMain.on('window:close', () => win?.close())

    // MCP IPC handlers
    ipcMain.handle('mcp:start', async (_event, provider: MCPProvider = 'playwright') => {
        if (provider === 'chrome-cdp') return await startChromeCDP()
        return await startMCPServer()
    })

    ipcMain.handle('mcp:stop', async (_event, provider: MCPProvider = 'playwright') => {
        if (provider === 'chrome-cdp') stopChromeCDP()
        else await stopMCPServer()
        return { success: true }
    })

    ipcMain.handle('mcp:status', async (_event, provider: MCPProvider = 'playwright') => {
        if (provider === 'chrome-cdp') return { running: cdpReady }
        return { running: mcpReady }
    })

    ipcMain.handle('mcp:list-tools', async (_event, provider: MCPProvider = 'playwright') => {
        if (provider === 'chrome-cdp') return { success: true, tools: cdpTools }
        return { success: true, tools: mcpTools }
    })

    ipcMain.handle('mcp:call-tool', async (_event, provider: MCPProvider, toolName: string, args: any) => {
        if (provider === 'chrome-cdp') {
            try {
                const result = await handleCDPToolCall(toolName, args)
                return { success: true, result }
            } catch (err: any) {
                return { success: false, error: err.message }
            }
        }
        try {
            const result = await handleMCPToolCall(toolName, args)
            return { success: true, result }
        } catch (err: any) {
            return { success: false, error: err.message }
        }
    })

    const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL)
    } else {
        win.loadFile(path.join(process.env.DIST!, 'index.html'))
    }
}

// ──────────────────────────── Music Bot (yt-dlp) ────────────────────────────

interface Track {
    id: string
    title: string
    duration: number
    thumbnail: string
    url: string
    streamUrl?: string
}

let currentTrack: Track | null = null
let musicQueue: Track[] = []
let isPlaying = false
let ytdlpProcess: ReturnType<typeof spawn> | null = null
let musicAudioPath = path.join(app.getPath('temp'), 'luma-music')

// Ensure music temp directory exists
if (!fs.existsSync(musicAudioPath)) {
    fs.mkdirSync(musicAudioPath, { recursive: true })
}

// Get yt-dlp path (bundled or system)
function getYtdlpPath(): string {
    // First try bundled yt-dlp
    const bundledPath = app.isPackaged
        ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe')
        : path.join(__dirname, '..', 'resources', 'yt-dlp.exe')
    
    console.log('[Music] Checking yt-dlp path:', bundledPath, 'exists:', fs.existsSync(bundledPath))
    
    if (fs.existsSync(bundledPath)) {
        console.log('[Music] Using bundled yt-dlp:', bundledPath)
        return bundledPath
    }
    
    // Fallback to system yt-dlp
    console.log('[Music] Bundled not found, using system yt-dlp')
    return 'yt-dlp'
}

// Check if yt-dlp is available
async function checkYtdlp(): Promise<{ available: boolean; path: string | null }> {
    const ytdlpPath = getYtdlpPath()
    console.log('[Music] Checking yt-dlp availability:', ytdlpPath)
    return new Promise((resolve) => {
        const proc = spawn(ytdlpPath, ['--version'])
        proc.on('close', (code) => {
            console.log('[Music] yt-dlp check result, code:', code)
            resolve({ available: code === 0, path: code === 0 ? ytdlpPath : null })
        })
        proc.on('error', () => {
            resolve({ available: false, path: null })
        })
    })
}

// Search YouTube and return top results
async function searchYoutube(query: string): Promise<Track[]> {
    const ytdlpPath = getYtdlpPath()
    return new Promise((resolve, reject) => {
        const args = [
            `ytsearch5:${query}`,
            '--flat-playlist',
            '--dump-json',
            '--no-download',
            '--no-warnings',
        ]
        
        const proc = spawn(ytdlpPath, args)
        let output = ''
        
        proc.stdout.on('data', (data) => {
            output += data.toString()
        })
        
        proc.stderr.on('data', (data) => {
            console.error('[Music] yt-dlp stderr:', data.toString())
        })
        
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`yt-dlp exited with code ${code}`))
                return
            }
            
            try {
                const lines = output.trim().split('\n')
                const tracks: Track[] = []
                
                for (const line of lines) {
                    if (!line.trim()) continue
                    const data = JSON.parse(line)
                    tracks.push({
                        id: data.id || data.url,
                        title: data.title || 'Unknown',
                        duration: data.duration || 0,
                        thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
                        url: data.url || `https://www.youtube.com/watch?v=${data.id}`,
                    })
                }
                
                resolve(tracks)
            } catch (e) {
                reject(e)
            }
        })
        
        proc.on('error', (e) => {
            reject(new Error(`Failed to run yt-dlp: ${e.message}`))
        })
    })
}

// Get stream URL for a track (extract audio URL)
async function getStreamUrl(videoUrl: string): Promise<string> {
    const ytdlpPath = getYtdlpPath()
    return new Promise((resolve, reject) => {
        // Try multiple audio formats
        const args = [
            videoUrl,
            '-f', 'bestaudio/bestaudio[ext=webm]/bestaudio[ext=m4a]/best',
            '-g', // Get URL only
            '--no-warnings',
            '--no-check-certificates',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ]
        
        console.log('[Music] Getting stream URL for:', videoUrl)
        const proc = spawn(ytdlpPath, args)
        let output = ''
        let stderr = ''
        
        proc.stdout.on('data', (data) => {
            output += data.toString()
        })
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString()
            console.error('[Music] yt-dlp stderr:', data.toString())
        })
        
        proc.on('close', (code) => {
            console.log('[Music] yt-dlp exit code:', code, 'output length:', output.length)
            if (code !== 0 || !output.trim()) {
                reject(new Error(`Failed to get stream URL: ${stderr || 'No output'}`))
                return
            }
            resolve(output.trim().split('\n')[0])
        })
        
        proc.on('error', (e) => {
            reject(new Error(`Failed to run yt-dlp: ${e.message}`))
        })
    })
}

// IPC Handlers for music
ipcMain.handle('music:check', async () => {
    const result = await checkYtdlp()
    return { available: result.available }
})

ipcMain.handle('music:search', async (_event, query: string) => {
    try {
        const tracks = await searchYoutube(query)
        return { success: true, tracks }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
})

ipcMain.handle('music:get-stream', async (_event, url: string) => {
    try {
        const streamUrl = await getStreamUrl(url)
        return { success: true, streamUrl }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
})

ipcMain.handle('music:queue:add', async (_event, track: Track) => {
    musicQueue.push(track)
    
    // If no current music, start playing the first from queue
    if (!currentTrack && musicQueue.length > 0) {
        currentTrack = musicQueue.shift() || null
        isPlaying = true
    }
    
    return { success: true, queueLength: musicQueue.length, current: currentTrack, isPlaying }
})

ipcMain.handle('music:queue:get', async () => {
    return { queue: musicQueue, current: currentTrack, isPlaying }
})

ipcMain.handle('music:queue:clear', async () => {
    musicQueue = []
    currentTrack = null
    isPlaying = false
    return { success: true }
})

ipcMain.handle('music:skip', async () => {
    if (musicQueue.length > 0) {
        currentTrack = musicQueue.shift() || null
        return { success: true, current: currentTrack }
    }
    currentTrack = null
    isPlaying = false
    return { success: true, current: null }
})

// Screen sharing IPC handlers
ipcMain.handle('screen:get-sources', async () => {
    try {
        const sources = await desktopCapturer.getSources({ 
            types: ['screen', 'window'],
            thumbnailSize: { width: 640, height: 360 }
        })
        // Translate common OS-localized source names to English
        const translateSourceName = (name: string): string => {
            const translations: Record<string, string> = {
                'Tela inteira': 'Entire Screen',
                'Tela cheia': 'Entire Screen',
                'Tela': 'Screen',
                'Área de trabalho': 'Desktop',
                'Pantalla completa': 'Entire Screen',
                'Pantalla': 'Screen',
                'Escritorio': 'Desktop',
                'Écran entier': 'Entire Screen',
                'Bureau': 'Desktop',
                'Gesamter Bildschirm': 'Entire Screen',
                'Schermo intero': 'Entire Screen',
            }
            for (const [key, value] of Object.entries(translations)) {
                if (name.toLowerCase().startsWith(key.toLowerCase())) {
                    return name.toLowerCase() === key.toLowerCase() ? value : name.replace(new RegExp(key, 'i'), value)
                }
            }
            // Screen sources from Electron are often "Screen 1", "Screen 2" etc
            return name.replace(/^Tela\s*/i, 'Screen ')
                       .replace(/^Pantalla\s*/i, 'Screen ')
                       .replace(/^Écran\s*/i, 'Screen ')
                       .replace(/^Bildschirm\s*/i, 'Screen ')
                       .replace(/^Schermo\s*/i, 'Screen ')
        }

        return { 
            success: true, 
            sources: sources.map(s => ({
                id: s.id,
                name: translateSourceName(s.name),
                thumbnail: s.thumbnail.toDataURL(),
            }))
        }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

// ──────────────────────────── Local Server (TeamSpeak-like) ────────────────────────────

let localServerProcess: ReturnType<typeof spawn> | null = null
let localServerConfig: { name: string; port: number; password?: string } | null = null

import { networkInterfaces } from 'os'

function getLocalIpAddress(): string {
    const nets = networkInterfaces()
    
    // VPN / virtual adapter keywords to skip
    const VPN_KEYWORDS = [
        'radmin', 'hamachi', 'zerotier', 'tailscale', 'wireguard',
        'vpn', 'virtual', 'vethernet', 'vmware', 'vmnet',
        'virtualbox', 'vbox', 'docker', 'wsl', 'hyper-v',
    ]
    
    const candidates: { address: string; priority: number; name: string }[] = []
    
    for (const name of Object.keys(nets)) {
        const netList = nets[name]
        if (!netList) continue
        
        const lowerName = name.toLowerCase()
        const isVPN = VPN_KEYWORDS.some(kw => lowerName.includes(kw))
        
        for (const net of netList) {
            if (net.family !== 'IPv4' || net.internal) continue
            
            let priority = 0
            
            // Deprioritize VPN adapters heavily
            if (isVPN) {
                priority = -100
            } else if (net.address.startsWith('192.168.')) {
                priority = 100 // Most common home LAN
            } else if (net.address.startsWith('10.')) {
                priority = 90
            } else if (net.address.match(/^172\.(1[6-9]|2\d|3[01])\./)) {
                priority = 80
            } else {
                priority = 50 // Other non-VPN address
            }
            
            // Prefer Ethernet/Wi-Fi adapter names
            if (lowerName.includes('ethernet') || lowerName.includes('eth')) priority += 10
            if (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wlan')) priority += 8
            
            candidates.push({ address: net.address, priority, name })
        }
    }
    
    // Sort by priority descending
    candidates.sort((a, b) => b.priority - a.priority)
    
    return candidates.length > 0 ? candidates[0].address : '127.0.0.1'
}

ipcMain.handle('local-server:start', async (_event, config: { name: string; port: number; password?: string }) => {
    try {
        if (localServerProcess) {
            return { success: false, error: 'Server already running' }
        }
        
        // Path to server script - check dist folder first (compiled), then root
        let serverPath = app.isPackaged
            ? path.join(process.resourcesPath, 'server', 'index.js')
            : path.join(__dirname, '..', 'server', 'dist', 'index.js')
        
        console.log('[LocalServer] Checking server path:', serverPath)
        
        // Check if server file exists
        if (!fs.existsSync(serverPath)) {
            // Try non-dist version
            const altPath = path.join(__dirname, '..', 'server', 'index.js')
            if (fs.existsSync(altPath)) {
                serverPath = altPath
            } else {
                // Try .ts version for development with tsx
                const tsPath = path.join(__dirname, '..', 'server', 'index.ts')
                if (fs.existsSync(tsPath)) {
                    serverPath = tsPath
                } else {
                    return { success: false, error: 'Server files not found. Run: cd server && npx tsc index.ts --outDir dist --module ESNext --target ES2020 --moduleResolution node --esModuleInterop' }
                }
            }
        }
        
        console.log('[LocalServer] Starting server from:', serverPath)
        
        // Start server process
        localServerProcess = spawn('node', [serverPath], {
            cwd: path.dirname(serverPath),
            env: { ...process.env, LUMA_SERVER_CONFIG: JSON.stringify(config) },
            stdio: ['pipe', 'pipe', 'pipe'],
        })
        
        localServerConfig = config
        
        localServerProcess.stdout?.on('data', (data) => {
            // Don't prefix to preserve ASCII formatting from the server
            process.stdout.write(data)
        })
        
        localServerProcess.stderr?.on('data', (data) => {
            // Don't prefix to preserve ASCII formatting from the server
            process.stderr.write(data)
        })
        
        localServerProcess.on('close', (code) => {
            console.log('[LocalServer] Process exited with code', code)
            localServerProcess = null
            localServerConfig = null
        })
        
        // Wait a bit for server to start
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
})

ipcMain.handle('local-server:stop', async () => {
    if (localServerProcess) {
        localServerProcess.kill()
        localServerProcess = null
        localServerConfig = null
    }
    return { success: true }
})

ipcMain.handle('local-server:status', async () => {
    if (localServerProcess && localServerConfig) {
        return {
            running: true,
            config: localServerConfig,
            address: getLocalIpAddress(),
        }
    }
    return { running: false }
})

ipcMain.handle('network:get-local-ip', async () => {
    return { ip: getLocalIpAddress() }
})

app.on('window-all-closed', () => {
    stopMCPServer()
    if (ytdlpProcess) {
        ytdlpProcess.kill()
    }
    if (process.platform !== 'darwin') {
        app.quit()
        win = null
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(createWindow)
