import * as THREE from 'three'
import { getGrid, getRoadGroup } from './scene.js'

// ── Module-level state (targets + current values) ────────────────────────────
// WebSocket state-change callbacks only SET TARGETS.
// tickEffects() lerps toward targets every frame — this prevents visual jank
// from WebSocket floods (100 rapid state changes just update the same target).

let _scene = null
let _parts = null

// Bed animation — incline when lowered matching real truck bed slope
const BED_LOWERED_ANGLE = -0.06  // slight rear tilt — back of bed rises, front stays close to body
let bedTargetAngle  = BED_LOWERED_ANGLE
let bedCurrentAngle = BED_LOWERED_ANGLE


// LIDAR sweep
let lidarSweepMesh  = null
let lidarAngle      = 0
let lidarTargetVis  = false   // true = should be visible


// Wheel rotation
let wheelTargetSpeed  = 0   // kph
let wheelCurrentSpeed = 0   // kph (lerped)

// Engine heat color
let engineTempTarget = 92

// Elapsed time for shader uTime uniform
let elapsedTime = 0

const _colorYellow = new THREE.Color(0xffcc00)
const _colorOrange = new THREE.Color(0xff6600)
const _colorRed    = new THREE.Color(0xff2244)
const _tempColor   = new THREE.Color()

// ── Component → mesh resolver ─────────────────────────────────────────────────
function resolveComponentMesh(component, parts) {
  const map = {
    chassis:           parts.chassis,
    cab:               parts.cab,
    engine:            parts.engineHood,
    lidar:             parts.lidarDome,
    tire_front_left:   parts.wheels?.fl,
    tire_front_right:  parts.wheels?.fr,
    tire_rear_left:    parts.wheels?.rl,
    tire_rear_right:   parts.wheels?.rr,
  }
  return map[component] || null
}

// ── initEffects ───────────────────────────────────────────────────────────────
/**
 * Create all persistent effect meshes (cones, LIDAR sweep).
 * Call once after the truck is built.
 */
