import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const data = resolve('.cache/browser')
mkdirSync(data, { recursive: true })

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5181',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: [
    {
      command: 'node scripts/run-api.mjs --port 8011',
      url: 'http://127.0.0.1:8011/api/health',
      timeout: 120_000,
      env: {
        CAD_DATABASE_PATH: resolve(data, 'cad.sqlite3'),
        RECIPE_DATABASE_PATH: resolve(data, 'recipes.sqlite3'),
        CORS_ALLOW_ORIGINS: '["http://127.0.0.1:5181"]',
        X3D_BACKEND: 'local',
      },
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5181 --strictPort',
      cwd: 'apps/web',
      url: 'http://127.0.0.1:5181',
      env: { VITE_API_BASE_URL: 'http://127.0.0.1:8011' },
    },
  ],
})
