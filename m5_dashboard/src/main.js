// M5 dashboard: reads the venue from M2 (/api/venue, /m1/*), follows the live state over /ws,
// and sends the duty manager's decisions back. It holds no model of its own.
import { createScene } from './scene.js'
import { createOverlay } from './overlay.js'
import {
  STRINGS, formatApiError, formatProposalReason,
  getInitialLang, getInitialMode, getInitialTheme,
  saveLang, saveMode, saveTheme,
} from './i18n.js'

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

const WALKING_TYPES = new Set(['concourse', 'portal', 'tunnel', 'gate'])
const ERROR_TARGET = 0.5

const CHART_THEMES = {
  dark: {
    axis: '#7b8fa8', grid: 'rgba(148,179,219,0.12)', limit: '#fb7185',
    closed: '#fb7185', approved: '#34d399', fc: '#fbbf24', now: '#38bdf8',
    nowFillTop: 'rgba(56,189,248,0.22)', nowFillBot: 'rgba(56,189,248,0.0)',
    truth: '#e2e8f0',
  },
  light: {
    axis: '#546b88', grid: 'rgba(30,58,95,0.1)', limit: '#e11d48',
    closed: '#e11d48', approved: '#059669', fc: '#d97706', now: '#0284c7',
    nowFillTop: 'rgba(2,132,199,0.18)', nowFillBot: 'rgba(2,132,199,0.0)',
    truth: '#1e293b',
  },
}

let lang = getInitialLang()
let theme = getInitialTheme()
let appMode = getInitialMode()
const T = () => STRINGS[lang]
const fmtNum = (n) => Number(n).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')

function applyThemeChrome() {
  document.documentElement.dataset.theme = theme
  for (const b of document.querySelectorAll('#theme-switch button')) {
    const active = b.dataset.theme === theme
    b.classList.toggle('active', active)
    b.setAttribute('aria-pressed', String(active))
  }
}

function applyModeChrome() {
  document.documentElement.dataset.mode = appMode
  for (const b of document.querySelectorAll('#mode-switch button')) {
    const active = b.dataset.mode === appMode
    b.classList.toggle('active', active)
    b.setAttribute('aria-pressed', String(active))
  }
  const s = T()
  const isSim = appMode === 'sim'
  $('eval-title').textContent = isSim ? s.evalTitle : s.opsEvalTitle
  $('eval-sub').textContent = isSim ? s.evalSub : s.opsEvalSub
  $('eval-tip-btn').dataset.tipKey = isSim ? 'tipEval' : 'tipOpsLoop'
}

function applyStaticI18n() {
  const s = T()
  document.documentElement.lang = s.htmlLang
  document.title = s.pageTitle
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const val = s[el.dataset.i18n]
    if (typeof val === 'string') el.textContent = val
  }
  $('mode-switch')?.setAttribute('aria-label', s.modeAria)
  $('toolbar')?.setAttribute('aria-label', s.toolbarAria)
  $('lang-switch')?.setAttribute('aria-label', s.langAria)
  $('theme-switch')?.setAttribute('aria-label', s.themeAria)
  $('b-collapse-left')?.setAttribute('title', s.collapseLeft)
  $('b-collapse-left')?.setAttribute('aria-label', s.collapseLeft)
  $('b-expand-left')?.setAttribute('title', s.expandLeft)
  $('b-expand-left')?.setAttribute('aria-label', s.expandLeft)
  const lightBtn = document.querySelector('#theme-switch button[data-theme="light"]')
  const darkBtn = document.querySelector('#theme-switch button[data-theme="dark"]')
  if (lightBtn) { lightBtn.title = s.themeLightTitle; lightBtn.setAttribute('aria-label', s.themeLightTitle) }
  if (darkBtn) { darkBtn.title = s.themeDarkTitle; darkBtn.setAttribute('aria-label', s.themeDarkTitle) }
  for (const b of document.querySelectorAll('#lang-switch button')) {
    const active = b.dataset.lang === lang
    b.classList.toggle('active', active)
    b.setAttribute('aria-pressed', String(active))
  }
  applyModeChrome()
}

applyThemeChrome()
applyStaticI18n()
$('status-text').textContent = T().statusConnecting

let manifest = await json('/api/venue')
const LIMIT = manifest.constants.fruin_f
const asset = (m, file) => new URL(`${m.asset_base ?? '/m1'}/${file}`, location.href).pathname
const loadLayer = (m) => Promise.all(['zones', 'lines', 'spawn'].map((n) => json(asset(m, m.files[n]))))
const [zonesGeo, linesGeo, spawn] = await loadLayer(manifest)
const view = createScene($('scene'), manifest, theme)
let overlay = createOverlay(view, manifest, zonesGeo, linesGeo, spawn, { lang, theme })

// Precomputed helpers derived from manifest (rebuilt on stage layout switch)
let gateLineId = {}
let gateCapacityPps = 4.16
let monitoredTotal = 0
function indexManifest() {
  gateLineId = {}
  for (const [lid, ln] of Object.entries(manifest.lines ?? {})) {
    if (manifest.gates[ln.to]) gateLineId[ln.to] = lid
  }
  const a = manifest.assumed ?? {}
  const w = a.gate_width_m?.value ?? 8.0
  const sh = a.gate_flow_share?.value ?? 0.4
  const sf = a.specific_flow_pps_per_m?.value ?? 1.3
  gateCapacityPps = w * sh * sf
  monitoredTotal = Object.values(manifest.zones).filter((z) => z.monitored).length
}
indexManifest()

function renderScope() {
  const s = T()
  const side = manifest.scope.side === 'W' ? s.sideWest : s.sideEast
  const status = manifest.stage?.status === 'hypothetical' ? s.statusHypothetical
    : manifest.status === 'provisional' ? s.statusProvisional : manifest.status
  $('scope-status').textContent = status
  $('scope').innerHTML = [side, s.scopeZones(Object.keys(manifest.zones).length), s.scopePeople(manifest.scope.capacity)]
    .map((item) => `<span>${esc(item)}</span>`)
    .join('')
  $('key-lim').textContent = s.keyLim(LIMIT)
}
renderScope()

$('loading-text').textContent = T().loadingModel
await Promise.all([view.loadVenue(asset(manifest, manifest.files.mesh)), view.loadSeats(asset(manifest, manifest.files.seats))])
view.setStageMode(manifest.stage?.mode ?? 'original')
$('loading').classList.add('done')

// ------------------------------------------------------------------ views & viewport chrome
const VIEWS = {
  Overview: [[-330, 215, 265], [-45, 6, 5]],
  Concourse: [[-205, 78, 150], [-88, 10, 30]],
  Floor: [[-150, 120, -10], [-25, 2, 15]],
  Plan: [[-75, 600, 36], [-75, 0, 30]],
}
let activeView = 'Overview'
for (const [name, [p, t]] of Object.entries(VIEWS)) {
  const b = document.createElement('button')
  b.type = 'button'
  b.dataset.view = name
  b.classList.toggle('active', name === activeView)
  b.textContent = T().views[name] ?? name
  b.onclick = () => {
    activeView = name
    for (const x of $('views').querySelectorAll('button')) x.classList.toggle('active', x === b)
    view.flyTo(p, t)
  }
  $('views').append(b)
}
view.flyTo(...VIEWS.Overview, 3.2)
$('f-shell').onchange = (e) => {
  const showShell = e.target.checked
  view.setCutaway(!showShell)
  overlay.setShellVisible(showShell)
}
$('f-fx').onchange = (e) => view.setFx(e.target.checked)
view.setFx(true)

