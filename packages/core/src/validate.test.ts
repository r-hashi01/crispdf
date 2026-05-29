import { afterEach, describe, expect, it } from 'vitest'
import { validate } from './validate'

const tracked: HTMLElement[] = []
function makePage(html: string): HTMLElement {
  const page = document.createElement('div')
  page.style.cssText = 'width:800px;height:600px;position:relative;background:#fff'
  page.innerHTML = html
  document.body.appendChild(page)
  tracked.push(page)
  return page
}
afterEach(() => {
  for (const n of tracked.splice(0)) n.remove()
})

describe('validate', () => {
  it('reports a clean page as ok with no issues', () => {
    const page = makePage('<h1>Hello</h1><p>Just text and <b>bold</b>.</p>')
    const result = validate([page])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('flags <canvas> as a hard error (text inside is unextractable → silent loss)', () => {
    const page = makePage('<p>ok</p><canvas width="100" height="80"></canvas>')
    const result = validate([page])
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.element.tagName).toBe('CANVAS')
    expect(result.errors[0]?.rule).toBe('canvas')
  })

  it('flags <video> as a hard error', () => {
    const page = makePage('<video src="x.mp4"></video>')
    const result = validate([page])
    expect(result.ok).toBe(false)
    expect(result.errors.map((e) => e.rule)).toContain('video')
  })

  it('warns on mix-blend-mode (rasterized, not blended with the vector layer)', () => {
    const page = makePage('<div style="mix-blend-mode: multiply">x</div>')
    const result = validate([page])
    expect(result.ok).toBe(true) // warnings don't fail validation
    expect(result.warnings.map((w) => w.rule)).toContain('mix-blend-mode')
  })

  it('warns on filter: blur()', () => {
    const page = makePage('<div style="filter: blur(3px)">x</div>')
    const result = validate([page])
    expect(result.warnings.map((w) => w.rule)).toContain('filter')
  })

  it('warns on backdrop-filter', () => {
    const page = makePage('<div style="backdrop-filter: blur(4px)">x</div>')
    const result = validate([page])
    expect(result.warnings.map((w) => w.rule)).toContain('backdrop-filter')
  })

  it('warns on position: sticky (meaningless for a single fixed-size page)', () => {
    const page = makePage('<div style="position: sticky; top: 0">x</div>')
    const result = validate([page])
    expect(result.warnings.map((w) => w.rule)).toContain('position-sticky')
  })

  it('warns on a 3D transform but not on a plain 2D transform', () => {
    const page3d = makePage('<div style="transform: rotateX(45deg)">x</div>')
    expect(validate([page3d]).warnings.map((w) => w.rule)).toContain('transform-3d')

    const page2d = makePage('<div style="transform: translateX(10px) scale(1.2)">x</div>')
    expect(validate([page2d]).warnings.map((w) => w.rule)).not.toContain('transform-3d')
  })

  it('aggregates issues across multiple pages', () => {
    const a = makePage('<canvas></canvas>')
    const b = makePage('<div style="mix-blend-mode: screen">x</div>')
    const result = validate([a, b])
    expect(result.errors).toHaveLength(1)
    expect(result.warnings.length).toBeGreaterThanOrEqual(1)
  })
})
