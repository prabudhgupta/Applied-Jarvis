/**
 * main.js — Orchestrator.
 *
 * Responsibilities:
 *  1. Initialise the Three.js scene
 *  2. Build the procedural truck (with GLTF fallback)
 *  3. Initialise visual effects
 *  4. Connect to the backend WebSocket
 *  5. Wire up HUD control buttons → REST API calls
 *  6. Start the animation loop
 */

import { initScene, startAnimationLoop } from './scene.js'
import { buildTruck, getTruckParts, setHolographicMode } from './vehicle.js'
import {
  initEffects,
  tickEffects,
  updateBedAnimation,
  updateLidarSweep,
  updateAlertGlow,
  updateWheelSpeed,
  updateEngineTemp,
  updateTirePressure,
} from './effects.js'
import { updateHUD }          from './hud.js'
import { setCameraPreset }    from './scene.js'
import { connectWebSocket } from './websocket.js'
import { initVoice, speakAlert } from './voice.js'

// ── Config (Vite env vars, with sensible dev defaults) ────────────────────────
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL  = import.meta.env.VITE_WS_URL  || 'ws://localhost:8000/ws'

// Current vehicle state — kept in sync by the WebSocket handler
let currentState = {
  mode:         'manual',
  bed_position: 'lowered',
  lidar_active: false,
  alert:        null,
  telemetry: {
    load_weight_tons: 380,
    tire_pressure_psi: { fl: 100, fr: 100, rl: 98, rr: 100 },
    engine_temp_c: 92,
    fuel_percent: 67,
    speed_kph: 0,
  },
}

// ── Initialise scene ─────────────────────────────────────────────────────────
const canvas = document.getElementById('app-canvas')
const { scene, composer, controls } = initScene(canvas)

