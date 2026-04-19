/**
 * voice.js — Voice control with wake word + text-to-speech responses.
 *
 * Uses the browser's Web Speech API (SpeechRecognition + SpeechSynthesis).
 * No external dependencies. Chrome-only (matches requirement: standard Chrome).
 *
 * Flow:
 *  1. Always listening for wake word "jarvis wake up"
 *  2. On wake: Jarvis responds, enters command mode for 10s
 *  3. Executes matched command, speaks confirmation
 *  4. Returns to wake-word listening after timeout
 */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

let _onCommand = null
let _statusEl = null
let _mode = 'sleeping'   // 'sleeping' | 'listening'
let _listenTimeout = null
let recognition = null
let _audioQueue = []
let _isPlaying = false
let _isSpeaking = false  // true while TTS is playing — pause recognition

const COMMANDS = [
  { phrases: ['engine simulation', 'engine failure', 'start engine', 'simulate engine'],
    action: 'engine_start', response: 'Starting engine failure simulation.' },
  { phrases: ['stop engine', 'engine stop', 'stop simulation', 'reset engine'],
    action: 'engine_stop', response: 'Engine simulation stopped. Systems nominal.' },
  { phrases: ['tire failure', 'tire simulation', 'simulate tire', 'start tire'],
    action: 'tire_start', response: 'Simulating rear-left tire pressure loss.' },
  { phrases: ['stop tire', 'tire stop', 'reset tire'],
    action: 'tire_stop', response: 'Tire simulation stopped. Pressure restored.' },
  { phrases: ['raise bed', 'raise the bed', 'dump', 'dump load'],
    action: 'bed_raise', response: 'Raising dump bed. Load weight dropping to zero.' },
  { phrases: ['lower bed', 'lower the bed'],
    action: 'bed_lower', response: 'Lowering dump bed.' },
  { phrases: ['activate lidar', 'lidar on', 'start lidar', 'enable lidar'],
    action: 'lidar_on', response: 'LIDAR sweep activated.' },
  { phrases: ['deactivate lidar', 'lidar off', 'stop lidar', 'disable lidar'],
    action: 'lidar_off', response: 'LIDAR sweep deactivated.' },
  { phrases: ['top view', 'top down', 'bird eye', 'overhead'],
    action: 'cam_top', response: 'Switching to top-down view.' },
  { phrases: ['side view', 'side profile', 'profile view'],
    action: 'cam_side', response: 'Switching to side profile.' },
  { phrases: ['operator view', 'operator', 'cab view'],
    action: 'cam_operator', response: 'Switching to operator cab view.' },
  { phrases: ['status', 'status report', 'report', 'how are things'],
    action: 'status', response: null },
  { phrases: ['go to sleep', 'sleep', 'stand by', 'goodbye', 'jarvis stand by', 'jarvis sleep'],
    action: 'sleep', response: 'Standing by. Say "Jarvis wake up" when you need me.' },
]

function speak(text) {
  _audioQueue.push(text)
  if (!_isPlaying) _playNext()
}

function _pauseRecognition() {
  _isSpeaking = true
  if (recognition) try { recognition.stop() } catch (e) { /* ok */ }
}

function _resumeRecognition() {
  _isSpeaking = false
  if (recognition) {
    setTimeout(() => {
      try { recognition.start() } catch (e) { /* ok */ }
    }, 400)
  }
}

async function _playNext() {
  if (_audioQueue.length === 0) {
    _isPlaying = false
    _resumeRecognition()
    return
  }
  _isPlaying = true
  _pauseRecognition()
  const text = _audioQueue.shift()

  try {
    const resp = await fetch(`${API_URL}/api/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (resp.ok) {
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => { URL.revokeObjectURL(url); _playNext() }
      audio.onerror = () => { URL.revokeObjectURL(url); _fallbackSpeak(text); _playNext() }
      audio.play()
      return
    }
  } catch (e) { /* fall through to browser TTS */ }

  _fallbackSpeak(text)
  _playNext()
}

function _fallbackSpeak(text) {
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1.05
  utterance.pitch = 0.95
  synth.speak(utterance)
}

function setStatus(status) {
  _mode = status
  if (_statusEl) {
    if (status === 'sleeping') {
      _statusEl.textContent = 'VOICE: STANDBY'
      _statusEl.className = 'voice-status voice-sleeping'
    } else {
      _statusEl.textContent = 'VOICE: LISTENING'
      _statusEl.className = 'voice-status voice-listening'
    }
  }
}

function matchCommand(transcript) {
  const lower = transcript.toLowerCase().trim()
  for (const cmd of COMMANDS) {
    for (const phrase of cmd.phrases) {
      if (lower.includes(phrase)) return cmd
    }
  }
  return null
}

function enterListeningMode() {
  setStatus('listening')
  clearTimeout(_listenTimeout)
  _listenTimeout = setTimeout(() => {
    speak('Going to standby.')
    setStatus('sleeping')
  }, 15000)
}

export function speakAlert(text) { speak(text) }

export function initVoice(onCommand, statusElement) {
  if (!SpeechRecognition) {
    console.warn('[voice] SpeechRecognition not supported in this browser')
    return
  }

  _onCommand = onCommand
  _statusEl = statusElement

  recognition = new SpeechRecognition()
  recognition.continuous = true
  recognition.interimResults = false
  recognition.lang = 'en-US'

  recognition.onresult = (event) => {
    const last = event.results[event.results.length - 1]
    if (!last.isFinal) return
    const transcript = last[0].transcript.toLowerCase().trim()
    console.log(`[voice] Heard: "${transcript}"`)

    if (_mode === 'sleeping') {
      if (transcript.includes('jarvis') && (transcript.includes('wake up') || transcript.includes('wake'))) {
        speak('Online and ready. What do you need?')
        enterListeningMode()
      }
      return
    }

    // In listening mode
    if (transcript.includes('jarvis') && (transcript.includes('wake up') || transcript.includes('wake'))) {
      speak('I\'m already here. What do you need?')
      enterListeningMode()
      return
    }

    const cmd = matchCommand(transcript)
    if (cmd) {
      clearTimeout(_listenTimeout)
      if (cmd.response) speak(cmd.response)
      if (_onCommand) _onCommand(cmd.action)
      if (cmd.action !== 'sleep') {
        enterListeningMode()
      } else {
        setStatus('sleeping')
      }
    } else {
      // Ignore short/noise transcripts silently
      if (transcript.length > 3) {
        console.log(`[voice] No match for: "${transcript}"`)
      }
      enterListeningMode()
    }
  }

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed') {
      console.warn('[voice] Microphone permission denied. Click anywhere on the page and reload.')
      if (_statusEl) {
        _statusEl.textContent = 'VOICE: MIC DENIED'
        _statusEl.className = 'voice-status voice-sleeping'
      }
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.warn('[voice] Error:', event.error)
    }
  }

  let restartTimer = null
  recognition.onend = () => {
    // Don't restart while Jarvis is speaking — it would hear its own voice
    if (_isSpeaking) return
    clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      try { recognition.start() } catch (e) { /* already started */ }
    }, 500)
  }

  setStatus('sleeping')
  console.log('[voice] Initialised — starting recognition…')
  try {
    recognition.start()
    console.log('[voice] Recognition started. Say "Jarvis wake up".')
  } catch (e) {
    console.warn('[voice] Could not start recognition:', e.message)
  }
}
