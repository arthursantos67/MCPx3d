// Three.js frame-time benchmark on a real GPU: fixed route in play mode for each example scene.
// Usage: node scripts/benchmark-three-fps.mjs [--skip-build] [--runs 3] [--seconds 60] [--warmup 5]
//   [--scenes "Vale dos Ventos,..."] [--modes gpu,cpu] [--label baseline] [--out file.json] [--compare base.json]
// Default is headless (real GPU, immune to the desktop); --headed opens a window that must stay visible.
// "gpu" renders at the quality's pixel ratio; "cpu" lowers the internal resolution to 0.25 to isolate main-thread cost.
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, totalmem, release } from 'node:os'
import { dirname, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback }
const flag = (name) => args.includes(`--${name}`)
// 0.7 worlds: the same example opened with a fixed traversal (walking with sprint, or terrain-following flight at 36 m/s).
const loop = (half) => [[half, 0], [half, half], [-half, half], [-half, -half], [half, -half], [half, 0]].map((point) => point.join(',')).join(';')
const WORLDS = {
  'Mundo 4 km · a pé': { button: 'Relevo sintético 4 km', query: `route=${loop(600)}&sprint=1` },
  'Mundo 4 km · voo 36 m/s': { button: 'Relevo sintético 4 km', query: `route=${loop(1500)}&sprint=1&fly=40&speed=20` },
  'Aurora 4 km · a pé': { button: 'Terras de Aurora 4 km', query: `route=${loop(600)}&sprint=1` },
  'Aurora 4 km · voo 36 m/s': { button: 'Terras de Aurora 4 km', query: `route=${loop(1500)}&sprint=1&fly=40&speed=20` },
}
const WORLD_SCENES = Object.keys(WORLDS)
const TITLES = { 'Exemplo jogável': 'Ilha do Farol' }
const SCENES = ['Vale dos Ventos', 'Mercado de Valemar', 'Floresta encantada', 'Ermo dos Saqueadores', 'Exemplo jogável']
const scenes = option('scenes', SCENES.join(',')).split(',').map((item) => item.trim()).filter(Boolean)
const runs = Number(option('runs', 3)), seconds = Number(option('seconds', 60)), warmup = Number(option('warmup', 5))
const modes = option('modes', 'gpu,cpu').split(',').map((item) => item.trim())
const label = option('label', 'run'), port = Number(option('port', 5190))
const out = resolve(option('out', `.cache/benchmark-three/${label}.json`)), compare = option('compare', null)
const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ratios = { gpu: null, cpu: 0.25 }
const viewport = { width: 1920, height: 1080 }

const sorted = (values) => [...values].sort((a, b) => a - b)
const quantile = (values, q) => { const list = sorted(values); return list.length ? list[Math.min(list.length - 1, Math.floor(q * (list.length - 1) + 0.5))] : 0 }
const median = (values) => quantile(values, 0.5)
const mad = (values) => { const m = median(values); return median(values.map((value) => Math.abs(value - m))) }
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits

function run(command, cwd) {
  execFileSync(command, { cwd, stdio: 'inherit', shell: true })
}

async function startPreview() {
  const server = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: resolve('apps/web'), stdio: 'pipe' })
  const url = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(url)).ok) return { server, url } } catch { /* starting */ }
    await new Promise((done) => setTimeout(done, 500))
  }
  server.kill()
  throw new Error('vite preview did not start')
}

async function launch() {
  // Headless Chrome keeps the real GPU (ANGLE/D3D11) and a steady vsync, and no other window can occlude or minimise
  // it; `--headed` shows the window instead.
  return chromium.launch({ executablePath: chrome, headless: !flag('headed'),
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', `--window-size=${viewport.width},${viewport.height + 120}`] })
}

async function hardware(browser) {
  const page = await browser.newPage()
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), info = gl?.getExtension('WEBGL_debug_renderer_info')
    return gl ? { vendor: String(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR)), renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      parallelCompile: !!gl.getExtension('KHR_parallel_shader_compile'), timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') } : null
  })
  await page.close()
  if (!gpu) throw new Error('WebGL2 indisponível no Chrome do benchmark.')
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu.renderer)) throw new Error(`Renderer por software (${gpu.renderer}); o benchmark exige GPU real.`)
  let gpuName = null
  try { gpuName = execFileSync('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'], { encoding: 'utf8' }).trim() } catch { /* not NVIDIA */ }
  return { gpu, gpuDriver: gpuName, cpu: cpus()[0].model, threads: cpus().length, memoryGiB: round(totalmem() / 2 ** 30, 1), os: `Windows ${release()}`, chrome: browser.version(), viewport }
}

