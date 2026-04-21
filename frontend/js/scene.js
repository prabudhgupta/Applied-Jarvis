import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// ── Particle state (module-level so startAnimationLoop can access it) ─────────
const PARTICLE_COUNT = 500
const PARTICLE_MAX_Y = 22
let _particlePositionAttr = null   // set in initScene, read in startAnimationLoop
let _grid = null                   // grid floor, scrolled by effects to simulate movement
let _roadGroup = null              // road markings, scrolled with grid

// ── Camera preset animation state ────────────────────────────────────────────
let _camera = null
let _controls = null
let _camAnimating = false
let _camAnimT = 0
const _camStartPos    = new THREE.Vector3()
const _camStartTarget = new THREE.Vector3()
const _camEndPos      = new THREE.Vector3()
const _camEndTarget   = new THREE.Vector3()
const CAM_ANIM_DURATION = 1.0

const CAMERA_PRESETS = {
  TOP:      { pos: [0, 35, 0.1],    target: [0, 0, 0] },
  SIDE:     { pos: [0, 4, 22],      target: [0, 2, 0] },
  OPERATOR: { pos: [-3, 5, 1.5],    target: [4, 2, 0] },
}

export function getGrid() { return _grid }
export function getRoadGroup() { return _roadGroup }

export function setCameraPreset(name) {
  const preset = CAMERA_PRESETS[name]
  if (!preset || !_camera || !_controls) return
  _camStartPos.copy(_camera.position)
  _camStartTarget.copy(_controls.target)
  _camEndPos.set(...preset.pos)
  _camEndTarget.set(...preset.target)
  _camAnimT = 0
  _camAnimating = true
}

/**
 * Initialise the Three.js scene, camera, renderer, OrbitControls, and the
 * EffectComposer bloom pipeline.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ scene, camera, renderer, composer, controls }}
 */
