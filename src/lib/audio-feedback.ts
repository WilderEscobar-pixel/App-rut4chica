/**
 * Audio Feedback Utility
 * 
 * Provides audio feedback for scan events:
 * - Success sound: when a product is scanned correctly and assigned
 * - Alert sound: when a product is not found or already complete
 * 
 * Uses the Web Audio API to generate simple tones without external files.
 */

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

/**
 * Play a success tone (ascending two-note chime)
 */
export function playSuccessSound() {
  try {
    const ctx = getAudioContext()
    
    // First note
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(880, ctx.currentTime) // A5
    gain1.gain.setValueAtTime(0.15, ctx.currentTime)
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)
    
    osc1.start(ctx.currentTime)
    osc1.stop(ctx.currentTime + 0.2)
    
    // Second note (higher)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.12) // E6
    gain2.gain.setValueAtTime(0, ctx.currentTime)
    gain2.gain.setValueAtTime(0.15, ctx.currentTime + 0.12)
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
    
    osc2.start(ctx.currentTime + 0.12)
    osc2.stop(ctx.currentTime + 0.4)
  } catch (err) {
    // Audio not available, fail silently
    console.warn('Audio feedback not available:', err)
  }
}

/**
 * Play an alert tone (descending buzz)
 */
export function playAlertSound() {
  try {
    const ctx = getAudioContext()
    
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    
    osc.type = 'square'
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.3)
    
    gain.gain.setValueAtTime(0.1, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
    
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch (err) {
    console.warn('Audio feedback not available:', err)
  }
}

/**
 * Play a complete tone (three ascending notes)
 */
export function playCompleteSound() {
  try {
    const ctx = getAudioContext()
    const notes = [660, 880, 1100]
    const durations = [0.15, 0.15, 0.25]
    let startTime = ctx.currentTime
    
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, startTime)
      gain.gain.setValueAtTime(0.12, startTime)
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + durations[i])
      
      osc.start(startTime)
      osc.stop(startTime + durations[i])
      
      startTime += durations[i] * 0.8
    })
  } catch (err) {
    console.warn('Audio feedback not available:', err)
  }
}
