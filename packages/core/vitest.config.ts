import { createRequire } from 'node:module'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Mirror tsup's version injection so VERSION resolves under test too.
const { version } = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  define: { __VELLUM_VERSION__: JSON.stringify(version) },
  optimizeDeps: {
    include: ['html-to-image', '@pdf-lib/standard-fonts'],
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
})
