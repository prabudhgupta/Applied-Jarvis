import * as THREE from 'three'

// ── Module state ──────────────────────────────────────────────────────────────
let _parts = null
export function getTruckParts() { return _parts }

export function setHolographicMode(enabled) {
  if (!_parts?.truckGroup) return

  const holographicMaterials = []
  _parts.truckGroup.traverse(child => {
    if (!child.isMesh) return
    if (!child.userData.originalMaterial) {
      child.userData.originalMaterial = child.material
    }

    if (enabled) {
      if (!child.userData.holographicMaterial) {
        const color = child.userData.isWheelDetail ? 0x66ffff : 0x00ffff
        child.userData.holographicMaterial = createHolographicMaterial(color)
        child.userData.holographicMaterial.uniforms.uOpacity.value = 0.24
        child.userData.holographicMaterial.uniforms.uEmissive.value = 0.07
      }
      child.material = child.userData.holographicMaterial
      holographicMaterials.push(child.material)
    } else {
      child.material = child.userData.originalMaterial
    }
  })

  _parts.holographicEnabled = enabled
  _parts.allMaterials = enabled ? holographicMaterials : []
}

// ── Assembly Table ────────────────────────────────────────────────────────────
// Liebherr T284 mining truck: 48 STL parts from 3D-print CAD export.
// Only the structurally significant parts are loaded and assembled here.
// Positions derived from real Liebherr T284 dimensions at 1:58.8 scale
// (model wheel diameter 61.2mm = real 3600mm tire).
//
// Coordinate system (Three.js Y-up, truck faces +X):
//   X = forward/back (front of truck = +X)
//   Y = up
//   Z = left/right (left = +Z)
//
// Non-wheel parts need R_x(-90°) to convert STL Z-up → Three.js Y-up.
// Wheels are already correct without rotation (face in XY, axle along Z).

const STL_DIR = './models/liebherr/'