// ── Build truck (async — may load GLTF or fall back to procedural) ────────────
buildTruck(scene).then(() => {
  const parts = getTruckParts()

  // Initialise effects after parts are available
  initEffects(scene, parts)

  // ── Spoken prediction alerts ────────────────────────────────────────────────
  let lastSpokenAlert = null
  const ALERT_INTERVALS = [60, 45, 30, 15, 10, 5]

  function checkSpokenAlerts(predictions) {
    if (!predictions) return
    for (const pred of predictions) {
      if (pred.severity === 'normal') continue
      const secs = pred.seconds_to_threshold
      if (secs === null || secs === undefined || secs <= 0) {
        if (lastSpokenAlert !== `${pred.component}_now`) {
          const label = pred.component === 'engine_temp_c' ? 'Engine' : 'Tire'
          speakAlert(`Warning. ${label} failure imminent.`)
          lastSpokenAlert = `${pred.component}_now`
        }
        continue
      }
      for (const threshold of ALERT_INTERVALS) {
        if (secs <= threshold + 2 && secs >= threshold - 2) {
          const alertKey = `${pred.component}_${threshold}`
          if (lastSpokenAlert !== alertKey) {
            const label = pred.component === 'engine_temp_c' ? 'Engine' : 'Tire'
            speakAlert(`${label} critical in approximately ${threshold} seconds.`)
            lastSpokenAlert = alertKey
          }
          break
        }
      }
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
  connectWebSocket(WS_URL, state => {
    currentState = state
    updateHUD(state)
    updateBedAnimation(state.bed_position)
    updateLidarSweep(state.lidar_active)
    updateAlertGlow(state.alert, parts)
    updateWheelSpeed(state.telemetry?.speed_kph ?? 0)
    updateEngineTemp(state.telemetry?.engine_temp_c ?? 92)
    updateTirePressure(state.telemetry?.tire_pressure_psi)
    checkSpokenAlerts(state.predictions)
  })

  // ── Button → REST API wiring ───────────────────────────────────────────────
  // The REST call mutates backend state and triggers a WebSocket broadcast back
  // to all clients, which then drives the visual update.  We never update the
  // 3D scene directly from button clicks — everything goes through the WS loop.

  let engineFailActive = false
  const btnMode = document.getElementById('btn-mode')
  btnMode.addEventListener('click', () => {
    engineFailActive = !engineFailActive
    const next = engineFailActive ? 'autonomous' : 'manual'
    btnMode.classList.toggle('active', engineFailActive)
    apiPost('/api/mode', { mode: next })
  })

  document.getElementById('btn-bed').addEventListener('click', () => {
    const next = currentState.bed_position === 'raised' ? 'lowered' : 'raised'
    apiPost('/api/bed', { position: next })
  })

  document.getElementById('btn-lidar').addEventListener('click', () => {
    apiPost('/api/lidar', { active: !currentState.lidar_active })
  })

  document.getElementById('btn-alert').addEventListener('click', () => {
    // Cycle through alert components for demo variety
    const components = [
      'tire_rear_left',
      'tire_front_right',
      'engine',
    ]
    const component = components[Math.floor(Math.random() * components.length)]
    const severity  = 'critical'
    apiPost('/api/alert', { component, severity })
  })

  let tireFailActive = false
  const btnTire = document.getElementById('btn-tire-fail')
  btnTire.addEventListener('click', () => {
    tireFailActive = !tireFailActive
    btnTire.classList.toggle('active', tireFailActive)
    apiPost('/api/tire-fail', { active: tireFailActive, wheel: 'rl' })
  })

  let hologramActive = false
  const btnHologram = document.getElementById('btn-hologram')
  btnHologram.addEventListener('click', () => {
    hologramActive = !hologramActive
    btnHologram.classList.toggle('active', hologramActive)
    updateAlertGlow(null, parts)
    setHolographicMode(hologramActive)
    updateTirePressure(currentState.telemetry?.tire_pressure_psi)
    updateEngineTemp(currentState.telemetry?.engine_temp_c ?? 92)
    updateAlertGlow(currentState.alert, parts)
  })

  // Camera presets — purely client-side, no backend round-trip needed
  document.getElementById('btn-cam-top').addEventListener('click', () => setCameraPreset('TOP'))
  document.getElementById('btn-cam-side').addEventListener('click', () => setCameraPreset('SIDE'))
  document.getElementById('btn-cam-operator').addEventListener('click', () => setCameraPreset('OPERATOR'))
  document.getElementById('btn-cam-access').addEventListener('click', () => setCameraPreset('ACCESS'))

  // ── Voice control ──────────────────────────────────────────────────────────
  const voiceStatusEl = document.getElementById('voice-status')
  initVoice(action => {
    const actions = {
      engine_start: () => { if (!engineFailActive) btnMode.click() },
      engine_stop:  () => { if (engineFailActive) btnMode.click() },
      tire_start:   () => { if (!tireFailActive) btnTire.click() },
      tire_stop:    () => { if (tireFailActive) btnTire.click() },
      bed_raise:    () => { if (currentState.bed_position === 'lowered') apiPost('/api/bed', { position: 'raised' }) },
      bed_lower:    () => { if (currentState.bed_position === 'raised') apiPost('/api/bed', { position: 'lowered' }) },
      lidar_on:     () => { if (!currentState.lidar_active) apiPost('/api/lidar', { active: true }) },
      lidar_off:    () => { if (currentState.lidar_active) apiPost('/api/lidar', { active: false }) },
      cam_top:      () => setCameraPreset('TOP'),
      cam_side:     () => setCameraPreset('SIDE'),
      cam_operator: () => setCameraPreset('OPERATOR'),
      cam_access:   () => setCameraPreset('ACCESS'),
      status:       () => {
        const t = currentState.telemetry
        const statusMsg = `Engine temperature ${Math.round(t.engine_temp_c)} degrees. ` +
          `Speed ${Math.round(t.speed_kph)} kilometers per hour. ` +
          `Fuel at ${Math.round(t.fuel_percent)} percent. ` +
          `Mode: ${currentState.mode}.`
        speakAlert(statusMsg)
      },
      sleep: () => {},
    }
    if (actions[action]) actions[action]()
  }, voiceStatusEl)

  // ── Animation loop ─────────────────────────────────────────────────────────
  startAnimationLoop(composer, controls, delta => {
    tickEffects(delta)
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────
async function apiPost(path, body) {
  try {
    await fetch(`${API_URL}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
  } catch (err) {
    console.warn(`[API] POST ${path} failed:`, err)
  }
}
