import { useState, useEffect, useRef } from 'react'
import { Music, Volume2, Search, X, ChevronDown, ChevronUp } from 'lucide-react'
import { getAllSounds, getSoundpadConfig, preloadSound, playSoundToDestination, type SoundpadSound } from '../lib/soundpad'

interface SoundpadPanelProps {
    audioContext: AudioContext | null
    destination: AudioNode | null
    onPlaySound?: (soundId: string) => void
}

function SoundpadPanel({ audioContext, destination, onPlaySound }: SoundpadPanelProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [playingId, setPlayingId] = useState<string | null>(null)
    const [sounds] = useState<SoundpadSound[]>(() => getAllSounds())
    const [config] = useState(() => getSoundpadConfig())
    const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
    const localSourceRef = useRef<AudioBufferSourceNode | null>(null)
    const playRequestIdRef = useRef(0)

    const filtered = search
        ? sounds.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
        : sounds

    const stopCurrentPlayback = () => {
        playRequestIdRef.current += 1

        if (currentSourceRef.current) {
            try { currentSourceRef.current.onended = null } catch {}
            try { currentSourceRef.current.stop() } catch {}
            currentSourceRef.current = null
        }

        if (localSourceRef.current) {
            try { localSourceRef.current.onended = null } catch {}
            try { localSourceRef.current.stop() } catch {}
            localSourceRef.current = null
        }

        setPlayingId(null)
    }

    const handlePlay = async (sound: SoundpadSound) => {
        if (!audioContext || !destination) return
        if (!config.enabled) return

        const requestId = playRequestIdRef.current + 1
        stopCurrentPlayback()
        playRequestIdRef.current = requestId

        if (audioContext.state === 'suspended') {
            await audioContext.resume().catch(() => {})
        }

        const buffer = await preloadSound(sound.path, audioContext)
        if (!buffer || playRequestIdRef.current !== requestId) return

        setPlayingId(sound.id)

        // Play to mixer destination (sent to peers via WebRTC)
        const source = playSoundToDestination(buffer, audioContext, destination, config.volume)
        currentSourceRef.current = source

        // Also play to local speakers so the player hears it too
        const localSource = playSoundToDestination(buffer, audioContext, audioContext.destination, config.volume)
        localSourceRef.current = localSource

        const handleEnded = () => {
            if (playRequestIdRef.current !== requestId) return
            setPlayingId(null)
            currentSourceRef.current = null
            localSourceRef.current = null
        }

        source.onended = handleEnded
        localSource.onended = handleEnded

        // Broadcast to other participants
        onPlaySound?.(sound.id)
    }

    const handleStop = () => {
        stopCurrentPlayback()
    }

    // Preload all sounds on mount
    useEffect(() => {
        if (!audioContext) return
        sounds.forEach(s => preloadSound(s.path, audioContext))
    }, [audioContext, sounds])

    useEffect(() => {
        return () => {
            stopCurrentPlayback()
        }
    }, [])

    if (!config.enabled) return null

    return (
        <div className="soundpad">
            <button
                className={`btn btn--sm btn--ghost soundpad__toggle ${isOpen ? 'active' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                title="Soundpad"
            >
                <Music size={16} />
                <span>Soundpad</span>
                {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>

            {isOpen && (
                <div className="soundpad__panel">
                    <div className="soundpad__search">
                        <Search size={14} />
                        <input
                            type="text"
                            placeholder="Search sounds..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {search && (
                            <button className="soundpad__search-clear" onClick={() => setSearch('')}>
                                <X size={12} />
                            </button>
                        )}
                    </div>
                    <div className="soundpad__grid">
                        {filtered.map(sound => (
                            <button
                                key={sound.id}
                                className={`soundpad__btn ${playingId === sound.id ? 'playing' : ''}`}
                                onClick={() => playingId === sound.id ? handleStop() : handlePlay(sound)}
                                title={sound.name}
                            >
                                {playingId === sound.id ? (
                                    <Volume2 size={12} className="soundpad__btn-icon" />
                                ) : (
                                    <Music size={12} className="soundpad__btn-icon" />
                                )}
                                <span className="soundpad__btn-name">{sound.name}</span>
                            </button>
                        ))}
                        {filtered.length === 0 && (
                            <div className="soundpad__empty">No sounds found</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default SoundpadPanel
