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

// ── Module state ──────────────────────────────────────────────────────────────
let _parts = null
export function getTruckParts() { return _parts }

function makeMesh(geometry, material) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = false
  return mesh
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function buildTruck(scene) {
  try {
    return await buildFromGLTF(scene)
  } catch (err) {
    console.warn('[vehicle] GLTF load failed, using procedural truck:', err?.message || err)
    return buildProceduralTruck(scene)
  }
}

// ── GLTF ingestion pipeline ───────────────────────────────────────────────────
//
// Two-stage pipeline that mirrors how a production perception/CAD pipeline
// ingests vehicle geometry:
//
//   STAGE 1 — STRUCTURED PATH
//     Walk the glTF scene graph looking for named nodes (Bed, Cab, Wheel_FL…).
//     This is how OEM exports arrive — Komatsu / Caterpillar CAD toolchains
//     emit structured glTFs with named sub-parts. O(1), deterministic.
//
//   STAGE 2 — FEATURE-BASED FALLBACK
//     When the input is a merged mesh (common for free dev-time models),
//     derive sub-parts from geometric features. All thresholds are bbox-
//     relative, so the same pipeline works across trucks of different sizes
//     and proportions. No hardcoded world coordinates below this point.
//
// Assumptions (for Stage 2):
//   · Truck's longest axis is X (length). Shortest is Y (height).
//   · Bed is the tallest feature in one half of X. We detect which half and
//     rotate so it ends up at +X canonically.
//   · Wheels are roughly at the truck's four corners in XZ, at low Y.

async function buildFromGLTF(scene) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const loader = new GLTFLoader()
  const gltf = await new Promise((resolve, reject) => {
    loader.load('./models/truck.glb', resolve, undefined, reject)
  })

  // Stage 1 ────────────────────────────────────────────────────────────────
  const structured = extractStructuredParts(gltf.scene)
  if (structured) {
    console.log('[vehicle] GLTF has structured scene graph — using named nodes')
    return assembleFromStructured(scene, structured)
  }

  // Stage 2 ────────────────────────────────────────────────────────────────
  console.log('[vehicle] GLTF is a merged mesh — using feature-based segmentation')
  const geom = extractMergedGeometry(gltf.scene)
  normalizeToCanonical(geom, { targetLen: 10 })
  return assembleFromFeatures(scene, geom)
}

// ── Stage 1: structured extraction ────────────────────────────────────────────
// Looks for named nodes matching common OEM conventions. Returns null if the
// scene graph doesn't expose sub-parts (triggers the feature-based fallback).
function extractStructuredParts(gltfScene) {
  const namePatterns = {
    bed:      [/bed/i, /dumpbox/i, /hopper/i, /tray/i],
    cab:      [/cab/i, /cabin/i],
    wheel_fl: [/wheel.*fl$/i, /wheel.*front.?left/i, /fl.*wheel/i],
    wheel_fr: [/wheel.*fr$/i, /wheel.*front.?right/i, /fr.*wheel/i],
    wheel_rl: [/wheel.*rl$/i, /wheel.*rear.?left/i, /rl.*wheel/i],
    wheel_rr: [/wheel.*rr$/i, /wheel.*rear.?right/i, /rr.*wheel/i],
  }
  const found = {}
  gltfScene.traverse(node => {
    if (!node.isMesh) return
    for (const [key, patterns] of Object.entries(namePatterns)) {
      if (!found[key] && patterns.some(p => p.test(node.name))) found[key] = node
    }
  })
  const wheelCount = ['wheel_fl','wheel_fr','wheel_rl','wheel_rr']
    .filter(k => found[k]).length
  return (found.bed && wheelCount >= 2) ? found : null
}

function assembleFromStructured(/* scene, parts */) {
  // Extension point for OEM structured glTFs. Our dev model is merged, so
  // this path isn't reachable today. When integrating a structured export,
  // implement here: clone node geometries, apply holographic material,
  // hinge the bed at its rear-bottom edge, populate _parts.wheels, etc.
  throw new Error('structured-path assembly not yet implemented — using feature fallback')
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function extractMergedGeometry(gltfScene) {
  let sourceMesh = null
  gltfScene.traverse(c => { if (c.isMesh && !sourceMesh) sourceMesh = c })
  if (!sourceMesh) throw new Error('No mesh found in GLTF')
  sourceMesh.updateMatrixWorld(true)
  const geom = sourceMesh.geometry.clone()
  geom.applyMatrix4(sourceMesh.matrixWorld)
  return geom
}

// Normalize the geometry into a canonical frame:
//   1. Scale so the longest axis is `targetLen`
//   2. Center on X/Z, sit on y=0
//   3. Detect orientation (which X-half the bed is in) and rotate 180° if
//      needed so the bed ends up at +X by convention
function normalizeToCanonical(geom, { targetLen }) {
  geom.computeBoundingBox()
  const size = new THREE.Vector3()
  geom.boundingBox.getSize(size)
  const scale = targetLen / Math.max(size.x, size.y, size.z)
  geom.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale))

  centerGeometryOnXZGround(geom)
  alignLengthToX(geom)
  alignBedToPositiveX(geom)
}