async function measure(url, scene, mode) {
  const browser = await launch()
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('dialog', (dialog) => void dialog.accept())
    await page.route('**/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' }))
    await page.addInitScript(() => {
      localStorage.setItem('modeler:workspace', 'three')
      window.__longTasks = []
      try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push([entry.startTime, entry.duration]) }).observe({ type: 'longtask', buffered: true }) } catch { /* unsupported */ }
    })
    const ratio = ratios[mode], world = WORLDS[scene]
    await page.goto(`${url}/?bench=1&drive=1${ratio ? `&ratio=${ratio}` : ''}${world ? `&${world.query}` : ''}`)
    await page.getByRole('img', { name: 'Cena Three.js interativa' }).waitFor()
    await page.waitForFunction(() => !!window.__formaBench)
    await page.getByRole('button', { name: 'Projeto ▾', exact: true }).click()
    const switchStart = await page.evaluate((name) => {
      const bench = window.__formaBench
      bench.marks = {}
      bench.mark('switchStart')
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent === name)
      if (!button) throw new Error(`Exemplo não encontrado: ${name}`)
      button.click()
      return bench.marks.switchStart
    }, world?.button ?? scene)
    if (world) await page.waitForFunction(() => window.__formaBench.marks.worldPrepared > window.__formaBench.marks.switchStart, null, { timeout: 300_000, polling: 100 })
    await page.waitForFunction((after) => window.__formaBench.marks.sceneReady > window.__formaBench.marks[after], world ? 'worldPrepared' : 'switchStart', { timeout: 300_000, polling: 100 })
    const { sceneReady, worldStart } = await page.evaluate(() => window.__formaBench.marks)
    // The first frame with terrain follows the compile started at sceneReady; give it a second before play.
    if (world) await page.waitForTimeout(1000)
    const play = page.getByRole('button', { name: '▶ Jogar', exact: true })
    await play.waitFor()
    await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent === '▶ Jogar'); return button && !button.disabled }, null, { timeout: 300_000, polling: 200 })
    const playClick = await page.evaluate(() => { window.__formaBench.mark('playClick'); [...document.querySelectorAll('button')].find((item) => item.textContent === '▶ Jogar').click(); return window.__formaBench.marks.playClick })
    await page.waitForFunction(() => window.__formaBench.marks.firstGameFrame > window.__formaBench.marks.playClick, null, { timeout: 300_000, polling: 100 })
    const firstGameFrame = await page.evaluate(() => window.__formaBench.marks.firstGameFrame)
    await page.waitForTimeout(warmup * 1000)
    await page.bringToFront()
    const startPosition = await page.evaluate(() => { const bench = window.__formaBench; bench.frames = []; bench.gpu = []; bench.recording = true; return bench.position() })
    const measuredFrom = await page.evaluate(() => performance.now())
    let travelled = 0, previous = startPosition
    for (let second = 0; second < seconds; second++) {
      await page.waitForTimeout(1000)
      const position = await page.evaluate(() => window.__formaBench.position())
      if (previous && position) travelled += Math.hypot(position[0] - previous[0], position[2] - previous[2])
      previous = position
    }
    const result = await page.evaluate(() => {
      const bench = window.__formaBench
      bench.recording = false
      const canvas = document.querySelector('canvas[aria-label="Cena Three.js interativa"]')
      return { visible: document.visibilityState, frames: bench.frames, gpu: bench.gpu.filter((sample) => sample.game).map((sample) => sample.ms), memory: bench.memory(), heap: performance.memory ? performance.memory.usedJSHeapSize : null, longTasks: window.__longTasks,
        canvas: canvas ? [canvas.width, canvas.height] : null, playing: !!document.querySelector('[aria-label="Modo jogo"]') }
    })
    const frames = result.frames.filter((frame) => frame.game && frame.interval > 0)
    // Chrome limits hidden or occluded windows to one frame per second; such a run measures the browser, not the scene.
    const throttled = result.visible !== 'visible' || frames.filter((frame) => Math.abs(frame.interval - 1000) < 15).length >= 2
    const intervals = frames.map((frame) => frame.interval), cpu = frames.map((frame) => frame.cpu)
    const loadTasks = result.longTasks.filter(([start]) => start >= switchStart && start <= firstGameFrame).map(([, duration]) => duration)
    // World loading proper (terrain errors, tiles, programs, first terrain frame), apart from the 1.x scene switch
    // before it and the play-mode start after it, which every scene pays.
    // The click on "Jogar" runs inside a task that began a few milliseconds before its mark.
    const worldTasks = world ? result.longTasks.filter(([start]) => start >= worldStart - 5 && start < playClick - 50).map(([, duration]) => duration) : []
    const playTasks = result.longTasks.filter(([start]) => start >= playClick - 50 && start <= firstGameFrame).map(([, duration]) => duration)
    const gameTasks = result.longTasks.filter(([start]) => start >= measuredFrom).map(([, duration]) => duration)
    return {
      scene, mode, throttled, frames: frames.length, playing: result.playing, canvas: result.canvas, travelledMetres: round(travelled, 1),
      frameMs: { median: round(median(intervals)), p95: round(quantile(intervals, 0.95)), max: round(Math.max(0, ...intervals)) },
      over50: intervals.filter((value) => value > 50).length, over100: intervals.filter((value) => value > 100).length,
      cpuMs: { median: round(median(cpu)), p95: round(quantile(cpu, 0.95)), max: round(Math.max(0, ...cpu)) },
      gpuMs: result.gpu.length ? { median: round(median(result.gpu)), p95: round(quantile(result.gpu, 0.95)), max: round(Math.max(...result.gpu)), samples: result.gpu.length } : null,
      drawCalls: { median: median(frames.map((frame) => frame.calls)), max: Math.max(0, ...frames.map((frame) => frame.calls)) },
      triangles: { median: median(frames.map((frame) => frame.triangles)), max: Math.max(0, ...frames.map((frame) => frame.triangles)) },
      memory: { ...result.memory, estimatedGpuMiB: round((result.memory.geometryBytes + result.memory.textureBytes) / 2 ** 20, 1), jsHeapMiB: result.heap ? round(result.heap / 2 ** 20, 1) : null },
      sceneSwitchMs: round(sceneReady - switchStart, 0), streamMs: world ? { median: round(median(frames.map((frame) => frame.streamMs ?? 0)), 3), max: round(Math.max(0, ...frames.map((frame) => frame.streamMs ?? 0)), 3) } : null,
      selectMs: world ? { median: round(median(frames.map((frame) => frame.selectMs ?? 0)), 3), max: round(Math.max(0, ...frames.map((frame) => frame.selectMs ?? 0)), 3) } : null,
      deficitFrames: world ? frames.filter((frame) => frame.deficit > 0).length : null,
      ...(world ? { residency: { max: Math.max(0, ...frames.map((frame) => frame.resident ?? 0)), pendingMax: Math.max(0, ...frames.map((frame) => frame.pending ?? 0)), firstDeficit: frames.find((frame) => frame.deficit > 0) ?? null } } : {}),
      timeToPlayableMs: round(firstGameFrame - playClick, 0),
      loadLongestTaskMs: round(Math.max(0, ...loadTasks), 0), loadTasksOver100: loadTasks.filter((value) => value > 100).length,
      loadTasks: result.longTasks.filter(([start]) => start >= switchStart && start <= firstGameFrame).map(([start, duration]) => [round(start - switchStart, 0), round(duration, 0)]).filter(([, duration]) => duration > 50),
      gameLongestTaskMs: round(Math.max(0, ...gameTasks), 0), playStartLongestTaskMs: round(Math.max(0, ...playTasks), 0),
      ...(world ? { worldLoadLongestTaskMs: round(Math.max(0, ...worldTasks), 0), worldLoadMs: round(sceneReady - worldStart, 0) } : {}), errors,
    }
  } finally { await browser.close() }
}

