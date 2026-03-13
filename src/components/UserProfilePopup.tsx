import { useEffect, useRef } from 'react'

interface UserProfilePopupProps {
    username: string
    avatarUrl: string | null
    decoration: string
    border: string
    nameColor: string
    nameFont: string
    status?: string
    position: { x: number; y: number }
    onClose: () => void
}

function getNameColorValue(id: string): string {
    const map: Record<string, string> = {
        red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e',
        cyan: '#06b6d4', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899', white: '#ffffff',
    }
    return map[id] || 'var(--text-primary)'
}

function getNameFontValue(id: string): string {
    const map: Record<string, string> = {
        unbounded: '"Unbounded", sans-serif', righteous: '"Righteous", cursive',
        orbitron: '"Orbitron", sans-serif', caveat: '"Caveat", cursive',
        dancing: '"Dancing Script", cursive', pacifico: '"Pacifico", cursive',
        marker: '"Permanent Marker", cursive', pixel: '"Press Start 2P", cursive',
    }
    return map[id] || 'inherit'
}

function getNameFontScale(id: string): number {
    const map: Record<string, number> = {
        pixel: 0.7, unbounded: 0.88, orbitron: 0.9, pacifico: 1.05,
        caveat: 1.15, dancing: 1.1, marker: 0.95,
    }
    return map[id] || 1
}

export default function UserProfilePopup({ username, avatarUrl, decoration, border, nameColor, nameFont, status, position, onClose }: UserProfilePopupProps) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose()
            }
        }
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('mousedown', handleClick)
        document.addEventListener('keydown', handleEsc)
        return () => {
            document.removeEventListener('mousedown', handleClick)
            document.removeEventListener('keydown', handleEsc)
        }
    }, [onClose])

    // Position popup so it doesn't overflow viewport
    useEffect(() => {
        if (!ref.current) return
        const rect = ref.current.getBoundingClientRect()
        const el = ref.current
        if (rect.right > window.innerWidth - 16) {
            el.style.left = `${window.innerWidth - rect.width - 16}px`
        }
        if (rect.bottom > window.innerHeight - 16) {
            el.style.top = `${position.y - rect.height - 8}px`
        }
    }, [position])

    return (
        <div
            ref={ref}
            className={`profile-popup ${border !== 'none' ? `user-panel-border user-panel-border--${border}` : ''}`}
            style={{ left: position.x, top: position.y + 8 }}
        >
            <div className="profile-popup__banner" />
            <div className="profile-popup__avatar-area">
                <div className={`avatar avatar--xl avatar-decoration avatar-decoration--${decoration}`}>
                    {avatarUrl ? (
                        <img src={avatarUrl} alt={username} className="avatar__image" />
                    ) : (
                        (username || '?').charAt(0)
                    )}
                </div>
            </div>
            <div className="profile-popup__info">
                <div
                    className="profile-popup__name"
                    style={{
                        color: nameColor !== 'default' ? getNameColorValue(nameColor) : undefined,
                        fontFamily: nameFont !== 'default' ? getNameFontValue(nameFont) : undefined,
                        fontSize: `calc(1em * ${getNameFontScale(nameFont)})`,
                    }}
                >
                    {username}
                </div>
                {status && (
                    <div className="profile-popup__status">❝{status}❞</div>
                )}
            </div>
        </div>
    )
}