$('b-collapse-left').onclick = () => {
  $('left-dock').classList.add('collapsed')
  $('b-expand-left').hidden = false
}
$('b-expand-left').onclick = () => {
  $('left-dock').classList.remove('collapsed')
  $('b-expand-left').hidden = true
}

const focusZone = (id) => {
  const [x, y, z] = overlay.centre(id)
  const out = Math.hypot(x, z) || 1
  view.flyTo([x + (x / out) * 120, y + 150, z + (z / out) * 120 + 60], [x * 0.8, y, z * 0.8], 1.5)
  overlay.setFocus(id)
}

// ------------------------------------------------------------------ scenario form (Testbed mode)
function buildGateOptions() {
  const sel = $('f-gate')
  sel.innerHTML = ''
  for (const [id, g] of [['', { ref: '' }], ...Object.entries(manifest.gates)]) {
    const o = new Option('', id)
    o.dataset.ref = g.ref
    o.selected = manifest.stage ? id === manifest.stage.recommended_close_gate : g.ref === 'D'
    sel.append(o)
  }
  renderGateOptions()
}
function renderGateOptions() {
  const s = T()
  for (const o of $('f-gate').options) {
    o.textContent = o.value ? s.gateClosesAt(o.dataset.ref) : s.gateNoClosure
  }
}
buildGateOptions()

let speedValue = 10
for (const b of document.querySelectorAll('#f-speed button')) {
  b.onclick = () => {
    speedValue = +b.dataset.speed
    for (const x of document.querySelectorAll('#f-speed button')) x.classList.toggle('active', x === b)
  }
}
const sliderP = $('f-p')
const showP = () => {
  const val = +sliderP.value, min = +sliderP.min, max = +sliderP.max
  const pct = ((val - min) / (max - min)) * 100
  sliderP.style.setProperty('--pct', `${pct}%`)
  $('o-p').textContent = `${Math.round(val * 100)}%`
}
sliderP.oninput = showP
showP()

let run = null, state = null, truth = null, series = [], guidance = new Map(), logged = new Set(), logs = []
let wsState = 'connecting'
let hoveredZone = null
let hoveredDisplay = null
let layoutBusy = false

const hooks = { state: [], run: [], appearance: [] }

$('b-start').onclick = async () => {
  const drop = $('f-drop').checked
  await post('/api/runs', {
    p_follow: +sliderP.value, speed: speedValue, close_gate: $('f-gate').value || null, approval: $('f-approval').value,
    drop_zones: drop ? ['L2-W-C08', 'L2-W-C10'] : [], drop_from_s: drop ? 200 : 0, drop_to_s: drop ? 320 : 0,
    layout: manifest.layout ?? 'north_end',
  })
}
$('b-stop').onclick = () => run && post(`/api/runs/${run.run_id}/stop`)
$('b-to-ops').onclick = () => setMode('ops')

// ------------------------------------------------------------------ live channel
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
  ws.onopen = () => { wsState = 'open'; setStatus() }
  ws.onclose = () => { wsState = 'offline'; setStatus(); setTimeout(connect, 1500) }
  ws.onmessage = (e) => {
    const { type, data } = JSON.parse(e.data)
    if (type === 'hello') {
      if (data.run) onRun(data.run, true)
      for (const g of data.guidance) onGuidance(g)
      if (data.state) onState(data.state)
    } else if (type === 'run') onRun(data)
    else if (type === 'state') onState(data)
    else if (type === 'guidance') onGuidance(data)
    else if (type === 'facility') {
      pushLog({ t: data.t_s, kind: 'facility', ref: manifest.zones[data.zone_id].gate_ref, status: data.status, by: data.by, cls: data.status })
    } else if (type === 'evaluation') {
      truth = data
      if (series.length) series.at(-1).truth = data.true_max_density
      renderEval()
      if (appMode === 'sim') drawChart()
    }
  }
}

function setStatus() {
  const s = T()
  if (wsState === 'offline') {
    $('status').className = 'off'
    $('status-text').textContent = s.statusOffline
    return
  }
  if (wsState === 'connecting') {
    $('status').className = ''
    $('status-text').textContent = s.statusConnecting
    return
  }
  const live = run?.status === 'running'
  $('status').className = live ? 'live' : ''
  const runStatus = run ? (s.runStatusMap[run.status] ?? run.status) : ''
  if (live) {
    $('status-text').innerHTML = `<span>${esc(s.statusLiveLabel)}</span><span class="run-id">${esc(run.run_id.replace(/^run-/, ''))}</span>`
  } else {
    $('status-text').textContent = run ? s.statusRunEnded(runStatus) : s.statusReady
  }
  $('b-start').disabled = live || layoutBusy
  $('b-stop').disabled = !live
  $('f-layout').disabled = live || layoutBusy
  renderOpsRail()
}

async function onRun(r, resumed = false) {
  const want = r.config?.layout ?? 'north_end'
  if (want !== (manifest.layout ?? 'north_end')) await switchLayout(want, { resetRun: false })
  const fresh = !run || run.run_id !== r.run_id
  run = r
  if (fresh) {
    series = []; guidance = new Map(); logged = new Set(); logs = []; truth = null; state = null
    $('log').innerHTML = ''
    overlay.reset()
    if (resumed) {
      series = (await json(`/api/runs/${r.run_id}/series`)).map((s) => ({ t: s.t_s, now: s.max_density, fc: s.max_forecast_density }))
    } else {
      pushLog({ t: 0, kind: 'start', approval: r.config.approval, cls: '' })
      view.flyTo(...VIEWS.Overview, 1.6)
    }
  }
  if (r.status !== 'running' && r.result && !logged.has(`end:${r.run_id}`)) {
    logged.add(`end:${r.run_id}`)
    pushLog({
      t: r.result.sim_time_s, kind: 'run_end', status: r.status,
      t90_s: r.result.t90_s ?? 0, over: r.result.over_threshold_zone_seconds, cls: '',
    })
  }
  setStatus(); renderPending(true); renderGates(); renderEval(); renderKpis(); renderOpsRail(); renderLog(); drawChart()
  for (const f of hooks.run) f(r, { fresh, resumed })
}

function onState(s) {
  if (!run || s.run_id !== run.run_id) return
  state = window.twinState = s
  overlay.apply(s)
  series.push({ t: s.t_s, now: s.kpis.max_density, fc: s.kpis.max_forecast_density })
  for (const f of hooks.state) f(s)
  renderKpis(); renderOpsRail(); renderGates(); renderEval(); renderPending(); drawChart()
  if (hoveredDisplay) renderDisplayTooltip(hoveredDisplay)
  else if (hoveredZone) renderTooltip(hoveredZone)
}

function onGuidance(g) {
  const before = guidance.get(g.id)
  guidance.set(g.id, g)
  const key = `${g.id}:${g.status}`
  if (!logged.has(key)) {
    logged.add(key)
    const gates = g.messages.map((m) => m.gate_ref).filter((x, i, a) => a.indexOf(x) === i).join(', ')
    pushLog({
      t: g.status === 'proposed' ? g.created_t_s : g.decided_t_s,
      kind: 'guidance',
      status: g.status,
      version: g.version,
      count: g.messages.length,
      gates,
      by: g.status === 'proposed' ? 'M4' : g.decided_by,
      cls: g.status,
    })
  }
  if (g.status === 'proposed' && !before && manifest.zones[g.trigger_zone]) focusZone(g.trigger_zone)
  renderPending()
  renderEval()
}