const ASSEMBLY = {
  // ── Wheels (6) ─────────────────────────────────────────────────────────────
  'obj_12_Component18.stl': { type: 'wheel', key: 'fl',  pos: [ 95, 30.6,  46.1 ] },
  'obj_13_Component18.stl': { type: 'wheel', key: 'fr',  pos: [ 95, 30.6, -46.1 ] },
  'obj_10_Component19.stl': { type: 'wheel', key: 'rlo', pos: [-12, 30.6,  58.65] },
  'obj_11_Component19.stl': { type: 'wheel', key: 'rli', pos: [-12, 30.6,  29.75] },
  'obj_14_Component19.stl': { type: 'wheel', key: 'rro', pos: [-12, 30.6, -29.75] },
  'obj_15_Component19.stl': { type: 'wheel', key: 'rri', pos: [-12, 30.6, -58.65] },

  // ── Dump bed (moved forward so hinge aligns with rear chassis) ──────────────
  'obj_1_to.stl_A.stl': { type: 'bed', pos: [5, 100, 0] },

  // ── Cab ────────────────────────────────────────────────────────────────────
  'obj_3_Body9.stl': { type: 'cab', pos: [95, 90, 0] },

  // ── Chassis / frame rails ──────────────────────────────────────────────────
  'obj_8_Component2.stl_A.stl':   { type: 'chassis', pos: [20, 45, 0] },
  'obj_9_Component2.stl_B_A.stl': { type: 'chassis', pos: [-40, 40, 0] },
  'obj_16_Component2.stl_B_B.stl':{ type: 'chassis', pos: [60, 40, 0] },

  // ── Deck plate (bed support surface) ───────────────────────────────────────
  'obj_2_to.stl_B.stl': { type: 'body', pos: [10, 56, 0] },

  // ── Engine hood ────────────────────────────────────────────────────────────
  'obj_4_Body5.stl_A.stl': { type: 'engine', pos: [118, 80, 0] },

  // ── Exhaust stacks (lowered, closer to cab) ───────────────────────────────
  'obj_45_Component33.stl': { type: 'body', pos: [78, 80, 38] },
  'obj_46_Component32.stl': { type: 'body', pos: [78, 80, -38] },

  // ── Front face (grille + panel below engine) ────────────────────────────────
  'obj_5_Body5.stl_B.stl': { type: 'body', pos: [137, 80, 0] },
  'obj_18_Component3.stl': { type: 'body', pos: [133, 63, 0] },

  // ── Gap between cab and bed (equipment housing / body structure) ────────────
  'obj_6_Body6.stl':       { type: 'body', pos: [68, 75, 0] },
  'obj_7_Body4.stl':       { type: 'body', pos: [58, 78, 0] },
  'obj_20_Component4.stl_B.stl': { type: 'chassis', pos: [72, 65, 0] },

  // ── Structural supports (centered) ─────────────────────────────────────────
  'obj_19_Component11.stl':      { type: 'chassis', pos: [40, 48, 0] },
  'obj_21_Component4.stl_A.stl': { type: 'chassis', pos: [-30, 50, 0] },

  // ── Suspension / hydraulics (between dual wheels, Z=±44) ───────────────────
  'obj_27_Component25.stl':  { type: 'chassis', pos: [-45, 35, 44] },
  'obj_28_Component28.stl':  { type: 'chassis', pos: [-45, 35, -44] },
  'obj_43_Component10.stl':  { type: 'chassis', pos: [-18, 38, 44] },
  'obj_44_Component27.stl':  { type: 'chassis', pos: [-18, 38, -44] },
  'obj_30_Component26.stl':  { type: 'chassis', pos: [15, 48, 0] },

  // ── Front fender / platform ────────────────────────────────────────────────
  'obj_29_Component29.stl': { type: 'chassis', pos: [90, 64, 0] },

  // ── Deck surface plates ────────────────────────────────────────────────────
  'obj_17_Component15.stl':  { type: 'chassis', pos: [0, 56, 0] },
  'obj_24_Component13.stl':  { type: 'chassis', pos: [45, 56, 0] },
  'obj_25_Component132.stl': { type: 'chassis', pos: [-25, 56, 15] },
  'obj_26_Component133.stl': { type: 'chassis', pos: [-25, 56, -15] },

  // ── Side rails ─────────────────────────────────────────────────────────────
  'obj_22_Component92.stl': { type: 'chassis', pos: [35, 56, 55] },
  'obj_23_Component92.stl': { type: 'chassis', pos: [35, 56, -55] },

  // ── Guardrails / handrails ─────────────────────────────────────────────────
  'obj_33_Component31.stl': { type: 'body', pos: [78, 95, 55] },
  'obj_34_Component31.stl': { type: 'body', pos: [78, 95, -55] },

  // ── Small structural details (centered, no wheel clipping) ─────────────────
  'obj_41_Component35.stl': { type: 'chassis', pos: [48, 50, 10] },
  'obj_42_Component34.stl': { type: 'chassis', pos: [48, 50, -10] },
  'obj_47_Component30.stl': { type: 'chassis', pos: [82, 58, 15] },
  'obj_48_Component30.stl': { type: 'chassis', pos: [82, 58, -15] },

  // The remaining tiny round/axle STL pieces render as diagonal pins in this
  // scene, so hubcaps are recreated procedurally for cleaner visual fidelity.
}

// ── Bed hinge point (rear-bottom of dump bed) ────────────────────────────────
// bed center X = 5, half-length = 203.1/2 = 101.55 → rear = -96.55
// bed center Y = 100, half-height = 88/2 = 44 → bottom = 56
const BED_HINGE_X = -96.55
const BED_HINGE_Y = 66
const BED_RESTING_CLEARANCE_Y = 12

// Rear wheel group centers (midpoint between inner/outer duals)
const RL_CENTER_Z = (58.65 + 29.75) / 2   // 44.2
const RR_CENTER_Z = -(58.65 + 29.75) / 2  // -44.2

// ── Materials ─────────────────────────────────────────────────────────────────
function makeBodyMat() {
  return new THREE.MeshStandardMaterial({
    color: 0xffc247, roughness: 0.46, metalness: 0.08,
    emissive: 0x5a3200,
    emissiveIntensity: 0.2,
    vertexColors: true,
  })
}
function makeBedMat() {
  return new THREE.MeshStandardMaterial({
    color: 0xf0b13a, roughness: 0.52, metalness: 0.07,
    emissive: 0x4a2a00,
    emissiveIntensity: 0.18,
    vertexColors: true,
  })
}
function makeWheelMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x74786f, roughness: 0.78, metalness: 0.05,
    emissive: 0x20231f,
    emissiveIntensity: 0.38,
  })
}
function makeWheelDetailMat() {
  return new THREE.MeshStandardMaterial({
    color: 0xf0b43a, roughness: 0.5, metalness: 0.16,
    emissive: 0x5b3500,
    emissiveIntensity: 0.26,
  })
}
function makeChassisMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x181a1d, roughness: 0.62, metalness: 0.22,
  })
}
function makeAccessMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x59636d, roughness: 0.46, metalness: 0.35,
    emissive: 0x10161a,
    emissiveIntensity: 0.34,
  })
}

