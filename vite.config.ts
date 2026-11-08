import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url))
const PKG_PATH = path.resolve(APP_ROOT, 'package.json')
const MAX_CRITICAL_VERSION = 1_000_000

function readCriticalVersion(): number {
  if (path.dirname(PKG_PATH) !== APP_ROOT) {
    throw new Error('package.json path escaped app root boundary.')
  }
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')) as {
    criticalVersion?: unknown
  }

  const rawCritical = pkg.criticalVersion ?? 0
  if (
    typeof rawCritical !== 'number' ||
    !Number.isSafeInteger(rawCritical) ||
    rawCritical < 0 ||
    rawCritical > MAX_CRITICAL_VERSION
  ) {
    throw new Error(
      `Invalid criticalVersion in package.json: ${String(rawCritical)}. Expected integer 0..${MAX_CRITICAL_VERSION}.`
    )
  }

  return rawCritical
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __CRITICAL_VERSION__: JSON.stringify(readCriticalVersion()),
  },
  base: './', // Relative base path ensures GitHub Pages works under any subfolder
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase'
          }
          if (id.endsWith('src/data/quotes.json')) {
            return 'quotes-data'
          }
        },
      },
    },
  },
})
