import * as THREE from 'three'

// ── Holographic ShaderMaterial ────────────────────────────────────────────────
// Custom shader: Fresnel edge glow + world-space horizontal scanlines +
// additive blending.  uAlertBlend (0→1) lerps the color toward red for alerts.
// AdditiveBlending + depthWrite:false is the correct combo for holographic
// translucent meshes — overlapping geometry brightens rather than obscures.

export function createHolographicMaterial(color = 0x00ffff) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor:       { value: new THREE.Color(color) },
      uTime:        { value: 0 },
      uOpacity:     { value: 0.55 },
      uFresnelPow:  { value: 4.5 },
      uScanSpeed:   { value: 0.35 },
      uScanDensity: { value: 70.0 },
      uEmissive:    { value: 0.28 },
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
        // Fresnel — bright at silhouette edges, dim in face centre
        float NdotV   = clamp(dot(vNormal, vViewDir), 0.0, 1.0);
        float fresnel = pow(1.0 - NdotV, uFresnelPow);

        // World-space horizontal scanlines
        float scan     = sin(vWorldPos.y * uScanDensity - uTime * uScanSpeed * 10.0);
        float scanline = smoothstep(0.0, 0.4, scan) * 0.18 + 0.82;

        // Blend between normal holo colour and alert red
        vec3 baseColor = mix(uColor, uAlertColor, uAlertBlend);

        // Final colour: emissive base + fresnel edge boost, modulated by scanlines
        vec3 color = baseColor * (uEmissive + fresnel * 0.9) * scanline;

        // Alpha: higher at edges, lower at face centre
        float alpha = uOpacity * (0.25 + fresnel * 0.75) * scanline;
        alpha = clamp(alpha, 0.0, 1.0);

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side:        THREE.DoubleSide,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,   // must be false for additive transparent objects
  })
}

// ── Procedural truck builder ─────────────────────────────────────────────────
// Builds a recognisable Caterpillar 797-style haul truck from primitives.
// Front faces +Z.  All units are approximate metres at ~1:20 scale.
//
// Group hierarchy:
//   truckGroup
//     bodyGroup       chassis, cab, engineHood, bumper, exhausts
//     bedGroup        dumpBed + walls — pivot at rear edge of chassis
//     wheelGroup      4× front(×1) + rear(×2 per side) wheels
//     lidarDome       sits atop cab

let _parts = null   // cached after first build

export function getTruckParts() {
  return _parts
}

function makeMesh(geometry, material) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = false
  return mesh
}

export async function buildTruck(scene) {
  // Attempt GLTF load first; fall through to procedural on any error
  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const loader = new GLTFLoader()
    const gltf = await new Promise((resolve, reject) => {
      loader.load('./models/truck.glb', resolve, undefined, reject)
    })
    // Apply holographic material to every mesh in the loaded model
    const allMaterials = []
    gltf.scene.traverse(child => {
      if (child.isMesh) {
        const mat = createHolographicMaterial()
        child.material = mat
        allMaterials.push(mat)
      }
    })
    scene.add(gltf.scene)
    // Build a minimal parts registry from the GLTF scene graph
    _parts = {
      truckGroup: gltf.scene,
      bedGroup: gltf.scene.getObjectByName('bedGroup') || gltf.scene,
      lidarDome: gltf.scene.getObjectByName('lidarDome') || null,
      wheels: { fl: null, fr: null, rl: null, rr: null },
      allMaterials,
    }
    return _parts
  } catch {
    // No .glb found — build procedurally
    return buildProceduralTruck(scene)
  }
}