function getMaterial(type) {
  switch (type) {
    case 'wheel':   return makeWheelMat()
    case 'bed':     return makeBedMat()
    case 'chassis': return makeChassisMat()
    case 'cab':     return makeBodyMat()
    case 'body':    return makeBodyMat()
    case 'engine': {
      const m = makeBodyMat()
      m.color.set(0xffcb4f)
      return m
    }
    default: return makeChassisMat()
  }
}

// ── Holographic ShaderMaterial (procedural fallback) ─────────────────────────
export function createHolographicMaterial(color = 0x00ffff) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor:       { value: new THREE.Color(color) },
      uTime:        { value: 0 },
      uOpacity:     { value: 0.45 },
      uFresnelPow:  { value: 5.0 },
      uScanSpeed:   { value: 0.35 },
      uScanDensity: { value: 70.0 },
      uEmissive:    { value: 0.18 },
      uAlertColor:  { value: new THREE.Color(0xff2244) },
      uAlertBlend:  { value: 0.0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal   = normalize(normalMatrix * normal);
        vViewDir  = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3  uColor;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uFresnelPow;
      uniform float uScanSpeed;
      uniform float uScanDensity;
      uniform float uEmissive;
      uniform vec3  uAlertColor;
      uniform float uAlertBlend;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldPos;
      void main() {
        float NdotV   = clamp(dot(vNormal, vViewDir), 0.0, 1.0);
        float fresnel = pow(1.0 - NdotV, uFresnelPow);
        float scan     = sin(vWorldPos.y * uScanDensity - uTime * uScanSpeed * 10.0);
        float scanline = smoothstep(0.0, 0.4, scan) * 0.18 + 0.82;
        vec3 baseColor = mix(uColor, uAlertColor, uAlertBlend);
        float emBoost = uAlertBlend * 0.5;
        vec3 color = baseColor * (uEmissive + emBoost + fresnel * 0.9) * scanline;
        float alpha = (uOpacity + emBoost) * (0.35 + fresnel * 0.65) * scanline;
        alpha = clamp(alpha, 0.0, 1.0);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side:        THREE.DoubleSide,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
  })
}

// ── Public entry point ───────────────────────────────────────────────────────
export async function buildTruck(scene) {
  try {
    return await buildAssembledSTL(scene)
  } catch (err) {
    console.warn('[vehicle] STL assembly failed, falling back to procedural:', err?.message || err)
    return buildProceduralTruck(scene)
  }
}

