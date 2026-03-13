import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    onBeforeClose: (callback: () => void) => {
        ipcRenderer.on('app:before-close', callback)
        return () => ipcRenderer.removeListener('app:before-close', callback)
    },
})

contextBridge.exposeInMainWorld('mcpAPI', {
    start: (provider: 'playwright' | 'chrome-cdp' = 'playwright') => ipcRenderer.invoke('mcp:start', provider),
    stop: (provider: 'playwright' | 'chrome-cdp' = 'playwright') => ipcRenderer.invoke('mcp:stop', provider),
    getStatus: (provider: 'playwright' | 'chrome-cdp' = 'playwright') => ipcRenderer.invoke('mcp:status', provider),
    listTools: (provider: 'playwright' | 'chrome-cdp' = 'playwright') => ipcRenderer.invoke('mcp:list-tools', provider),
    callTool: (provider: 'playwright' | 'chrome-cdp', name: string, args: any) => ipcRenderer.invoke('mcp:call-tool', provider, name, args),
})

contextBridge.exposeInMainWorld('musicAPI', {
    check: () => ipcRenderer.invoke('music:check'),
    search: (query: string) => ipcRenderer.invoke('music:search', query),
    getStreamUrl: (url: string) => ipcRenderer.invoke('music:get-stream', url),
    addToQueue: (track: any) => ipcRenderer.invoke('music:queue:add', track) as Promise<{ success: boolean; queueLength: number; current?: any; isPlaying?: boolean }>,
    getQueue: () => ipcRenderer.invoke('music:queue:get'),
    clearQueue: () => ipcRenderer.invoke('music:queue:clear'),
    skip: () => ipcRenderer.invoke('music:skip'),
})

contextBridge.exposeInMainWorld('screenAPI', {
    getSources: () => ipcRenderer.invoke('screen:get-sources'),
})

contextBridge.exposeInMainWorld('localServerAPI', {
    start: (config: { name: string; port: number; password?: string }) => 
        ipcRenderer.invoke('local-server:start', config),
    stop: () => ipcRenderer.invoke('local-server:stop'),
    status: () => ipcRenderer.invoke('local-server:status'),
})

contextBridge.exposeInMainWorld('networkAPI', {
    getLocalIp: () => ipcRenderer.invoke('network:get-local-ip'),
})
