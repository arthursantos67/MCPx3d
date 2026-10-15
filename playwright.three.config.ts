import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'

// Three.js runs locally. Its browser regressions deliberately mock backend and model requests.
export default defineConfig({
  ...base,
  // Software WebGL readbacks and multiple captures need more than the product's generic timeout.
  timeout: 90_000,
  testMatch: 'three-*.spec.{ts,mts}',
  webServer: Array.isArray(base.webServer) ? base.webServer.slice(1) : base.webServer,
})
