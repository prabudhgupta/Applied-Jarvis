import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

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
  renderer.toneMappingExposure = 1.2
  // r152+ API — outputEncoding was removed
  renderer.outputColorSpace = THREE.SRGBColorSpace

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
  // Intentionally dim — the holographic material is self-illuminating
  const ambient = new THREE.AmbientLight(0x001a2e, 3)
  scene.add(ambient)

  const rimLight = new THREE.DirectionalLight(0x00ffff, 0.4)
  rimLight.position.set(-10, 15, -5)
  scene.add(rimLight)

  // ── Grid floor ─────────────────────────────────────────────────────────────
  const grid = new THREE.GridHelper(80, 40, 0x003344, 0x001a22)
  grid.position.y = -1.8
  scene.add(grid)

  // ── EffectComposer: RenderPass → UnrealBloomPass → OutputPass ──────────────
  // IMPORTANT: always call composer.render() in the loop, never renderer.render()
  // IMPORTANT: OutputPass must be last — handles tone mapping for final output
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.2,   // strength — overall glow intensity
    0.5,   // radius
    0.15   // threshold — low value means even moderately bright cyan glows
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
    controls.update()       // needed for damping
    onFrame(delta)
    composer.render()       // NOT renderer.render() — composer owns the output
  }

  tick()
}