function formatLogEntry(entry) {
  const s = T()
  const actor = (by) => esc(s.actorMap[by] ?? by ?? '')
  if (entry.kind === 'start') {
    return esc(s.logStart(s.approvalModeLog[entry.approval] ?? entry.approval))
  }
  if (entry.kind === 'run_end') {
    const status = s.runStatusMap[entry.status] ?? entry.status
    return esc(s.logRunEnd({ status, t90: clock(entry.t90_s), over: entry.over, limit: LIMIT }))
  }
  if (entry.kind === 'facility') {
    const status = s.facilityStatusMap[entry.status] ?? entry.status
    return `${esc(s.logFacility({ ref: entry.ref, status }))} <small>${actor(entry.by)}</small>`
  }
  if (entry.kind === 'guidance') {
    const fn = s.logGuidance[entry.status]
    const body = fn ? fn({ version: entry.version, count: entry.count, gates: entry.gates }) : `${entry.status}`
    return `${esc(body)} <small>${actor(entry.by)}</small>`
  }
  return esc(formatApiError(entry.message, lang))
}

function makeLogItem(entry) {
  const li = document.createElement('li')
  li.innerHTML = `<time>${clock(entry.t ?? 0)}</time><span class="${entry.cls}">${formatLogEntry(entry)}</span>`
  return li
}

function updateLogCount() {
  const el = $('log-count')
  if (el) el.textContent = logs.length ? T().logCount(logs.length) : ''
}

function pushLog(entry) {
  logs.unshift(entry)
  const ol = $('log')
  const empty = ol.querySelector('.log-empty')
  if (empty) empty.remove()
  ol.prepend(makeLogItem(entry))
  updateLogCount()
}

function renderLog() {
  const ol = $('log')
  ol.innerHTML = ''
  updateLogCount()
  if (!logs.length) {
    const li = document.createElement('li')
    li.className = 'log-empty'
    li.textContent = T().logEmpty
    ol.append(li)
    return
  }
  for (const entry of logs) ol.append(makeLogItem(entry))
}

// ------------------------------------------------------------------ Unified Top HUD KPIs
function renderKpis() {
  const s = T(), k = state?.kpis
  const cap = manifest.scope.capacity
  const tStr = k ? clock(state.t_s) : '0:00'
  const inside = k ? Math.round(k.people_inside) : cap
  const outPct = k ? Math.round(k.exited_share * 100) : 0
  const peak = k ? k.max_density.toFixed(1) : '0.0'
  const fc = k ? k.max_forecast_density.toFixed(1) : '0.0'
  const over = k ? k.zones_over_now : 0
  const stale = k ? k.stale_zones : 0
  const lat = state?.latency_ms != null ? `${Math.round(state.latency_ms)} ms` : s.na

  const peakCls = k && k.max_density > LIMIT ? 'alert' : ''
  const fcCls = k && k.max_forecast_density > LIMIT ? 'warn' : ''
  const overCls = k ? (over > 0 ? 'alert' : 'ok') : ''
  const healthCls = stale > 0 ? 'warn' : ''
  const camTxt = stale > 0 ? s.kpiCamsStale(stale, monitoredTotal) : s.kpiCamsOk(monitoredTotal)

  $('kpis').innerHTML = `
    <div class="kpi-grp">
      <div class="kpi-prog">
        <span class="kpi-clock">${tStr}</span>
        <div class="kpi-prog-meta">
          <div class="kpi-prog-row"><b>${outPct}% ${esc(s.kpiOut)}</b><span>${fmtNum(inside)} ${esc(s.kpiInside)}</span></div>
          <div class="kpi-prog-bar"><i style="width:${outPct}%"></i></div>
        </div>
      </div>
    </div>
    <div class="kpi-grp">
      <div class="kpi-stat ${peakCls}"><span class="lbl">${esc(s.kpiPeak)}</span><span class="val">${peak}</span></div>
      <div class="kpi-stat ${fcCls}"><span class="lbl">${esc(s.kpiForecast)}</span><span class="val">${fc}</span></div>
      <div class="kpi-stat ${overCls}"><span class="lbl">${esc(s.kpiOver(LIMIT))}</span><span class="val">${over}</span></div>
    </div>
    <div class="kpi-grp">
      <div class="kpi-health ${healthCls}">
        <span class="h-dot"></span><span>${esc(camTxt)}</span><span class="h-sep">·</span><span>${esc(lat)}</span>
      </div>
    </div>
  `
}

// ------------------------------------------------------------------ Operations Left Rail (Feed + Hotspots + Distribution)
function hotspotColor(d, fc) {
  if (d > LIMIT) return 'var(--alert)'
  if (fc > LIMIT) return 'var(--warn)'
  if (d > 1.4) return '#2dd4bf'
  return 'var(--accent)'
}

