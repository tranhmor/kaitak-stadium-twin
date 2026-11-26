// Renderer, venue model (M1 venue_lite.glb + seats.bin), lighting, cutaway and post-processing.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing'
import { N8AOPostPass } from 'n8ao'

const SEAT_COLOURS = ['#3d485c', '#7a3b2e', '#b0602b', '#8d887b', '#4d1d24']

// category -> material settings. The .blend materials are procedural and do not export, so the
// dashboard assigns its own dark (night operations) and light (daylight architectural) palettes.
const LOOK_THEMES = {
  dark: {
    ctx_ground: { color: '#080b11', roughness: 1 },
    ctx_green: { color: '#0b1a16', roughness: 1 },
    ctx_roads: { color: '#161d29', roughness: 0.9 },
    ctx_paths: { color: '#232e40', roughness: 0.9 },
    ctx_plazas: { color: '#1c2636', roughness: 0.85 },
    ctx_buildings: { color: '#141b28', roughness: 0.8 },
    ctx_windows: { color: '#1a2233', emissive: '#ffc680', emissiveIntensity: 0.22, roughness: 0.4, metalness: 0 },
    ctx_landmarks: { color: '#1a2333', roughness: 0.7 },
    ctx_trees: { color: '#0e211a', roughness: 1 },
    stadium_shell: { color: '#aebfd6', roughness: 0.32, metalness: 0.75, cut: 'full', side: THREE.DoubleSide },
    stadium_glass: { color: '#3a5f80', roughness: 0.15, metalness: 0.6, emissive: '#2b6f99', emissiveIntensity: 0.35, cut: 'full', side: THREE.DoubleSide },
    stadium_roof: { color: '#8e9db3', roughness: 0.45, metalness: 0.6, cut: 'full', side: THREE.DoubleSide },
    stadium_bowl: { color: '#39445a', roughness: 0.85, cut: 'upper', side: THREE.DoubleSide },
    stadium_floor: { color: '#11161f', roughness: 0.9 },
    stage: { color: '#1b212e', roughness: 0.6, metalness: 0.3 },
    stage_screens: { color: '#05070b', emissive: '#6a5cff', emissiveIntensity: 2.4 },
    _fallback: { color: '#202838', roughness: 0.8, metalness: 0 },
  },
  light: {
    ctx_ground: { color: '#bfc9d6', roughness: 1 },
    ctx_green: { color: '#7cb088', roughness: 1 },
    ctx_roads: { color: '#7d8a9b', roughness: 0.9 },
    ctx_paths: { color: '#a5b1c0', roughness: 0.9 },
    ctx_plazas: { color: '#ccd5e0', roughness: 0.85 },
    ctx_buildings: { color: '#dde4ed', roughness: 0.78 },
    ctx_windows: { color: '#536f90', emissive: '#000000', emissiveIntensity: 0, roughness: 0.25, metalness: 0.35 },
    ctx_landmarks: { color: '#c4d0df', roughness: 0.7 },
    ctx_trees: { color: '#4e865d', roughness: 1 },
    stadium_shell: { color: '#eaf0f7', roughness: 0.28, metalness: 0.42, cut: 'full', side: THREE.DoubleSide },
    stadium_glass: { color: '#5283a8', roughness: 0.16, metalness: 0.42, emissive: '#1d4f73', emissiveIntensity: 0.08, cut: 'full', side: THREE.DoubleSide },
    stadium_roof: { color: '#d4dfec', roughness: 0.42, metalness: 0.35, cut: 'full', side: THREE.DoubleSide },
    stadium_bowl: { color: '#778599', roughness: 0.85, cut: 'upper', side: THREE.DoubleSide },
    stadium_floor: { color: '#455264', roughness: 0.9 },
    stage: { color: '#323b4a', roughness: 0.6, metalness: 0.3 },
    stage_screens: { color: '#141a26', emissive: '#584ae5', emissiveIntensity: 0.95 },
    _fallback: { color: '#b8c4d4', roughness: 0.8, metalness: 0 },
  },
}

const ENV_THEMES = {
  dark: {
    horizon: 0x0b1422, zenith: 0x020409, glow: 0x1d3558, glowStrength: 0.55,
    fogDensity: 0.00115, envIntensity: 0.32,
    hemiSky: 0x8fb4ff, hemiGround: 0x0a0d14, hemiIntensity: 0.75,
    keyColor: 0xdfeaff, keyIntensity: 2.3,
    rimColor: 0x4f8dff, rimIntensity: 0.7,
    pitchColor: 0x9fd0ff, pitchIntensity: 3.0,
    aoColor: 0x02040a, aoIntensity: 2.6,
    bloomThreshold: 1.0, bloomIntensity: 0.85,
    vignetteDarkness: 0.62,
  },
  light: {
    horizon: 0xc8ddf0, zenith: 0x6ca2d8, glow: 0xfff3de, glowStrength: 0.38,
    fogDensity: 0.00072, envIntensity: 0.52,
    hemiSky: 0xe6f2ff, hemiGround: 0x7d8999, hemiIntensity: 0.95,
    keyColor: 0xfff8eb, keyIntensity: 2.05,
    rimColor: 0x92befa, rimIntensity: 0.68,
    pitchColor: 0xfff4e0, pitchIntensity: 0.65,
    aoColor: 0x33445c, aoIntensity: 1.85,
    bloomThreshold: 1.5, bloomIntensity: 0.28,
    vignetteDarkness: 0.22,
  },
}

