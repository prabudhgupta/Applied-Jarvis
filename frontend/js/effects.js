import * as THREE from 'three'
import { getGrid, getRoadGroup } from './scene.js'

// ── Module-level state (targets + current values) ────────────────────────────
// WebSocket state-change callbacks only SET TARGETS.
// tickEffects() lerps toward targets every frame — this prevents visual jank
// from WebSocket floods (100 rapid state changes just update the same target).

let _scene = null
let _parts = null

// Bed animation
let bedTargetAngle  = 0
let bedCurrentAngle = 0


// LIDAR sweep
let lidarSweepMesh  = null
let lidarAngle      = 0
let lidarTargetVis  = false   // true = should be visible

// Alert overlay meshes — keyed by component name
let alertOverlays = {}

// Wheel rotation
let wheelTargetSpeed  = 0   // kph
let wheelCurrentSpeed = 0   // kph (lerped)

// Engine heat color
let engineTempTarget = 92
let engineHeatOverlay = null

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

  // Engine heat overlay — positioned at the engine area of the truck
  const engineBB = new THREE.Box3().setFromObject(parts.engineHood || parts.bodyGroup)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  engineBB.getCenter(center)
  engineBB.getSize(size)
  const overlayGeo = new THREE.BoxGeometry(size.x * 0.35, size.y * 0.6, size.z * 0.8)
  const overlayMat = new THREE.MeshBasicMaterial({
    color: 0xffcc00,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  engineHeatOverlay = new THREE.Mesh(overlayGeo, overlayMat)
  engineHeatOverlay.position.set(
    center.x - size.x * 0.25,
    center.y + size.y * 0.15,
    center.z
  )
  engineHeatOverlay.visible = false
  scene.add(engineHeatOverlay)

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
  bedTargetAngle = bedPosition === 'raised' ? Math.PI * 0.15 : 0
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
    else color = new THREE.Color(0x00ffff)
    wheel.traverse(child => {
      if (child.material?.uniforms?.uColor) {
        child.material.uniforms.uColor.value.copy(color)
      } else if (child.material?.color) {
        child.material.color.copy(color)
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

export function updateAlertGlow(alert, parts) {
  // Dispose all previous alert overlays
  Object.values(alertOverlays).forEach(mesh => {
    mesh.parent?.remove(mesh)
    mesh.geometry.dispose()
    mesh.material.dispose()
  })
  alertOverlays = {}

  if (!alert) return

  const targetMesh = resolveComponentMesh(alert.component, parts)
  if (!targetMesh) return

  const overlayMat = new THREE.MeshBasicMaterial({
    color: 0xff2244,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const overlay = new THREE.Mesh(targetMesh.geometry, overlayMat)
  // Match transform by parenting to the same parent, mirroring position
  targetMesh.parent.add(overlay)
  overlay.position.copy(targetMesh.position)
  overlay.rotation.copy(targetMesh.rotation)
  // Slightly larger to avoid z-fighting
  overlay.scale.copy(targetMesh.scale).multiplyScalar(1.03)

  alertOverlays[alert.component] = overlay
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
    const sign = _parts.bedRotationSign ?? 1
    _parts.bedGroup.rotation.z = bedCurrentAngle * sign
  }

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

  // Pulse alert overlay opacity
  Object.values(alertOverlays).forEach(mesh => {
    mesh.material.opacity = 0.45 + Math.sin(elapsedTime * 6.0) * 0.2
  })

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
    for (const w of Object.values(_parts.wheels)) {
      if (w) w.rotation.y += rotIncrement
    }
  }

  // Engine heat overlay — glow from yellow → orange → red at the engine area
  if (engineHeatOverlay) {
    const t = engineTempTarget
    let targetOpacity = 0
    if (t <= 96) {
      targetOpacity = 0
    } else if (t <= 100) {
      const f = (t - 96) / 4
      _tempColor.copy(_colorYellow)
      targetOpacity = f * 0.35
    } else if (t <= 103) {
      const f = (t - 100) / 3
      _tempColor.copy(_colorYellow).lerp(_colorOrange, f)
      targetOpacity = 0.35 + f * 0.2
    } else {
      const f = Math.min((t - 103) / 2, 1)
      _tempColor.copy(_colorOrange).lerp(_colorRed, f)
      targetOpacity = 0.55 + f * 0.15
    }

    engineHeatOverlay.material.color.lerp(_tempColor, 0.08)
    const opDiff = targetOpacity - engineHeatOverlay.material.opacity
    engineHeatOverlay.material.opacity += opDiff * 0.05
    engineHeatOverlay.visible = engineHeatOverlay.material.opacity > 0.01
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
