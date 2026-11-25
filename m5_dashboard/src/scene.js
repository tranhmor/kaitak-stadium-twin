// Renderer, venue model (M1 venue_lite.glb + seats.bin), lighting, cutaway and post-processing.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing'
import { N8AOPostPass } from 'n8ao'

const HORIZON = 0x0b1422
const SEAT_COLOURS = ['#3d485c', '#7a3b2e', '#b0602b', '#8d887b', '#4d1d24']

// category -> material settings. The .blend materials are procedural and do not export, so the
// dashboard assigns its own night-time operations palette.
const LOOK = {
  ctx_ground: { color: '#080b11', roughness: 1 },
  ctx_green: { color: '#0b1a16', roughness: 1 },
  ctx_roads: { color: '#161d29', roughness: 0.9 },
  ctx_paths: { color: '#232e40', roughness: 0.9 },
  ctx_plazas: { color: '#1c2636', roughness: 0.85 },
  ctx_buildings: { color: '#141b28', roughness: 0.8 },
  ctx_windows: { color: '#1a2233', emissive: '#ffc680', emissiveIntensity: 0.22, roughness: 0.4 },
  ctx_landmarks: { color: '#1a2333', roughness: 0.7 },
  ctx_trees: { color: '#0e211a', roughness: 1 },
  stadium_shell: { color: '#aebfd6', roughness: 0.32, metalness: 0.75, cut: 'full', side: THREE.DoubleSide },
  stadium_glass: { color: '#3a5f80', roughness: 0.15, metalness: 0.6, emissive: '#2b6f99', emissiveIntensity: 0.35, cut: 'full', side: THREE.DoubleSide },
  stadium_roof: { color: '#8e9db3', roughness: 0.45, metalness: 0.6, cut: 'full', side: THREE.DoubleSide },
  stadium_bowl: { color: '#39445a', roughness: 0.85, cut: 'upper', side: THREE.DoubleSide },
  stadium_floor: { color: '#11161f', roughness: 0.9 },
  stage: { color: '#1b212e', roughness: 0.6, metalness: 0.3 },
  stage_screens: { color: '#05070b', emissive: '#6a5cff', emissiveIntensity: 2.4 },
}

