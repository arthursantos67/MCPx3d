import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
// This repo has no root package.json/lockfile, so Vite's default
// `server.fs.allow` (derived from the nearest workspace root) would stop at
// `apps/web` itself and refuse to serve `packages/agent`/`packages/domain`
// source files, which the chat UI imports by relative path (Issue #27) the
// same way `packages/agent` already imports `packages/domain` -- see
// `packages/agent/README.md`'s "Why packages/domain is imported by relative
// path, not as an npm dependency".
const repoRoot = path.resolve(here, '..', '..')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
})