function summarize(list) {
  const pick = (get) => list.map(get)
  const medians = pick((item) => item.frameMs.median), p95s = pick((item) => item.frameMs.p95)
  return {
    runs: list.length,
    frameMs: { median: round(median(medians)), p95: round(median(p95s)), max: round(Math.max(...pick((item) => item.frameMs.max))) },
    noiseMs: { median: round(Math.max(2 * mad(medians), 0.03 * median(medians))), p95: round(Math.max(2 * mad(p95s), 0.03 * median(p95s))) },
    fps: round(1000 / median(medians), 1),
    cpuMs: { median: round(median(pick((item) => item.cpuMs.median))), p95: round(median(pick((item) => item.cpuMs.p95))), max: round(Math.max(...pick((item) => item.cpuMs.max))) },
    gpuMs: list.every((item) => item.gpuMs) ? { median: round(median(pick((item) => item.gpuMs.median))), p95: round(median(pick((item) => item.gpuMs.p95))) } : null,
    over50: pick((item) => item.over50), over100: pick((item) => item.over100),
    drawCalls: { median: median(pick((item) => item.drawCalls.median)), max: Math.max(...pick((item) => item.drawCalls.max)) },
    triangles: { median: median(pick((item) => item.triangles.median)), max: Math.max(...pick((item) => item.triangles.max)) },
    estimatedGpuMiB: median(pick((item) => item.memory.estimatedGpuMiB)), jsHeapMiB: median(pick((item) => item.memory.jsHeapMiB ?? 0)), programs: median(pick((item) => item.memory.programs)),
    sceneSwitchMs: median(pick((item) => item.sceneSwitchMs)),
    ...(list[0].streamMs ? { streamMs: { median: median(pick((item) => item.streamMs.median)), max: Math.max(...pick((item) => item.streamMs.max)) }, selectMs: { median: median(pick((item) => item.selectMs.median)), max: Math.max(...pick((item) => item.selectMs.max)) }, deficitFrames: pick((item) => item.deficitFrames) } : {}), timeToPlayableMs: median(pick((item) => item.timeToPlayableMs)),
    loadLongestTaskMs: Math.max(...pick((item) => item.loadLongestTaskMs)), gameLongestTaskMs: Math.max(...pick((item) => item.gameLongestTaskMs)),
    playStartLongestTaskMs: Math.max(...pick((item) => item.playStartLongestTaskMs ?? 0)),
    ...(list[0].worldLoadMs !== undefined ? { worldLoadMs: median(pick((item) => item.worldLoadMs)), worldLoadLongestTaskMs: Math.max(...pick((item) => item.worldLoadLongestTaskMs)) } : {}),
    travelledMetres: pick((item) => item.travelledMetres),
  }
}

