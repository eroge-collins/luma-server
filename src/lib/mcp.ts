// MCP (Model Context Protocol) client library for renderer process
// Communicates with the MCP server via Electron IPC

export interface MCPConfig {
    enabled: boolean
    provider?: 'playwright' | 'chrome-cdp'
    connected?: boolean
}

export interface MCPTool {
    name: string
    description?: string
    inputSchema?: any
}

export interface MCPStatus {
    running: boolean
}

const MCP_CONFIG_KEY = 'mcp_config'

// ──────── Config Persistence ────────

export function getMCPConfig(): MCPConfig {
    try {
        const stored = localStorage.getItem(MCP_CONFIG_KEY)
        if (stored) {
            const parsed = JSON.parse(stored)
            const provider = parsed?.provider === 'chrome-cdp' ? 'chrome-cdp' : 'playwright'
            return {
                enabled: !!parsed?.enabled,
                provider,
                connected: !!parsed?.connected,
            }
        }
    } catch { }
    return { enabled: false, provider: 'playwright', connected: false }
}

export function saveMCPConfig(config: MCPConfig) {
    localStorage.setItem(MCP_CONFIG_KEY, JSON.stringify(config))
}

// ──────── MCP API (delegates to Electron main via preload) ────────

declare global {
    interface Window {
        mcpAPI?: {
            start: (provider?: 'playwright' | 'chrome-cdp') => Promise<{ success: boolean; error?: string }>
            stop: (provider?: 'playwright' | 'chrome-cdp') => Promise<{ success: boolean }>
            getStatus: (provider?: 'playwright' | 'chrome-cdp') => Promise<MCPStatus>
            listTools: (provider?: 'playwright' | 'chrome-cdp') => Promise<{ success: boolean; tools: MCPTool[]; error?: string }>
            callTool: (provider: 'playwright' | 'chrome-cdp', name: string, args: any) => Promise<{ success: boolean; result?: any; error?: string }>
        }
    }
}

function getMCPAPI() {
    if (!window.mcpAPI) {
        throw new Error('MCP API not available (not running in Electron)')
    }
    return window.mcpAPI
}

export async function startMCP(provider?: 'playwright' | 'chrome-cdp'): Promise<{ success: boolean; error?: string }> {
    try {
        const cfg = getMCPConfig()
        const selectedProvider = provider || (cfg.provider === 'chrome-cdp' ? 'chrome-cdp' : 'playwright')
        return await getMCPAPI().start(selectedProvider)
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

export async function stopMCP(provider?: 'playwright' | 'chrome-cdp'): Promise<{ success: boolean }> {
    try {
        const cfg = getMCPConfig()
        const selectedProvider = provider || (cfg.provider === 'chrome-cdp' ? 'chrome-cdp' : 'playwright')
        return await getMCPAPI().stop(selectedProvider)
    } catch {
        return { success: false }
    }
}

export async function getMCPStatus(): Promise<MCPStatus> {
    try {
        const cfg = getMCPConfig()
        const provider = cfg.provider === 'chrome-cdp' ? 'chrome-cdp' : 'playwright'
        return await getMCPAPI().getStatus(provider)
    } catch {
        return { running: false }
    }
}

export async function getMCPTools(provider?: 'playwright' | 'chrome-cdp'): Promise<MCPTool[]> {
    try {
        const cfg = getMCPConfig()
        const selectedProvider = provider || (cfg.provider === 'chrome-cdp' ? 'chrome-cdp' : 'playwright')
        const result = await getMCPAPI().listTools(selectedProvider)
        return result.success ? result.tools : []
    } catch {
        return []
    }
}

export async function callMCPTool(name: string, args: any): Promise<any> {
    const cfg = getMCPConfig()
    const provider = cfg.provider === 'chrome-cdp' ? 'chrome-cdp' : 'playwright'
    const result = await getMCPAPI().callTool(provider, name, args)
    if (!result.success) {
        throw new Error(result.error || 'MCP tool call failed')
    }
    return result.result
}

export function isMCPAvailable(): boolean {
    return !!window.mcpAPI
}
