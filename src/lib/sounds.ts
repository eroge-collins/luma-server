// Sound effects for the app using Web Audio API
let audioContext: AudioContext | null = null

function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    return audioContext
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume: number = 0.15) {
    const ctx = getAudioContext()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime)

    gainNode.gain.setValueAtTime(volume, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + duration)
}

export const sounds = {
    connect: () => {
        playTone(523, 0.15, 'sine', 0.12)
        setTimeout(() => playTone(659, 0.15, 'sine', 0.12), 100)
        setTimeout(() => playTone(784, 0.2, 'sine', 0.10), 200)
    },

    disconnect: () => {
        playTone(784, 0.15, 'sine', 0.12)
        setTimeout(() => playTone(523, 0.25, 'sine', 0.10), 120)
    },

    messageSent: () => {
        playTone(880, 0.08, 'sine', 0.06)
        setTimeout(() => playTone(1100, 0.08, 'sine', 0.05), 60)
    },

    messageReceived: () => {
        playTone(660, 0.1, 'sine', 0.08)
        setTimeout(() => playTone(880, 0.12, 'sine', 0.06), 80)
    },

    click: () => {
        playTone(1200, 0.04, 'sine', 0.04)
    },

    mute: () => {
        playTone(440, 0.12, 'sine', 0.08)
        setTimeout(() => playTone(330, 0.15, 'sine', 0.06), 80)
    },

    unmute: () => {
        playTone(330, 0.12, 'sine', 0.08)
        setTimeout(() => playTone(440, 0.15, 'sine', 0.06), 80)
    },

    join: () => {
        playTone(440, 0.1, 'sine', 0.08)
        setTimeout(() => playTone(554, 0.1, 'sine', 0.08), 80)
        setTimeout(() => playTone(659, 0.15, 'sine', 0.06), 160)
    },

    leave: () => {
        playTone(659, 0.1, 'sine', 0.08)
        setTimeout(() => playTone(554, 0.1, 'sine', 0.08), 80)
        setTimeout(() => playTone(440, 0.15, 'sine', 0.06), 160)
    },

    joinChannel: () => {
        playTone(440, 0.1, 'sine', 0.08)
        setTimeout(() => playTone(554, 0.1, 'sine', 0.08), 80)
        setTimeout(() => playTone(659, 0.15, 'sine', 0.06), 160)
    },

    error: () => {
        playTone(300, 0.15, 'triangle', 0.1)
        setTimeout(() => playTone(250, 0.2, 'triangle', 0.08), 120)
    },
}

export function resumeAudioContext() {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') {
        ctx.resume()
    }
}
