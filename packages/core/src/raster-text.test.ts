import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureRaster } from './capture'
import { domToPdf } from './dom-to-pdf'
import { keepUndrawableInRaster } from './raster-text'
import { extractSpans } from './walk'

// Text no font can draw (a fallback that failed to load, a symbol no font has)
// must stay visible in the raster instead of vanishing from both layers.

const pages: HTMLElement[] = []
afterEach(() => {
  for (const p of pages.splice(0)) p.remove()
  vi.unstubAllGlobals()
})

function page(html: string): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText =
    'width:240px;height:120px;background:#fff;color:#000;font:bold 28px Arial,sans-serif'
  el.innerHTML = html
  document.body.appendChild(el)
  pages.push(el)
  return el
}

async function darkFraction(bytes: Uint8Array): Promise<number> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  let dark = 0
  for (let i = 0; i < data.length; i += 4) {
    if (0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0) < 128)
      dark++
  }
  return dark / (bitmap.width * bitmap.height)
}

const capture = (el: HTMLElement) =>
  captureRaster(el, { format: 'png', quality: 1, width: 240, height: 120 })

describe('keepUndrawableInRaster', () => {
  it('keeps text without a font in the raster and out of the text layer', async () => {
    const el = page('<p>Latin</p><p id="cjk">日本語テキスト</p>')
    const spans = extractSpans(el)
    const kept = keepUndrawableInRaster([spans], [], [])
    expect(kept.pageSpans[0]?.map((s) => s.text)).toEqual(['Latin'])
    expect(kept.undrawable).toEqual(new Set([...'日本語テキスト']))
    expect(el.querySelector('#cjk')?.hasAttribute('data-vellum-raster-text')).toBe(true)
    const withKept = await darkFraction(await capture(el))
    kept.release()
    expect(el.querySelector('[data-vellum-raster-text]')).toBeNull()
    // Without the marker the capture hides all text: the kept text was what showed.
    expect(withKept).toBeGreaterThan((await darkFraction(await capture(el))) + 0.005)
  })

  it('leaves drawable text alone', () => {
    const el = page('<p>Plain “Latin” — €5</p>')
    const spans = extractSpans(el)
    const kept = keepUndrawableInRaster([spans], [], [])
    expect(kept.pageSpans[0]).toBe(spans)
    expect(kept.undrawable.size).toBe(0)
  })
})

describe('domToPdf when the fallback font fails to load', () => {
  it('warns that the text stays in the raster and removes its markers afterwards', async () => {
    // Only the font fetches fail; data: URLs (the capture's images) still load.
    const realFetch = globalThis.fetch.bind(globalThis)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).startsWith('data:') ? realFetch(input) : new Response(null, { status: 503 }),
      ),
    )
    const el = page('<p>日本語</p>')
    const result = await domToPdf({
      pages: [el],
      source: { width: 240, height: 120 },
      output: { width: 240, height: 120, unit: 'pt' },
      rasterFormat: 'png',
    })
    expect(result.warnings.some((w) => /No font can draw 3 character/.test(w))).toBe(true)
    expect(el.querySelector('[data-vellum-raster-text]')).toBeNull()
  })
})