export function initScene(canvas) {
  // ── Scene ──────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000810)
  scene.fog = new THREE.FogExp2(0x000810, 0.018)

  // ── Camera ─────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  )
  camera.position.set(14, 9, 18)
  camera.lookAt(0, 2, 0)

  // ── Renderer ───────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  // r152+ API — outputEncoding was removed
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  // ── Orbit controls ─────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 2, 0)
  controls.minDistance = 5
  controls.maxDistance = 60
  controls.maxPolarAngle = Math.PI / 2   // don't let the camera go underground
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.update()

  // ── Lighting ───────────────────────────────────────────────────────────────
  // Balanced lighting for standard PBR materials + holographic fallback
  const ambient = new THREE.AmbientLight(0x404040, 0.8)
  scene.add(ambient)

  const hemiLight = new THREE.HemisphereLight(0xB1E1FF, 0xB97A20, 0.6)
  scene.add(hemiLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.8)
  dirLight.position.set(10, 20, 10)
  dirLight.castShadow = true
  dirLight.shadow.mapSize.width = 2048
  dirLight.shadow.mapSize.height = 2048
  dirLight.shadow.camera.near = 0.5
  dirLight.shadow.camera.far = 80
  dirLight.shadow.camera.left = -20
  dirLight.shadow.camera.right = 20
  dirLight.shadow.camera.top = 20
  dirLight.shadow.camera.bottom = -20
  scene.add(dirLight)

  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4)
  fillLight.position.set(-10, 10, -10)
  scene.add(fillLight)

  // ── Ground plane (receives shadows) ─────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.95, metalness: 0.0 })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.05
  ground.receiveShadow = true
  scene.add(ground)

  // ── Grid floor ─────────────────────────────────────────────────────────────
  const grid = new THREE.GridHelper(80, 40, 0x003344, 0x001a22)
  grid.position.y = -0.02
  scene.add(grid)
  _grid = grid

  // ── Haul road ──────────────────────────────────────────────────────────────
  const roadGroup = new THREE.Group()
  roadGroup.position.y = -0.01

  // Road surface — subtle dark plane under the truck
  const roadSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 8),
    new THREE.MeshBasicMaterial({
      color: 0x001a22,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    })
  )
  roadSurface.rotation.x = -Math.PI / 2
  roadGroup.add(roadSurface)

  // Road edge lines
  const edgeLineMat = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const edgeGeo = new THREE.PlaneGeometry(120, 0.08)
  const leftEdge = new THREE.Mesh(edgeGeo, edgeLineMat)
  leftEdge.rotation.x = -Math.PI / 2
  leftEdge.position.z = 4
  roadGroup.add(leftEdge)

  const rightEdge = new THREE.Mesh(edgeGeo.clone(), edgeLineMat)
  rightEdge.rotation.x = -Math.PI / 2
  rightEdge.position.z = -4
  roadGroup.add(rightEdge)

  // Center dashes
  const dashMat = new THREE.MeshBasicMaterial({
    color: 0x005566,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  for (let i = -30; i < 30; i++) {
    const dash = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.06),
      dashMat
    )
    dash.rotation.x = -Math.PI / 2
    dash.position.x = i * 2
    roadGroup.add(dash)
  }

  scene.add(roadGroup)
  _roadGroup = roadGroup

  // ── Particle atmosphere ────────────────────────────────────────────────────
  // 500 faint cyan dust motes drifting slowly upward — gives the holodeck feel
  // and makes the scene feel alive even before any buttons are pressed.
  const particlePositions = new Float32Array(PARTICLE_COUNT * 3)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particlePositions[i * 3]     = (Math.random() - 0.5) * 70
    particlePositions[i * 3 + 1] = Math.random() * PARTICLE_MAX_Y
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 70
  }
  const particleGeo = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(particlePositions, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)   // hint: positions change every frame
  particleGeo.setAttribute('position', posAttr)
  _particlePositionAttr = posAttr            // expose to startAnimationLoop

  const particleMat = new THREE.PointsMaterial({
    color: 0x00ffff,
    size: 0.07,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  scene.add(new THREE.Points(particleGeo, particleMat))

  // ── EffectComposer: RenderPass → UnrealBloomPass → OutputPass ──────────────
  // IMPORTANT: always call composer.render() in the loop, never renderer.render()
  // IMPORTANT: OutputPass must be last — handles tone mapping for final output
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2,   // strength — subtle glow for alerts/LIDAR, not overpowering
    0.4,   // radius
    0.85   // threshold — only very bright pixels bloom
  )
  composer.addPass(bloom)
  composer.addPass(new OutputPass())   // must be last

  // ── Resize handler ─────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const w = window.innerWidth
    const h = window.innerHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    composer.setSize(w, h)
    bloom.resolution.set(w, h)
  })

  _camera = camera
  _controls = controls

  return { scene, camera, renderer, composer, controls }
}

/**
 * Start the RAF animation loop.
 *
 * @param {EffectComposer} composer
 * @param {OrbitControls}  controls
 * @param {(delta: number) => void} onFrame — called each frame with delta seconds
 */
export function startAnimationLoop(composer, controls, onFrame) {
  const clock = new THREE.Clock()

  function tick() {
    requestAnimationFrame(tick)
    const delta = clock.getDelta()

    // Camera preset animation (smooth ease-in-out)
    if (_camAnimating) {
      _camAnimT += delta / CAM_ANIM_DURATION
      if (_camAnimT >= 1) { _camAnimT = 1; _camAnimating = false }
      const t = _camAnimT < 0.5
        ? 2 * _camAnimT * _camAnimT
        : 1 - Math.pow(-2 * _camAnimT + 2, 2) / 2
      _camera.position.lerpVectors(_camStartPos, _camEndPos, t)
      _controls.target.lerpVectors(_camStartTarget, _camEndTarget, t)
    }

    controls.update()       // needed for damping
    onFrame(delta)

    // Drift particles upward; wrap back to y=0 when they exceed the ceiling
    if (_particlePositionAttr) {
      const arr   = _particlePositionAttr.array
      const drift = delta * 0.3
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        arr[i * 3 + 1] += drift
        if (arr[i * 3 + 1] > PARTICLE_MAX_Y) arr[i * 3 + 1] = 0
      }
      _particlePositionAttr.needsUpdate = true
    }

    composer.render()       // NOT renderer.render() — composer owns the output
  }

  tick()
}