function centerGeometryOnXZGround(geom) {
  geom.computeBoundingBox()
  const bb = geom.boundingBox
  geom.translate(
    -(bb.min.x + bb.max.x) / 2,
    -bb.min.y,
    -(bb.min.z + bb.max.z) / 2
  )
  geom.computeBoundingBox()
}

// Ensure the truck's longest horizontal axis is X (our length convention).
// If Z > X, rotate 90° around Y so length maps to X and width maps to Z.
function alignLengthToX(geom) {
  geom.computeBoundingBox()
  const size = new THREE.Vector3()
  geom.boundingBox.getSize(size)
  if (size.z > size.x) {
    geom.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2))
    centerGeometryOnXZGround(geom)
  }
}

// Count upper-half triangle centroids on each side of X=0. The side with more
// upper triangles is where the tall bed walls live; rotate so it lands at +X.
function alignBedToPositiveX(geom) {
  const bb = geom.boundingBox
  const yMid = bb.min.y + (bb.max.y - bb.min.y) * 0.5

  const pos = geom.getAttribute('position')
  const index = geom.index
  const triCount = index ? index.count / 3 : pos.count / 3
  let negXUpper = 0, posXUpper = 0
  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2
    if (index) {
      i0 = index.getX(t * 3); i1 = index.getX(t * 3 + 1); i2 = index.getX(t * 3 + 2)
    } else {
      i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2
    }
    const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3
    if (cy < yMid) continue
    const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3
    if (cx < 0) negXUpper++
    else        posXUpper++
  }

  if (negXUpper > posXUpper) {
    geom.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI))
    centerGeometryOnXZGround(geom)
  }
}

// ── Stage 2: feature detectors ────────────────────────────────────────────────

// Split body and bed by triangle-centroid position. The bed is the
// upper-rear rectangular volume of the normalized bbox; "upper" and "rear"
// are bbox-relative fractions so the detector scales with truck size.
function detectBedRegion(geom) {
  geom.computeBoundingBox()
  const bb = geom.boundingBox
  const xT = bb.min.x + (bb.max.x - bb.min.x) * 0.30
  const yT = bb.min.y + (bb.max.y - bb.min.y) * 0.40
  const { aGeo, bGeo } = splitGeometryByCentroid(geom, (cx, cy) => cx > xT && cy > yT)
  return { bedGeo: aGeo, bodyGeo: bGeo }
}

// Detect wheel positions by clustering low-Y, outer-Z triangle centroids.
// Rationale: a wheel arch is GEOMETRICALLY defined as low (bottom ~30% of
// the truck) and lateral (outer ~20%+ of the Z span). Triangles meeting
// both predicates are grouped into the four XZ-quadrants; each quadrant's
// centroid is the wheel center. Returns { fl, fr, rl, rr } of {x, z}.
//
// Assumes normalized geometry: +X = rear, -X = front, ±Z = sides.
function detectWheelPositions(geom) {
  geom.computeBoundingBox()
  const bb = geom.boundingBox
  const height = bb.max.y - bb.min.y
  const depth  = bb.max.z - bb.min.z
  const yMax     = bb.min.y + height * 0.30
  const zMagMin  = depth * 0.20
  const minPts   = 6   // a real arch should have at least this many triangles

  const pos = geom.getAttribute('position')
  const index = geom.index
  const triCount = index ? index.count / 3 : pos.count / 3

  const buckets = { fl: [], fr: [], rl: [], rr: [] }
  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2
    if (index) {
      i0 = index.getX(t * 3); i1 = index.getX(t * 3 + 1); i2 = index.getX(t * 3 + 2)
    } else {
      i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2
    }
    const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3
    if (cy > yMax) continue
    const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3
    const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3
    if (Math.abs(cz) < zMagMin) continue
    const xSide = cx < 0 ? 'f' : 'r'   // -X = front
    const zSide = cz > 0 ? 'l' : 'r'   // +Z = left (arbitrary but consistent)
    buckets[xSide + zSide].push([cx, cz])
  }

  console.log(`[vehicle] Wheel detection — bbox: x[${bb.min.x.toFixed(1)},${bb.max.x.toFixed(1)}] y[${bb.min.y.toFixed(1)},${bb.max.y.toFixed(1)}] z[${bb.min.z.toFixed(1)},${bb.max.z.toFixed(1)}]`)
  console.log(`[vehicle] Wheel detection — yMax=${yMax.toFixed(2)}, zMagMin=${zMagMin.toFixed(2)}, triCount=${triCount}`)
  console.log(`[vehicle] Wheel detection — buckets: fl=${buckets.fl.length} fr=${buckets.fr.length} rl=${buckets.rl.length} rr=${buckets.rr.length}`)

  const out = {}
  for (const [key, pts] of Object.entries(buckets)) {
    if (pts.length < minPts) continue
    const avgX = pts.reduce((s, p) => s + p[0], 0) / pts.length
    const avgZ = pts.reduce((s, p) => s + p[1], 0) / pts.length
    out[key] = { x: avgX, z: avgZ }
  }
  console.log(`[vehicle] Wheel detection — detected ${Object.keys(out).length} wheels:`, out)
  return out
}

