// Headless check of the dashboard: loads it, fails on a blank canvas or page errors, saves screenshots.
//   node tools/shot.mjs [url] [outDir] [--run '<RunControl json>'] [--at 150,400]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1] }
const approve = args.includes('--approve') && args.splice(args.indexOf('--approve'), 1)
const runCfg = opt('--run'), at = (opt('--at') ?? '').split(',').filter(Boolean).map(Number), view = opt('--view')
const url = args[0] ?? 'http://127.0.0.1:8010/', out = args[1] ?? 'tools/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`) })
await page.goto(url)
await page.waitForSelector('#loading.done', { timeout: 60000 })
await page.waitForTimeout(4500)

const stats = async (name) => {
  const png = await page.screenshot({ path: `${out}/${name}.png` })
  const s = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const c = new OffscreenCanvas(320, 180), g = c.getContext('2d'); g.drawImage(img, 0, 0, 320, 180)
    const d = g.getImageData(0, 0, 320, 180).data
    let sum = 0, sq = 0, bright = 0
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += l; sq += l * l; bright += l > 245 }
    const n = d.length / 4, mean = sum / n
    return { mean: +mean.toFixed(1), stdev: +Math.sqrt(sq / n - mean * mean).toFixed(1), blownShare: +(bright / n).toFixed(4) }
  }, png.toString('base64'))
  const info = await page.evaluate(() => ({ calls: window.twin.view.renderer.info.render.calls, triangles: window.twin.view.renderer.info.render.triangles,
    gpu: (() => { const gl = window.twin.view.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a' })() }))
  console.log(name, JSON.stringify({ ...s, ...info }))
  if (s.stdev < 6) problems.push(`${name}: canvas looks blank (stdev ${s.stdev})`)
  // the 3D view itself, without the HTML panels: catches a frame that went black behind the panels
  const mid = await page.screenshot({ clip: { x: 500, y: 250, width: 400, height: 300 } })
  if (mid.length < 20000) problems.push(`${name}: 3D view is black (${mid.length} bytes)`)
}
if (view) { await page.getByRole('button', { name: view, exact: true }).click(); await page.waitForTimeout(2500) }
await stats('idle')
if (runCfg) {
  const run = await page.evaluate((cfg) => fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: cfg }).then((r) => r.json()), runCfg)
  if (approve) {
    await page.waitForSelector('#pending .approve', { timeout: 120000 })
    await stats('proposal')
    await page.click('#pending .approve')
    await page.waitForSelector('#log .approved', { timeout: 20000 })
    await page.waitForFunction(() => window.twinState?.redirected?.length > 0, null, { timeout: 20000 })
    console.log('approved', await page.evaluate(() => ({ t: window.twinState.t_s, redirected: window.twinState.redirected, log: [...document.querySelectorAll('#log li')].map((l) => l.textContent).slice(0, 4) })))
  }
  for (const t of at) {
    await page.waitForFunction((t) => (window.twinState?.t_s ?? 0) >= t, t, { timeout: 180000, polling: 200 })
    if (view) { await page.getByRole('button', { name: view, exact: true }).click(); await page.waitForTimeout(2600) } else await page.waitForTimeout(1800)
    await stats(`t${t}${view ? '-' + view.toLowerCase() : ''}`)
  }
  await page.evaluate((id) => fetch(`/api/runs/${id}/stop`, { method: 'POST' }), run.run_id)
}
// sweep the camera between two views: a single bad pixel (NaN) spread by bloom shows up only at some angles
const A = [[-215.76, 162.2, 178.09], [-88.4, 12.2, 48.38]], B = [[-205, 78, 150], [-88, 10, 30]]
let black = 0
for (let i = 0; i <= 60; i++) {
  await page.evaluate(([A, B, k]) => { const v = window.twin.view, l = (a, b) => a.map((x, j) => x + (b[j] - x) * k); v.camera.position.set(...l(A[0], B[0])); v.controls.target.set(...l(A[1], B[1])); v.controls.update() }, [A, B, i / 60])
  await page.waitForTimeout(60)
  black += (await page.screenshot({ clip: { x: 500, y: 250, width: 400, height: 300 } })).length < 20000
}
console.log(`camera sweep: ${black} black frames of 61`)
if (black) problems.push(`camera sweep: ${black} black frames`)
await browser.close()
if (problems.length) { console.log(problems.join('\n')); process.exit(1) }
console.log('OK')
