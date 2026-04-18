/**
 * hud.js — Pure DOM manipulation.
 * Receives the current VehicleState and updates every HUD element.
 * No Three.js imports.
 */

const TIRE_LOW_PSI = 95
const TIRE_WARNING_PSI = 92
const TIRE_CRITICAL_PSI = 88
const ENGINE_WARNING = 100
const ENGINE_CRITICAL = 105

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

  // ── Predictive analytics ────────────────────────────────────────────────────
  const history = state.telemetry_history?.engine_temp_c
  if (history && history.length > 1) {
    drawSparkline('sparkline-engine', history, ENGINE_WARNING, ENGINE_CRITICAL)
  } else {
    const engCanvas = document.getElementById('sparkline-engine')
    if (engCanvas) {
      const ctx = engCanvas.getContext('2d')
      ctx.clearRect(0, 0, engCanvas.width, engCanvas.height)
    }
  }

  _updatePredictionText('prediction-engine', state.predictions, 'engine_temp_c',
    'ENG', '°C')

  // Tire sparkline + prediction
  const tireKeys = ['tire_fl', 'tire_fr', 'tire_rl', 'tire_rr']
  const activeTireKey = tireKeys.find(k => state.telemetry_history?.[k]?.length > 1)
  if (activeTireKey) {
    const tireHistory = state.telemetry_history[activeTireKey]
    drawSparkline('sparkline-tire', tireHistory, TIRE_WARNING_PSI, TIRE_CRITICAL_PSI, true)
    const label = activeTireKey.replace('tire_', '').toUpperCase()
    _updatePredictionText('prediction-tire', state.predictions, activeTireKey,
      `TIRE ${label}`, ' PSI', true)
  } else {
    const tireCanvas = document.getElementById('sparkline-tire')
    if (tireCanvas) {
      const ctx = tireCanvas.getContext('2d')
      ctx.clearRect(0, 0, tireCanvas.width, tireCanvas.height)
    }
    const tirePredEl = document.getElementById('prediction-tire')
    if (tirePredEl) {
      tirePredEl.textContent = 'NOMINAL'
      tirePredEl.className = 'prediction-text prediction-normal'
    }
  }
}

function _updatePredictionText(elementId, predictions, component, label, unit, isDropping) {
  const el = document.getElementById(elementId)
  if (!el || !predictions) return
  const pred = predictions.find(p => p.component === component)
  if (pred && pred.severity !== 'normal') {
    const secs = pred.seconds_to_threshold
    let timeStr
    if (secs === null || secs === undefined || secs <= 0) {
      timeStr = 'NOW'
    } else if (secs < 60) {
      timeStr = `${Math.round(secs)}s`
    } else {
      timeStr = `~${Math.round(secs / 60)} MIN`
    }
    const sevLabel = pred.severity === 'critical' ? 'CRITICAL' : 'WARNING'
    const arrow = isDropping ? '▼' : '▲'
    el.textContent = `${arrow} ${label} ${sevLabel} IN ${timeStr} (${pred.current_value}${unit} → ${pred.threshold}${unit})`
    el.className = `prediction-text prediction-${pred.severity}`
  } else {
    el.textContent = 'NOMINAL'
    el.className = 'prediction-text prediction-normal'
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

function drawSparkline(canvasId, history, warnThresh, critThresh, isDropping = false) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height

  ctx.clearRect(0, 0, W, H)

  const values = history.map(p => p.v)
  const times  = history.map(p => p.t)
  const minV = Math.min(...values, warnThresh - 5)
  const maxV = Math.max(...values, critThresh + 5)
  const range = maxV - minV || 1

  const toX = i => (i / (values.length - 1)) * W
  const toY = v => H - ((v - minV) / range) * H

  // Warning threshold line
  const warnY = toY(warnThresh)
  ctx.strokeStyle = 'rgba(255, 179, 0, 0.4)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(0, warnY)
  ctx.lineTo(W, warnY)
  ctx.stroke()

  // Critical threshold line
  const critY = toY(critThresh)
  ctx.strokeStyle = 'rgba(255, 34, 68, 0.5)'
  ctx.beginPath()
  ctx.moveTo(0, critY)
  ctx.lineTo(W, critY)
  ctx.stroke()
  ctx.setLineDash([])

  // Data line
  ctx.strokeStyle = '#00ffff'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  values.forEach((v, i) => {
    const x = toX(i)
    const y = toY(v)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // Trend projection (dotted line extending the slope)
  if (values.length >= 3) {
    const last = values[values.length - 1]
    const tLast = times[times.length - 1]
    const tFirst = times[0]
    const duration = tLast - tFirst
    if (duration > 0) {
      const slope = (last - values[0]) / duration
      const projected = last + slope * duration * 0.5
      const projX = W + W * 0.15
      const projY = toY(projected)
      const lastX = toX(values.length - 1)
      const lastY = toY(last)

      const inDanger = isDropping ? projected < warnThresh : projected > warnThresh
      const inCritical = isDropping ? projected < critThresh : projected > critThresh
      ctx.strokeStyle = inDanger ? 'rgba(255, 179, 0, 0.6)' : 'rgba(0, 255, 255, 0.4)'
      if (inCritical) ctx.strokeStyle = 'rgba(255, 34, 68, 0.6)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(lastX, lastY)
      ctx.lineTo(projX, projY)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // Current value dot
  if (values.length > 0) {
    const lastV = values[values.length - 1]
    const lx = toX(values.length - 1)
    const ly = toY(lastV)
    const dotCrit = isDropping ? lastV <= critThresh : lastV >= critThresh
    const dotWarn = isDropping ? lastV <= warnThresh : lastV >= warnThresh
    ctx.fillStyle = dotCrit ? '#ff2244' : dotWarn ? '#ffb300' : '#00ffff'
    ctx.beginPath()
    ctx.arc(lx, ly, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}