function renderOpsRail() {
  const s = T()
  const live = run?.status === 'running'
  const feedEl = $('feed-card')
  if (feedEl) {
    feedEl.className = `feed-card${live ? ' live' : ''}`
    if (live) {
      const tag = run.config?.launch ? s.feedLiveProxy(run.config.speed ?? 10) : s.feedLiveExternal
      feedEl.innerHTML = `<div class="feed-top"><span class="feed-title"><i></i>${esc(s.feedLiveTitle)}</span><span class="feed-tag">${esc(tag)}</span></div>`
    } else if (run) {
      const st = s.runStatusMap[run.status] ?? run.status
      feedEl.innerHTML = `<div class="feed-top"><span class="feed-title"><i></i>${esc(s.feedEndedTitle(st))}</span></div>
        <div class="feed-desc">${esc(s.feedEndedDesc)}</div>
        <button type="button" class="feed-cta" data-open-sim="1">${esc(s.btnOpenSim)}</button>`
    } else {
      feedEl.innerHTML = `<div class="feed-top"><span class="feed-title"><i></i>${esc(s.feedIdleTitle)}</span></div>
        <div class="feed-desc">${esc(s.feedIdleDesc)}</div>
        <button type="button" class="feed-cta" data-open-sim="1">${esc(s.btnOpenSim)}</button>`
    }
  }

  // Hotspots Top 5
  const hsEl = $('hotspots')
  if (hsEl) {
    if (!state) {
      hsEl.innerHTML = `<div class="hs-empty">${esc(s.hotspotsIdle)}</div>`
    } else {
      const ranked = Object.entries(state.zones)
        .filter(([id]) => WALKING_TYPES.has(manifest.zones[id]?.type))
        .map(([id, z]) => ({ id, d: z.density, fc: z.forecast_density, score: Math.max(z.density, z.forecast_density) }))
        .filter((x) => x.score >= 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
      if (!ranked.length) {
        hsEl.innerHTML = `<div class="hs-empty">${esc(s.hotspotsNone)}</div>`
      } else {
        hsEl.innerHTML = ranked.map((x) => {
          const pct = Math.min(100, (x.score / 4.0) * 100)
          const cls = x.d > LIMIT ? 'alert' : x.fc > LIMIT ? 'warn' : ''
          const sel = p2.zone === x.id ? ' selected' : ''
          return `<button type="button" class="hs-row${sel}" data-zone="${esc(x.id)}">
            <span class="hs-id">${esc(short(x.id))}</span>
            <span class="hs-bar"><i style="width:${pct}%;background:${hotspotColor(x.d, x.fc)}"></i></span>
            <span class="hs-val ${cls}"><b>${x.d.toFixed(1)}</b> → ${x.fc.toFixed(1)}</span>
          </button>`
        }).join('')
      }
    }
  }

  // Crowd Spatial Distribution (Stands / Floor / Concourse+Tunnels)
  let nSeat = 0, nFloor = 0, nWalk = 0
  if (state) {
    for (const [id, z] of Object.entries(state.zones)) {
      const tp = manifest.zones[id]?.type
      if (tp === 'seating') nSeat += z.count
      else if (tp === 'floor') nFloor += z.count
      else nWalk += z.count
    }
  } else {
    for (const z of Object.values(manifest.zones)) {
      if (z.type === 'seating') nSeat += z.capacity ?? 0
      else if (z.type === 'floor') nFloor += z.capacity ?? 0
    }
  }
  const tot = Math.max(1, nSeat + nFloor + nWalk)
  const pSeat = (nSeat / tot) * 100, pFloor = (nFloor / tot) * 100, pWalk = (nWalk / tot) * 100
  $('dist-total').textContent = fmtNum(Math.round(nSeat + nFloor + nWalk))
  $('crowd-dist').innerHTML = `
    <div class="dist-bar">
      <i class="d-seat" style="width:${pSeat.toFixed(1)}%"></i>
      <i class="d-floor" style="width:${pFloor.toFixed(1)}%"></i>
      <i class="d-walk" style="width:${pWalk.toFixed(1)}%"></i>
    </div>
    <div class="dist-legend">
      <div class="dist-item d-seat"><span>${esc(s.distSeating)}</span><b>${fmtNum(Math.round(nSeat))}</b></div>
      <div class="dist-item d-floor"><span>${esc(s.distFloor)}</span><b>${fmtNum(Math.round(nFloor))}</b></div>
      <div class="dist-item d-walk"><span>${esc(s.distWalking)}</span><b>${fmtNum(Math.round(nWalk))}</b></div>
    </div>
  `
}

$('feed-card').addEventListener('click', (e) => {
  if (e.target.closest('[data-open-sim]')) setMode('sim')
})

$('hotspots').addEventListener('click', (e) => {
  const row = e.target.closest('button.hs-row[data-zone]')
  if (!row) return
  const id = row.dataset.zone
  focusZone(id)
  p2Select(id)
  renderOpsRail()
})

// ------------------------------------------------------------------ Gates (P1 controls + live flow rate)
function renderGates() {
  const s = T()
  if (!state) {
    $('gates').innerHTML = Object.entries(manifest.gates).map(([id, g]) =>
      `<div class="g idle"><b>${esc(s.gateLabel(g.ref))}</b><div class="bar"><i style="width:0%"></i></div><span class="g-rate">—</span><span class="g-tot">—</span><button type="button" class="gate-btn close" data-gate="${esc(id)}" data-next="closed" disabled title="${esc(s.gateRunOnlyTip)}">${esc(s.gateBtnClose)}</button></div>`
    ).join('')
    return
  }
  const live = run?.status === 'running'
  const maxArr = Math.max(1, ...Object.values(state.gate_arrivals))
  const openCount = countEffectiveOpenGates(state.facilities)
  $('gates').innerHTML = Object.entries(manifest.gates).map(([id, g]) => {
    const n = state.gate_arrivals[id] ?? 0
    const closed = state.facilities[id] === 'closed'
    const lid = gateLineId[id]
    const rate = closed ? 0 : Math.max(0, state.flows?.[lid] ?? 0)
    const util = Math.min(1, rate / gateCapacityPps)
    const barPct = closed ? 100 : (live ? Math.round(util * 100) : Math.round((n / maxArr) * 100))
    const rowCls = closed ? 'closed' : util >= 0.92 ? 'full' : util >= 0.7 ? 'busy' : ''
    const pending = gateInFlight.has(id)
    const lastOpen = !closed && openCount <= 1
    const disabled = !live || pending || lastOpen
    const tip = !live ? s.gateRunOnlyTip : lastOpen ? s.gateLastOpenTip : ''
    const cls = closed ? 'reopen' : 'close'
    const label = closed ? s.gateBtnReopen : s.gateBtnClose
    const next = closed ? 'open' : 'closed'
    const rateText = closed ? '0.0/s' : s.gateRate(rate)
    return `<div class="g ${rowCls}"><b>${esc(s.gateLabel(g.ref))}</b><div class="bar"><i style="width:${barPct}%"></i></div><span class="g-rate">${esc(rateText)}</span><span class="g-tot">${closed ? esc(s.gateClosedState) : fmtNum(Math.round(n))}</span><button type="button" class="gate-btn ${cls}" data-gate="${esc(id)}" data-next="${next}"${disabled ? ' disabled' : ''}${tip ? ` title="${esc(tip)}"` : ''}>${esc(label)}</button></div>`
  }).join('')
}

// ------------------------------------------------------------------ Guidance Pending Card (P3 preview + scrollable table)
function renderPending(force = false) {
  const s = T()
  const g = [...guidance.values()].find((x) => x.status === 'proposed' && x.id === state?.pending_guidance)
  const box = $('pending')
  if (!g) {
    if (force || box.dataset.id !== '') {
      box.dataset.id = ''
      box.innerHTML = `<div class="empty">${esc(run?.config.approval === 'none' ? s.guidanceOff : s.guidanceEmpty)}</div>`
    }
    clearProposalPreview()
    return
  }
  const left = Math.max(0, 1 - (state.t_s - g.created_t_s) / 120)
  if (!force && box.dataset.id === g.id) {
    const bar = box.querySelector('.ttl i')
    if (bar) bar.style.width = `${left * 100}%`
    return
  }
  const unchecked = box.dataset.id === g.id
    ? new Set([...box.querySelectorAll('input[data-display]:not(:checked)')].map((i) => i.dataset.display))
    : new Set()
  box.dataset.id = g.id
  const { why, plan } = formatProposalReason(g.reason, lang)
  const rows = g.messages.map((m) => {
    const d = manifest.displays[m.display_id], zonesServed = d.serves.map(short).join(', ')
    const people = g.assignments.filter((a) => d.serves.includes(a.zone_id) && a.to_gate === m.gate_id).reduce((acc, a) => acc + a.people, 0)
    const from = g.assignments.find((a) => d.serves.includes(a.zone_id))?.from_gate
    const checkedAttr = unchecked.has(m.display_id) ? '' : 'checked'
    return `<tr class="${checkedAttr ? '' : 'dropped'}"><td class="drop"><input type="checkbox" ${checkedAttr} data-display="${esc(m.display_id)}" data-gate-ref="${esc(m.gate_ref)}" data-zones="${d.serves.join(',')}" title="${esc(s.untickTip)}" /></td>
      <td>${short(m.display_id)} <small>${zonesServed}</small></td>
      <td><span class="gate">${manifest.zones[from]?.gate_ref ?? '?'}</span> → <span class="gate to">${m.gate_ref}</span></td><td>${people}</td></tr>`
  }).join('')
  box.innerHTML = `<div class="card proposed"><div class="why">${esc(why)}</div><div class="sub">${esc(plan ?? '')}</div>
    <div class="preview-pill" id="preview-pill"></div>
    <div class="ttl"><i style="width:${left * 100}%"></i></div>
    <div class="card-table-wrap"><table>${rows}</table></div>
    <div class="row"><button class="approve">${esc(s.btnApprove)}</button><button class="reject">${esc(s.btnReject)}</button><button class="show">${esc(s.btnShow)}</button></div></div>`
  const decide = (action) => {
    const drop = [...box.querySelectorAll('input:not(:checked)')].flatMap((i) => i.dataset.zones.split(','))
    post(`/api/guidance/${g.id}/decision`, { action, by: 'duty manager', drop_zones: drop })
      .catch((e) => pushLog({ t: state.t_s, kind: 'error', message: e.message, cls: 'rejected' }))
  }
  box.querySelector('.approve').onclick = () => decide('approve')
  box.querySelector('.reject').onclick = () => decide('reject')
  box.querySelector('.show').onclick = () => manifest.zones[g.trigger_zone] && focusZone(g.trigger_zone)
  syncProposalPreview()
}

// ------------------------------------------------------------------ Bottom-Right Panel: Ops Loop vs Sim Eval
function baselineDiffBadge(r, key) {
  const b = p2.baseRun?.result
  if (!r?.completed || r[key] == null || b?.[key] == null || run?.config.approval === 'none') return ''
  const d = r[key] - b[key], sign = d > 0 ? '+' : d < 0 ? '−' : ''
  const value = key === 't90_s' ? clock(Math.abs(d)) : fmtNum(Math.abs(d))
  const pct = b[key] ? ` (${sign}${Math.abs(Math.round((100 * d) / b[key]))}%)` : ''
  const cls = d < 0 ? 'p2-better' : d > 0 ? 'p2-worse' : ''
  return `<span class="mt-sub ${cls}">${sign}${value}${pct}</span>`
}

function renderEval() {
  const s = T(), r = run?.result
  const totalDisplays = Object.keys(manifest.displays).length
  const activeSigns = state?.redirected?.length ?? 0
  const stale = state?.kpis?.stale_zones ?? 0
  const onlineCams = monitoredTotal - stale
  const approvedPlans = [...guidance.values()].filter((g) => g.status === 'approved').length

  if (appMode === 'ops') {
    const comp = state?.compliance
    const compPct = comp != null ? Math.round(comp * 100) : null
    const meterHtml = `
      <div class="meter-box">
        <div class="meter-top">
          <span class="meter-lbl">${esc(s.opsCompLabel)}</span>
          <span class="meter-val">${compPct != null ? `${compPct}%` : '—'}</span>
        </div>
        <div class="meter-track"><i style="width:${compPct ?? 0}%"></i></div>
        <div class="meter-sub">${esc(compPct != null ? s.opsCompSub : s.opsCompWait)}</div>
      </div>`

    if (r) {
      $('eval').innerHTML = `${meterHtml}
        <div class="mini-grid">
          <div class="mini-tile">
            <span class="mt-lbl">${esc(s.opsOutcomeT90)}</span>
            <span class="mt-val">${clock(r.t90_s ?? 0)}</span>
            ${baselineDiffBadge(r, 't90_s')}
          </div>
          <div class="mini-tile">
            <span class="mt-lbl">${esc(s.opsOutcomeOver(LIMIT))}</span>
            <span class="mt-val">${fmtNum(r.over_threshold_zone_seconds ?? 0)}</span>
            ${baselineDiffBadge(r, 'over_threshold_zone_seconds')}
          </div>
        </div>`
      return
    }

    $('eval').innerHTML = `${meterHtml}
      <div class="mini-grid cols-3">
        <div class="mini-tile ${activeSigns > 0 ? 'ok' : ''}">
          <span class="mt-lbl">${esc(s.opsSigns)}</span>
          <span class="mt-val">${activeSigns}<small>/${totalDisplays}</small></span>
        </div>
        <div class="mini-tile ${stale > 0 ? 'warn' : 'ok'}">
          <span class="mt-lbl">${esc(s.opsSensors)}</span>
          <span class="mt-val">${onlineCams}<small>/${monitoredTotal}</small></span>
        </div>
        <div class="mini-tile">
          <span class="mt-lbl">${esc(s.opsApproved)}</span>
          <span class="mt-val">${approvedPlans}</span>
        </div>
      </div>`
    return
  }

  // Simulation / Evaluation mode: structured accuracy meter + ground-truth breakdown (never 1 sparse line!)
  const maxErr = r?.density_max_error ?? truth?.max_abs_error ?? null
  const errPct = maxErr != null ? Math.min(100, (maxErr / 0.75) * 100) : 0
  const pass = maxErr != null && maxErr <= ERROR_TARGET
  const pillCls = maxErr == null ? 'wait' : pass ? 'pass' : 'fail'
  const pillTxt = maxErr == null ? s.evalAwait : pass ? s.evalPass : s.evalFail
  const errMeter = `
    <div class="meter-box">
      <div class="meter-top">
        <span class="meter-lbl">${esc(s.evalMeterLabel)}</span>
        <span class="meter-val">${maxErr != null ? maxErr.toFixed(2) : '—'}<span class="pill ${pillCls}">${esc(pillTxt)}</span></span>
      </div>
      <div class="meter-track"><i class="${pillCls}" style="width:${errPct}%"></i><span class="ref-line" style="left:66.7%" title="${esc(s.evalTargetPill)}"></span></div>
    </div>`

  if (r) {
    const estC = state?.compliance != null ? `${Math.round(state.compliance * 100)}%` : '—'
    const trueC = r.true_compliance != null ? `${Math.round(r.true_compliance * 100)}%` : '—'
    $('eval').innerHTML = `${errMeter}
      <div class="mini-grid">
        <div class="mini-tile">
          <span class="mt-lbl">${esc(s.evalT90)}</span>
          <span class="mt-val">${clock(r.t90_s ?? 0)}</span>
          ${baselineDiffBadge(r, 't90_s')}
        </div>
        <div class="mini-tile">
          <span class="mt-lbl">${esc(s.evalOverLim(LIMIT))}</span>
          <span class="mt-val">${fmtNum(r.over_threshold_zone_seconds ?? 0)}</span>
          ${baselineDiffBadge(r, 'over_threshold_zone_seconds')}
        </div>
      </div>
      <dl class="eval-rows">
        <dt>${esc(s.evalRunErr)}</dt><dd>${r.density_mae.toFixed(3)} / ${r.density_max_error.toFixed(2)}</dd>
        <dt>${esc(s.evalCompEst)}</dt><dd>${estC} / ${trueC}</dd>
      </dl>`
    return
  }

  const errTxt = truth ? `${truth.mean_abs_error.toFixed(2)} / ${truth.max_abs_error.toFixed(2)}` : '— / —'
  const blind = truth ? Object.entries(truth.blind).sort((a, b) => b[1].true - a[1].true)[0] : null
  const blindLbl = blind ? s.evalNoCam(short(blind[0])) : s.evalNoCamIdle
  const blindVal = blind ? `${blind[1].estimated.toFixed(2)} / ${blind[1].true.toFixed(2)}` : '— / —'
  const compEst = state?.compliance != null ? `${Math.round(state.compliance * 100)}%` : '—'
  const compTrue = run?.config?.approval === 'none' ? '—' : run?.config?.p_follow != null ? `${Math.round(run.config.p_follow * 100)}%` : '—'

  $('eval').innerHTML = `${errMeter}
    <dl class="eval-rows">
      <dt>${esc(s.evalErrNow)}</dt><dd>${errTxt}</dd>
      <dt>${esc(blindLbl)}</dt><dd>${blindVal}</dd>
      <dt>${esc(s.evalCompEst)}</dt><dd>${compEst} / ${compTrue}</dd>
    </dl>`
}

// ------------------------------------------------------------------ Main Chart (P2 modes + mode-aware truth line + sleek area gradient)
function drawChart() {
  const c = $('chart'), dpr = Math.min(window.devicePixelRatio, 2), w = c.clientWidth, h = c.clientHeight
  if (!w || !h) return
  if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr }
  const g = c.getContext('2d')
  const pal = CHART_THEMES[theme]
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)

  const mode = p2Mode(), zone = p2.zone
  const now = mode === 'over' ? (p) => p.over : mode === 'zone' ? (p) => p.z?.[zone]?.[0] : (p) => p.now
  const fc = mode === 'over' ? (p) => p.overFc : mode === 'zone' ? (p) => p.z?.[zone]?.[1] : (p) => p.fc
  const baseRows = p2.showBase && mode !== 'zone' ? p2.baseRows : []
  const L = 26, B = 16, Tpad = 4, R = 6, tMax = Math.max(600, (series.at(-1)?.t ?? 0) * 1.05)
  let yMax = 4.4, ticks = [0, 1, 2, 3, 4]
  if (mode === 'over') {
    let top = 4
    for (const p of series) top = Math.max(top, now(p) ?? 0, fc(p) ?? 0)
    for (const p of baseRows) if (p.t <= tMax) top = Math.max(top, now(p) ?? 0)
    const k = Math.ceil(top / 4)
    ticks = [0, k, 2 * k, 3 * k, 4 * k]
    yMax = 4.4 * k
  }
  const X = (t) => L + ((w - L - R) * t) / tMax, Y = (v) => Tpad + (h - Tpad - B) * (1 - Math.min(v, yMax) / yMax)
  g.font = '10px system-ui'; g.fillStyle = pal.axis; g.strokeStyle = pal.grid; g.lineWidth = 1; g.setLineDash([])
  for (const v of ticks) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke(); g.fillText(v, 7, Y(v) + 3) }
  const step = tMax > 1500 ? 300 : 120
  for (let t = 0; t <= tMax; t += step) {
    const label = clock(t)
    g.fillText(label, Math.min(X(t) - 8, w - 1 - g.measureText(label).width), h - 3)
  }
  if (mode !== 'over') {
    g.strokeStyle = pal.limit; g.lineWidth = 1.1; g.setLineDash([4, 3])
    g.beginPath(); g.moveTo(L, Y(LIMIT)); g.lineTo(w - R, Y(LIMIT)); g.stroke()
    g.setLineDash([])
  }
  const mark = (t, colour) => { g.strokeStyle = colour; g.setLineDash([2, 3]); g.lineWidth = 1.1; g.beginPath(); g.moveTo(X(t), Tpad); g.lineTo(X(t), h - B); g.stroke(); g.setLineDash([]) }
  if (run?.config.close_gate && (series.at(-1)?.t ?? 0) >= run.config.close_at_s) mark(run.config.close_at_s, pal.closed)
  for (const x of guidance.values()) if (x.status === 'approved') mark(x.decided_t_s, pal.approved)

  const path = (rows, get, colour, dash, shift = 0, fill = false) => {
    g.strokeStyle = colour; g.setLineDash(dash); g.lineWidth = 1.75; g.beginPath()
    let started = false, firstX = 0, lastX = 0
    for (const p of rows) {
      const v = get(p)
      if (v == null) continue
      if (rows === baseRows && p.t > tMax) break
      const x = X(p.t + shift), y = Y(v)
      if (!started) { g.moveTo(x, y); firstX = x; started = true }
      else g.lineTo(x, y)
      lastX = x
    }
    if (!started) { g.setLineDash([]); return }
    g.stroke(); g.setLineDash([])
    if (fill) {
      g.lineTo(lastX, Y(0))
      g.lineTo(firstX, Y(0))
      g.closePath()
      const grad = g.createLinearGradient(0, Tpad, 0, h - B)
      grad.addColorStop(0, pal.nowFillTop)
      grad.addColorStop(1, pal.nowFillBot)
      g.fillStyle = grad
      g.fill()
    }
  }
  const note = (text, y) => {
    g.save()
    g.font = '11px Inter, "PingFang SC", system-ui, sans-serif'
    g.fillStyle = pal.axis
    g.globalAlpha = 0.78
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, L + (w - L - R) / 2, y)
    g.restore()
  }
  if (!series.length) { note(T().chartEmpty, (Y(LIMIT) + Y(0)) / 2); return }
  if (mode === 'zone') {
    const first = series.find((p) => p.z)
    if (!first) { note(T().chartZoneResumed(clock(series.at(-1).t)), (Y(LIMIT) + Y(0)) / 2); return }
    if (first !== series[0]) note(T().chartZoneResumed(clock(first.t)), Tpad + 9)
  }
  if (baseRows.length) path(baseRows, now, P2_BASE[theme], [6, 4])
  path(series, fc, pal.fc, [5, 4], manifest.constants.forecast_horizon_s)
  path(series, now, pal.now, [], 0, true)
  if (mode === 'peak' && appMode === 'sim') path(series, (p) => p.truth, pal.truth, [1.5, 4])
}

