/**
 * Phase 3 self-check: render the generated PDF back to pixels and pixel-diff it
 * against a reference raster of the page as it actually renders (text included
 * — domToPdf passes a ground-truth capture, not the text-suppressed embedding
 * raster, so a page that lost text diffs *higher*, not lower). A page that
 * diverges beyond the threshold surfaces as a warning — turning otherwise-
 * silent rendering drift (a missing font, an unsupported CSS feature the vector
 * layer mishandled) into a *detectable* failure, per the visible-degradation
 * invariant.
 *
 * Caveat: a whole-page mean-abs diff is blunt — text occupies a small fraction
 * of most pages, so it flags gross failures (a page largely wrong) rather than
 * subtle ones. SSIM / region-localized diffing is the future refinement.
 *
 * The pixel math (`meanPixelDiff`) and orchestration (`runSelfCheck`) are pure
 * and dependency-injected so they unit-test without pdf.js or a real canvas.
 * The default decode/render glue lives at the bottom and is loaded on demand.
 */

import type { SelfCheckPageResult } from './types'

export type { SelfCheckPageResult }

export interface RasterImage {
  width: number
  height: number
  /** RGBA bytes, length === width * height * 4. */
  data: Uint8ClampedArray
}

/**
 * Mean per-channel absolute difference over RGB, normalized to 0..1 (0 =
 * identical, 1 = every pixel maximally different). Alpha is ignored — the PDF
 * background raster is opaque. Mismatched dimensions return 1 (fully different)
 * rather than throwing; the caller renders to the reference size so this is a
 * guard, not an expected path.
 */
export function meanPixelDiff(a: RasterImage, b: RasterImage): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  const pixels = a.width * a.height
  if (pixels === 0) return 0
  let sum = 0
  for (let i = 0; i < pixels; i++) {
    const o = i * 4
    sum +=
      Math.abs((a.data[o] ?? 0) - (b.data[o] ?? 0)) +
      Math.abs((a.data[o + 1] ?? 0) - (b.data[o + 1] ?? 0)) +
      Math.abs((a.data[o + 2] ?? 0) - (b.data[o + 2] ?? 0))
  }
  return sum / (pixels * 3 * 255)
}

export interface SelfCheckDeps {
  /** Decode a capture-phase raster (JPEG/PNG bytes) to RGBA pixels. */
  decodeRaster(bytes: Uint8Array, format: 'jpeg' | 'png'): Promise<RasterImage>
  /** Render one page of the generated PDF to RGBA pixels at the given size. */
  renderPdfPage(
    pdfBytes: Uint8Array,
    pageIndex: number,
    width: number,
    height: number,
  ): Promise<RasterImage>
}

export interface RunSelfCheckArgs {
  pdfBytes: Uint8Array
  pageRasters: Uint8Array[]
  rasterFormat: 'jpeg' | 'png'
  threshold: number
  deps: SelfCheckDeps
  onWarning?: (msg: string) => void
}

/**
 * Compare every generated PDF page against its reference raster. Returns
 * one result per successfully compared page; a page whose decode/render throws
 * is skipped with a warning (self-check must never sink the whole generation).
 */
export async function runSelfCheck(args: RunSelfCheckArgs): Promise<SelfCheckPageResult[]> {
  const results: SelfCheckPageResult[] = []
  for (let i = 0; i < args.pageRasters.length; i++) {
    const refBytes = args.pageRasters[i]
    if (!refBytes) continue
    let diff: number
    try {
      const ref = await args.deps.decodeRaster(refBytes, args.rasterFormat)
      const rendered = await args.deps.renderPdfPage(args.pdfBytes, i, ref.width, ref.height)
      diff = meanPixelDiff(ref, rendered)
    } catch (err) {
      args.onWarning?.(
        `Self-check could not compare page ${i + 1}: ${(err as Error).message}. Skipping its visual diff.`,
      )
      continue
    }
    const exceeded = diff > args.threshold
    if (exceeded) {
      args.onWarning?.(
        `Self-check: page ${i + 1} visual diff = ${(diff * 100).toFixed(1)}% exceeds threshold ` +
          `${(args.threshold * 100).toFixed(1)}%. The PDF may not match the source on that page ` +
          `(e.g. a font that didn't embed, or a CSS feature the vector layer missed).`,
      )
    }
    results.push({ page: i + 1, diff, exceeded })
  }
  return results
}

/**
 * Default browser dependencies: decode rasters via `createImageBitmap` +
 * `OffscreenCanvas`, render PDF pages via pdf.js (dynamically imported so it
 * stays out of the main bundle and is only paid for when self-check is on).
 *
 * Consumers enabling `selfCheck` must have `pdfjs-dist` installed (it is an
 * optional peer dependency). The pdf.js worker is loaded from the package via
 * `new URL(..., import.meta.url)`, which Vite/webpack resolve automatically.
 */
export function defaultSelfCheckDeps(): SelfCheckDeps {
  return {
    async decodeRaster(bytes, format) {
      const blob = new Blob([bytes as BlobPart], {
        type: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      })
      const bitmap = await createImageBitmap(blob)
      const { width, height } = bitmap
      const ctx = newCanvasContext(width, height)
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const img = ctx.getImageData(0, 0, width, height)
      return { width, height, data: img.data }
    },
    async renderPdfPage(pdfBytes, pageIndex, width, height) {
      const pdfjs = await loadPdfjs()
      const doc = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise
      try {
        const page = await doc.getPage(pageIndex + 1)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(width / base.width, height / base.height)
        const viewport = page.getViewport({ scale })
        const ctx = newCanvasContext(width, height)
        // White backing so anti-aliased edges diff against the same ground the
        // JPEG raster has (JPEG has no alpha).
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport })
          .promise
        const img = ctx.getImageData(0, 0, width, height)
        return { width, height, data: img.data }
      } finally {
        await doc.destroy()
      }
    },
  }
}

type Canvas2D = OffscreenCanvasRenderingContext2D

function newCanvasContext(width: number, height: number): Canvas2D {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('self-check: OffscreenCanvas 2D context unavailable')
  return ctx
}

interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string; workerPort: Worker | null }
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfjsDocument> }
}
interface PdfjsDocument {
  getPage(n: number): Promise<PdfjsPage>
  destroy(): Promise<void>
}
interface PdfjsViewport {
  width: number
  height: number
}
interface PdfjsPage {
  getViewport(opts: { scale: number }): PdfjsViewport
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: PdfjsViewport }): {
    promise: Promise<void>
  }
}

let pdfjsPromise: Promise<PdfjsModule> | null = null
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod = (await import('pdfjs-dist')) as unknown as PdfjsModule
      if (!mod.GlobalWorkerOptions.workerSrc && !mod.GlobalWorkerOptions.workerPort) {
        mod.GlobalWorkerOptions.workerPort = new Worker(
          new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
          { type: 'module' },
        )
      }
      return mod
    })()
  }
  return pdfjsPromise
}