export function createScene(canvas, manifest, initialTheme = 'dark') {
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

  let currentTheme = initialTheme === 'light' ? 'light' : 'dark'
  const env0 = ENV_THEMES[currentTheme]

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(env0.horizon, env0.fogDensity)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = env0.envIntensity
  pmrem.dispose()

  const skyUniforms = {
    horizon: { value: new THREE.Color(env0.horizon) },
    zenith: { value: new THREE.Color(env0.zenith) },
    glow: { value: new THREE.Color(env0.glow) },
    glowStrength: { value: env0.glowStrength },
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: skyUniforms,
      vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 p; uniform vec3 horizon, zenith, glow; uniform float glowStrength;
        void main(){ float h = clamp(p.y, 0.0, 1.0); vec3 c = mix(horizon, zenith, pow(h, 0.45));
          c += glow * pow(1.0 - h, 10.0) * glowStrength; gl_FragColor = vec4(c, 1.0); }`,
    }))
  scene.add(sky)

  const hemi = new THREE.HemisphereLight(env0.hemiSky, env0.hemiGround, env0.hemiIntensity)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(env0.keyColor, env0.keyIntensity)
  key.position.set(-260, 340, 210)
  key.castShadow = true
  key.shadow.mapSize.set(4096, 4096)
  Object.assign(key.shadow.camera, { left: -230, right: 230, top: 230, bottom: -230, near: 50, far: 900 })
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.6
  scene.add(key)
  const rim = new THREE.DirectionalLight(env0.rimColor, env0.rimIntensity)
  rim.position.set(300, 160, -260)
  scene.add(rim)
  const pitch = new THREE.PointLight(env0.pitchColor, env0.pitchIntensity, 420, 0.9)   // spill from the stage and floodlights
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
  let cutawayOn = true
  const clip = (material, kind) => {
    const planes = kind === 'full' ? cutFull : cutUpper
    material.clippingPlanes = cutawayOn ? planes : null
    material.clipIntersection = true
    material.clipShadows = true
    cutMaterials.push([material, planes])
    return material
  }
  const setCutaway = (on) => {
    cutawayOn = on
    for (const [m, planes] of cutMaterials) {
      m.clippingPlanes = on ? planes : null
      m.needsUpdate = true
    }
  }

  const venue = new THREE.Group()
  venue.position.set(-CX, 0, CY)                                             // glTF axes: x = x, y = z, z = -y
  scene.add(venue)
  const themedMeshes = []

  const applyMeshLook = (mesh, theme) => {
    const table = LOOK_THEMES[theme]
    const spec = table[mesh.userData.lookKey] ?? table._fallback
    const mat = mesh.material
    mat.color.set(spec.color)
    mat.roughness = spec.roughness ?? 0.8
    mat.metalness = spec.metalness ?? 0
    if (spec.emissive) {
      mat.emissive.set(spec.emissive)
      mat.emissiveIntensity = spec.emissiveIntensity ?? 1
    } else {
      mat.emissive.set(0x000000)
      mat.emissiveIntensity = 0
    }
  }

  async function loadVenue(url) {
    const draco = new DRACOLoader().setDecoderPath('/draco/')
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url)
    const table = LOOK_THEMES[currentTheme]
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return
      const keyName = table[o.name] ? o.name : table[o.parent?.name] ? o.parent.name : '_fallback'
      const look = table[keyName]
      const { cut, ...params } = look
      o.userData.lookKey = keyName
      o.material = new THREE.MeshStandardMaterial(params)
      if (cut) clip(o.material, cut)
      const ctx = o.name.startsWith('ctx_')
      o.castShadow = !ctx || o.name === 'ctx_buildings' || o.name === 'ctx_landmarks'
      o.receiveShadow = o.name !== 'ctx_windows' && o.name !== 'stage_screens'
      o.geometry.computeVertexNormals()
      themedMeshes.push(o)
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
  Object.assign(ao.configuration, { aoRadius: 7, distanceFalloff: 1, intensity: env0.aoIntensity, halfRes: true, depthAwareUpsampling: true, gammaCorrection: false })
  ao.configuration.color = new THREE.Color(env0.aoColor)
  ao.setQualityMode('Medium')
  composer.addPass(ao)
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: env0.bloomThreshold, luminanceSmoothing: 0.25, intensity: env0.bloomIntensity, radius: 0.72 })
  const vignette = new VignetteEffect({ offset: 0.28, darkness: env0.vignetteDarkness })
  composer.addPass(new EffectPass(camera, bloom, vignette,
    new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new SMAAEffect({ preset: SMAAPreset.HIGH })))
  let fx = true
  const setFx = (on) => {
    fx = on
    renderer.toneMapping = on ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
  }

  function setTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark'
    currentTheme = next
    const e = ENV_THEMES[next]
    scene.fog.color.set(e.horizon)
    scene.fog.density = e.fogDensity
    scene.environmentIntensity = e.envIntensity
    skyUniforms.horizon.value.set(e.horizon)
    skyUniforms.zenith.value.set(e.zenith)
    skyUniforms.glow.value.set(e.glow)
    skyUniforms.glowStrength.value = e.glowStrength
    hemi.color.set(e.hemiSky)
    hemi.groundColor.set(e.hemiGround)
    hemi.intensity = e.hemiIntensity
    key.color.set(e.keyColor)
    key.intensity = e.keyIntensity
    rim.color.set(e.rimColor)
    rim.intensity = e.rimIntensity
    pitch.color.set(e.pitchColor)
    pitch.intensity = e.pitchIntensity
    ao.configuration.color.set(e.aoColor)
    ao.configuration.intensity = e.aoIntensity
    bloom.luminanceMaterial.threshold = e.bloomThreshold
    bloom.intensity = e.bloomIntensity
    vignette.darkness = e.vignetteDarkness
    for (const mesh of themedMeshes) applyMeshLook(mesh, next)
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

  return { THREE, renderer, scene, camera, controls, toScene, loadVenue, loadSeats, setCutaway, setFx, setTheme, flyTo, onFrame: (f) => updaters.push(f) }
}
