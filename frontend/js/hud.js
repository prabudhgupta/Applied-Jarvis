/**
 * hud.js — Pure DOM manipulation.
 * Receives the current VehicleState and updates every HUD element.
 * No Three.js imports.
 */

const TIRE_LOW_PSI = 95

export function updateHUD(state) {
  // ── Mode ────────────────────────────────────────────────────────────────────
  const modeEl = document.getElementById('hud-mode')
  if (modeEl) {
    modeEl.textContent = state.mode.toUpperCase()
    modeEl.className   = 'value ' + (state.mode === 'autonomous' ? 'value-green' : 'value-amber')
  }

  // ── Bed position ────────────────────────────────────────────────────────────
  const bedEl = document.getElementById('hud-bed')
  if (bedEl) bedEl.textContent = state.bed_position.toUpperCase()

  // ── LIDAR ───────────────────────────────────────────────────────────────────
  const lidarEl = document.getElementById('hud-lidar')
  if (lidarEl) {
    lidarEl.textContent = state.lidar_active ? 'ACTIVE' : 'INACTIVE'
    lidarEl.className   = 'value ' + (state.lidar_active ? 'value-green' : '')
  }

  // ── Telemetry ───────────────────────────────────────────────────────────────
  const t = state.telemetry
  if (t) {
    _setText('hud-load',  `${t.load_weight_tons} T`)
    _setText('hud-speed', `${t.speed_kph} KPH`)
    _setText('hud-fuel',  `${t.fuel_percent}%`)
    _setText('hud-temp',  `${t.engine_temp_c}°C`)

    // Tire pressures — highlight low readings
    const psi = t.tire_pressure_psi
    if (psi) {
      ;['fl', 'fr', 'rl', 'rr'].forEach(pos => {
        const el = document.getElementById(`hud-tire-${pos}`)
        if (!el) return
        const val = psi[pos]
        el.textContent = `${pos.toUpperCase()}: ${val}`
        el.className   = 'value ' + (val < TIRE_LOW_PSI ? 'value-alert' : '')
      })
    }
  }

  // ── Alert banner ─────────────────────────────────────────────────────────────
  const alertEl     = document.getElementById('hud-alert')
  const alertTextEl = document.getElementById('hud-alert-text')
  if (alertEl && alertTextEl) {
    if (state.alert) {
      alertEl.classList.remove('hidden')
      const { component, severity } = state.alert
      alertTextEl.textContent =
        `ALERT: ${component.replace(/_/g, ' ').toUpperCase()} — ${severity.toUpperCase()}`
    } else {
      alertEl.classList.add('hidden')
    }
  }
}

export function setConnectionStatus(status) {
  // status: 'connecting' | 'connected' | 'disconnected'
  const el = document.getElementById('hud-connection')
  if (!el) return
  const map = {
    connecting:   ['CONNECTING', 'value-warning'],
    connected:    ['ONLINE',     'value-green'],
    disconnected: ['OFFLINE',    'value-alert'],
  }
  const [text, cls] = map[status] || ['UNKNOWN', '']
  el.textContent = text
  el.className   = `value ${cls}`
}

function _setText(id, text) {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}
