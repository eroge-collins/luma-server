import { Minus, Square, X } from 'lucide-react'

function TitleBar() {
    const handleMinimize = () => window.electronAPI?.minimize()
    const handleMaximize = () => window.electronAPI?.maximize()
    const handleClose = () => window.electronAPI?.close()

    return (
        <div className="title-bar">
            <div className="title-bar__logo">Luma</div>
            <div className="title-bar__controls">
                <button className="title-bar__btn" onClick={handleMinimize} title="Minimize">
                    <Minus />
                </button>
                <button className="title-bar__btn" onClick={handleMaximize} title="Maximize">
                    <Square />
                </button>
                <button className="title-bar__btn title-bar__btn--close" onClick={handleClose} title="Close">
                    <X />
                </button>
            </div>
        </div>
    )
}

export default TitleBar