// ── Assembled STL truck ──────────────────────────────────────────────────────
async function buildAssembledSTL(scene) {
  const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
  const loader = new STLLoader()
  const rotZ2Y = new THREE.Matrix4().makeRotationX(-Math.PI / 2)

  const entries = Object.entries(ASSEMBLY)
  console.log(`[vehicle] Loading ${entries.length} STL parts for assembly...`)

  // Load all parts in parallel
  const loaded = await Promise.all(entries.map(([file, config]) =>
    new Promise((resolve, reject) => {
      loader.load(STL_DIR + file, geo => {
        geo.computeVertexNormals()

        // Convert Z-up → Y-up for non-wheel parts.
        // Wheels are already correct: face in XY plane, axle along Z.
        if (config.type !== 'wheel') {
          geo.applyMatrix4(rotZ2Y)
        }

        // Center geometry at its own origin (not at the print-bed position)
        geo.computeBoundingBox()
        const c = new THREE.Vector3()
        geo.boundingBox.getCenter(c)
        geo.translate(-c.x, -c.y, -c.z)

        // Flip bed 180° around Y — the tall protective front wall (serrated edge)
        // must face the cab/engine, not the rear of the truck.
        if (config.type === 'bed') {
          geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI))
        }
        if (['bed', 'body', 'cab', 'engine'].includes(config.type)) {
          addVerticalColorGradient(geo, config.type === 'bed' ? 0xffca4d : 0xffd25c, 0xb77a24)
        }

        resolve({ file, geo, config })
      }, undefined, err => reject(new Error(`Failed to load ${file}: ${err?.message || err}`)))
    })
  ))

  console.log(`[vehicle] All ${loaded.length} parts loaded, assembling...`)

  // ── Create scene hierarchy ──────────────────────────────────────────────────
  const truckGroup = new THREE.Group()
  const bodyGroup  = new THREE.Group()
  const bedGroup   = new THREE.Group()

  // Wheel groups: FL/FR are single wheels, RL/RR are dual groups
  const wheelFL = new THREE.Group()
  const wheelFR = new THREE.Group()
  const wheelRL = new THREE.Group()
  const wheelRR = new THREE.Group()
  wheelFL.position.set(95, 30.6, 46.1)
  wheelFR.position.set(95, 30.6, -46.1)
  wheelRL.position.set(-12, 30.6, RL_CENTER_Z)
  wheelRR.position.set(-12, 30.6, RR_CENTER_Z)

  // Bed group pivot at hinge (rear-bottom of bed), with a small resting lift so
  // wheels/hydraulics do not poke through the lowered bed from top-down views.
  bedGroup.position.set(BED_HINGE_X, BED_HINGE_Y + BED_RESTING_CLEARANCE_Y, 0)

  let chassisMesh = null
  let cabMesh     = null
  let engineMesh  = null

  for (const { file, geo, config } of loaded) {
    const mat  = getMaterial(config.type)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow   = true
    mesh.receiveShadow = true

    const [px, py, pz] = config.pos

    switch (config.type) {
      case 'wheel': {
        // Place wheel mesh inside its group (local offset from group center)
        switch (config.key) {
          case 'fl':  wheelFL.add(mesh); break
          case 'fr':  wheelFR.add(mesh); break
          case 'rlo': mesh.position.set(0, 0, 58.65 - RL_CENTER_Z);  wheelRL.add(mesh); break
          case 'rli': mesh.position.set(0, 0, 29.75 - RL_CENTER_Z);  wheelRL.add(mesh); break
          case 'rro': mesh.position.set(0, 0, -29.75 - RR_CENTER_Z); wheelRR.add(mesh); break
          case 'rri': mesh.position.set(0, 0, -58.65 - RR_CENTER_Z); wheelRR.add(mesh); break
        }
        break
      }
      case 'bed':
        // Position relative to bed hinge
        mesh.position.set(px - BED_HINGE_X, py - BED_HINGE_Y, pz)
        bedGroup.add(mesh)
        break
      case 'cab':
        mesh.position.set(px, py, pz)
        bodyGroup.add(mesh)
        cabMesh = mesh
        break
      case 'engine':
        mesh.position.set(px, py, pz)
        bodyGroup.add(mesh)
        engineMesh = mesh
        break
      case 'chassis':
        mesh.position.set(px, py, pz)
        bodyGroup.add(mesh)
        if (!chassisMesh) chassisMesh = mesh
        break
      default:
        mesh.position.set(px, py, pz)
        bodyGroup.add(mesh)
    }
  }

  const hydraulicGroup = addHydraulicDetails(bodyGroup)
  addOperatorAccessDetails(bodyGroup)
  addWheelHubCaps({ wheelFL, wheelFR, wheelRL, wheelRR })

  // The reference haul truck reads long and low from the side. Lengthen the
  // bed forward from its hinge while keeping the chassis/cab proportions stable.
  bedGroup.scale.x = 1.16

  // ── Assemble hierarchy ──────────────────────────────────────────────────────
  bodyGroup.add(bedGroup)
  bodyGroup.add(wheelFL, wheelFR, wheelRL, wheelRR)
  truckGroup.add(bodyGroup)

  // ── LIDAR dome (procedural — no STL part for this) ─────────────────────────
  const lidarDome = new THREE.Mesh(
    new THREE.SphereGeometry(4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x00ffff, transparent: true, opacity: 0.25,
      side: THREE.DoubleSide,
    })
  )
  // Place on top of the cab (cab top ≈ 90+27=117)
  lidarDome.position.set(95, 121, 0)
  bodyGroup.add(lidarDome)

  // ── Scale to viewport, center on XZ, ground at Y=0 ─────────────────────────
  // Slightly smaller than before so the raised bed stays clear of HUD panels.
  const box  = new THREE.Box3().setFromObject(truckGroup)
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const scale  = 10.2 / maxDim
  truckGroup.scale.setScalar(scale)

  // Recompute after scaling
  box.setFromObject(truckGroup)
  const center = box.getCenter(new THREE.Vector3())
  truckGroup.position.x -= center.x
  truckGroup.position.z -= center.z
  truckGroup.position.y -= box.min.y

  scene.add(truckGroup)

  // ── Wheel radius in scene units ─────────────────────────────────────────────
  const wheelRadius = 30.6 * scale

  const totalTris = loaded.reduce((sum, r) => {
    const pos = r.geo.getAttribute('position')
    return sum + (pos ? pos.count / 3 : 0)
  }, 0)
  console.log(`[vehicle] Truck assembled: ${loaded.length} parts, ~${Math.round(totalTris / 1000)}K tris, scale=${scale.toFixed(4)}, wheelRadius=${wheelRadius.toFixed(2)}`)

  // ── Populate _parts interface ───────────────────────────────────────────────
  _parts = {
    truckGroup,
    bodyGroup,
    chassis:     chassisMesh || bodyGroup,
    cab:         cabMesh || bodyGroup,
    engineHood:  engineMesh || cabMesh || bodyGroup,
    bedGroup,
    hydraulicGroup,
    bedRotationSign: 1,
    lidarDome,
    wheels:      { fl: wheelFL, fr: wheelFR, rl: wheelRL, rr: wheelRR },
    wheelRadius,
    wheelSpinAxis: 'z',   // STL wheels: geometry face in XY, axle along Z
    allMaterials: [],     // no holographic materials in STL path
  }
  return _parts
}

