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
import { buildTruck, getTruckParts }      from './vehicle.js'
import {
  initEffects,
  tickEffects,
  updateBedAnimation,
  updateSensorCones,
  updateLidarSweep,
  updateAlertGlow,
} from './effects.js'
import { updateHUD }        from './hud.js'
import { connectWebSocket } from './websocket.js'

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

  // ── WebSocket ──────────────────────────────────────────────────────────────
  connectWebSocket(WS_URL, state => {
    currentState = state
    updateHUD(state)
    updateBedAnimation(state.bed_position)
    updateSensorCones(state.mode)
    updateLidarSweep(state.lidar_active)
    updateAlertGlow(state.alert, parts)
  })

  // ── Button → REST API wiring ───────────────────────────────────────────────
  // The REST call mutates backend state and triggers a WebSocket broadcast back
  // to all clients, which then drives the visual update.  We never update the
  // 3D scene directly from button clicks — everything goes through the WS loop.

  document.getElementById('btn-mode').addEventListener('click', () => {
    const next = currentState.mode === 'autonomous' ? 'manual' : 'autonomous'
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
      'chassis',
      'cab',
      'lidar',
    ]
    const component = components[Math.floor(Math.random() * components.length)]
    const severity  = Math.random() > 0.5 ? 'warning' : 'critical'
    apiPost('/api/alert', { component, severity })
  })

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