export function initEffects(scene, parts) {
  _scene = scene
  _parts = parts

  // Engine heat — tint the actual engineHood mesh via its uAlertBlend uniform
  // (no separate overlay geometry needed since we own the mesh)

  // LIDAR sweep — a horizontal rotating plane with an arc shader
  // Only the leading 30° arc is drawn; rotation.y accumulates to sweep 360°
  lidarSweepMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.ShaderMaterial({
      uniforms: {
        uAngle: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uAngle;
        varying vec2 vUv;
        #define PI 3.14159265

        void main() {
          vec2 centered = vUv - 0.5;
          float dist = length(centered);
          if (dist > 0.48) discard;

          float angle = atan(centered.y, centered.x);
          // Keep only a ~28° arc ahead of the rotation direction
          float arcHalf = PI * 0.08;
          float diff = mod(angle - uAngle + PI * 3.0, PI * 2.0) - PI;
          if (abs(diff) > arcHalf) discard;

          // Fade from bright leading edge to transparent trailing edge
          float fade = 1.0 - abs(diff) / arcHalf;
          // Fade with distance from centre
          float distFade = 1.0 - dist / 0.48;
          float alpha = fade * distFade * 0.55;

          gl_FragColor = vec4(0.0, 1.0, 1.0, alpha);
        }
      `,
      transparent: true,
      side:        THREE.DoubleSide,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    })
  )
  lidarSweepMesh.rotation.x = -Math.PI / 2   // lie flat (XZ plane)
  lidarSweepMesh.position.set(0, 0.4, 0)
  lidarSweepMesh.visible = false
  scene.add(lidarSweepMesh)

}

// ── State-change setters (called from WebSocket handler) ─────────────────────

export function updateBedAnimation(bedPosition) {
  bedTargetAngle = bedPosition === 'raised' ? Math.PI * 0.18 : BED_LOWERED_ANGLE
}


export function updateWheelSpeed(speedKph) {
  wheelTargetSpeed = speedKph
}

export function updateEngineTemp(tempC) {
  engineTempTarget = tempC
}

export function updateTirePressure(tirePsi) {
  if (!_parts?.wheels || !tirePsi) return
  const WARN = 94
  const CRIT = 89
  for (const [key, wheel] of Object.entries(_parts.wheels)) {
    if (!wheel) continue
    const psi = tirePsi[key]
    if (psi === undefined) continue
    let color
    if (psi <= CRIT) color = new THREE.Color(0xff2244)
    else if (psi <= WARN) color = new THREE.Color(0xffb300)
    else color = new THREE.Color(0xD4A020)   // normal = yellow matching wheel material
    wheel.traverse(child => {
      if (child.material?.uniforms?.uColor) {
        child.material.uniforms.uColor.value.copy(color)
      } else if (child.material?.color) {
        child.material.color.copy(color)
        // Add emissive glow for visibility on dark materials
        if (child.material.emissive) {
          child.material.emissive.copy(color).multiplyScalar(psi <= CRIT ? 0.4 : psi <= WARN ? 0.2 : 0)
        }
      }
    })
  }
}

export function updateLidarSweep(active) {
  lidarTargetVis = active
  if (!active) {
    // Keep mesh visible until fade-out is handled by lidar dome opacity
    lidarSweepMesh.visible = false
  } else {
    lidarSweepMesh.visible = true
  }
}

// Track current alert state to avoid reset/reapply flicker
let _currentAlertComponent = null
let _alertedMesh = null

export function updateAlertGlow(alert, parts) {
  const newComponent = alert?.component || null

  // Only reset if the alert actually changed
  if (newComponent === _currentAlertComponent) return

  // Reset previous alert
  if (_alertedMesh) {
    _alertedMesh.traverse(child => {
      if (child.material?.uniforms?.uAlertBlend) {
        child.material.uniforms.uAlertBlend.value = 0
      } else if (child.material?.emissive) {
        child.material.emissive.set(0x000000)
      }
    })
    _alertedMesh = null
  }

  _currentAlertComponent = newComponent
  if (!alert) return

  const targetMesh = resolveComponentMesh(alert.component, parts)
  if (!targetMesh) return

  // Tint the mesh red via uAlertBlend (holographic) or emissive (standard)
  targetMesh.traverse(child => {
    if (child.material?.uniforms?.uAlertBlend) {
      child.material.uniforms.uAlertBlend.value = 1.0
      child.material.uniforms.uAlertColor.value.set(0xff2244)
    } else if (child.material?.emissive) {
      child.material.emissive.set(0xff2244)
    }
  })
  _alertedMesh = targetMesh
}

// ── Per-frame tick ────────────────────────────────────────────────────────────
/**
 * Called every animation frame from main.js.
 * @param {number} delta - seconds since last frame
 */
export function tickEffects(delta) {
  if (!_parts) return

  elapsedTime += delta

  // Update uTime on all holographic materials (drives scanline animation)
  _parts.allMaterials.forEach(mat => {
    if (mat.uniforms?.uTime !== undefined) {
      mat.uniforms.uTime.value = elapsedTime
    }
  })

  // Bed rotation — smooth lerp toward target.
  // bedRotationSign accounts for hinge placement: procedural hinges at the
  // group origin with bed extending +X (sign=1), segmented hinges at the
  // rear with bed extending -X (sign=-1). Both produce front-lifts-up.
  const BED_SPEED = 1.4   // radians per second
  const bedDiff = bedTargetAngle - bedCurrentAngle
  if (Math.abs(bedDiff) > 0.0005) {
    bedCurrentAngle += Math.sign(bedDiff) * Math.min(Math.abs(bedDiff), BED_SPEED * delta)
  }
  const sign = _parts.bedRotationSign ?? 1
  _parts.bedGroup.rotation.z = bedCurrentAngle * sign

  // LIDAR sweep rotation
  // Only update uAngle — the shader handles the visual rotation of the arc.
  // Do NOT change rotation.z/y: the mesh lies flat via rotation.x=-PI/2 set at
  // init time; changing another axis would tilt it out of the ground plane.
  if (lidarSweepMesh.visible) {
    lidarAngle += delta * 1.5   // ~1.5 rad/s ≈ one revolution per ~4 seconds
    lidarSweepMesh.material.uniforms.uAngle.value = lidarAngle
    // Pulse lidar dome
    if (_parts.lidarDome) {
      const domeMat = _parts.lidarDome.material
      domeMat.opacity = 0.4 + Math.sin(elapsedTime * 4.0) * 0.25
    }
  } else if (_parts.lidarDome) {
    _parts.lidarDome.material.opacity = 0.25
  }

  // Pulse alert blend on the alerted mesh
  if (_alertedMesh) {
    const pulse = 0.7 + Math.sin(elapsedTime * 6.0) * 0.3
    _alertedMesh.traverse(child => {
      if (child.material?.uniforms?.uAlertBlend) {
        child.material.uniforms.uAlertBlend.value = pulse
      } else if (child.material?.emissive) {
        child.material.emissive.set(0xff2244).multiplyScalar(pulse * 0.5)
      }
    })
  }

  // Wheel rotation — lerp speed, then spin proportionally
  const WHEEL_ACCEL = 40
  const speedDiff = wheelTargetSpeed - wheelCurrentSpeed
  if (Math.abs(speedDiff) > 0.01) {
    wheelCurrentSpeed += Math.sign(speedDiff) * Math.min(Math.abs(speedDiff), WHEEL_ACCEL * delta)
  }
  if (_parts?.wheels && Math.abs(wheelCurrentSpeed) > 0.01) {
    const wheelRadius = _parts.wheelRadius || 1.4
    const omega = ((wheelCurrentSpeed / 3.6) / wheelRadius) * 3
    const rotIncrement = omega * delta
    const spinAxis = _parts.wheelSpinAxis || 'y'
    for (const w of Object.values(_parts.wheels)) {
      if (w) w.rotation[spinAxis] += rotIncrement
    }
  }

  // Engine heat — tint the engineHood from normal → yellow → orange → red
  if (_parts.engineHood) {
    const t = engineTempTarget
    if (t <= 96) {
      _tempColor.set(0x000000) // no heat tint
    } else if (t <= 100) {
      const f = (t - 96) / 4
      _tempColor.set(0x000000).lerp(_colorYellow, f)
    } else if (t <= 103) {
      const f = (t - 100) / 3
      _tempColor.copy(_colorYellow).lerp(_colorOrange, f)
    } else {
      const f = Math.min((t - 103) / 2, 1)
      _tempColor.copy(_colorOrange).lerp(_colorRed, f)
    }

    // Holographic path: tint uColor
    if (_parts.engineHood.material?.uniforms?.uColor) {
      const holoTarget = t <= 96 ? new THREE.Color(0x00ffff) : _tempColor
      _parts.engineHood.material.uniforms.uColor.value.lerp(holoTarget, 0.05)
    } else {
      // Standard material path: use emissive for heat glow
      _parts.engineHood.traverse(child => {
        if (child.material?.emissive) {
          child.material.emissive.lerp(_tempColor, 0.05)
        }
      })
    }
  }

  // Grid + road scroll — moves the ground to simulate truck driving forward
  const grid = getGrid()
  const road = getRoadGroup()
  if (grid && Math.abs(wheelCurrentSpeed) > 0.01) {
    const scrollSpeed = (wheelCurrentSpeed / 3.6) * delta
    grid.position.x -= scrollSpeed
    if (grid.position.x < -2) grid.position.x += 2
    if (road) {
      road.position.x -= scrollSpeed
      if (road.position.x < -4) road.position.x += 4
    }
  }

}
