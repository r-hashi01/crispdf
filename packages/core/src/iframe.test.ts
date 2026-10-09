import { afterEach, describe, expect, it } from 'vitest'
import { captureRaster } from './capture'
import { discoverFontFaces } from './font-discovery'
import { extractSpans } from './walk'

// Pages hosted in a same-origin iframe (e.g. a print view loaded off-screen)
// belong to another document and realm: everything must use that document.

const frames: HTMLIFrameElement[] = []
afterEach(() => {
  for (const f of frames.splice(0)) f.remove()
})

async function framePage(css = ''): Promise<{ frame: HTMLIFrameElement; page: HTMLElement }> {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:300px;height:200px;border:0'
  frame.srcdoc = `<!doctype html><html><head><style>${css}</style></head><body style="margin:0">
    <div id="page" style="width:240px;height:120px;background:#fff;color:#000;font:bold 28px Arial,sans-serif">BLACK TEXT HERE</div>
  </body></html>`
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
  document.body.appendChild(frame)
  frames.push(frame)
  await loaded
  const page = frame.contentDocument?.getElementById('page')
  if (!page) throw new Error('iframe page missing')
  return { frame, page }
}

async function darkFraction(bytes: Uint8Array): Promise<number> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  let dark = 0
  const n = bitmap.width * bitmap.height
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const luma = 0.299 * (data[o] ?? 0) + 0.587 * (data[o + 1] ?? 0) + 0.114 * (data[o + 2] ?? 0)
    if (luma < 128) dark++
  }
  return dark / n
}

describe('pages inside an iframe', () => {
  it('suppresses text in the raster (style goes into the page document)', async () => {
    const { page } = await framePage()
    const opts = { format: 'png' as const, quality: 1, width: 240, height: 120 }
    const groundTruth = await captureRaster(page, { ...opts, suppressText: false })
    const suppressed = await captureRaster(page, opts)
    expect(await darkFraction(groundTruth)).toBeGreaterThan(0.01)
    expect(await darkFraction(suppressed)).toBeLessThan(0.002)
    // Nothing leaks into the outer document.
    expect(document.getElementById('__vellum-capture-style')).toBeNull()
  })

  it("discovers @font-face rules from the iframe's own stylesheets", async () => {
    const { frame } = await framePage(`
      @font-face {
        font-family: 'Inter';
        font-weight: 400;
        src: url('https://fonts.gstatic.com/s/inter/v1/Inter-Regular.woff2') format('woff2');
      }
    `)
    const doc = frame.contentDocument
    if (!doc) throw new Error('no iframe document')
    expect(discoverFontFaces(doc).map((r) => r.family)).toContain('inter')
  })

  it('extracts spans with the iframe layout', async () => {
    const { page } = await framePage()
    const spans = extractSpans(page)
    expect(spans.map((s) => s.text).join(' ')).toContain('BLACK TEXT HERE')
  })
})