// ------------------------------------------------------------------ hover (3D Sign preview & Zone telemetry)
const tip = $('tip')
function renderTooltip(id) {
  const tr = T(), z = manifest.zones[id], s = state?.zones[id]
  const zType = tr.zoneTypes[z.type] ?? z.type
  const sep = lang === 'zh' ? '，' : ', '
  let html = `<b>${id}</b><span class="tip-tag">${esc(zType)}</span><br>${z.area_m2} m²${z.capacity ? `${sep}${esc(tr.tipSeats(z.capacity))}` : ''}${z.closed_for_concert ? `${sep}${esc(tr.tipNotSold)}` : ''}`
  if (s) {
    html += `<br>${esc(tr.tipPeopleDensity(Math.round(s.count), s.density.toFixed(2)))}<br>${esc(tr.tipForecast(s.forecast_density.toFixed(2)))}<br>`
    html += s.stale
      ? `<span class="stale">${esc(tr.tipStale(s.age_s.toFixed(0)))}</span>`
      : esc(z.monitored ? tr.tipMeasured : tr.tipEstimatedLines)
  } else html += `<br>${esc(z.monitored ? tr.tipHasCam : tr.tipNoCam)}`
  tip.innerHTML = html
}

function renderDisplayTooltip(id) {
  const tr = T(), d = manifest.displays[id]
  if (!d) return
  const serves = d.serves.map(short).join(', ')
  let bannerCls = 'idle', bannerTxt = tr.tipSignIdle
  const isRedir = state?.redirected?.includes(id)
  const gateId = state?.displays?.[id]
  const gateRef = gateId ? manifest.gates[gateId]?.ref : null
  const pendingInput = document.querySelector(`#pending input[data-display="${id}"]:checked`)
  if (isRedir && gateRef) {
    const wrong = state?.facilities?.[gateId] === 'closed'
    bannerCls = wrong ? 'wrong' : 'approved'
    bannerTxt = wrong ? tr.tipSignWrong(gateRef) : tr.tipSignApproved(gateRef)
  } else if (pendingInput?.dataset.gateRef) {
    bannerCls = 'preview'
    bannerTxt = tr.tipSignPreview(pendingInput.dataset.gateRef)
  } else if (gateRef) {
    bannerTxt = tr.tipSignDefault(gateRef)
  }
  tip.innerHTML = `<b>${esc(short(id))}</b><span class="tip-tag">${esc(tr.tipSignTag)}</span><br>${esc(tr.tipSignServes(serves))}<div class="sign-banner ${bannerCls}">${esc(bannerTxt)}</div>`
}

