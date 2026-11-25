// Live layer on top of the venue model: zone surfaces, outlines, crowd dots, flow arrows, gates, displays.
// Geometry and IDs come from the M1 files; values come from M2 state messages.
import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

const WALKING = new Set(['portal', 'concourse', 'gate', 'tunnel'])
const RAMP = [[0, '#0d3a4a'], [1.0, '#1fb6c9'], [1.8, '#7be05a'], [2.2, '#ffc23d'], [2.8, '#ff4d5e'], [4.0, '#ff2bd1']]
  .map(([d, c]) => [d, new THREE.Color(c)])
const C = { edge: new THREE.Color('#58c8f5'), stale: new THREE.Color('#8492a6'), warn: new THREE.Color('#ffb347'), alert: new THREE.Color('#ff4d5e'),
  seat: new THREE.Color('#4a78ff'), ok: new THREE.Color('#4ade9a') }

function ramp(density, out) {
  let i = 1
  while (i < RAMP.length - 1 && density > RAMP[i][0]) i++
  const [d0, c0] = RAMP[i - 1], [d1, c1] = RAMP[i]
  out.lerpColors(c0, c1, THREE.MathUtils.clamp((density - d0) / (d1 - d0), 0, 1))
  // below the limit the surface stays under the bloom threshold; above it, it glows
  return out.multiplyScalar(density > 2.2 ? 1.5 + Math.min(1.6, (density - 2.2) * 1.6) : 0.3 + 0.5 * (density / 2.2))
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function label(text, { colour = '#dbe6f5', bg = 'rgba(9,14,22,0.86)', border = 'rgba(120,160,210,0.55)', size = 64 } = {}) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  ctx.font = `700 ${size}px Inter, -apple-system, system-ui, sans-serif`
  const w = Math.ceil(ctx.measureText(text).width) + size * 0.8, h = size * 1.5
  canvas.width = w; canvas.height = h
  ctx.font = `700 ${size}px Inter, -apple-system, system-ui, sans-serif`
  ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 5
  ctx.beginPath(); ctx.roundRect(3, 3, w - 6, h - 6, size * 0.3); ctx.fill(); ctx.stroke()
  ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + size * 0.04)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, aspect: w / h }
}

function sprite(text, height, options) {
  const { texture, aspect } = label(text, options)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, fog: false }))
  s.scale.set(height * aspect, height, 1)
  s.renderOrder = 20
  return s
}

