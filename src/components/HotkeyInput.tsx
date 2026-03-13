import { useState, useEffect, useRef } from 'react'
import { Keyboard } from 'lucide-react'

interface HotkeyInputProps {
    value: string
    onChange: (key: string) => void
    placeholder?: string
}

// Map key codes to display names
const KEY_DISPLAY_NAMES: Record<string, string> = {
    'KeyA': 'A', 'KeyB': 'B', 'KeyC': 'C', 'KeyD': 'D', 'KeyE': 'E', 'KeyF': 'F',
    'KeyG': 'G', 'KeyH': 'H', 'KeyI': 'I', 'KeyJ': 'J', 'KeyK': 'K', 'KeyL': 'L',
    'KeyM': 'M', 'KeyN': 'N', 'KeyO': 'O', 'KeyP': 'P', 'KeyQ': 'Q', 'KeyR': 'R',
    'KeyS': 'S', 'KeyT': 'T', 'KeyU': 'U', 'KeyV': 'V', 'KeyW': 'W', 'KeyX': 'X',
    'KeyY': 'Y', 'KeyZ': 'Z',
    'Digit0': '0', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4',
    'Digit5': '5', 'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9',
    'Space': 'Space', 'Tab': 'Tab', 'Enter': 'Enter', 'Escape': 'Esc',
    'Backspace': 'Backspace', 'Delete': 'Delete',
    'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
    'ShiftLeft': 'Shift', 'ShiftRight': 'Shift',
    'ControlLeft': 'Ctrl', 'ControlRight': 'Ctrl',
    'AltLeft': 'Alt', 'AltRight': 'Alt',
    'MetaLeft': 'Win', 'MetaRight': 'Win',
    'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6',
    'F7': 'F7', 'F8': 'F8', 'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
}

function getDisplayName(code: string): string {
    return KEY_DISPLAY_NAMES[code] || code.replace('Key', '').replace('Digit', '')
}

function HotkeyInput({ value, onChange, placeholder = 'Press a key' }: HotkeyInputProps) {
    const [isListening, setIsListening] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isListening) {
                e.preventDefault()
                e.stopPropagation()
                
                // Ignore modifier keys alone
                if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
                
                onChange(e.code)
                setIsListening(false)
            }
        }

        if (isListening) {
            window.addEventListener('keydown', handleKeyDown)
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [isListening, onChange])

    const handleClick = () => {
        setIsListening(true)
        inputRef.current?.focus()
    }

    const handleBlur = () => {
        setIsListening(false)
    }

    const displayValue = value ? getDisplayName(value) : ''

    return (
        <div
            ref={inputRef as any}
            className={`hotkey-input ${isListening ? 'listening' : ''}`}
            onClick={handleClick}
            onBlur={handleBlur}
            tabIndex={0}
        >
            <Keyboard size={14} />
            <span className={displayValue ? '' : 'placeholder'}>
                {isListening ? 'Press a key...' : displayValue || placeholder}
            </span>
        </div>
    )
}

export default HotkeyInput