$('scene').addEventListener('pointermove', (e) => {
  const dispId = overlay.pickDisplay(e.clientX, e.clientY)
  if (dispId) {
    hoveredDisplay = dispId
    hoveredZone = null
    renderDisplayTooltip(dispId)
    tip.style.display = 'block'
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 270)}px`
    tip.style.top = `${e.clientY + 14}px`
    return
  }
  hoveredDisplay = null
  const id = overlay.pick(e.clientX, e.clientY)
  hoveredZone = id
  if (!id) { tip.style.display = 'none'; return }
  renderTooltip(id)
  tip.style.display = 'block'
  tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 270)}px`
  tip.style.top = `${e.clientY + 14}px`
})

// ------------------------------------------------------------------ floating info popovers
const popover = $('popover')
let activeTipTarget = null

function positionPopover(target) {
  const text = T()[target.dataset.tipKey]
  if (!text) return
  popover.textContent = text
  popover.classList.add('open')
  const r = target.getBoundingClientRect()
  const pw = popover.offsetWidth, ph = popover.offsetHeight, pad = 10
  let left, top
  if (target.dataset.tipPos === 'top') {
    left = r.left + (r.width - pw) / 2
    top = r.top - ph - 8
    if (top < pad) top = r.bottom + 8
  } else {
    left = r.right + 8
    top = r.top + (r.height - ph) / 2
    if (left + pw > window.innerWidth - pad) {
      left = r.left + (r.width - pw) / 2
      top = r.top - ph - 8
      if (top < pad) top = r.bottom + 8
    }
  }
  left = Math.max(pad, Math.min(left, window.innerWidth - pw - pad))
  top = Math.max(pad, Math.min(top, window.innerHeight - ph - pad))
  popover.style.left = `${Math.round(left)}px`
  popover.style.top = `${Math.round(top)}px`
}

