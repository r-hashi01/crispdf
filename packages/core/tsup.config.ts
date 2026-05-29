import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  platform: 'browser',
  // pdf.js is only used by the opt-in self-check and is an optional peer
  // dependency; keep it out of the bundle so consumers who don't enable
  // self-check pay nothing for it.
  external: ['pdfjs-dist'],
})