function gate(current, base) {
  const findings = []
  for (const [key, entry] of Object.entries(current.summary)) {
    const [mode] = key.split(' · ')
    const scene = key.slice(key.indexOf(' · ') + 3), world = WORLD_SCENES.includes(scene), previous = base?.summary[key]
    // The frame budget binds 0.7 world scenarios; existing 1.x scenes (some already above it) must not regress.
    // Absolute frame limits use the resolution-isolated pass, where an entry-level GPU does not dominate.
    if (world && mode === 'cpu' && entry.over100.some((count) => count > 0)) findings.push(`${key}: ${entry.over100.join('/')} quadros > 100 ms em jogo`)
    if (world && entry.gameLongestTaskMs > 100) findings.push(`${key}: tarefa longa de ${entry.gameLongestTaskMs} ms em jogo`)
    if (world && entry.worldLoadLongestTaskMs > 100) findings.push(`${key}: bloqueio de ${entry.worldLoadLongestTaskMs} ms na carga do mundo`)
    if (world && mode === 'cpu' && entry.cpuMs.median > 8) findings.push(`${key}: CPU mediana ${entry.cpuMs.median} ms > 8 ms`)
    if (world && entry.streamMs?.max > 2.5) findings.push(`${key}: streaming usou ${entry.streamMs.max} ms em um quadro (orçamento 2 ms)`)
    if (world && entry.deficitFrames?.some((count) => count > 0)) findings.push(`${key}: ${entry.deficitFrames.join('/')} quadros com nível de detalhe ainda não carregado`)
    if (world && entry.drawCalls.max > 600) findings.push(`${key}: ${entry.drawCalls.max} draw calls > 600`)
    if (world && entry.triangles.max > 1_500_000) findings.push(`${key}: ${entry.triangles.max} triângulos > 1,5 M`)
    if (!previous) continue
    if (entry.gameLongestTaskMs > Math.max(100, previous.gameLongestTaskMs * 1.15)) findings.push(`${key}: tarefa longa em jogo ${entry.gameLongestTaskMs} ms > linha de base ${previous.gameLongestTaskMs} ms`)
    if (entry.playStartLongestTaskMs > Math.max(100, (previous.playStartLongestTaskMs ?? Infinity) * 1.15)) findings.push(`${key}: bloqueio ao entrar no jogo ${entry.playStartLongestTaskMs} ms > linha de base ${previous.playStartLongestTaskMs} ms`)
    if (entry.loadLongestTaskMs > Math.max(100, previous.loadLongestTaskMs * 1.15)) findings.push(`${key}: bloqueio na carga ${entry.loadLongestTaskMs} ms > linha de base ${previous.loadLongestTaskMs} ms`)
    if (entry.drawCalls.median > previous.drawCalls.median * 1.05) findings.push(`${key}: draw calls ${entry.drawCalls.median} > ${previous.drawCalls.median}`)
    if (entry.triangles.median > previous.triangles.median * 1.05) findings.push(`${key}: triângulos ${entry.triangles.median} > ${previous.triangles.median}`)
    for (const stat of ['median', 'p95']) {
      const allowed = previous.frameMs[stat] + Math.max(previous.noiseMs[stat], entry.noiseMs[stat])
      if (entry.frameMs[stat] > allowed) findings.push(`${key}: ${stat} ${entry.frameMs[stat]} ms > ${round(allowed)} ms (linha de base ${previous.frameMs[stat]} ± ruído)`)
    }
  }
  return findings
}

