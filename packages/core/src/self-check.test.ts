import { describe, expect, it, vi } from 'vitest'
import { meanPixelDiff, type RasterImage, runSelfCheck } from './self-check'

function solid(w: number, h: number, r: number, g: number, b: number, a = 255): RasterImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  }
  return { width: w, height: h, data }
}

describe('meanPixelDiff', () => {
  it('returns 0 for identical images', () => {
    expect(meanPixelDiff(solid(4, 4, 10, 20, 30), solid(4, 4, 10, 20, 30))).toBe(0)
  })

  it('returns 1 for black vs white (max per-channel difference)', () => {
    expect(meanPixelDiff(solid(3, 3, 0, 0, 0), solid(3, 3, 255, 255, 255))).toBeCloseTo(1, 5)
  })

  it('ignores the alpha channel', () => {
    expect(meanPixelDiff(solid(2, 2, 50, 50, 50, 0), solid(2, 2, 50, 50, 50, 255))).toBe(0)
  })

  it('treats mismatched dimensions as fully different', () => {
    expect(meanPixelDiff(solid(2, 2, 0, 0, 0), solid(3, 3, 0, 0, 0))).toBe(1)
  })
})

describe('runSelfCheck', () => {
  it('flags pages whose rendered output diverges from the capture raster beyond the threshold', async () => {
    const onWarning = vi.fn()
    const deps = {
      decodeRaster: vi.fn(async () => solid(4, 4, 0, 0, 0)),
      // page 0 renders identical (diff 0), page 1 renders white (diff 1)
      renderPdfPage: vi.fn(async (_pdf: Uint8Array, pageIndex: number) =>
        pageIndex === 0 ? solid(4, 4, 0, 0, 0) : solid(4, 4, 255, 255, 255),
      ),
    }
    const results = await runSelfCheck({
      pdfBytes: new Uint8Array([1, 2, 3]),
      pageRasters: [new Uint8Array([9]), new Uint8Array([8])],
      rasterFormat: 'jpeg',
      threshold: 0.02,
      deps,
      onWarning,
    })
    expect(results).toEqual([
      { page: 1, diff: 0, exceeded: false },
      { page: 2, diff: 1, exceeded: true },
    ])
    // Only the diverging page warns, and the message names the page + percentage.
    expect(onWarning).toHaveBeenCalledOnce()
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/page 2/i)
    // The renderer is asked for the reference raster's pixel dimensions.
    expect(deps.renderPdfPage).toHaveBeenCalledWith(expect.anything(), 0, 4, 4)
  })

  it('soft-fails a page (warning, no throw) when rendering errors, and still checks the rest', async () => {
    const onWarning = vi.fn()
    const deps = {
      decodeRaster: vi.fn(async () => solid(2, 2, 0, 0, 0)),
      renderPdfPage: vi.fn(async (_pdf: Uint8Array, pageIndex: number) => {
        if (pageIndex === 0) throw new Error('pdf.js boom')
        return solid(2, 2, 0, 0, 0)
      }),
    }
    const results = await runSelfCheck({
      pdfBytes: new Uint8Array([1]),
      pageRasters: [new Uint8Array([9]), new Uint8Array([8])],
      rasterFormat: 'jpeg',
      threshold: 0.02,
      deps,
      onWarning,
    })
    // Page 1 skipped (errored), page 2 compared OK.
    expect(results).toEqual([{ page: 2, diff: 0, exceeded: false }])
    expect(onWarning).toHaveBeenCalledOnce()
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/page 1/i)
  })
})
