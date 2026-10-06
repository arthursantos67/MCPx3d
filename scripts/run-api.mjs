import { resolve } from 'node:path'
import { root, runUv } from './runtime.mjs'

const args = process.argv.slice(2)
if (!args.includes('--port')) args.push('--port', '8001')
runUv(['run', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', ...args], { cwd: resolve(root, 'apps/api') })