function buildProceduralTruck(scene) {
  const allMaterials = []

  function holo(color = 0x00ffff) {
    const mat = createHolographicMaterial(color)
    allMaterials.push(mat)
    return mat
  }

  const truckGroup = new THREE.Group()

  // ── Body ────────────────────────────────────────────────────────────────────
  const bodyGroup = new THREE.Group()

  // Main chassis frame
  const chassis = makeMesh(new THREE.BoxGeometry(8, 1.2, 4), holo())
  chassis.position.set(0, 0, 0)
  bodyGroup.add(chassis)

  // Engine hood (long boxy front — haul trucks have enormous engines)
  const engineHood = makeMesh(new THREE.BoxGeometry(3.2, 1.2, 3.0), holo())
  engineHood.position.set(1.8, 0.8, 0)
  bodyGroup.add(engineHood)

  // Cab — offset LEFT and sits on top of the engine hood (haul truck layout)
  const cab = makeMesh(new THREE.BoxGeometry(2.4, 1.8, 3.2), holo())
  cab.position.set(-1.0, 1.5, 0)
  bodyGroup.add(cab)

  // Front bumper / push plate
  const frontBumper = makeMesh(new THREE.BoxGeometry(0.3, 0.8, 3.4), holo())
  frontBumper.position.set(3.3, 0.2, 0)
  bodyGroup.add(frontBumper)

  // Exhaust stacks — two vertical cylinders behind cab
  const exhaustGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.5, 8)
  const exhaust1 = makeMesh(exhaustGeo, holo(0x00cccc))
  exhaust1.position.set(1.2, 1.65, 1.0)
  bodyGroup.add(exhaust1)

  const exhaust2 = makeMesh(exhaustGeo, holo(0x00cccc))
  exhaust2.position.set(1.2, 1.65, -1.0)
  bodyGroup.add(exhaust2)

  bodyGroup.position.set(0, 1.8, 0)   // lift body above ground
  truckGroup.add(bodyGroup)

  // ── Dump bed ────────────────────────────────────────────────────────────────
  // bedGroup pivot is at the REAR edge of the chassis so rotation.x = hinge dump
  // Signature Cat 797 shape: tall walls overhanging the chassis, a raised front
  // canopy that extends FORWARD over the cab, and a wider stance than the frame.
  const bedGroup = new THREE.Group()

  const BED_LEN   = 7.0   // length along X (longer than chassis)
  const BED_WIDTH = 4.6   // wider than the 4-unit chassis so it overhangs
  const WALL_H    = 2.2   // tall walls — bed dominates the silhouette
  const FLOOR_Y   = 0.0

  // Bed floor
  const dumpBed = makeMesh(new THREE.BoxGeometry(BED_LEN, 0.35, BED_WIDTH), holo(0x008899))
  dumpBed.position.set(BED_LEN / 2, FLOOR_Y, 0)
  bedGroup.add(dumpBed)

  // Side walls — flare slightly outward at the top (rotated around X for flare)
  const bedWallMat = holo(0x006677)
  const bedWallL = makeMesh(new THREE.BoxGeometry(BED_LEN, WALL_H, 0.18), bedWallMat)
  bedWallL.position.set(BED_LEN / 2, WALL_H / 2 + 0.1, BED_WIDTH / 2 - 0.09)
  bedWallL.rotation.x = -0.08   // slight outward flare
  bedGroup.add(bedWallL)

  const bedWallR = makeMesh(new THREE.BoxGeometry(BED_LEN, WALL_H, 0.18), bedWallMat)
  bedWallR.position.set(BED_LEN / 2, WALL_H / 2 + 0.1, -(BED_WIDTH / 2 - 0.09))
  bedWallR.rotation.x = 0.08
  bedGroup.add(bedWallR)

  // Rear tailgate wall (short)
  const bedRear = makeMesh(new THREE.BoxGeometry(0.2, 1.1, BED_WIDTH), bedWallMat)
  bedRear.position.set(0.1, 0.65, 0)
  bedGroup.add(bedRear)

  // Front wall — tall vertical section where the canopy attaches
  const bedFrontWall = makeMesh(new THREE.BoxGeometry(0.2, WALL_H + 0.3, BED_WIDTH), bedWallMat)
  bedFrontWall.position.set(BED_LEN - 0.1, (WALL_H + 0.3) / 2 + 0.1, 0)
  bedGroup.add(bedFrontWall)

  // Signature Cat 797 overhang canopy — extends FORWARD over the cab
  const canopyMat = holo(0x007788)
  const canopy = makeMesh(new THREE.BoxGeometry(3.2, 0.3, BED_WIDTH), canopyMat)
  canopy.position.set(BED_LEN + 1.0, WALL_H + 0.4, 0)
  bedGroup.add(canopy)

  // Canopy support strut angling down from canopy front to cab roof area
  const strut = makeMesh(new THREE.BoxGeometry(0.25, 1.6, 0.25), canopyMat)
  strut.position.set(BED_LEN + 2.4, WALL_H - 0.4, BED_WIDTH / 2 - 0.3)
  strut.rotation.z = 0.3
  bedGroup.add(strut)

  const strut2 = makeMesh(new THREE.BoxGeometry(0.25, 1.6, 0.25), canopyMat)
  strut2.position.set(BED_LEN + 2.4, WALL_H - 0.4, -(BED_WIDTH / 2 - 0.3))
  strut2.rotation.z = 0.3
  bedGroup.add(strut2)

  // Attach bedGroup at the rear of the chassis body — pivot at the hinge point
  bedGroup.position.set(-4.0, 2.6, 0)
  truckGroup.add(bedGroup)

  // ── Lidar dome ──────────────────────────────────────────────────────────────
  // Sits on top of the cab — starts as dim wireframe, glows when active
  const lidarDome = makeMesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    })
  )
  lidarDome.position.set(-1.0, 3.6, 0)   // matches cab position + height
  truckGroup.add(lidarDome)

  // ── Wheels ──────────────────────────────────────────────────────────────────
  const wheelGroup = new THREE.Group()

  // Haul trucks: smaller front wheels (steering), larger dual rear (load bearing)
  // Cylinders rotated 90° on Z to face outward (axle orientation)
  function makeWheel(radiusY, width, color = 0x004455) {
    const mat = createHolographicMaterial(color)
    allMaterials.push(mat)
    const wheel = makeMesh(new THREE.CylinderGeometry(radiusY, radiusY, width, 20), mat)
    wheel.rotation.z = Math.PI / 2
    return wheel
  }

  // Front wheels (single per side) — bigger radius for haul-truck scale
  const wfl = makeWheel(1.4, 1.0)
  wfl.position.set(2.8, 0.0, 2.5)
  wheelGroup.add(wfl)

  const wfr = makeWheel(1.4, 1.0)
  wfr.position.set(2.8, 0.0, -2.5)
  wheelGroup.add(wfr)

  // Rear wheels (DUAL per side — characteristic haul truck feature)
  const wrl1 = makeWheel(1.6, 1.0)
  wrl1.position.set(-2.4, 0.0, 2.5)
  wheelGroup.add(wrl1)

  const wrl2 = makeWheel(1.6, 1.0)
  wrl2.position.set(-2.4, 0.0, 3.4)    // outer rear-left
  wheelGroup.add(wrl2)

  const wrr1 = makeWheel(1.6, 1.0)
  wrr1.position.set(-2.4, 0.0, -2.5)
  wheelGroup.add(wrr1)

  const wrr2 = makeWheel(1.6, 1.0)
  wrr2.position.set(-2.4, 0.0, -3.4)   // outer rear-right
  wheelGroup.add(wrr2)

  wheelGroup.position.y = 1.4   // lift to ground contact — matches new wheel radius
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
    allMaterials,
  }

  return _parts
}
