// Soundpad Service - manages sound effects for voice calls

export interface SoundpadSound {
    id: string
    name: string
    filename: string
    path: string
    isCustom: boolean
}

export interface SoundpadConfig {
    enabled: boolean
    volume: number
    customSoundsFolder: string
    customSounds: { id: string; name: string; filename: string }[]
}

const SOUNDPAD_CONFIG_KEY = 'luma_soundpad_config'

const DEFAULT_SOUNDS: SoundpadSound[] = [
    { id: '1m-iq', name: '1M IQ', filename: '1m-iq.mp3', path: '/sounds/soundpad/1m-iq.mp3', isCustom: false },
    { id: '67', name: '67', filename: '67.mp3', path: '/sounds/soundpad/67.mp3', isCustom: false },
    { id: 'ack', name: 'Ack', filename: 'ack.mp3', path: '/sounds/soundpad/ack.mp3', isCustom: false },
    { id: 'among-us', name: 'Among Us', filename: 'among-us.mp3', path: '/sounds/soundpad/among-us.mp3', isCustom: false },
    { id: 'anime-ahh', name: 'Anime Ahh', filename: 'anime-ahh.mp3', path: '/sounds/soundpad/anime-ahh.mp3', isCustom: false },
    { id: 'bad-to-the-bone', name: 'Bad to the Bone', filename: 'bad-to-the-bone.mp3', path: '/sounds/soundpad/bad-to-the-bone.mp3', isCustom: false },
    { id: 'bruh', name: 'Bruh', filename: 'bruh.mp3', path: '/sounds/soundpad/bruh.mp3', isCustom: false },
    { id: 'chinese-rapping-dog', name: 'Chinese Rapping Dog', filename: 'chinese-rapping-dog.mp3', path: '/sounds/soundpad/chinese-rapping-dog.mp3', isCustom: false },
    { id: 'chinese-rapping', name: 'Chinese Rapping', filename: 'chinese-rapping.mp3', path: '/sounds/soundpad/chinese-rapping.mp3', isCustom: false },
    { id: 'doakes-track', name: 'Doakes Track', filename: 'doakes-track.mp3', path: '/sounds/soundpad/doakes-track.mp3', isCustom: false },
    { id: 'door-knocking', name: 'Door Knocking', filename: 'door-knocking.mp3', path: '/sounds/soundpad/door-knocking.mp3', isCustom: false },
    { id: 'dry-fart', name: 'Dry Fart', filename: 'dry-fart.mp3', path: '/sounds/soundpad/dry-fart.mp3', isCustom: false },
    { id: 'fahhhh', name: 'Fahhhh', filename: 'fahhhh.mp3', path: '/sounds/soundpad/fahhhh.mp3', isCustom: false },
    { id: 'fbi-open-up', name: 'FBI Open Up', filename: 'fbi-open-up.mp3', path: '/sounds/soundpad/fbi-open-up.mp3', isCustom: false },
    { id: 'galaxy-track', name: 'Galaxy Track', filename: 'galaxy-track.mp3', path: '/sounds/soundpad/galaxy-track.mp3', isCustom: false },
    { id: 'gey-echo', name: 'Gey Echo', filename: 'gey-echo.mp3', path: '/sounds/soundpad/gey-echo.mp3', isCustom: false },
    { id: 'gogogogogo', name: 'Go Go Go', filename: 'gogogogogo.mp3', path: '/sounds/soundpad/gogogogogo.mp3', isCustom: false },
    { id: 'indian-track', name: 'Indian Track', filename: 'indian-track.mp3', path: '/sounds/soundpad/indian-track.mp3', isCustom: false },
    { id: 'italian-brainrot-ringtone', name: 'Italian Brainrot', filename: 'italian-brainrot-ringtone.mp3', path: '/sounds/soundpad/italian-brainrot-ringtone.mp3', isCustom: false },
    { id: 'let-me-know', name: 'Let Me Know', filename: 'let-me-know.mp3', path: '/sounds/soundpad/let-me-know.mp3', isCustom: false },
    { id: 'mlg-airhorn', name: 'MLG Airhorn', filename: 'mlg-airhorn.mp3', path: '/sounds/soundpad/mlg-airhorn.mp3', isCustom: false },
    { id: 'oi-oi-oe-oi-a-eye-eye', name: 'Oi Oi Oe', filename: 'oi-oi-oe-oi-a-eye-eye.mp3', path: '/sounds/soundpad/oi-oi-oe-oi-a-eye-eye.mp3', isCustom: false },
    { id: 'prowler', name: 'Prowler', filename: 'prowler.mp3', path: '/sounds/soundpad/prowler.mp3', isCustom: false },
    { id: 'rizz', name: 'Rizz', filename: 'rizz.mp3', path: '/sounds/soundpad/rizz.mp3', isCustom: false },
    { id: 'romance-track', name: 'Romance Track', filename: 'romance-track.mp3', path: '/sounds/soundpad/romance-track.mp3', isCustom: false },
    { id: 'skeleton-with-shield', name: 'Skeleton w/ Shield', filename: 'skeleton-with-shield.mp3', path: '/sounds/soundpad/skeleton-with-shield.mp3', isCustom: false },
    { id: 'spiderman-track', name: 'Spiderman Track', filename: 'spiderman-track.mp3', path: '/sounds/soundpad/spiderman-track.mp3', isCustom: false },
    { id: 'studio-audience-awwww', name: 'Audience Awww', filename: 'studio-audience-awwww.mp3', path: '/sounds/soundpad/studio-audience-awwww.mp3', isCustom: false },
    { id: 'taco-bell-bong', name: 'Taco Bell Bong', filename: 'taco-bell-bong.mp3', path: '/sounds/soundpad/taco-bell-bong.mp3', isCustom: false },
    { id: 'the-weeknd-rizz', name: 'Weeknd Rizz', filename: 'the-weeknd-rizz.mp3', path: '/sounds/soundpad/the-weeknd-rizz.mp3', isCustom: false },
    { id: 'vine-boom', name: 'Vine Boom', filename: 'vine-boom.mp3', path: '/sounds/soundpad/vine-boom.mp3', isCustom: false },
    { id: 'what-a-good-boy', name: 'What a Good Boy', filename: 'what-a-good-boy.mp3', path: '/sounds/soundpad/what-a-good-boy.mp3', isCustom: false },
]

