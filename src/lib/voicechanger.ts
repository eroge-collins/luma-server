// Voice Changer Service - Web Audio API effects for voice calls

export type VoiceEffect = 'none' | 'deep' | 'chipmunk' | 'robot' | 'radio' | 'echo' | 'cave'

export interface VoiceChangerConfig {
    enabled: boolean
    effect: VoiceEffect
    intensity: number // 0-1
}

const VOICE_CHANGER_CONFIG_KEY = 'luma_voicechanger_config'

const DEFAULT_CONFIG: VoiceChangerConfig = {
    enabled: false,
    effect: 'none',
    intensity: 0.5,
}

export const VOICE_EFFECTS: { value: VoiceEffect; label: string; description: string }[] = [
    { value: 'none', label: 'None', description: 'No effect applied' },
    { value: 'deep', label: 'Deep', description: 'Lowers your voice pitch' },
    { value: 'chipmunk', label: 'Chipmunk', description: 'Raises your voice pitch' },
    { value: 'robot', label: 'Robot', description: 'Robotic modulation effect' },
    { value: 'radio', label: 'Radio', description: 'Old radio / walkie-talkie' },
    { value: 'echo', label: 'Echo', description: 'Spacey echo/delay effect' },
    { value: 'cave', label: 'Cave', description: 'Deep reverb cave effect' },
]

export function getVoiceChangerConfig(): VoiceChangerConfig {
    try {
        const stored = localStorage.getItem(VOICE_CHANGER_CONFIG_KEY)
        if (stored) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(stored) }
        }
    } catch {}
    return DEFAULT_CONFIG
}

export function saveVoiceChangerConfig(config: Partial<VoiceChangerConfig>): void {
    const current = getVoiceChangerConfig()
    const updated = { ...current, ...config }
    localStorage.setItem(VOICE_CHANGER_CONFIG_KEY, JSON.stringify(updated))
}

export interface VoiceChangerChain {
    inputNode: MediaStreamAudioSourceNode
    outputGain: GainNode
    cleanup: () => void
}

// Build the audio processing chain for a given effect
// Connects sourceStream → effect chain → destination (the AudioNode you pass in)
export function createVoiceChangerChain(
    audioContext: AudioContext,
    sourceStream: MediaStream,
    effect: VoiceEffect,
    intensity: number,
    destination: AudioNode,
): VoiceChangerChain {
    const source = audioContext.createMediaStreamSource(sourceStream)
    
    // Output gain node for muting control
    const outputGain = audioContext.createGain()
    outputGain.gain.value = 1.0
    outputGain.connect(destination)

    const nodes: AudioNode[] = [outputGain]

    if (effect === 'none') {
        source.connect(outputGain)
    } else if (effect === 'deep') {
        // Low-pass filter + boost low frequencies
        const lowpass = audioContext.createBiquadFilter()
        lowpass.type = 'lowshelf'
        lowpass.frequency.value = 300
        lowpass.gain.value = 10 + intensity * 15

        const lowpass2 = audioContext.createBiquadFilter()
        lowpass2.type = 'lowpass'
        lowpass2.frequency.value = 3000 - intensity * 1500
        lowpass2.Q.value = 0.5

        source.connect(lowpass)
        lowpass.connect(lowpass2)
        lowpass2.connect(outputGain)
        nodes.push(lowpass, lowpass2)
    } else if (effect === 'chipmunk') {
        // High-pass boost + high shelf
        const highshelf = audioContext.createBiquadFilter()
        highshelf.type = 'highshelf'
        highshelf.frequency.value = 2000
        highshelf.gain.value = 8 + intensity * 12

        const highpass = audioContext.createBiquadFilter()
        highpass.type = 'highpass'
        highpass.frequency.value = 200 + intensity * 300
        highpass.Q.value = 0.7

        source.connect(highpass)
        highpass.connect(highshelf)
        highshelf.connect(outputGain)
        nodes.push(highshelf, highpass)
    } else if (effect === 'robot') {
        // Ring modulation - multiply signal with sine wave
        const oscillator = audioContext.createOscillator()
        oscillator.type = 'sine'
        oscillator.frequency.value = 50 + intensity * 150

        const modGain = audioContext.createGain()
        modGain.gain.value = 0

        // The oscillator modulates the gain
        oscillator.connect(modGain.gain)
        source.connect(modGain)
        modGain.connect(outputGain)

        oscillator.start()
        nodes.push(oscillator as any, modGain)
    } else if (effect === 'radio') {
        // Band-pass filter (telephone/radio effect)
        const bandpass = audioContext.createBiquadFilter()
        bandpass.type = 'bandpass'
        bandpass.frequency.value = 1500 + intensity * 500
        bandpass.Q.value = 2 + intensity * 5

        // Add some distortion
        const waveshaper = audioContext.createWaveShaper()
        const curve = new Float32Array(256)
        const amount = 5 + intensity * 20
        for (let i = 0; i < 256; i++) {
            const x = (i * 2) / 256 - 1
            curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x))
        }
        waveshaper.curve = curve
        waveshaper.oversample = '2x'

        const radioGain = audioContext.createGain()
        radioGain.gain.value = 1.5

        source.connect(bandpass)
        bandpass.connect(waveshaper)
        waveshaper.connect(radioGain)
        radioGain.connect(outputGain)
        nodes.push(bandpass, waveshaper, radioGain)
    } else if (effect === 'echo') {
        // Delay with feedback
        const delay = audioContext.createDelay(1.0)
        delay.delayTime.value = 0.15 + intensity * 0.35

        const feedback = audioContext.createGain()
        feedback.gain.value = 0.3 + intensity * 0.3

        const dryGain = audioContext.createGain()
        dryGain.gain.value = 1.0

        const wetGain = audioContext.createGain()
        wetGain.gain.value = 0.5 + intensity * 0.3

        // Dry path
        source.connect(dryGain)
        dryGain.connect(outputGain)

        // Wet path with feedback loop
        source.connect(delay)
        delay.connect(feedback)
        feedback.connect(delay)
        delay.connect(wetGain)
        wetGain.connect(outputGain)

        nodes.push(delay, feedback, dryGain, wetGain)
    } else if (effect === 'cave') {
        // Multiple delays to simulate reverb
        const dryGain = audioContext.createGain()
        dryGain.gain.value = 0.8

        source.connect(dryGain)
        dryGain.connect(outputGain)

        const delayTimes = [0.03, 0.07, 0.13, 0.21, 0.34]
        const gains = [0.5, 0.4, 0.3, 0.2, 0.1]

        for (let i = 0; i < delayTimes.length; i++) {
            const d = audioContext.createDelay(1.0)
            d.delayTime.value = delayTimes[i] * (0.5 + intensity)
            const g = audioContext.createGain()
            g.gain.value = gains[i] * (0.5 + intensity * 0.5)

            const lp = audioContext.createBiquadFilter()
            lp.type = 'lowpass'
            lp.frequency.value = 4000 - i * 500

            source.connect(d)
            d.connect(lp)
            lp.connect(g)
            g.connect(outputGain)
            nodes.push(d, g, lp)
        }

        nodes.push(dryGain)
    }

    return {
        inputNode: source,
        outputGain,
        cleanup: () => {
            try {
                source.disconnect()
                nodes.forEach(n => {
                    try { n.disconnect() } catch {}
                })
            } catch {}
        },
    }
}
