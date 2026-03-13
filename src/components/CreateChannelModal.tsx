import { useState, useEffect } from 'react'
import { sounds } from '../lib/sounds'
import { localServer } from '../lib/local-server'
import { Hash, Volume2, X } from 'lucide-react'

interface CreateChannelModalProps {
    userId: string
    onCreated: () => void
    onClose: () => void
}

function CreateChannelModal({ userId, onCreated, onClose }: CreateChannelModalProps) {
    const [name, setName] = useState('')
    const [type, setType] = useState<'text' | 'voice'>('text')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [ready, setReady] = useState(false)

    useEffect(() => {
        const t = setTimeout(() => setReady(true), 1500)
        return () => clearTimeout(t)
    }, [])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        await handleCreate()
    }

    const handleCreate = async () => {
        const channelName = name.trim().toLowerCase().replace(/\s+/g, '-')
        if (!channelName.trim()) return
        setLoading(true)
        setError('')

        if (localServer.isConnected()) {
            localServer.createChannel(channelName.trim(), type)
            sounds.joinChannel()
            onCreated()
            setLoading(false)
            return
        }

        setError('Not connected to a server')
        setLoading(false)
        return
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <div className="modal__title" style={{ margin: 0 }}>Create Channel</div>
                            <button className="btn btn--icon-sm btn--ghost" onClick={onClose}>
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div>
                                <label className="label">Type</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        type="button"
                                        className={`btn btn--sm ${type === 'text' ? 'btn--primary' : ''}`}
                                        onClick={() => setType('text')}
                                        style={{ flex: 1 }}
                                    >
                                        <Hash size={14} />
                                        Text
                                    </button>
                                    <button
                                        type="button"
                                        className={`btn btn--sm ${type === 'voice' ? 'btn--primary' : ''}`}
                                        onClick={() => setType('voice')}
                                        style={{ flex: 1 }}
                                    >
                                        <Volume2 size={14} />
                                        Voice
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="label" htmlFor="channel-name">Name</label>
                                <input
                                    id="channel-name"
                                    className="input"
                                    type="text"
                                    placeholder={type === 'text' ? 'general' : 'voice-chat'}
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    autoFocus
                                    required
                                />
                            </div>

                            {error && <div className="auth-form__error">{error}</div>}

                            <div className="modal__actions">
                                <button type="button" className="btn" onClick={onClose}>
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn--primary"
                                    disabled={loading || !name.trim()}
                                >
                                    {loading ? 'Creating...' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </div>
    )
}

export default CreateChannelModal
