import { useState, useEffect } from 'react'
import { X, AlertTriangle } from 'lucide-react'

interface ConfirmModalProps {
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    onConfirm: () => void
    onCancel: () => void
}

function ConfirmModal({
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    const [ready, setReady] = useState(false)

    useEffect(() => {
        const t = setTimeout(() => setReady(true), 1500)
        return () => clearTimeout(t)
    }, [])

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal" onClick={e => e.stopPropagation()}>
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <div className="modal__title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                                {danger && <AlertTriangle size={20} style={{ color: 'var(--red)' }} />}
                                {title}
                            </div>
                            <button className="btn btn--icon-sm btn--ghost" onClick={onCancel}>
                                <X size={16} />
                            </button>
                        </div>

                        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
                            {message}
                        </p>

                        <div className="modal__actions">
                            <button className="btn" onClick={onCancel}>
                                {cancelLabel}
                            </button>
                            <button
                                className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
                                onClick={onConfirm}
                            >
                                {confirmLabel}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default ConfirmModal
