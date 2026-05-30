import { createRequire } from 'node:module'
import { defineConfig } from 'tsup'

// package.json is the single source of truth for the version; inject it so
// src/index.ts never carries a duplicated literal.
const { version } = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  platform: 'browser',
  define: { __VELLUM_VERSION__: JSON.stringify(version) },
  // pdf.js is only used by the opt-in self-check and is an optional peer
  // dependency; keep it out of the bundle so consumers who don't enable
  // self-check pay nothing for it.
  external: ['pdfjs-dist'],
})