function hidePopover() {
  activeTipTarget = null
  popover.classList.remove('open')
}

document.addEventListener('pointerover', (e) => {
  const target = e.target.closest('[data-tip-key]')
  if (target) { activeTipTarget = target; positionPopover(target) }
})
document.addEventListener('pointerout', (e) => {
  if (!activeTipTarget) return
  const next = e.relatedTarget?.closest?.('[data-tip-key]')
  if (next !== activeTipTarget) hidePopover()
})
document.addEventListener('focusin', (e) => {
  const target = e.target.closest?.('[data-tip-key]')
  if (target) { activeTipTarget = target; positionPopover(target) }
})
document.addEventListener('focusout', (e) => {
  if (activeTipTarget && e.target.closest?.('[data-tip-key]') === activeTipTarget) hidePopover()
})

// ------------------------------------------------------------------ mode, language & theme switches
function setMode(next) {
  const target = next === 'sim' ? 'sim' : 'ops'
  if (target === appMode) return
  appMode = target
  saveMode(appMode)
  applyModeChrome()
  renderOpsRail()
  renderEval()
  p2Render()
  drawChart()
}

function setLang(next) {
  const target = next === 'zh' ? 'zh' : 'en'
  if (target === lang) return
  lang = target
  saveLang(lang)
  applyStaticI18n()
  renderScope()
  renderGateOptions()
  for (const b of $('views').querySelectorAll('button')) {
    b.textContent = T().views[b.dataset.view] ?? b.dataset.view
  }
  overlay.setAppearance({ lang })
  setStatus()
  renderKpis()
  renderOpsRail()
  renderGates()
  renderPending(true)
  renderEval()
  renderLog()
  drawChart()
  if (hoveredDisplay) renderDisplayTooltip(hoveredDisplay)
  else if (hoveredZone) renderTooltip(hoveredZone)
  for (const f of hooks.appearance) f({ lang, theme })
}

function setTheme(next) {
  const target = next === 'light' ? 'light' : 'dark'
  if (target === theme) return
  theme = target
  saveTheme(theme)
  applyThemeChrome()
  view.setTheme(theme)
  overlay.setAppearance({ theme })
  drawChart()
  for (const f of hooks.appearance) f({ lang, theme })
}

for (const b of document.querySelectorAll('#mode-switch button')) {
  b.onclick = () => setMode(b.dataset.mode)
}
for (const b of document.querySelectorAll('#lang-switch button')) {
  b.onclick = () => setLang(b.dataset.lang)
}
for (const b of document.querySelectorAll('#theme-switch button')) {
  b.onclick = () => setTheme(b.dataset.theme)
}

// ------------------------------------------------------------------ P1 gate controls
const gateInFlight = new Map()

function countEffectiveOpenGates(facilities) {
  let count = 0
  for (const id of Object.keys(manifest.gates)) {
    const isClosed = facilities?.[id] === 'closed' || gateInFlight.get(id)?.target === 'closed'
    if (!isClosed) count += 1
  }
  return count
}

hooks.state.push((s) => {
  for (const [id, entry] of gateInFlight) {
    if (s.facilities[id] === entry.target) {
      gateInFlight.delete(id)
    } else if (entry.resolved) {
      entry.statesSeen += 1
      if (entry.statesSeen >= 2) gateInFlight.delete(id)
    }
  }
})

hooks.run.push((r, { fresh }) => {
  if ((fresh || r.status !== 'running') && gateInFlight.size) {
    gateInFlight.clear()
    renderGates()
  }
})

