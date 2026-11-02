import { candidatesForSpan, standardDrawable, type WebFontCandidate } from './font-resolver'
import type { TextSpan } from './types'
import { rangeCoversCodePoint } from './unicode-range'
import { sourceOf } from './walk'

export interface RasterTextResult {
  /** The spans still drawn as PDF text. */
  pageSpans: TextSpan[][]
  /** Characters no font could draw (a sample for the warning). */
  undrawable: Set<string>
  /** Remove the markers this added. */
  release(): void
}

/**
 * Keep text no font can draw in the raster: mark the element it renders in
 * with `data-vellum-raster-text` (the capture leaves such text visible) and
 * leave that element's spans out of the text layer, so the text is shown
 * once, as pixels, instead of disappearing from both layers.
 */
export function keepUndrawableInRaster(
  pageSpans: TextSpan[][],
  webFonts: readonly WebFontCandidate[],
  fallbacks: readonly WebFontCandidate[],
): RasterTextResult {
  const marked: Element[] = []
  const undrawable = new Set<string>()
  for (const spans of pageSpans) {
    for (const span of spans) {
      const candidates = candidatesForSpan(webFonts, fallbacks, span)
      const missing = [...span.text].filter((ch) => {
        if (standardDrawable(ch)) return false
        const cp = ch.codePointAt(0) ?? 0
        return !candidates.some((c) => rangeCoversCodePoint(c.unicodeRange, cp))
      })
      if (missing.length === 0) continue
      for (const ch of missing) undrawable.add(ch)
      const el = sourceOf(span)
      if (el && !el.hasAttribute('data-vellum-raster-text')) {
        el.setAttribute('data-vellum-raster-text', '')
        marked.push(el)
      }
    }
  }
  const kept = (span: TextSpan) => !marked.some((el) => el.contains(sourceOf(span) ?? null))
  return {
    pageSpans: marked.length > 0 ? pageSpans.map((spans) => spans.filter(kept)) : pageSpans,
    undrawable,
    release: () => {
      for (const el of marked) el.removeAttribute('data-vellum-raster-text')
    },
  }
}