// Generic triangle splitter: each triangle goes to aGeo if predicate(cx,cy,cz)
// is true, otherwise to bGeo. Normals are recomputed on both outputs.
function splitGeometryByCentroid(geom, predicate) {
  const src = geom.index ? geom.toNonIndexed() : geom
  const pos = src.getAttribute('position')
  const triCount = pos.count / 3
  const aVerts = []
  const bVerts = []
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3
    const x0 = pos.getX(i0),     y0 = pos.getY(i0),     z0 = pos.getZ(i0)
    const x1 = pos.getX(i0 + 1), y1 = pos.getY(i0 + 1), z1 = pos.getZ(i0 + 1)
    const x2 = pos.getX(i0 + 2), y2 = pos.getY(i0 + 2), z2 = pos.getZ(i0 + 2)
    const cx = (x0 + x1 + x2) / 3
    const cy = (y0 + y1 + y2) / 3
    const cz = (z0 + z1 + z2) / 3
    const target = predicate(cx, cy, cz) ? aVerts : bVerts
    target.push(x0, y0, z0, x1, y1, z1, x2, y2, z2)
  }
  const toGeom = verts => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    g.computeVertexNormals()
    return g
  }
  return { aGeo: toGeom(aVerts), bGeo: toGeom(bVerts) }
}

// ── Assembly ──────────────────────────────────────────────────────────────────

function assembleFromFeatures(scene, geom) {
  const bb = geom.boundingBox
  const truckHeight = bb.max.y - bb.min.y
  const truckDepth  = bb.max.z - bb.min.z

  const { bodyGeo, bedGeo } = detectBedRegion(geom)
  const wheelPositions = detectWheelPositions(geom)

  const allMaterials = []

  // Body mesh
  const bodyMat = createHolographicMaterial(0x00ffff)
  allMaterials.push(bodyMat)
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)

  // Bed mesh — hinge at the REAR-bottom edge (tailgate end, far from cab).
  // Like a real Cat 797: hydraulics push the cab-side of the bed UP, the
  // rear stays at the hinge. Material slides from high front to low rear.
  const bedMat = createHolographicMaterial(0x00bbdd)
  allMaterials.push(bedMat)
  bedGeo.computeBoundingBox()
  const bedBB  = bedGeo.boundingBox
  const hingeX = bedBB.max.x   // rear/tailgate edge (far from cab, +X)
  const hingeY = bedBB.min.y   // bottom of bed
  bedGeo.translate(-hingeX, -hingeY, 0)
  const bedMesh = new THREE.Mesh(bedGeo, bedMat)
  bedMesh.position.set(hingeX, hingeY, 0)
  console.log(`[vehicle] Bed: hinge at rear x=${hingeX.toFixed(1)}, front at x=${bedBB.min.x.toFixed(1)}, rotation.z will be NEGATIVE to lift front`)

  // Wheels — procedural cylinders at detected arch positions. Size is
  // bbox-derived so a bigger truck gets bigger wheels.
  const wheels = buildDetectedWheels(wheelPositions, truckHeight, truckDepth, allMaterials)

  // LIDAR dome — sits above the body's own max Y (cab/hood top), biased
  // toward the cab side (-X). Position is entirely bbox-derived.
  bodyGeo.computeBoundingBox()
  const bodyBB = bodyGeo.boundingBox
  const domeRadius = Math.max(truckHeight * 0.06, 0.2)
  const lidarDome = new THREE.Mesh(
    new THREE.SphereGeometry(domeRadius, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.25,
    })
  )
  lidarDome.position.set(
    bodyBB.min.x + (bodyBB.max.x - bodyBB.min.x) * 0.35,
    bodyBB.max.y + domeRadius * 0.2,
    0
  )

  const truckGroup = new THREE.Group()
  truckGroup.add(bodyMesh, bedMesh, lidarDome)
  Object.values(wheels).forEach(w => { if (w) truckGroup.add(w) })
  scene.add(truckGroup)

  console.log(
    `[vehicle] Feature-based segmentation: ` +
    `body=${bodyGeo.attributes.position.count / 3} tris, ` +
    `bed=${bedGeo.attributes.position.count / 3} tris, ` +
    `wheels=${Object.values(wheels).filter(Boolean).length}/4`
  )

  _parts = {
    truckGroup,
    bodyGroup:  bodyMesh,
    chassis:    bodyMesh,
    cab:        bodyMesh,
    engineHood: bodyMesh,
    dumpBed:    bedMesh,
    bedGroup:   bedMesh,
    bedRotationSign: -1,   // hinge at rear → negative rotation.z lifts front (Cat 797 style)
    lidarDome,
    wheels,
    wheelRadius: truckHeight * 0.28,
    allMaterials,
  }
  return _parts
}