$('gates').addEventListener('click', async (e) => {
  const btn = e.target.closest('button.gate-btn[data-gate]')
  if (!btn || btn.disabled) return
  if (run?.status !== 'running' || !state) return
  const id = btn.dataset.gate
  const nextStatus = btn.dataset.next
  if (nextStatus !== 'closed' && nextStatus !== 'open') return
  if (gateInFlight.has(id)) return
  if (nextStatus === 'closed' && countEffectiveOpenGates(state.facilities) <= 1) return

  const runId = run.run_id
  const entry = { target: nextStatus, resolved: false, statesSeen: 0 }
  gateInFlight.set(id, entry)
  renderGates()
  try {
    await json(`/api/facilities/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, by: 'duty manager' }),
    })
    if (gateInFlight.get(id) === entry) {
      if (run?.run_id !== runId || run?.status !== 'running' || state?.facilities?.[id] === nextStatus) {
        gateInFlight.delete(id)
        renderGates()
      } else {
        entry.resolved = true
      }
    }
  } catch (err) {
    if (gateInFlight.get(id) === entry) gateInFlight.delete(id)
    pushLog({ t: state?.t_s ?? 0, kind: 'error', message: err.message, cls: 'rejected' })
    renderGates()
  }
})

// ------------------------------------------------------------------ P2 chart, zone inspector and baseline
const P2_BASE = { dark: '#8a9bb3', light: '#7b8ba3' }
const p2 = { mode: 'peak', zone: null, baseRun: null, baseRows: [], showBase: true, req: 0 }
const p2Mode = () => (p2.mode === 'zone' && !p2.zone ? 'peak' : p2.mode)
const p2KeyBase = Object.assign(document.createElement('span'), { className: 'k base', hidden: true })
document.querySelector('.panel.chart .key').append(p2KeyBase)

function p2Select(id) {
  p2.zone = id
  overlay.setSelected(id)
  if (id) p2.mode = 'zone'
  else if (p2.mode === 'zone') p2.mode = 'peak'
  p2Render()
  renderOpsRail()
}

function p2Render() {
  const s = T(), mode = p2Mode(), hasBase = p2.baseRows.length > 0
  const group = $('p2-mode')
  group.setAttribute('aria-label', s.chartModeAria)
  for (const b of group.querySelectorAll('button')) {
    const m = b.dataset.mode
    b.textContent = m === 'peak' ? s.chartModePeak : m === 'over' ? s.chartModeOver(LIMIT) : s.chartModeZone
    b.classList.toggle('active', m === mode)
    b.setAttribute('aria-pressed', String(m === mode))
  }
  const zoneButton = group.querySelector('[data-mode="zone"]')
  zoneButton.disabled = !p2.zone
  zoneButton.title = p2.zone ? '' : s.chartZoneHint
  const wrap = $('p2-base-wrap'), box = $('p2-base')
  wrap.classList.toggle('off', !hasBase)
  wrap.title = s.baselineTip
  box.disabled = !hasBase
  box.checked = hasBase && p2.showBase
  $('p2-base-label').textContent = hasBase ? s.baselineLabel : s.baselineNone
  const head = document.querySelector('.panel.chart .sec-head h2')
  head.querySelector('[data-i18n="chartTitle"]').textContent =
    mode === 'over' ? s.chartTitleOver(LIMIT) : mode === 'zone' ? s.chartTitleZone(short(p2.zone)) : s.chartTitle
  head.querySelector('[data-i18n="chartSub"]').textContent = mode === 'over' ? s.chartSubOver : s.chartSub
  const key = document.querySelector('.panel.chart .key')
  key.querySelector('.k.truth').hidden = mode !== 'peak' || appMode !== 'sim'
  key.querySelector('.k.lim').hidden = mode === 'over'
  p2KeyBase.hidden = !(hasBase && p2.showBase && mode !== 'zone')
  p2KeyBase.textContent = s.keyBase
  p2RenderZone()
  drawChart()
}

function p2RenderZone() {
  const chip = $('p2-zone')
  chip.hidden = !p2.zone
  if (!p2.zone) return
  const s = T(), z = manifest.zones[p2.zone], now = state?.zones[p2.zone]
  $('p2-zone-id').textContent = short(p2.zone)
  $('p2-zone-basis').textContent = now?.stale ? s.zoneStale : z.monitored ? s.tipHasCam : s.tipNoCam
  $('p2-zone-clear').title = s.zoneClear
  $('p2-zone-clear').setAttribute('aria-label', s.zoneClear)
}

function p2Scenario(c) {
  const drop = [...(c.drop_zones ?? [])].sort()
  return JSON.stringify([c.seed ?? 1, c.close_gate ?? null, c.close_at_s ?? 120, c.layout ?? 'north_end', drop,
    drop.length ? [c.drop_from_s, c.drop_to_s] : null])
}

async function p2LoadBaseline(r) {
  const req = ++p2.req
  p2.baseRun = null
  p2.baseRows = []
  p2Render()
  if (r.config.approval === 'none') return
  try {
    const want = p2Scenario(r.config)
    const base = (await json('/api/runs?limit=100')).find((x) => x.run_id !== r.run_id && x.status === 'completed' && x.result
      && x.config?.approval === 'none' && p2Scenario(x.config) === want)
    if (!base) return
    const rows = await json(`/api/runs/${base.run_id}/series`)
    if (req !== p2.req) return
    p2.baseRun = base
    p2.baseRows = rows.map((x) => ({ t: x.t_s, now: x.max_density, over: x.zones_over_now }))
  } catch {
    return
  }
  p2Render()
  renderEval()
}

$('p2-mode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]')
  if (!b || b.disabled) return
  p2.mode = b.dataset.mode
  p2Render()
})
$('p2-base').addEventListener('change', (e) => { p2.showBase = e.target.checked; p2Render() })
$('p2-zone-clear').addEventListener('click', () => p2Select(null))
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && p2.zone) p2Select(null) })

const p2Press = { x: 0, y: 0, down: false }
$('scene').addEventListener('pointerdown', (e) => { if (e.button === 0) Object.assign(p2Press, { x: e.clientX, y: e.clientY, down: true }) })
$('scene').addEventListener('pointerup', (e) => {
  if (!p2Press.down || e.button !== 0) return
  p2Press.down = false
  if (Math.hypot(e.clientX - p2Press.x, e.clientY - p2Press.y) >= 5) return
  const id = overlay.pick(e.clientX, e.clientY)
  p2Select(id && id !== p2.zone ? id : null)
})

hooks.state.push((s) => {
  const row = series.at(-1)
  row.over = s.kpis.zones_over_now
  row.overFc = s.kpis.zones_over_forecast
  row.z = {}
  for (const [id, v] of Object.entries(s.zones)) row.z[id] = [v.density, v.forecast_density]
  if (p2.zone) p2RenderZone()
})
hooks.run.push(async (r, { fresh, resumed }) => {
  if (fresh && resumed) {
    try {
      const over = new Map((await json(`/api/runs/${r.run_id}/series`)).map((x) => [x.t_s, x.zones_over_now]))
      for (const p of series) if (p.over == null && over.has(p.t)) p.over = over.get(p.t)
    } catch {}
  }
  if (fresh) p2LoadBaseline(r)
  else p2Render()
})
hooks.appearance.push(() => p2Render())
p2Render()

// ------------------------------------------------------------------ P3 proposal preview
function syncProposalPreview() {
  const box = $('pending')
  const inputs = [...box.querySelectorAll('input[data-display]')]
  if (!inputs.length) {
    clearProposalPreview()
    return
  }
  const ids = []
  const targets = {}
  for (const input of inputs) {
    const tr = input.closest('tr')
    if (tr) tr.classList.toggle('dropped', !input.checked)
    if (input.checked) {
      ids.push(input.dataset.display)
      if (input.dataset.gateRef) targets[input.dataset.display] = input.dataset.gateRef
    }
  }
  overlay.setPreview(ids, targets)
  const pill = $('preview-pill')
  if (pill) {
    const s = T()
    pill.textContent = ids.length ? s.previewActive(ids.length, inputs.length) : s.previewNone
    pill.classList.toggle('off', ids.length === 0)
  }
}

function clearProposalPreview() {
  overlay.setPreview([])
}

$('pending').addEventListener('change', (e) => {
  if (e.target.matches('input[data-display]')) syncProposalPreview()
})

hooks.run.push((r, { fresh, resumed }) => {
  if (r.status !== 'running' || (fresh && !resumed)) clearProposalPreview()
  else syncProposalPreview()
})

// ------------------------------------------------------------------ stage layout (M1 presets, E2)
let layouts = []
try { layouts = await json('/api/layouts') } catch { layouts = [] }
$('layout-field').hidden = layouts.length < 2

function renderLayoutOptions() {
  const s = T(), sel = $('f-layout')
  sel.innerHTML = layouts.map((x) => `<option value="${esc(x.preset_id)}">${esc(lang === 'zh' ? x.label_zh : x.label_en)}</option>`).join('')
  sel.value = manifest.layout ?? 'north_end'
  $('layout-field').title = s.layoutTip
}

async function switchLayout(id, { resetRun = true } = {}) {
  if (!id || id === (manifest.layout ?? 'north_end') || layoutBusy) return
  layoutBusy = true
  setStatus()
  try {
    const m = await json(`/api/venue?layout=${encodeURIComponent(id)}`)
    const [z, l, sp] = await loadLayer(m)
    p2Select(null)
    clearProposalPreview()
    overlay.dispose()
    manifest = m
    indexManifest()
    overlay = createOverlay(view, m, z, l, sp, { lang, theme })
    overlay.setShellVisible($('f-shell').checked)
    view.setStageMode(m.stage?.mode ?? 'original')
    Object.assign(window.twin, { manifest, overlay })
    if (resetRun) {
      run = null; state = null; truth = null; series = []; guidance = new Map(); logged = new Set(); logs = []
      gateInFlight.clear()
      p2.req += 1; p2.baseRun = null; p2.baseRows = []
    }
    buildGateOptions(); renderScope()
    renderKpis(); renderOpsRail(); renderGates(); renderEval(); renderPending(true); renderLog(); p2Render()
  } catch (e) {
    pushLog({ t: state?.t_s ?? 0, kind: 'error', message: e.message, cls: 'rejected' })
  } finally {
    layoutBusy = false
    renderLayoutOptions()
    setStatus()
  }
}

$('f-layout').onchange = (e) => switchLayout(e.target.value)
hooks.appearance.push(() => renderLayoutOptions())
renderLayoutOptions()

window.twin = {
  view, overlay, manifest,
  setLang, setTheme, setMode, switchLayout,
  getLang: () => lang, getTheme: () => theme, getMode: () => appMode,
}
window.addEventListener('resize', drawChart)

applyModeChrome()
setStatus(); renderKpis(); renderOpsRail(); renderGates(); renderEval(); renderPending(true); renderLog(); p2Render()
connect()
