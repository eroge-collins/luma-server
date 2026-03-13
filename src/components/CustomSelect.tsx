import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

interface Option {
    value: string
    label: string
}

interface CustomSelectProps {
    value: string
    onChange: (value: string) => void
    options: Option[]
    placeholder?: string
    disabled?: boolean
}

function CustomSelect({ value, onChange, options, placeholder = 'Select...', disabled = false }: CustomSelectProps) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    const selectedLabel = options.find(o => o.value === value)?.label || placeholder

    // Close on click outside
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        if (open) document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [open])

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        if (open) document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [open])

    return (
        <div className="custom-select" ref={ref}>
            <button
                className={`custom-select__trigger ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => !disabled && setOpen(!open)}
                type="button"
                disabled={disabled}
            >
                <span className="custom-select__label">{selectedLabel}</span>
                <ChevronDown size={14} className={`custom-select__chevron ${open ? 'rotated' : ''}`} />
            </button>

            {open && (
                <div className="custom-select__dropdown">
                    {options.map(option => (
                        <button
                            key={option.value}
                            className={`custom-select__option ${option.value === value ? 'selected' : ''}`}
                            onClick={() => {
                                onChange(option.value)
                                setOpen(false)
                            }}
                            type="button"
                        >
                            <span>{option.label}</span>
                            {option.value === value && <Check size={14} />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export default CustomSelect
