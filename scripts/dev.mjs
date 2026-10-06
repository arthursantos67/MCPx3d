import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { environment, root, stop } from './runtime.mjs'

const api = spawn(process.execPath, [resolve(root, 'scripts/run-api.mjs')], { env: environment, stdio: 'inherit', windowsHide: true })
let web
let closing = false
const close = () => { closing = true; stop(web); stop(api) }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, close)
api.on('exit', (code) => { close(); process.exitCode = code ?? 1 })

let ready = false
for (let attempt = 0; attempt < 120 && !closing; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:8001/api/health', { signal: AbortSignal.timeout(1000) })
    if (response.ok) { ready = true; break }
  } catch {}
  await setTimeout(500)
}
if (ready && !closing) {
  web = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {
    cwd: resolve(root, 'apps/web'), env: environment, stdio: 'inherit', windowsHide: true,
  })
  web.on('exit', (code) => { close(); process.exitCode = code ?? 0 })
} else {
  const interrupted = closing
  close()
  if (!interrupted) { console.error('A API não iniciou. Verifique os erros acima e a porta 8001.'); process.exitCode = 1 }
}
