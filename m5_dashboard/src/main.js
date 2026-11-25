// M5 dashboard: reads the venue from M2 (/api/venue, /m1/*), follows the live state over /ws,
// and sends the duty manager's decisions back. It holds no model of its own.
import { createScene } from './scene.js'
import { createOverlay } from './overlay.js'

const $ = (id) => document.getElementById(id)
const json = async (url, options) => {
  const r = await fetch(url, options)
  if (!r.ok) throw new Error(`${url}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}
const post = (url, body) => json(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const short = (id) => id.split('-').slice(2).join('-')
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const manifest = await json('/api/venue')
const LIMIT = manifest.constants.fruin_f
const [zonesGeo, linesGeo, spawn] = await Promise.all(['zones', 'lines'].map((n) => json(`/m1/${manifest.files[n]}`)).concat(json(`/m1/${manifest.files.spawn}`)))
const view = createScene($('scene'), manifest)
const overlay = createOverlay(view, manifest, zonesGeo, linesGeo, spawn)
window.twin = { view, overlay, manifest }

$('scope').textContent = `${manifest.scope.side === 'W' ? 'west' : 'east'} half, ${Object.keys(manifest.zones).length} zones, ${manifest.scope.capacity.toLocaleString()} people · IDs ${manifest.status}`
$('loading-text').textContent = 'Loading venue model'
await Promise.all([view.loadVenue(`/m1/${manifest.files.mesh}`), view.loadSeats(`/m1/${manifest.files.seats}`)])
$('loading').classList.add('done')

// ------------------------------------------------------------------ views
const VIEWS = {
  Overview: [[-330, 215, 265], [-45, 6, 5]],
  Concourse: [[-205, 78, 150], [-88, 10, 30]],
  Floor: [[-150, 120, -10], [-25, 2, 15]],
  Plan: [[-75, 600, 36], [-75, 0, 30]],
}
for (const [name, [p, t]] of Object.entries(VIEWS)) {
  const b = document.createElement('button')
  b.textContent = name
  b.onclick = () => view.flyTo(p, t)
  $('views').append(b)
}
view.flyTo(...VIEWS.Overview, 3.2)
$('f-shell').onchange = (e) => view.setCutaway(!e.target.checked)
$('f-fx').onchange = (e) => view.setFx(e.target.checked)
view.setFx(true)

const focusZone = (id) => {
  const [x, y, z] = overlay.centre(id)
  const out = Math.hypot(x, z) || 1
  view.flyTo([x + (x / out) * 120, y + 150, z + (z / out) * 120 + 60], [x * 0.8, y, z * 0.8], 1.5)
  overlay.setFocus(id)
}

// ------------------------------------------------------------------ scenario form
for (const [id, g] of [['', { ref: 'None' }], ...Object.entries(manifest.gates)]) {
  const o = new Option(id ? `Gate ${g.ref} closes at 2:00` : 'No closure', id)
  o.selected = g.ref === 'D'
  $('f-gate').append(o)
}
$('f-speed').value = '10'
const showP = () => { $('o-p').textContent = `${Math.round($('f-p').value * 100)}%` }
$('f-p').oninput = showP
showP()

let run = null, state = null, truth = null, series = [], guidance = new Map(), logged = new Set()

$('b-start').onclick = async () => {
  const drop = $('f-drop').checked
  await post('/api/runs', {
    p_follow: +$('f-p').value, speed: +$('f-speed').value, close_gate: $('f-gate').value || null, approval: $('f-approval').value,
    drop_zones: drop ? ['L2-W-C08', 'L2-W-C10'] : [], drop_from_s: drop ? 200 : 0, drop_to_s: drop ? 320 : 0,
  })
}
$('b-stop').onclick = () => run && post(`/api/runs/${run.run_id}/stop`)

// ------------------------------------------------------------------ live channel
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
  ws.onopen = () => setStatus()
  ws.onclose = () => { $('status').className = 'off'; $('status-text').textContent = 'M2 offline, retrying'; setTimeout(connect, 1500) }
  ws.onmessage = (e) => {
    const { type, data } = JSON.parse(e.data)
    if (type === 'hello') {
      if (data.run) onRun(data.run, true)
      for (const g of data.guidance) onGuidance(g)
      if (data.state) onState(data.state)
    } else if (type === 'run') onRun(data)
    else if (type === 'state') onState(data)
    else if (type === 'guidance') onGuidance(data)
    else if (type === 'facility') log(data.t_s, `Gate ${manifest.zones[data.zone_id].gate_ref} ${data.status} <small>${esc(data.by)}</small>`, data.status)
    else if (type === 'evaluation') { truth = data; if (series.length) series.at(-1).truth = data.true_max_density; renderEval() }
  }
}

function setStatus() {
  const live = run?.status === 'running'
  $('status').className = live ? 'live' : ''
  $('status-text').textContent = live ? `Live · ${run.run_id}` : run ? `Run ${run.status}` : 'Ready'
  $('b-start').disabled = live
  $('b-stop').disabled = !live
}

async function onRun(r, resumed = false) {
  const fresh = !run || run.run_id !== r.run_id
  run = r
  if (fresh) {
    series = []; guidance = new Map(); logged = new Set(); truth = null; state = null
    $('log').innerHTML = ''
    overlay.reset()
    if (resumed) {
      series = (await json(`/api/runs/${r.run_id}/series`)).map((s) => ({ t: s.t_s, now: s.max_density, fc: s.max_forecast_density }))
    } else {
      log(0, `Egress started · ${r.config.approval === 'none' ? 'no guidance' : r.config.approval === 'auto' ? 'batch approval' : 'manual approval'}`)
      view.flyTo(...VIEWS.Overview, 1.6)
    }
  }
  if (r.status !== 'running' && r.result) {
    log(r.result.sim_time_s, `Run ${r.status} · 90% out at ${clock(r.result.t90_s ?? 0)} · ${r.result.over_threshold_zone_seconds} zone-seconds above ${LIMIT}`)
  }
  setStatus(); renderPending(); renderEval(); renderKpis()
}

function onState(s) {
  if (!run || s.run_id !== run.run_id) return
  state = window.twinState = s
  overlay.apply(s)
  series.push({ t: s.t_s, now: s.kpis.max_density, fc: s.kpis.max_forecast_density })
  renderKpis(); renderGates(); renderPending(); drawChart()
}

function onGuidance(g) {
  const before = guidance.get(g.id)
  guidance.set(g.id, g)
  const key = `${g.id}:${g.status}`
  if (!logged.has(key)) {
    logged.add(key)
    const what = g.messages.map((m) => m.gate_ref).filter((x, i, a) => a.indexOf(x) === i).join(', ')
    const text = { proposed: `Proposal ${g.version}: ${g.messages.length} displays to Gate ${what}`, approved: `Proposal ${g.version} approved, ${g.messages.length} displays changed`,
      rejected: `Proposal ${g.version} rejected`, superseded: `Proposal ${g.version} expired undecided` }[g.status]
    log(g.status === 'proposed' ? g.created_t_s : g.decided_t_s, `${text} <small>${esc(g.status === 'proposed' ? 'M4' : g.decided_by)}</small>`, g.status)
  }
  if (g.status === 'proposed' && !before && manifest.zones[g.trigger_zone]) focusZone(g.trigger_zone)
  renderPending()
}

function log(t, html, cls = '') {
  const li = document.createElement('li')
  li.innerHTML = `<time>${clock(t ?? 0)}</time><span class="${cls}">${html}</span>`
  $('log').prepend(li)
}

// ------------------------------------------------------------------ panels
function renderKpis() {
  const k = state?.kpis
  const cell = (label, value, cls = '') => `<div class="kpi ${cls}"><b>${value}</b><span>${label}</span></div>`
  if (!k) { $('kpis').innerHTML = cell('Egress clock', '0:00') + cell('People inside', manifest.scope.capacity.toLocaleString()); return }
  $('kpis').innerHTML = [
    cell('Egress clock', clock(state.t_s)),
    cell('People inside', Math.round(k.people_inside).toLocaleString()),
    cell('Out', `${Math.round(k.exited_share * 100)}%`),
    cell('Peak density', k.max_density.toFixed(1), k.max_density > LIMIT ? 'alert' : ''),
    cell('Forecast +2 min', k.max_forecast_density.toFixed(1), k.max_forecast_density > LIMIT ? 'warn' : ''),
    cell(`Zones over ${LIMIT}`, k.zones_over_now, k.zones_over_now ? 'alert' : 'ok'),
    cell('Stale cameras', k.stale_zones, k.stale_zones ? 'warn' : ''),
    cell('Latency', state.latency_ms == null ? 'n/a' : `${Math.round(state.latency_ms)} ms`),
  ].join('')
}

function renderGates() {
  const total = Math.max(1, ...Object.values(state.gate_arrivals))
  $('gates').innerHTML = Object.entries(manifest.gates).map(([id, g]) => {
    const n = state.gate_arrivals[id] ?? 0, closed = state.facilities[id] === 'closed'
    return `<div class="g ${closed ? 'closed' : ''}"><b>Gate ${g.ref}</b><div class="bar"><i style="width:${(n / total) * 100}%"></i></div><span>${closed ? 'closed' : Math.round(n).toLocaleString()}</span></div>`
  }).join('')
}

function renderPending() {
  const g = [...guidance.values()].find((x) => x.status === 'proposed' && x.id === state?.pending_guidance)
  const box = $('pending')
  if (!g) {
    if (box.dataset.id !== '') {
      box.dataset.id = ''
      box.innerHTML = `<div class="empty">${run?.config.approval === 'none' ? 'Guidance is switched off for this run.' : 'No proposal waiting. M4 proposes when a 2-minute forecast passes the limit or a gate closes.'}</div>`
    }
    return
  }
  const left = Math.max(0, 1 - (state.t_s - g.created_t_s) / 120)
  if (box.dataset.id === g.id) { box.querySelector('.ttl i').style.width = `${left * 100}%`; return }
  box.dataset.id = g.id
  const [why, plan] = g.reason.split('; ')
  const rows = g.messages.map((m) => {
    const d = manifest.displays[m.display_id], zonesServed = d.serves.map(short).join(', ')
    const people = g.assignments.filter((a) => d.serves.includes(a.zone_id) && a.to_gate === m.gate_id).reduce((s, a) => s + a.people, 0)
    const from = g.assignments.find((a) => d.serves.includes(a.zone_id))?.from_gate
    return `<tr><td class="drop"><input type="checkbox" checked data-zones="${d.serves.join(',')}" title="Untick to leave this display unchanged" /></td>
      <td>${short(m.display_id)} <small>${zonesServed}</small></td>
      <td><span class="gate">${manifest.zones[from]?.gate_ref ?? '?'}</span> → <span class="gate to">${m.gate_ref}</span></td><td>${people}</td></tr>`
  }).join('')
  box.innerHTML = `<div class="card proposed"><div class="why">${esc(why)}</div><div class="sub">${esc(plan ?? '')}</div>
    <div class="ttl"><i style="width:${left * 100}%"></i></div><table>${rows}</table>
    <div class="row"><button class="approve">Approve</button><button class="reject">Reject</button><button class="show">Show</button></div></div>`
  const decide = (action) => {
    const drop = [...box.querySelectorAll('input:not(:checked)')].flatMap((i) => i.dataset.zones.split(','))
    post(`/api/guidance/${g.id}/decision`, { action, by: 'duty manager', drop_zones: drop }).catch((e) => log(state.t_s, esc(e.message), 'rejected'))
  }
  box.querySelector('.approve').onclick = () => decide('approve')
  box.querySelector('.reject').onclick = () => decide('reject')
  box.querySelector('.show').onclick = () => manifest.zones[g.trigger_zone] && focusZone(g.trigger_zone)
}

function renderEval() {
  const r = run?.result, row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`
  let html = ''
  if (truth) {
    html += row('Density error now, mean / max', `${truth.mean_abs_error.toFixed(2)} / ${truth.max_abs_error.toFixed(2)}`)
    const blind = Object.entries(truth.blind).sort((a, b) => b[1].true - a[1].true)[0]
    if (blind) html += row(`No camera: ${short(blind[0])} est. / true`, `${blind[1].estimated.toFixed(2)} / ${blind[1].true.toFixed(2)}`)
  }
  if (state?.compliance != null) html += row('Compliance estimated by the twin', `${Math.round(state.compliance * 100)}%`)
  if (r) {
    if (r.true_compliance != null) html += row('Compliance in the testbed', `${Math.round(r.true_compliance * 100)}%`)
    html += row('Run density error, mean / max', `${r.density_mae.toFixed(3)} / ${r.density_max_error.toFixed(2)}`)
    html += row('90% out', clock(r.t90_s ?? 0)) + row(`Zone-seconds above ${LIMIT}`, r.over_threshold_zone_seconds)
  }
  $('eval').innerHTML = html ? `<dl>${html}</dl><p class="note">Truth comes from the testbed and is shown for evaluation. M3 and M4 do not read it. Target: error ≤ 0.5 persons/m².</p>`
    : '<p class="note">Start a run. The testbed reports its true densities here so the twin’s estimate can be checked.</p>'
}

function drawChart() {
  const c = $('chart'), dpr = Math.min(window.devicePixelRatio, 2), w = c.clientWidth, h = c.clientHeight
  if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr }
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const L = 26, B = 16, T = 4, R = 6, tMax = Math.max(600, (series.at(-1)?.t ?? 0) * 1.05), yMax = 4.4
  const X = (t) => L + ((w - L - R) * t) / tMax, Y = (v) => T + (h - T - B) * (1 - Math.min(v, yMax) / yMax)
  g.font = '10px system-ui'; g.fillStyle = '#7f90a8'; g.strokeStyle = 'rgba(140,170,210,0.13)'; g.lineWidth = 1; g.setLineDash([])
  for (const v of [0, 1, 2, 3, 4]) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke(); g.fillText(v, 8, Y(v) + 3) }
  const step = tMax > 1500 ? 300 : 120
  for (let t = 0; t <= tMax; t += step) g.fillText(clock(t), X(t) - 8, h - 3)
  g.strokeStyle = '#ff4d5e'; g.beginPath(); g.moveTo(L, Y(LIMIT)); g.lineTo(w - R, Y(LIMIT)); g.stroke()
  const mark = (t, colour) => { g.strokeStyle = colour; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(t), T); g.lineTo(X(t), h - B); g.stroke(); g.setLineDash([]) }
  if (run?.config.close_gate && (series.at(-1)?.t ?? 0) >= run.config.close_at_s) mark(run.config.close_at_s, '#ff4d5e')
  for (const x of guidance.values()) if (x.status === 'approved') mark(x.decided_t_s, '#4ade9a')
  const path = (key, colour, dash, shift = 0) => {
    g.strokeStyle = colour; g.setLineDash(dash); g.lineWidth = 1.6; g.beginPath()
    let started = false
    for (const p of series) {
      if (p[key] == null) continue
      const x = X(p.t + shift), y = Y(p[key])
      started ? g.lineTo(x, y) : g.moveTo(x, y)
      started = true
    }
    g.stroke(); g.setLineDash([])
  }
  path('fc', '#ffb347', [5, 4], manifest.constants.forecast_horizon_s)   // drawn at the time it refers to
  path('now', '#5ad1ff', [])
  path('truth', '#ffffff', [1.5, 4])
}

// ------------------------------------------------------------------ hover
const tip = $('tip')
$('scene').addEventListener('pointermove', (e) => {
  const id = overlay.pick(e.clientX, e.clientY)
  if (!id) { tip.style.display = 'none'; return }
  const z = manifest.zones[id], s = state?.zones[id]
  let html = `<b>${id}</b> · ${z.type}<br>${z.area_m2} m²${z.capacity ? ` · ${z.capacity} seats` : ''}${z.closed_for_concert ? ' · not sold (behind stage)' : ''}`
  if (s) {
    html += `<br>${Math.round(s.count)} people · ${s.density.toFixed(2)} p/m²<br>in 2 min: ${s.forecast_density.toFixed(2)} p/m²<br>`
    html += s.stale ? `<span class="stale">camera data ${s.age_s.toFixed(0)} s old, estimated</span>` : z.monitored ? 'measured' : 'no camera, estimated from counting lines'
  } else html += `<br>${z.monitored ? 'camera' : 'no camera'}`
  tip.innerHTML = html
  tip.style.display = 'block'
  tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 240)}px`
  tip.style.top = `${e.clientY + 14}px`
})
window.addEventListener('resize', drawChart)

renderKpis(); renderEval(); renderPending(); drawChart()
connect()
