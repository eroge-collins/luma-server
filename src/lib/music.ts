// Music Bot library - interfaces with yt-dlp via Electron IPC and Supabase for sync

import { supabase } from './supabase'

export interface Track {
    id: string
    title: string
    duration: number
    thumbnail: string
    url: string
    streamUrl?: string
}

export interface MusicQueue {
    queue: Track[]
    current: Track | null
    isPlaying: boolean
}

declare global {
    interface Window {
        musicAPI?: {
            check: () => Promise<{ available: boolean }>
            search: (query: string) => Promise<{ success: boolean; tracks: Track[]; error?: string }>
            getStreamUrl: (url: string) => Promise<{ success: boolean; streamUrl?: string; error?: string }>
            addToQueue: (track: Track) => Promise<{ success: boolean; queueLength: number; current?: Track; isPlaying?: boolean }>
            getQueue: () => Promise<MusicQueue>
            clearQueue: () => Promise<{ success: boolean }>
            skip: () => Promise<{ success: boolean; current: Track | null }>
        }
    }
}

function getMusicAPI() {
    if (!window.musicAPI) {
        throw new Error('Music API not available (not running in Electron)')
    }
    return window.musicAPI
}

export async function checkMusicAvailable(): Promise<boolean> {
    try {
        const result = await getMusicAPI().check()
        return result.available
    } catch {
        return false
    }
}

export async function searchTracks(query: string): Promise<{ success: boolean; tracks?: Track[]; error?: string }> {
    try {
        return await getMusicAPI().search(query)
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

export async function getTrackStreamUrl(url: string): Promise<{ success: boolean; streamUrl?: string; error?: string }> {
    try {
        return await getMusicAPI().getStreamUrl(url)
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

// Supabase-synced music functions
export async function getMusicSession(channelId: string): Promise<MusicQueue | null> {
    const { data, error } = await supabase
        .from('music_sessions')
        .select('*')
        .eq('channel_id', channelId)
        .single()
    
    if (error || !data) return null
    
    return {
        queue: data.queue || [],
        current: data.current_track,
        isPlaying: data.is_playing
    }
}

export async function addTrackToSession(channelId: string, track: Track): Promise<{ success: boolean; isPlaying?: boolean }> {
    // Get current session
    const { data: existing } = await supabase
        .from('music_sessions')
        .select('*')
        .eq('channel_id', channelId)
        .single()
    
    const queue = existing?.queue || []
    const currentTrack = existing?.current_track
    
    // If no current track, start playing this one
    if (!currentTrack) {
        const { error } = await supabase
            .from('music_sessions')
            .upsert({
                channel_id: channelId,
                current_track: track,
                queue: [],
                is_playing: true,
                updated_at: new Date().toISOString()
            }, { onConflict: 'channel_id' })
        
        return { success: !error, isPlaying: true }
    }
    
    // Otherwise add to queue
    const { error } = await supabase
        .from('music_sessions')
        .upsert({
            channel_id: channelId,
            current_track: currentTrack,
            queue: [...queue, track],
            is_playing: existing?.is_playing || false,
            updated_at: new Date().toISOString()
        }, { onConflict: 'channel_id' })
    
    return { success: !error, isPlaying: existing?.is_playing || false }
}

export async function skipTrackInSession(channelId: string): Promise<Track | null> {
    const { data: existing } = await supabase
        .from('music_sessions')
        .select('*')
        .eq('channel_id', channelId)
        .single()
    
    if (!existing) return null
    
    const queue = existing.queue || []
    
    if (queue.length > 0) {
        const nextTrack = queue[0]
        const newQueue = queue.slice(1)
        
        await supabase
            .from('music_sessions')
            .upsert({
                channel_id: channelId,
                current_track: nextTrack,
                queue: newQueue,
                is_playing: true,
                updated_at: new Date().toISOString()
            }, { onConflict: 'channel_id' })
        
        return nextTrack
    }
    
    // No more tracks
    await supabase
        .from('music_sessions')
        .upsert({
            channel_id: channelId,
            current_track: null,
            queue: [],
            is_playing: false,
            updated_at: new Date().toISOString()
        }, { onConflict: 'channel_id' })
    
    return null
}

export async function clearMusicSession(channelId: string): Promise<boolean> {
    const { error } = await supabase
        .from('music_sessions')
        .upsert({
            channel_id: channelId,
            current_track: null,
            queue: [],
            is_playing: false,
            updated_at: new Date().toISOString()
        }, { onConflict: 'channel_id' })
    
    return !error
}

// Legacy functions (kept for compatibility)
export async function addTrackToQueue(track: Track): Promise<{ success: boolean; queueLength?: number; current?: Track; isPlaying?: boolean }> {
    try {
        const result = await getMusicAPI().addToQueue(track)
        return { 
            success: result.success, 
            queueLength: result.queueLength,
            current: result.current,
            isPlaying: result.isPlaying 
        }
    } catch {
        return { success: false }
    }
}

export async function getMusicQueue(): Promise<MusicQueue | null> {
    try {
        return await getMusicAPI().getQueue()
    } catch {
        return null
    }
}

export async function clearMusicQueue(): Promise<boolean> {
    try {
        const result = await getMusicAPI().clearQueue()
        return result.success
    } catch {
        return false
    }
}

export async function skipTrack(): Promise<Track | null> {
    try {
        const result = await getMusicAPI().skip()
        return result.current
    } catch {
        return null
    }
}

export function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function isMusicAPIAvailable(): boolean {
    return !!window.musicAPI
}