if (!flag('skip-build')) run(process.platform === 'win32' ? 'npm.cmd run build' : 'npm run build', resolve('.'))
const { server, url } = await startPreview()
const report = { label, date: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  settings: { runs, seconds, warmup, modes, quality: 'auto → médio em GPU real', ratios, build: 'vite build (produção)', vsync: 'ativo', window: flag('headed') ? 'janela visível' : 'headless' }, hardware: null, runs: [], summary: {} }
try {
  const probe = await launch()
  try { report.hardware = await hardware(probe) } finally { await probe.close() }
  console.log(JSON.stringify(report.hardware))
  // --resume keeps the runs already saved in the output (same commit), so an interrupted session continues.
  const previous = flag('resume') ? await readFile(out, 'utf8').then((text) => JSON.parse(text), () => null) : null
  const saved = previous && previous.commit === report.commit ? previous.runs.map((run, order) => ({ ...run, order })) : []
  await mkdir(dirname(out), { recursive: true })
  for (const mode of modes) for (let index = 0; index < runs; index++) {
    const order = index % 2 ? [...scenes].reverse() : scenes
    for (const scene of order) {
      const done = saved.filter((run) => run.mode === mode && run.scene === scene)
      if (done.length > index) { report.runs.push(done[index]); continue }
      let result = null
      for (let attempt = 0; !result; attempt++) {
        try { result = await measure(url, scene, mode) } catch (error) {
          if (attempt >= 2) throw error
          console.log(`${mode} ${scene}: falha do navegador (${String(error.message).split(/\r?\n/)[0]}), repetindo`)
        }
      }
      for (let retry = 0; result.throttled && retry < 3; retry++) { console.log(`${mode} ${scene}: janela limitada pelo navegador, repetindo`); result = await measure(url, scene, mode) }
      if (result.throttled) throw new Error(`Execução ${scene} continua limitada a 1 Hz pelo navegador; mantenha a janela do Chrome visível.`)
      report.runs.push(result)
      await writeFile(out, `${JSON.stringify(report, null, 2)}
`)
      console.log(`${mode} #${index + 1} ${scene}: mediana ${result.frameMs.median} ms, p95 ${result.frameMs.p95} ms, CPU ${result.cpuMs.median} ms, ${result.drawCalls.median} calls, ${result.triangles.median} tri, jogável em ${result.timeToPlayableMs} ms`)
    }
  }
  for (const mode of modes) for (const scene of scenes) report.summary[`${mode} · ${TITLES[scene] ?? scene}`] = summarize(report.runs.filter((item) => item.mode === mode && item.scene === scene))
  const base = compare ? JSON.parse(await readFile(resolve(compare), 'utf8')) : null
  report.gate = { comparedTo: compare, findings: gate(report, base) }
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report.summary, null, 2))
  console.log(report.gate.findings.length ? `Gate: ${report.gate.findings.length} achados\n- ${report.gate.findings.join('\n- ')}` : 'Gate: sem achados')
  console.log(`Relatório: ${out}`)
} finally { server.kill() }
