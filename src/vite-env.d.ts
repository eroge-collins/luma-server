export interface ElectronAPI {
    minimize: () => void
    maximize: () => void
    close: () => void
}

export interface LocalServerAPI {
    start: (config: { name: string; port: number; password?: string }) => Promise<{ success: boolean; error?: string }>
    stop: () => Promise<{ success: boolean }>
    status: () => Promise<{ running: boolean; config?: { name: string; port: number; password?: string }; address?: string }>
}

export interface NetworkAPI {
    getLocalIp: () => Promise<{ ip: string }>
}

declare global {
    interface Window {
        electronAPI: ElectronAPI
        localServerAPI: LocalServerAPI
        networkAPI: NetworkAPI
    }
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