export function createOverlay(view, manifest, zonesGeo, linesGeo, spawn) {
  const { scene, toScene } = view
  const zones = manifest.zones
  const root = new THREE.Group()
  scene.add(root)
  const tmp = new THREE.Color(), v3 = new THREE.Vector3()
  const lift = (type) => (type === 'seating' ? 0.9 : 0.18)

  // ---- zone surfaces and outlines
  const surface = {}, outline = {}, pickable = [], samples = {}
  const deckMaterial = new THREE.MeshStandardMaterial({ color: '#232c3d', roughness: 0.85 })
  for (const f of zonesGeo.features) {
    const id = f.id, z = zones[id], ring = f.geometry.coordinates[0].slice(0, -1)
    const pts2 = ring.map(([x, y]) => new THREE.Vector2(x, y))
    const tris = THREE.ShapeUtils.triangulateShape(pts2, [])
    const pos = new Float32Array(ring.length * 3)
    ring.forEach(([x, y, h], i) => toScene(x, y, h + lift(z.type), v3).toArray(pos, i * 3))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setIndex(tris.flat())
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }))
    mesh.userData.zone = id
    mesh.renderOrder = 5
    root.add(mesh)
    surface[id] = mesh
    pickable.push(mesh)

    if (z.type === 'concourse' || z.type === 'gate') {
      // the facade and upper structure are cut away, so give the concourse a visible deck to stand on
      const deck = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(pts2), { depth: 1.1, bevelEnabled: false }).rotateX(-Math.PI / 2), deckMaterial)
      // zero-area triangles from near-duplicate ring points get a zero normal, which turns into NaN in the
      // shader and is then spread over the whole frame by bloom
      const nrm = deck.geometry.attributes.normal
      for (let i = 0; i < nrm.count; i++) if (Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) < 0.5) nrm.setXYZ(i, 0, 1, 0)
      deck.position.copy(toScene(0, 0, ring[0][2] - 1.12))
      deck.receiveShadow = deck.castShadow = true
      root.add(deck)
    }

    const flat = []
    for (const [x, y, h] of [...ring, ring[0]]) flat.push(...toScene(x, y, h + lift(z.type) + 0.05, v3).toArray())
    const lg = new LineGeometry().setPositions(flat)
    const lm = new LineMaterial({ color: 0xffffff, linewidth: z.monitored ? 1.6 : 2.2, dashed: !z.monitored, dashSize: 2.2, gapSize: 1.6,
      transparent: true, opacity: 0.9, depthWrite: false })
    const line = new Line2(lg, lm)
    line.computeLineDistances()
    line.renderOrder = 6
    root.add(line)
    outline[id] = line

    // points for crowd dots: seats for seating and floor zones, area-weighted random points elsewhere
    if (spawn.zones[id]) {
      const order = spawn.zones[id].map((_, i) => i), rnd = mulberry(id.length * 977 + ring.length)
      for (let i = order.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]] }
      samples[id] = new Float32Array(order.length * 3)
      order.forEach((k, i) => toScene(spawn.zones[id][k][0], spawn.zones[id][k][1], spawn.z[id][k] + 0.55, v3).toArray(samples[id], i * 3))
    } else {
      const rnd = mulberry(ring.length * 131 + Math.round(z.area_m2)), n = Math.ceil(z.area_m2 * 4.4)
      const areas = tris.map(([a, b, c]) => Math.abs((ring[b][0] - ring[a][0]) * (ring[c][1] - ring[a][1]) - (ring[c][0] - ring[a][0]) * (ring[b][1] - ring[a][1])) / 2)
      const total = areas.reduce((s, a) => s + a, 0)
      samples[id] = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        let r = rnd() * total, t = 0
        while (t < tris.length - 1 && r > areas[t]) r -= areas[t++]
        const [a, b, c] = tris[t].map((k) => ring[k])
        let u = rnd(), w = rnd()
        if (u + w > 1) { u = 1 - u; w = 1 - w }
        toScene(a[0] + u * (b[0] - a[0]) + w * (c[0] - a[0]), a[1] + u * (b[1] - a[1]) + w * (c[1] - a[1]),
          a[2] + u * (b[2] - a[2]) + w * (c[2] - a[2]) + 0.1, v3).toArray(samples[id], i * 3)
      }
    }
  }

  // ---- crowd dots
  const MAX_DOTS = Math.ceil(manifest.scope.capacity * 1.25)
  const dots = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.75, 2, 6).translate(0, 0.55, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_DOTS)
  dots.count = 0
  dots.frustumCulled = false
  dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  dots.instanceMatrix.array.fill(0)
  for (let i = 0; i < MAX_DOTS; i++) dots.setColorAt(i, tmp.set(1, 1, 1))
  for (let i = 0; i < MAX_DOTS; i++) { const o = i * 16; dots.instanceMatrix.array[o] = dots.instanceMatrix.array[o + 5] = dots.instanceMatrix.array[o + 10] = dots.instanceMatrix.array[o + 15] = 1 }
  root.add(dots)
  const seatedColour = new THREE.Color('#ffd9a8').multiplyScalar(0.62), walkingColour = new THREE.Color('#cfe9ff').multiplyScalar(0.6)

  // ---- flow arrows on zone boundaries
  const CHEVRONS = 3
  const arrows = new THREE.InstancedMesh(new THREE.ConeGeometry(0.75, 2.1, 4).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }), linesGeo.features.length * CHEVRONS)
  arrows.frustumCulled = false
  arrows.renderOrder = 8
  root.add(arrows)
  const edges = linesGeo.features.map((f) => {
    const [[x0, y0, h0], [x1, y1, h1]] = f.geometry.coordinates
    const mid = toScene((x0 + x1) / 2, (y0 + y1) / 2, (h0 + h1) / 2 + 0.9)
    const dir = new THREE.Vector3(-(y1 - y0), 0, -(x1 - x0)).normalize()             // normal of the line, in scene axes
    const to = toScene(...zones[f.properties.to].centroid)
    if (dir.dot(to.sub(mid).setY(0)) < 0) dir.negate()
    return { id: f.id, mid, dir, quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir), flow: 0, shown: 0 }
  })
  const flowColour = new THREE.Color('#7fe3ff')

  // ---- gates and displays
  const gateLabel = {}
  for (const [id, g] of Object.entries(manifest.gates)) {
    const c = zones[id].centroid
    const open = sprite(`GATE ${g.ref}`, 4.4), closed = sprite(`GATE ${g.ref} CLOSED`, 4.4, { colour: '#fff', bg: 'rgba(150,20,34,0.92)', border: '#ff8090' })
    for (const s of [open, closed]) { s.position.copy(toScene(c[0], c[1], c[2] + 9)); root.add(s) }
    closed.visible = false
    gateLabel[id] = { open, closed }
  }
  const boards = {}
  const boardGeo = new THREE.BoxGeometry(2.6, 1.1, 0.25)
  for (const [id, d] of Object.entries(manifest.displays)) {
    const mesh = new THREE.Mesh(boardGeo, new THREE.MeshBasicMaterial({ color: 0x1b2a3d }))
    mesh.position.copy(toScene(d.xyz[0], d.xyz[1], d.xyz[2]))
    mesh.rotation.y = THREE.MathUtils.degToRad(d.angle_deg) + Math.PI / 2
    root.add(mesh)
    boards[id] = { mesh, sprites: {}, shown: null }
  }
  const boardSprite = (id, gateId) => {
    const b = boards[id]
    if (!b.sprites[gateId]) {
      const s = sprite(`→ ${manifest.gates[gateId].ref}`, 2.6, { colour: '#eafff4', bg: 'rgba(12,92,60,0.93)', border: '#69f0b0' })
      s.position.copy(b.mesh.position).y += 2.6
      root.add(s)
      b.sprites[gateId] = s
    }
    return b.sprites[gateId]
  }

  // ---- state
  let state = null, focus = null
  function apply(next) {
    state = next
    let n = 0
    const m = dots.instanceMatrix.array
    for (const [id, s] of Object.entries(next.zones)) {
      const z = zones[id], walking = WALKING.has(z.type), mat = surface[id].material, line = outline[id].material
      if (walking) {
        ramp(s.density, mat.color)
        mat.opacity = 0.3 + 0.45 * Math.min(1, s.density / 2.2)
      } else {
        const share = z.capacity ? Math.min(1, s.count / z.capacity) : 0
        mat.color.copy(C.seat).multiplyScalar(0.25 + 0.5 * share)
        mat.opacity = z.capacity ? 0.1 + 0.3 * share : 0.05
      }
      const closed = next.facilities[id] === 'closed'
      if (closed) { mat.color.copy(C.alert).multiplyScalar(1.6); mat.opacity = 0.6 }
      const level = closed || (walking && s.density > 2.2) ? 2 : walking && s.forecast_density > 2.2 ? 1 : 0
      outline[id].userData.level = level
      line.color.copy(level === 2 ? C.alert : level === 1 ? C.warn : s.stale ? C.stale : C.edge).multiplyScalar(level ? 1.9 : s.stale ? 0.7 : walking ? 0.85 : 0.45)
      line.dashed = !z.monitored || s.stale
      line.needsUpdate = true
      const pool = samples[id], k = Math.min(Math.round(s.count), pool.length / 3, MAX_DOTS - n)
      const colour = walking ? walkingColour : seatedColour
      for (let i = 0; i < k; i++, n++) {
        const o = n * 16
        m[o + 12] = pool[i * 3]; m[o + 13] = pool[i * 3 + 1]; m[o + 14] = pool[i * 3 + 2]
        dots.setColorAt(n, colour)
      }
    }
    dots.count = n
    dots.instanceMatrix.needsUpdate = true
    dots.instanceColor.needsUpdate = true
    for (const e of edges) e.flow = next.flows[e.id] ?? 0
    for (const [id, g] of Object.entries(gateLabel)) {
      const closed = next.facilities[id] === 'closed'
      g.open.visible = !closed
      g.closed.visible = closed
    }
    const redirected = new Set(next.redirected)
    for (const [id, b] of Object.entries(boards)) {
      const gate = redirected.has(id) ? next.displays[id] : null
      const wrong = gate && next.facilities[gate] === 'closed'             // approved message now points at a closed gate
      if (gate) boardSprite(id, gate).material.color.copy(wrong ? C.alert : tmp.set(0xffffff)).multiplyScalar(wrong ? 2.4 : 1.35)
      b.mesh.material.color.copy(wrong ? C.alert : gate ? C.ok : tmp.set(0x1b2a3d)).multiplyScalar(gate ? 2.2 : 1)
      if (gate === b.shown) continue
      if (b.shown) b.sprites[b.shown].visible = false
      if (gate) b.sprites[gate].visible = true
      b.shown = gate
    }
  }

  function reset() {
    dots.count = 0
    for (const id of Object.keys(surface)) {
      surface[id].material.color.copy(WALKING.has(zones[id].type) ? RAMP[0][1] : C.seat).multiplyScalar(0.3)
      surface[id].material.opacity = 0.16
      outline[id].material.color.copy(C.edge).multiplyScalar(0.6)
      outline[id].userData.level = 0
    }
    for (const e of edges) e.flow = 0
    for (const b of Object.values(boards)) {
      if (b.shown) b.sprites[b.shown].visible = false
      b.shown = null
      b.mesh.material.color.set(0x1b2a3d)
    }
    for (const g of Object.values(gateLabel)) { g.open.visible = true; g.closed.visible = false }
    state = null
  }
  reset()

  const mat4 = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3()
  view.onFrame((dt, t) => {
    const pulse = 0.72 + 0.28 * Math.sin(t * 5)
    for (const [id, line] of Object.entries(outline)) {
      const level = line.userData.level
      line.material.opacity = id === focus ? 1 : level ? pulse : 0.85
      line.material.linewidth = id === focus ? 4 : level ? 2.8 : zones[id].monitored ? 1.6 : 2.2
    }
    edges.forEach((e, i) => {
      e.shown += (e.flow - e.shown) * Math.min(1, dt * 3)
      const mag = Math.min(1, Math.abs(e.shown) / 4), sign = Math.sign(e.shown) || 1
      for (let k = 0; k < CHEVRONS; k++) {
        const phase = (t * (0.35 + mag * 0.9) + k / CHEVRONS) % 1
        const size = mag < 0.02 ? 0 : (0.55 + mag * 0.9) * Math.sin(phase * Math.PI)
        pos.copy(e.mid).addScaledVector(e.dir, sign * (phase - 0.5) * 7)
        mat4.compose(pos, e.quat, scl.set(size, size, size * sign))
        arrows.setMatrixAt(i * CHEVRONS + k, mat4)
        arrows.setColorAt(i * CHEVRONS + k, tmp.copy(flowColour).multiplyScalar(0.7 + mag * 1.3))
      }
    })
    arrows.instanceMatrix.needsUpdate = true
    if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true
  })

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
  function pick(clientX, clientY) {
    ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1)
    ray.setFromCamera(ndc, view.camera)
    const hit = ray.intersectObjects(pickable, false)[0]
    focus = hit ? hit.object.userData.zone : null
    return focus
  }

  const centre = (id) => toScene(...zones[id].centroid).toArray()
  return { apply, reset, pick, centre, setFocus: (id) => { focus = id } }
}
