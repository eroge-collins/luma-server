import { useState, useRef, useEffect, useCallback } from 'react'
import { X, ZoomIn, ZoomOut, RotateCw, Check, Loader2 } from 'lucide-react'
import { localServer } from '../lib/local-server'
import { supabase } from '../lib/supabase'

// Local avatar storage key
const AVATAR_STORAGE_KEY = 'luma_user_avatar'
const AVATAR_META_KEY = 'luma_user_avatar_meta'

interface AvatarMeta {
    position: { x: number; y: number }
    zoom: number
    isGif: boolean
}

interface AvatarCropModalProps {
    isOpen: boolean
    onClose: () => void
    currentAvatar: string | null
    userId: string
    onAvatarUpdated: (url: string, meta?: AvatarMeta) => void
}

function AvatarCropModal({ isOpen, onClose, currentAvatar, userId, onAvatarUpdated }: AvatarCropModalProps) {
    const [imageSrc, setImageSrc] = useState<string | null>(null)
    const [isGif, setIsGif] = useState(false)
    const [position, setPosition] = useState({ x: 50, y: 50 }) // percentage
    const [zoom, setZoom] = useState(1)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
    
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setImageSrc(null)
            setIsGif(false)
            setPosition({ x: 50, y: 50 })
            setZoom(1)
            setError(null)
        }
    }, [isOpen])

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        // Check file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            setError('Image must be less than 5MB')
            return
        }

        // Check if GIF
        const isGifFile = file.type === 'image/gif'
        setIsGif(isGifFile)

        const reader = new FileReader()
        reader.onload = () => {
            setImageSrc(reader.result as string)
            setPosition({ x: 50, y: 50 })
            setZoom(1)
            setError(null)
        }
        reader.readAsDataURL(file)
        e.target.value = ''
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!imageSrc) return
        setDragging(true)
        setDragStart({ x: e.clientX, y: e.clientY })
    }

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragging) return
        
        const dx = e.clientX - dragStart.x
        const dy = e.clientY - dragStart.y
        
        setPosition(prev => ({
            x: Math.max(0, Math.min(100, prev.x - (dx * 0.2 / zoom))),
            y: Math.max(0, Math.min(100, prev.y - (dy * 0.2 / zoom)))
        }))
        
        setDragStart({ x: e.clientX, y: e.clientY })
    }, [dragging, dragStart, zoom])

    const handleMouseUp = useCallback(() => {
        setDragging(false)
    }, [])

    useEffect(() => {
        if (dragging) {
            window.addEventListener('mousemove', handleMouseMove)
            window.addEventListener('mouseup', handleMouseUp)
            return () => {
                window.removeEventListener('mousemove', handleMouseMove)
                window.removeEventListener('mouseup', handleMouseUp)
            }
        }
    }, [dragging, handleMouseMove, handleMouseUp])

    const handleZoomIn = () => setZoom(prev => Math.min(3, prev + 0.1))
    const handleZoomOut = () => setZoom(prev => Math.max(1, prev - 0.1))

    const cropImage = async (): Promise<Blob | null> => {
        if (!imageSrc || !canvasRef.current) return null

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return null

        const img = new Image()
        img.crossOrigin = 'anonymous'

        return new Promise((resolve) => {
            img.onload = () => {
                // Output size (avatar size)
                const size = 256
                canvas.width = size
                canvas.height = size

                // Calculate crop area based on zoom and position
                const minDim = Math.min(img.width, img.height)
                const cropSize = minDim / zoom

                // Center point based on position percentages
                const centerX = (position.x / 100) * img.width
                const centerY = (position.y / 100) * img.height

                // Calculate source rectangle
                const sx = Math.max(0, centerX - cropSize / 2)
                const sy = Math.max(0, centerY - cropSize / 2)
                const sw = Math.min(cropSize, img.width - sx)
                const sh = Math.min(cropSize, img.height - sy)

                // Draw cropped image
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size)

                canvas.toBlob((blob) => {
                    resolve(blob)
                }, 'image/png', 0.9)
            }
            img.onerror = () => resolve(null)
            img.src = imageSrc
        })
    }

    const handleUpload = async () => {
        if (!imageSrc) return
        
        setUploading(true)
        setError(null)

        try {
            let avatarDataUrl: string
            const meta: AvatarMeta = {
                position: { ...position },
                zoom,
                isGif
            }

            if (isGif) {
                // For GIFs, save the original file (crop is handled via CSS)
                avatarDataUrl = imageSrc
            } else {
                // For static images, crop them to reduce size
                const blob = await cropImage()
                if (!blob) {
                    throw new Error('Failed to crop image')
                }
                // Convert blob to base64
                avatarDataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader()
                    reader.onload = () => resolve(reader.result as string)
                    reader.onerror = reject
                    reader.readAsDataURL(blob)
                })
            }

            // Save to localStorage as cache
            localStorage.setItem(AVATAR_STORAGE_KEY, avatarDataUrl)
            localStorage.setItem(AVATAR_META_KEY, JSON.stringify(meta))
            console.log('[Avatar] Saved to localStorage')

            // Upload to Supabase Storage for persistence
            try {
                // Convert data URL to blob for upload
                const response = await fetch(avatarDataUrl)
                const blob = await response.blob()
                const fileExt = isGif ? 'gif' : 'png'
                const fileName = `avatar.${fileExt}`
                const filePath = `${userId}/${fileName}`

                // Upload to Supabase Storage
                const { error: uploadError } = await supabase.storage
                    .from('avatars')
                    .upload(filePath, blob, {
                        upsert: true,
                        contentType: isGif ? 'image/gif' : 'image/png'
                    })

                if (uploadError) {
                    console.error('[Avatar] Supabase upload error:', uploadError)
                } else {
                    // Get public URL
                    const { data: urlData } = supabase.storage
                        .from('avatars')
                        .getPublicUrl(filePath)

                    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}` // Cache busting

                    // Update profile with avatar URL
                    const { error: profileError } = await supabase
                        .from('profiles')
                        .update({ avatar_url: publicUrl })
                        .eq('id', userId)

                    if (profileError) {
                        console.error('[Avatar] Profile update error:', profileError)
                    } else {
                        console.log('[Avatar] Uploaded to Supabase and profile updated')
                    }
                }
            } catch (supabaseError) {
                console.error('[Avatar] Supabase operation failed:', supabaseError)
                // Continue - localStorage is still available
            }

            // Notify UI to refresh anything that reads avatar from localStorage
            window.dispatchEvent(new CustomEvent('avatar-updated'))

            // Notify local server about avatar update
            localServer.updateProfile({ avatar_url: avatarDataUrl })

            onAvatarUpdated(avatarDataUrl, meta)
            onClose()
        } catch (err: any) {
            console.error('Avatar upload error:', err)
            setError(err.message || 'Failed to save avatar')
        } finally {
            setUploading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal avatar-crop-modal" onClick={e => e.stopPropagation()}>
                <div className="modal__header">
                    <h3 className="modal__title">Change Avatar</h3>
                    <button className="modal__close" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className="avatar-crop-modal__content">
                    {!imageSrc ? (
                        <div className="avatar-crop-modal__upload">
                            <div 
                                className="avatar-crop-modal__preview"
                                style={currentAvatar ? { backgroundImage: `url(${currentAvatar})` } : undefined}
                            >
                                {!currentAvatar && (
                                    <span className="avatar-crop-modal__placeholder">
                                        {userId.charAt(0).toUpperCase()}
                                    </span>
                                )}
                            </div>
                            <p className="avatar-crop-modal__hint">
                                Click below to select an image or GIF (max 5MB)
                            </p>
                            <button 
                                className="btn btn--primary"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                Choose Image
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,.gif"
                                style={{ display: 'none' }}
                                onChange={handleFileSelect}
                            />
                        </div>
                    ) : (
                        <div className="avatar-crop-modal__crop">
                            <div 
                                ref={containerRef}
                                className="avatar-crop-modal__crop-area"
                                onMouseDown={handleMouseDown}
                                style={{ cursor: dragging ? 'grabbing' : 'grab' }}
                            >
                                <div 
                                    className="avatar-crop-modal__image-container"
                                    style={{
                                        backgroundImage: `url(${imageSrc})`,
                                        backgroundPosition: `${position.x}% ${position.y}%`,
                                        backgroundSize: `${zoom * 100}%`,
                                    }}
                                />
                                <div className="avatar-crop-modal__crop-circle" />
                            </div>

                            <div className="avatar-crop-modal__controls">
                                <button 
                                    className="btn btn--icon btn--ghost"
                                    onClick={handleZoomOut}
                                    disabled={zoom <= 1}
                                    title="Zoom Out"
                                >
                                    <ZoomOut size={18} />
                                </button>
                                <span className="avatar-crop-modal__zoom-value">
                                    {Math.round(zoom * 100)}%
                                </span>
                                <button 
                                    className="btn btn--icon btn--ghost"
                                    onClick={handleZoomIn}
                                    disabled={zoom >= 3}
                                    title="Zoom In"
                                >
                                    <ZoomIn size={18} />
                                </button>
                                <button 
                                    className="btn btn--icon btn--ghost"
                                    onClick={() => fileInputRef.current?.click()}
                                    title="Change Image"
                                >
                                    <RotateCw size={18} />
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*,.gif"
                                    style={{ display: 'none' }}
                                    onChange={handleFileSelect}
                                />
                            </div>

                            {isGif && (
                                <p className="avatar-crop-modal__gif-hint">
                                    GIF: position and zoom will be applied via CSS (animation preserved)
                                </p>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="settings-alert settings-alert--error">
                            {error}
                        </div>
                    )}
                </div>

                <div className="modal__actions">
                    <button className="btn btn--ghost" onClick={onClose}>
                        Cancel
                    </button>
                    {imageSrc && (
                        <button 
                            className="btn btn--primary"
                            onClick={handleUpload}
                            disabled={uploading}
                        >
                            {uploading ? (
                                <><Loader2 size={16} className="spin" /> Uploading...</>
                            ) : (
                                <><Check size={16} /> Apply</>
                            )}
                        </button>
                    )}
                </div>

                {/* Hidden canvas for cropping */}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
        </div>
    )
}

export default AvatarCropModal