const DEFAULT_CONFIG: SoundpadConfig = {
    enabled: true,
    volume: 0.7,
    customSoundsFolder: '',
    customSounds: [],
}

// Audio buffer cache
const audioBufferCache = new Map<string, AudioBuffer>()

export function getSoundpadConfig(): SoundpadConfig {
    try {
        const stored = localStorage.getItem(SOUNDPAD_CONFIG_KEY)
        if (stored) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(stored) }
        }
    } catch {}
    return DEFAULT_CONFIG
}

export function saveSoundpadConfig(config: Partial<SoundpadConfig>): void {
    const current = getSoundpadConfig()
    const updated = { ...current, ...config }
    localStorage.setItem(SOUNDPAD_CONFIG_KEY, JSON.stringify(updated))
}

export function getDefaultSounds(): SoundpadSound[] {
    return DEFAULT_SOUNDS
}

export function getAllSounds(): SoundpadSound[] {
    const config = getSoundpadConfig()
    const customs: SoundpadSound[] = config.customSounds.map(s => ({
        id: `custom-${s.id}`,
        name: s.name,
        filename: s.filename,
        path: s.filename.startsWith('data:') ? s.filename : `custom://${s.filename}`,
        isCustom: true,
    }))
    return [...DEFAULT_SOUNDS, ...customs]
}

export function addCustomSound(name: string, filename: string, dataUrl: string): void {
    const config = getSoundpadConfig()
    const id = Date.now().toString(36)
    config.customSounds.push({ id, name, filename: dataUrl })
    saveSoundpadConfig(config)
}

export function removeCustomSound(id: string): void {
    const config = getSoundpadConfig()
    config.customSounds = config.customSounds.filter(s => s.id !== id)
    saveSoundpadConfig(config)
}

// Pre-load an audio buffer for fast playback
export async function preloadSound(path: string, audioContext: AudioContext): Promise<AudioBuffer | null> {
    if (audioBufferCache.has(path)) return audioBufferCache.get(path)!

    try {
        let arrayBuffer: ArrayBuffer

        if (path.startsWith('data:')) {
            // Base64 data URL
            const response = await fetch(path)
            arrayBuffer = await response.arrayBuffer()
        } else {
            const response = await fetch(path)
            if (!response.ok) return null
            arrayBuffer = await response.arrayBuffer()
        }

        const buffer = await audioContext.decodeAudioData(arrayBuffer)
        audioBufferCache.set(path, buffer)
        return buffer
    } catch (e) {
        console.error('[Soundpad] Failed to preload:', path, e)
        return null
    }
}

// Play a sound through an AudioContext and return the source node for cancellation
export function playSoundToDestination(
    buffer: AudioBuffer,
    audioContext: AudioContext,
    destination: AudioNode,
    volume: number = 0.7,
): AudioBufferSourceNode {
    const source = audioContext.createBufferSource()
    const gainNode = audioContext.createGain()
    gainNode.gain.value = volume
    source.buffer = buffer
    source.connect(gainNode)
    gainNode.connect(destination)
    source.start(0)
    return source
}
