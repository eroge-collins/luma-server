export interface Profile {
    id: string
    username: string
    avatar_url: string | null
    status: 'online' | 'offline' | 'busy'
    created_at: string
    decoration?: string
    border?: string
    name_color?: string
    name_font?: string
}

export interface Channel {
    id: string
    name: string
    type: 'text' | 'voice'
    created_by: string
    created_at: string
}

export interface Message {
    id: string
    channel_id: string
    user_id: string
    content: string
    created_at: string
    profiles?: Profile
    image_url?: string | null
}

export interface VoiceSession {
    id: string
    channel_id: string
    user_id: string
    signal_data: any
    created_at: string
    profiles?: Profile
}
