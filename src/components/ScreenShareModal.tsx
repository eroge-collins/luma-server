import { useState, useEffect } from 'react'
import { X, Monitor, AppWindow, Loader2 } from 'lucide-react'

interface ScreenSource {
    id: string
    name: string
    thumbnail: string
}

interface ScreenShareModalProps {
    isOpen: boolean
    onClose: () => void
    onStartShare: (sourceId: string | null, framerate: 30 | 60) => void
}

declare global {
    interface Window {
        screenAPI?: {
            getSources: () => Promise<{ success: boolean; sources?: ScreenSource[]; error?: string }>
        }
    }
}

function ScreenShareModal({ isOpen, onClose, onStartShare }: ScreenShareModalProps) {
    const [shareType, setShareType] = useState<'screen' | 'window'>('screen')
    const [framerate, setFramerate] = useState<30 | 60>(30)
    const [loading, setLoading] = useState(false)
    const [sources, setSources] = useState<ScreenSource[]>([])
    const [selectedSource, setSelectedSource] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [ready, setReady] = useState(false)

    useEffect(() => {
        if (isOpen) {
            setShareType('screen')
            setFramerate(30)
            setSelectedSource(null)
            setSources([])
            setError(null)
            setReady(false)
            loadSources()
            const t = setTimeout(() => setReady(true), 1500)
            return () => clearTimeout(t)
        }
    }, [isOpen])

    const loadSources = async () => {
        setLoading(true)
        setError(null)
        try {
            if (window.screenAPI) {
                const result = await window.screenAPI.getSources()
                if (result.success && result.sources) {
                    setSources(result.sources)
                    // Auto-select first screen source
                    const firstScreen = result.sources.find(s => s.id.includes('screen'))
                    if (firstScreen) setSelectedSource(firstScreen.id)
                } else {
                    setError(result.error || 'Failed to get screen sources')
                }
            } else {
                setError('Screen sharing requires the desktop app')
            }
        } catch (err: any) {
            setError(err.message)
        }
        setLoading(false)
    }

    const filteredSources = sources.filter(source => {
        if (shareType === 'screen') return source.id.includes('screen')
        if (shareType === 'window') return source.id.includes('window')
        return false
    })

    const handleTypeChange = (type: 'screen' | 'window') => {
        setShareType(type)
        // Auto-select first source of new type
        const first = sources.find(s => 
            type === 'screen' ? s.id.includes('screen') : s.id.includes('window')
        )
        setSelectedSource(first?.id || null)
    }

    if (!isOpen) return null

    const handleStart = () => {
        if (selectedSource) {
            onStartShare(selectedSource, framerate)
            onClose()
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal screen-share-modal" onClick={e => e.stopPropagation()}>
                {!ready ? (
                    <div className="modal-loader">
                        <div className="modal-loader__dots">
                            <div className="modal-loader__dot" />
                            <div className="modal-loader__dot" />
                            <div className="modal-loader__dot" />
                        </div>
                        <div className="modal-loader__text">Loading...</div>
                    </div>
                ) : (
                <div className="modal-content-gate">
                <div className="modal__header">
                    <h2 className="modal__title">Share Your Screen</h2>
                    <button className="modal__close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="modal__body">
                    {/* Share Type Selection */}
                    <div className="screen-share-section">
                        <label className="screen-share-label">What to share</label>
                        <div className="screen-share-options">
                            <button
                                className={`screen-share-option ${shareType === 'screen' ? 'active' : ''}`}
                                onClick={() => handleTypeChange('screen')}
                            >
                                <div className="screen-share-option__icon">
                                    <Monitor size={24} />
                                </div>
                                <div className="screen-share-option__label">Entire Screen</div>
                            </button>
                            <button
                                className={`screen-share-option ${shareType === 'window' ? 'active' : ''}`}
                                onClick={() => handleTypeChange('window')}
                            >
                                <div className="screen-share-option__icon">
                                    <AppWindow size={24} />
                                </div>
                                <div className="screen-share-option__label">Window</div>
                            </button>
                        </div>
                    </div>

                    {/* Source Selection */}
                    <div className="screen-share-section">
                        <label className="screen-share-label">Select source</label>
                        <div className="screen-share-source-container">
                            {loading ? (
                                <div className="screen-share-source-list">
                                    {[1, 2, 3].map(i => (
                                        <div key={i} className="screen-share-source-item screen-share-source-item--skeleton">
                                            <div className="screen-share-source-item__preview screen-share-skeleton-pulse" />
                                            <div className="screen-share-source-item__info">
                                                <div className="screen-share-skeleton-pulse" style={{ width: '60%', height: 14, borderRadius: 6 }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : error ? (
                                <div className="screen-share-error">{error}</div>
                            ) : filteredSources.length === 0 ? (
                                <div className="screen-share-empty">No {shareType}s available</div>
                            ) : (
                                <div className="screen-share-source-list">
                                    {filteredSources.map(source => (
                                        <button
                                            key={source.id}
                                            className={`screen-share-source-item ${selectedSource === source.id ? 'active' : ''}`}
                                            onClick={() => setSelectedSource(source.id)}
                                        >
                                            <div className="screen-share-source-item__preview">
                                                <img src={source.thumbnail} alt={source.name} />
                                            </div>
                                            <div className="screen-share-source-item__info">
                                                {shareType === 'window' ? <AppWindow size={14} /> : <Monitor size={14} />}
                                                <span className="screen-share-source-item__name">{source.name}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Framerate Selection */}
                    <div className="screen-share-section">
                        <label className="screen-share-label">Frame Rate</label>
                        <div className="screen-share-framerate">
                            <button
                                className={`screen-share-framerate__btn ${framerate === 30 ? 'active' : ''}`}
                                onClick={() => setFramerate(30)}
                            >
                                30 FPS
                                <span className="screen-share-framerate__desc">Better quality</span>
                            </button>
                            <button
                                className={`screen-share-framerate__btn ${framerate === 60 ? 'active' : ''}`}
                                onClick={() => setFramerate(60)}
                            >
                                60 FPS
                                <span className="screen-share-framerate__desc">Smoother motion</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="modal__footer">
                    <button className="btn btn--secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button 
                        className="btn btn--primary" 
                        onClick={handleStart}
                        disabled={!selectedSource || loading}
                    >
                        Share
                    </button>
                </div>
                </div>
                )}
            </div>
        </div>
    )
}

export default ScreenShareModal
