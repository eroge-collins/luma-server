import { useState } from 'react'
import { sounds } from '../lib/sounds'
import { localServer } from '../lib/local-server'

interface CreateChannelModalLocalProps {
    onCreated: () => void
    onClose: () => void
}

function CreateChannelModalLocal({ onCreated, onClose }: CreateChannelModalLocalProps) {
    const [channelName, setChannelName] = useState('')
    const [type, setType] = useState<'text' | 'voice'>('text')
    const [loading, setLoading] = useState(false)

    const handleCreate = async () => {
        const name = channelName.trim()
        if (!name) return
        setLoading(true)
        localServer.createChannel(name, type)
        sounds.joinChannel()
        setLoading(false)
        onCreated()
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal__header">
                    <h2>Create Channel</h2>
                    <button className="modal__close" onClick={onClose}>×</button>
                </div>

                <div className="modal__body">
                    <div className="form-group">
                        <label className="label">Channel name</label>
                        <input
                            className="input"
                            value={channelName}
                            onChange={(e) => setChannelName(e.target.value)}
                            placeholder="general"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Type</label>
                        <select className="input" value={type} onChange={(e) => setType(e.target.value as any)}>
                            <option value="text">Text</option>
                            <option value="voice">Voice</option>
                        </select>
                    </div>

                    <div className="modal__actions">
                        <button className="btn" onClick={onClose}>Cancel</button>
                        <button className="btn btn--primary" onClick={handleCreate} disabled={loading || !channelName.trim()}>
                            {loading ? 'Creating...' : 'Create'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default CreateChannelModalLocal