function addVerticalColorGradient(geometry, topColorHex, bottomColorHex) {
  geometry.computeBoundingBox()
  const minY = geometry.boundingBox.min.y
  const maxY = geometry.boundingBox.max.y
  const range = maxY - minY || 1
  const top = new THREE.Color(topColorHex)
  const bottom = new THREE.Color(bottomColorHex)
  const color = new THREE.Color()
  const pos = geometry.getAttribute('position')
  const colors = []

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const t = THREE.MathUtils.smoothstep((y - minY) / range, 0, 1)
    color.copy(bottom).lerp(top, t)
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
}

function makeBoxMesh(size, position, material, parent) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function makeCylinderBetween(start, end, radius, material, parent, radialSegments = 10) {
  const a = new THREE.Vector3(...start)
  const b = new THREE.Vector3(...end)
  const dir = b.clone().sub(a)
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, dir.length(), radialSegments),
    material
  )
  mesh.position.copy(a.clone().lerp(b, 0.5))
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  mesh.castShadow = true
  parent.add(mesh)
  return mesh
}

function addHydraulicDetails(bodyGroup) {
  const group = new THREE.Group()
  group.position.set(16, 45, 0)
  group.visible = false
  bodyGroup.add(group)

  const housingMat = makeChassisMat()
  housingMat.color.set(0x4e565b)
  housingMat.emissive.set(0x101417)
  housingMat.emissiveIntensity = 0.2
  const rodMat = new THREE.MeshStandardMaterial({
    color: 0x6d747c,
    roughness: 0.28,
    metalness: 0.58,
  })

  // The reference model hides the lift hardware when the bed is down. These
  // slim posts extend only during the dump animation, avoiding fixed cylinders
  // sitting awkwardly beside the wheels in the lowered state.
  for (const side of [1, -1]) {
    const z = side * 23
    makeBoxMesh([10, 5, 8], [-3, 0, z], housingMat, group)
    makeCylinderBetween([0, 2, z], [14, 34, z], 2.3, housingMat, group, 14)
    makeCylinderBetween([13, 30, z], [28, 64, z], 1.25, rodMat, group, 14)
    makeBoxMesh([8, 5, 7], [30, 64, z], housingMat, group)
  }
  return group
}