function buildDetectedWheels(positions, truckHeight, truckDepth, allMaterials) {
  const wheels = { fl: null, fr: null, rl: null, rr: null }
  const radius = truckHeight * 0.28
  const width  = truckDepth  * 0.14
  for (const [key, { x, z }] of Object.entries(positions)) {
    const mat = createHolographicMaterial(0x007799)
    allMaterials.push(mat)
    const group = new THREE.Group()
    group.position.set(x, radius, z)
    group.rotation.x = Math.PI / 2

    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, width, 24),
      mat
    )
    group.add(rim)

    addWheelRim(group, radius, width, allMaterials)

    wheels[key] = group
  }
  return wheels
}

function addWheelRim(wheelGroup, radius, width, allMaterials) {
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  allMaterials.push(rimMat)

  const barThick = radius * 0.08
  const barLen   = radius * 1.7
  const zOff     = width * 0.3

  const bar1 = new THREE.Mesh(
    new THREE.BoxGeometry(barLen, barThick, barThick),
    rimMat
  )
  bar1.position.z = zOff
  wheelGroup.add(bar1)

  const bar2 = new THREE.Mesh(
    new THREE.BoxGeometry(barThick, barLen, barThick),
    rimMat
  )
  bar2.position.z = zOff
  wheelGroup.add(bar2)

  const hubGeo = new THREE.CylinderGeometry(radius * 0.15, radius * 0.15, barThick * 1.5, 12)
  const hub = new THREE.Mesh(hubGeo, rimMat)
  hub.position.z = zOff
  hub.rotation.x = Math.PI / 2
  wheelGroup.add(hub)

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.92, barThick * 0.5, 8, 32),
    rimMat
  )
  outerRing.position.z = zOff
  wheelGroup.add(outerRing)
}

// ── Procedural fallback ───────────────────────────────────────────────────────
// Used only when the GLTF fails to load. Builds a recognisable Caterpillar
// 797-style haul truck from primitives. Front faces +X.
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

  // ── Dump bed ────────────────────────────────────────────────────────────────
  // bedGroup pivot at chassis rear — bed extends into +X so rotation.z raises
  // the far end (front, toward cab) like a real haul-truck dump.
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

  // ── Lidar dome ──────────────────────────────────────────────────────────────
  const lidarDome = makeMesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.25,
    })
  )
  lidarDome.position.set(-1.0, 3.6, 0)
  truckGroup.add(lidarDome)

  // ── Wheels ──────────────────────────────────────────────────────────────────
  const wheelGroup = new THREE.Group()
  function makeWheel(radiusY, width, color = 0x004455) {
    const mat = createHolographicMaterial(color)
    allMaterials.push(mat)
    const wheel = makeMesh(new THREE.CylinderGeometry(radiusY, radiusY, width, 20), mat)
    wheel.rotation.x = Math.PI / 2   // axle along Z (truck width)
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
    allMaterials,
  }
  return _parts
}
