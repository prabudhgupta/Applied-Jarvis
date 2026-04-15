import * as THREE from 'three'

// ── Module-level state (targets + current values) ────────────────────────────
// WebSocket state-change callbacks only SET TARGETS.
// tickEffects() lerps toward targets every frame — this prevents visual jank
// from WebSocket floods (100 rapid state changes just update the same target).

let _scene = null
let _parts = null

// Bed animation
let bedTargetAngle  = 0
let bedCurrentAngle = 0

// Sensor cones (appear in autonomous mode)
let sensorCones        = []
let coneTargetOpacity  = 0

// LIDAR sweep
let lidarSweepMesh  = null
let lidarAngle      = 0
let lidarTargetVis  = false   // true = should be visible

// Alert overlay meshes — keyed by component name
let alertOverlays = {}

// Elapsed time for shader uTime uniform
let elapsedTime = 0

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

  // Sensor cones — one at each corner of the truck, pointing outward-down
  const conePositions = [
    { x:  3.2, z:  2.2, ry:  Math.PI * 0.25 },   // front-left
    { x:  3.2, z: -2.2, ry: -Math.PI * 0.25 },   // front-right
    { x: -3.2, z:  2.2, ry:  Math.PI * 0.75 },   // rear-left
    { x: -3.2, z: -2.2, ry: -Math.PI * 0.75 },   // rear-right
  ]

  conePositions.forEach(({ x, z, ry }) => {
    const geo = new THREE.ConeGeometry(2.2, 5.0, 18, 1, true)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const cone = new THREE.Mesh(geo, mat)
    // Tip at origin — tilt outward and down
    cone.rotation.z = Math.PI * 0.7   // tilt toward ground
    cone.rotation.y = ry
    cone.position.set(x, 1.8, z)
    scene.add(cone)
    sensorCones.push(cone)
  })

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
  bedTargetAngle = bedPosition === 'raised' ? Math.PI * 0.27 : 0
}

export function updateSensorCones(mode) {
  coneTargetOpacity = mode === 'autonomous' ? 0.55 : 0
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

  // Bed rotation — smooth lerp toward target
  const BED_SPEED = 1.4   // radians per second
  const bedDiff = bedTargetAngle - bedCurrentAngle
  if (Math.abs(bedDiff) > 0.0005) {
    bedCurrentAngle += Math.sign(bedDiff) * Math.min(Math.abs(bedDiff), BED_SPEED * delta)
    _parts.bedGroup.rotation.x = bedCurrentAngle
  }

  // Sensor cone opacity fade
  const CONE_SPEED = 1.8  // opacity units per second
  sensorCones.forEach(cone => {
    const diff = coneTargetOpacity - cone.material.opacity
    if (Math.abs(diff) > 0.001) {
      cone.material.opacity += Math.sign(diff) * Math.min(Math.abs(diff), CONE_SPEED * delta)
    }
    cone.visible = cone.material.opacity > 0.005
  })

  // LIDAR sweep rotation
  if (lidarSweepMesh.visible) {
    lidarAngle += delta * 1.5   // ~1.5 rad/s ≈ one revolution per ~4 seconds
    lidarSweepMesh.rotation.z = lidarAngle
    // Update the arc shader uniform to match
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
}