function addWheelHubCaps({ wheelFL, wheelFR, wheelRL, wheelRR }) {
  const hubMat = makeWheelDetailMat()
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x1f2329,
    roughness: 0.68,
    metalness: 0.22,
  })

  function addHub(parent, z, radius = 13) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 2.6, 32), hubMat.clone())
    hub.rotation.x = Math.PI / 2
    hub.position.z = z
    hub.userData.isWheelDetail = true
    parent.add(hub)

    const inner = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, 3.1, 28), ringMat.clone())
    inner.rotation.x = Math.PI / 2
    inner.position.z = z + Math.sign(z) * 0.35
    inner.userData.isWheelDetail = true
    parent.add(inner)
  }

  addHub(wheelFL, 12.8, 12.5)
  addHub(wheelFR, -12.8, 12.5)
  addHub(wheelRL, 27.1, 12.8)
  addHub(wheelRR, -27.1, 12.8)
}

function addOperatorAccessDetails(bodyGroup) {
  const accessMat = makeAccessMat()
  const deckMat = makeBodyMat()
  const stepMat = new THREE.MeshStandardMaterial({
    color: 0x59636d,
    roughness: 0.48,
    metalness: 0.32,
    emissive: 0x0b0f12,
    emissiveIntensity: 0.28,
  })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x101820,
    roughness: 0.25,
    metalness: 0.05,
    transparent: true,
    opacity: 0.65,
  })

  function box(size, position, material = accessMat) {
    return makeBoxMesh(size, position, material, bodyGroup)
  }

  function cylinderBetween(start, end, radius = 0.9, material = accessMat) {
    return makeCylinderBetween(start, end, radius, material, bodyGroup, 8)
  }

  function addRailRun(z, x0, x1, yDeck, yRail) {
    const postXs = [x0, x0 + (x1 - x0) * 0.35, x0 + (x1 - x0) * 0.7, x1]
    for (const x of postXs) cylinderBetween([x, yDeck, z], [x, yRail, z], 0.75)
    cylinderBetween([x0, yRail, z], [x1, yRail, z], 0.75)
  }

  function addFrontGrille() {
    const grilleBackMat = new THREE.MeshStandardMaterial({
      color: 0x182026,
      roughness: 0.7,
      metalness: 0.1,
    })
    const grilleSlatMat = new THREE.MeshStandardMaterial({
      color: 0x7f8990,
      roughness: 0.46,
      metalness: 0.34,
      emissive: 0x10161a,
      emissiveIntensity: 0.18,
    })

    box([1.5, 28, 46], [151, 55, 0], grilleBackMat)
    box([2.6, 3.2, 52], [152, 70.5, 0], accessMat)
    box([2.6, 3.2, 52], [152, 39.5, 0], accessMat)
    box([2.6, 32, 3.2], [152, 55, 26], accessMat)
    box([2.6, 32, 3.2], [152, 55, -26], accessMat)

    for (let y = 42; y <= 68; y += 4) {
      box([2.8, 0.75, 40], [153, y, 0], grilleSlatMat)
    }
    for (let z = -18; z <= 18; z += 6) {
      box([2.9, 24, 0.75], [153.2, 55, z], grilleSlatMat)
    }
  }

  function addFrontStair(side) {
    const zOuter = side * 67
    const zInner = side * 54
    const zCenter = (zOuter + zInner) / 2
    const x = 153

    // Front-mounted stair channel: near-vertical rails with visible rung gaps.
    cylinderBetween([x, 17, zOuter], [x, 66, zOuter], 0.75, accessMat)
    cylinderBetween([x, 17, zInner], [x, 66, zInner], 0.75, accessMat)
    for (let i = 0; i < 8; i++) {
      const y = 21 + i * 5.4
      box([2.8, 1.2, 13], [x + 0.4, y, zCenter], stepMat)
    }

    box([15, 2.5, 18], [153, 14, zCenter], stepMat)
    box([17, 3, 20], [146, 65, zCenter], deckMat)
  }

  // Side walkways beside the operator cab, matching the cream deck in the
  // reference print while keeping the rails dark for visual contrast.
  box([72, 3, 9], [96, 63, 70], deckMat)
  box([72, 3, 9], [96, 63, -70], deckMat)
  box([24, 3, 126], [134, 63, 0], deckMat)

  // Handrails around both side walkways and the front service deck.
  addRailRun(76, 62, 128, 64, 88)
  addRailRun(-76, 62, 128, 64, 88)
  for (const x of [124, 138, 150]) {
    cylinderBetween([x, 64, 58], [x, 88, 58], 0.75)
    cylinderBetween([x, 64, -58], [x, 88, -58], 0.75)
  }
  cylinderBetween([124, 88, 58], [150, 88, 58], 0.75)
  cylinderBetween([124, 88, -58], [150, 88, -58], 0.75)
  cylinderBetween([150, 88, 58], [150, 88, -58], 0.75)

  // Front access face: grille plus side stair channels with clear tread gaps.
  addFrontGrille()
  addFrontStair(1)
  addFrontStair(-1)

  // Dark cab glazing helps the operator station read as a cab instead of a
  // plain block in the holographic lighting.
  box([24, 16, 1.1], [95, 91, 65.5], glassMat)
  box([24, 16, 1.1], [95, 91, -65.5], glassMat)
  box([1.1, 16, 42], [132.5, 91, 0], glassMat)
  box([1.2, 20, 18], [133.2, 91, 33], glassMat)
  box([1.2, 20, 18], [133.2, 91, -33], glassMat)

  // Door outlines and recessed panel lines on the operator station.
  const trimMat = makeAccessMat()
  for (const z of [66.5, -66.5]) {
    box([1.2, 24, 1.4], [79, 89, z], trimMat)
    box([1.2, 24, 1.4], [111, 89, z], trimMat)
    box([32, 1.4, 1.4], [95, 101, z], trimMat)
    box([32, 1.4, 1.4], [95, 77, z], trimMat)
    box([5, 1.8, 1.8], [113, 88, z], trimMat)
  }

  // Minimal interior silhouette: just enough to say "operator station" through
  // the dark glazing without turning the model into a detailed cabin sim.
  box([11, 14, 9], [93, 78, 0], trimMat)
  box([8, 9, 5], [103, 90, 0], trimMat)
  cylinderBetween([111, 84, -6], [111, 84, 6], 1.2, trimMat)

  // Small service lamps / camera pods under the cab balcony.
  for (const z of [-28, -12, 12, 28]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 5, 16), accessMat)
    lamp.position.set(126, 56, z)
    lamp.rotation.x = Math.PI / 2
    lamp.castShadow = true
    bodyGroup.add(lamp)
  }
}

