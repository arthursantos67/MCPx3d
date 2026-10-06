import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = resolve(root, '.cache')
mkdirSync(resolve(cache, 'temp'), { recursive: true })
export const environment = {
  ...process.env,
  TEMP: resolve(cache, 'temp'), TMP: resolve(cache, 'temp'),
  UV_CACHE_DIR: resolve(cache, 'uv'), npm_config_cache: resolve(cache, 'npm'),
}

export function stop(child) {
  if (!child?.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else child.kill('SIGTERM')
}

export function runUv(args, options) {
  let child
  const launch = (command, arguments_) => {
    child = spawn(command, arguments_, { env: environment, stdio: 'inherit', windowsHide: true, ...options })
    child.on('error', (error) => {
      if (command === 'uv' && error.code === 'ENOENT') launch(process.env.PYTHON_EXECUTABLE ?? 'python', ['-m', 'uv', ...args])
      else { console.error(`Não foi possível iniciar o Python/uv: ${error.message}`); process.exitCode = 1 }
    })
    child.on('exit', (code) => { if (code) process.exitCode = code })
  }
  launch(process.env.UV_EXECUTABLE ?? 'uv', args)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(child))
}