export function createScene(canvas, manifest) {
  const [CX, CY] = manifest.frame.bowl_centre
  const L2 = manifest.levels.L2.z
  // local metres (x east, y north, z up) -> scene (x east, y up, z south), origin at the bowl centre
  const toScene = (x, y, z, out = new THREE.Vector3()) => out.set(x - CX, z, -(y - CY))

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.localClippingEnabled = true

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(HORIZON, 0.00115)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.32
  pmrem.dispose()

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { horizon: { value: new THREE.Color(HORIZON) }, zenith: { value: new THREE.Color(0x020409) }, glow: { value: new THREE.Color(0x1d3558) } },
      vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 p; uniform vec3 horizon, zenith, glow;
        void main(){ float h = clamp(p.y, 0.0, 1.0); vec3 c = mix(horizon, zenith, pow(h, 0.45));
          c += glow * pow(1.0 - h, 10.0) * 0.55; gl_FragColor = vec4(c, 1.0); }`,
    }))
  scene.add(sky)

  scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0a0d14, 0.75))
  const key = new THREE.DirectionalLight(0xdfeaff, 2.3)
  key.position.set(-260, 340, 210)
  key.castShadow = true
  key.shadow.mapSize.set(4096, 4096)
  Object.assign(key.shadow.camera, { left: -230, right: 230, top: 230, bottom: -230, near: 50, far: 900 })
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.6
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x4f8dff, 0.7)
  rim.position.set(300, 160, -260)
  scene.add(rim)
  const pitch = new THREE.PointLight(0x9fd0ff, 3.0, 420, 0.9)   // spill from the stage and floodlights
  pitch.position.set(0, 46, 20)
  scene.add(pitch)

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 2, 5200)
  camera.position.set(-640, 430, 520)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI * 0.49
  controls.minDistance = 25
  controls.maxDistance = 1300
  controls.target.set(-40, 6, 0)

  // ---- cutaway: the west half above the main concourse is removed so the monitored area is visible
  const west = new THREE.Plane(new THREE.Vector3(1, 0, 0), -5)              // negative side: x < 5
  const cutUpper = [new THREE.Plane(new THREE.Vector3(0, -1, 0), L2 + 0.3), west]
  const cutFull = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.4), west]
  const cutMaterials = []
  const clip = (material, kind) => {
    material.clippingPlanes = kind === 'full' ? cutFull : cutUpper
    material.clipIntersection = true
    material.clipShadows = true
    cutMaterials.push([material, material.clippingPlanes])
    return material
  }
  const setCutaway = (on) => {
    for (const [m, planes] of cutMaterials) {
      m.clippingPlanes = on ? planes : null
      m.needsUpdate = true
    }
  }

  const venue = new THREE.Group()
  venue.position.set(-CX, 0, CY)                                             // glTF axes: x = x, y = z, z = -y
  scene.add(venue)

  async function loadVenue(url) {
    const draco = new DRACOLoader().setDecoderPath('/draco/')
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url)
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return
      const look = LOOK[o.name] ?? LOOK[o.parent?.name] ?? { color: '#202838' }
      const { cut, ...params } = look
      o.material = new THREE.MeshStandardMaterial(params)
      if (cut) clip(o.material, cut)
      const ctx = o.name.startsWith('ctx_')
      o.castShadow = !ctx || o.name === 'ctx_buildings' || o.name === 'ctx_landmarks'
      o.receiveShadow = o.name !== 'ctx_windows' && o.name !== 'stage_screens'
      o.geometry.computeVertexNormals()
    })
    venue.add(gltf.scene)
    draco.dispose()
  }

  async function loadSeats(url) {
    const data = new Float32Array(await (await fetch(url)).arrayBuffer())
    const n = data.length / 5
    const seat = new THREE.BoxGeometry(0.46, 0.5, 0.46).translate(0, 0.25, 0)
    const mesh = new THREE.InstancedMesh(seat, clip(new THREE.MeshStandardMaterial({ roughness: 0.75 }), 'upper'), n)
    const palette = SEAT_COLOURS.map((c) => new THREE.Color(c).multiplyScalar(0.8))
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < n; i++) {
      toScene(data[i * 5], data[i * 5 + 1], data[i * 5 + 2], p)
      m.compose(p, q.setFromAxisAngle(up, data[i * 5 + 3]), s)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, palette[data[i * 5 + 4] | 0])
    }
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    scene.add(mesh)
    return n
  }

  // ---- post-processing: ambient occlusion, bloom on HDR emitters only, vignette, ACES, SMAA
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
  composer.addPass(new RenderPass(scene, camera))
  const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight)
  Object.assign(ao.configuration, { aoRadius: 7, distanceFalloff: 1, intensity: 2.6, halfRes: true, depthAwareUpsampling: true, gammaCorrection: false })
  ao.configuration.color = new THREE.Color(0x02040a)
  ao.setQualityMode('Medium')
  composer.addPass(ao)
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.85, radius: 0.72 })
  composer.addPass(new EffectPass(camera, bloom, new VignetteEffect({ offset: 0.28, darkness: 0.62 }),
    new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new SMAAEffect({ preset: SMAAPreset.HIGH })))
  let fx = true
  const setFx = (on) => {
    fx = on
    renderer.toneMapping = on ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
  }

  // ---- camera moves
  let move = null
  const flyTo = (position, target, seconds = 1.8) => {
    move = { p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...position), t1: new THREE.Vector3(...target), t: 0, seconds }
  }
  controls.addEventListener('start', () => { move = null })

  const updaters = []
  const timer = new THREE.Timer()
  timer.connect(document)
  renderer.setAnimationLoop((now) => {
    timer.update(now)
    const dt = Math.min(timer.getDelta(), 0.1)
    if (move) {
      move.t = Math.min(1, move.t + dt / move.seconds)
      const k = move.t < 0.5 ? 4 * move.t ** 3 : 1 - (-2 * move.t + 2) ** 3 / 2
      camera.position.lerpVectors(move.p0, move.p1, k)
      controls.target.lerpVectors(move.t0, move.t1, k)
      if (move.t >= 1) move = null
    }
    controls.update()
    for (const u of updaters) u(dt, timer.getElapsed())
    if (fx) composer.render(dt)
    else renderer.render(scene, camera)
  })

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    composer.setSize(window.innerWidth, window.innerHeight)
  })

  return { THREE, renderer, scene, camera, controls, toScene, loadVenue, loadSeats, setCutaway, setFx, flyTo, onFrame: (f) => updaters.push(f) }
}