// ── Procedural fallback ──────────────────────────────────────────────────────
function buildProceduralTruck(scene) {
  const allMaterials = []
  function holo(color = 0x00ffff) {
    const mat = createHolographicMaterial(color)
    allMaterials.push(mat)
    return mat
  }

  function makeMesh(geometry, material) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = false
    return mesh
  }

  const truckGroup = new THREE.Group()

  const bodyGroup = new THREE.Group()
  const chassis = makeMesh(new THREE.BoxGeometry(8, 1.2, 4), holo())
  chassis.position.set(0, 0, 0)
  bodyGroup.add(chassis)

  const engineHood = makeMesh(new THREE.BoxGeometry(3.2, 1.2, 3.0), holo())
  engineHood.position.set(1.8, 0.8, 0)
  bodyGroup.add(engineHood)

  const cab = makeMesh(new THREE.BoxGeometry(2.4, 1.8, 3.2), holo())
  cab.position.set(-1.0, 1.5, 0)
  bodyGroup.add(cab)

  const frontBumper = makeMesh(new THREE.BoxGeometry(0.3, 0.8, 3.4), holo())
  frontBumper.position.set(3.3, 0.2, 0)
  bodyGroup.add(frontBumper)

  const exhaustGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.5, 8)
  const exhaust1 = makeMesh(exhaustGeo, holo(0x00cccc))
  exhaust1.position.set(1.2, 1.65, 1.0)
  bodyGroup.add(exhaust1)
  const exhaust2 = makeMesh(exhaustGeo, holo(0x00cccc))
  exhaust2.position.set(1.2, 1.65, -1.0)
  bodyGroup.add(exhaust2)

  bodyGroup.position.set(0, 1.8, 0)
  truckGroup.add(bodyGroup)

  const bedGroup = new THREE.Group()
  const BED_LEN = 7.0, BED_WIDTH = 4.6, WALL_H = 2.2, FLOOR_Y = 0.0
  const dumpBed = makeMesh(new THREE.BoxGeometry(BED_LEN, 0.35, BED_WIDTH), holo(0x008899))
  dumpBed.position.set(BED_LEN / 2, FLOOR_Y, 0)
  bedGroup.add(dumpBed)

  const bedWallMat = holo(0x006677)
  const bedWallL = makeMesh(new THREE.BoxGeometry(BED_LEN, WALL_H, 0.18), bedWallMat)
  bedWallL.position.set(BED_LEN / 2, WALL_H / 2 + 0.1, BED_WIDTH / 2 - 0.09)
  bedWallL.rotation.x = -0.08
  bedGroup.add(bedWallL)
  const bedWallR = makeMesh(new THREE.BoxGeometry(BED_LEN, WALL_H, 0.18), bedWallMat)
  bedWallR.position.set(BED_LEN / 2, WALL_H / 2 + 0.1, -(BED_WIDTH / 2 - 0.09))
  bedWallR.rotation.x = 0.08
  bedGroup.add(bedWallR)

  const bedRear = makeMesh(new THREE.BoxGeometry(0.2, 1.1, BED_WIDTH), bedWallMat)
  bedRear.position.set(0.1, 0.65, 0)
  bedGroup.add(bedRear)
  const bedFrontWall = makeMesh(new THREE.BoxGeometry(0.2, WALL_H + 0.3, BED_WIDTH), bedWallMat)
  bedFrontWall.position.set(BED_LEN - 0.1, (WALL_H + 0.3) / 2 + 0.1, 0)
  bedGroup.add(bedFrontWall)

  const canopyMat = holo(0x007788)
  const canopy = makeMesh(new THREE.BoxGeometry(3.2, 0.3, BED_WIDTH), canopyMat)
  canopy.position.set(BED_LEN + 1.0, WALL_H + 0.4, 0)
  bedGroup.add(canopy)
  const strut = makeMesh(new THREE.BoxGeometry(0.25, 1.6, 0.25), canopyMat)
  strut.position.set(BED_LEN + 2.4, WALL_H - 0.4, BED_WIDTH / 2 - 0.3)
  strut.rotation.z = 0.3
  bedGroup.add(strut)
  const strut2 = makeMesh(new THREE.BoxGeometry(0.25, 1.6, 0.25), canopyMat)
  strut2.position.set(BED_LEN + 2.4, WALL_H - 0.4, -(BED_WIDTH / 2 - 0.3))
  strut2.rotation.z = 0.3
  bedGroup.add(strut2)

  bedGroup.position.set(-4.0, 2.6, 0)
  truckGroup.add(bedGroup)

  const lidarDome = makeMesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.25,
    })
  )
  lidarDome.position.set(-1.0, 3.6, 0)
  truckGroup.add(lidarDome)

  const wheelGroup = new THREE.Group()
  function makeWheel(radiusY, width, color = 0x004455) {
    const mat = createHolographicMaterial(color)
    allMaterials.push(mat)
    const wheel = makeMesh(new THREE.CylinderGeometry(radiusY, radiusY, width, 20), mat)
    wheel.rotation.x = Math.PI / 2
    return wheel
  }

  const wfl = makeWheel(1.4, 1.0); wfl.position.set(2.8, 0.0, 2.5); wheelGroup.add(wfl)
  const wfr = makeWheel(1.4, 1.0); wfr.position.set(2.8, 0.0, -2.5); wheelGroup.add(wfr)
  const wrl1 = makeWheel(1.6, 1.0); wrl1.position.set(-2.4, 0.0, 2.5); wheelGroup.add(wrl1)
  const wrl2 = makeWheel(1.6, 1.0); wrl2.position.set(-2.4, 0.0, 3.4); wheelGroup.add(wrl2)
  const wrr1 = makeWheel(1.6, 1.0); wrr1.position.set(-2.4, 0.0, -2.5); wheelGroup.add(wrr1)
  const wrr2 = makeWheel(1.6, 1.0); wrr2.position.set(-2.4, 0.0, -3.4); wheelGroup.add(wrr2)

  wheelGroup.position.y = 1.4
  truckGroup.add(wheelGroup)

  scene.add(truckGroup)

  _parts = {
    truckGroup,
    bodyGroup,
    chassis,
    cab,
    engineHood,
    dumpBed,
    bedGroup,
    lidarDome,
    wheels: { fl: wfl, fr: wfr, rl: wrl1, rr: wrr1 },
    wheelRadius: 1.4,
    wheelSpinAxis: 'y',
    allMaterials,
  }
  return _parts
}
