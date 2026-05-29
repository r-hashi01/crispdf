import { afterEach, describe, expect, it } from 'vitest'
import { captureRaster } from './capture'

const tracked: HTMLElement[] = []
function makePage(): HTMLElement {
  const page = document.createElement('div')
  page.style.cssText =
    'width:240px;height:120px;background:#ffffff;color:#000000;font:bold 28px Arial,sans-serif'
  page.textContent = 'BLACK TEXT HERE'
  document.body.appendChild(page)
  tracked.push(page)
  return page
}
afterEach(() => {
  for (const n of tracked.splice(0)) n.remove()
})

/** Fraction of pixels darker than mid-gray — a proxy for "ink" (text) present. */
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

describe('captureRaster', () => {
  it('suppresses text by default (transparency trick) but keeps it with suppressText: false', async () => {
    const page = makePage()
    const opts = { format: 'png' as const, quality: 1, width: 240, height: 120 }

    const groundTruth = await captureRaster(page, { ...opts, suppressText: false })
    const suppressed = await captureRaster(page, { ...opts })

    const inkGround = await darkFraction(groundTruth)
    const inkSuppressed = await darkFraction(suppressed)

    // Ground truth shows the black text; the default (suppressed) capture
    // makes glyphs transparent, so it has visibly less ink.
    expect(inkGround).toBeGreaterThan(0.01)
    expect(inkGround).toBeGreaterThan(inkSuppressed + 0.01)
  })

  it('does not leave the capture class on the page after a ground-truth capture', async () => {
    const page = makePage()
    await captureRaster(page, {
      format: 'png',
      quality: 1,
      width: 240,
      height: 120,
      suppressText: false,
    })
    expect(page.className).toBe('')
  })
})
