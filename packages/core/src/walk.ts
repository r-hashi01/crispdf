import { parseColor } from './color'
import { type DomPx, domPx, type FontStyle, type TextSpan } from './types'

/**
 * Extract every visible text fragment from `root` as a flat list of
 * line-level spans. Coordinates are returned relative to `root`'s top-left.
 *
 * Phase 0 scope: HTML text only. No SVG `<text>`, no `::before`/`::after`,
 * no Shadow DOM, no iframes.
 */
export function extractSpans(root: HTMLElement): TextSpan[] {
  const rootRect = root.getBoundingClientRect()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest('[data-vellum-raster-text]')) return NodeFilter.FILTER_REJECT
      const text = node.nodeValue ?? ''
      if (text.trim() === '') return NodeFilter.FILTER_REJECT
      const cs = window.getComputedStyle(parent)
      if (cs.visibility === 'hidden' || cs.display === 'none') {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const spans: TextSpan[] = []
  let node = walker.nextNode() as Text | null
  while (node !== null) {
    const parent = node.parentElement
    if (parent) {
      pushSpansForTextNode(node, parent, rootRect, spans)
    }
    node = walker.nextNode() as Text | null
  }
  return spans
}

function pushSpansForTextNode(
  text: Text,
  parent: HTMLElement,
  rootRect: DOMRect,
  out: TextSpan[],
): void {
  const range = document.createRange()
  range.selectNodeContents(text)
  const lineRects = mergeRectsByVisualLine(
    Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0),
  )
  if (lineRects.length === 0) return

  const cs = window.getComputedStyle(parent)
  const fontFamily = cs.fontFamily
  const fontSize = domPx(Number.parseFloat(cs.fontSize))
  const fontWeight = parseFontWeight(cs.fontWeight)
  const fontStyle = parseFontStyle(cs.fontStyle)
  const direction = cs.direction === 'rtl' ? 'rtl' : 'ltr'
  const color = parseColor(cs.color)
  const letterSpacing = domPx(Number.parseFloat(cs.letterSpacing) || 0)
  const whiteSpace = cs.whiteSpace

  const lines = splitTextByLines(text, lineRects)
  const hasContentBefore = hasContentSibling(text, 'previous')
  const hasContentAfter = hasContentSibling(text, 'next')

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (!line) continue
    const isFirst = li === 0
    const isLast = li === lines.length - 1
    const normalized = normalizeLineWhitespace(line.text, whiteSpace, {
      keepLeadingSpace: isFirst && hasContentBefore,
      keepTrailingSpace: isLast && hasContentAfter,
    })
    if (normalized === '') continue
    out.push({
      text: normalized,
      x: domPx(line.rect.x - rootRect.x),
      y: domPx(line.rect.y - rootRect.y),
      w: domPx(line.rect.width),
      h: domPx(line.rect.height),
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      direction,
      color,
      letterSpacing,
    })
  }
}

/**
 * Apply CSS `white-space` normalization to a single visual line's slice. The
 * raw text node `.data` includes source-HTML indentation (newlines + spaces)
 * that the browser collapses before laying the text out — so the rect.x we
 * captured corresponds to the trimmed-and-collapsed start, not the raw start.
 * If we hand the raw slice to `drawText` the leading whitespace is rendered
 * literally and pushes the visible text right by the width of the indent.
 *
 * `keepLeadingSpace` / `keepTrailingSpace` toggle preservation of a single
 * boundary space. They flip on at inline boundaries (e.g. text in `<b>` next
 * to a sibling text node) where stripping that space would silently mash two
 * words together — both visually in the vector layer (subtly, since rect.x
 * still reserves the gap) and in the copy-paste output (loudly).
 *
 * Phase 0 handles only the `normal` family. `pre` / `pre-wrap` preserve
 * whitespace and are deferred.
 */
function normalizeLineWhitespace(
  s: string,
  whiteSpace: string,
  opts: { keepLeadingSpace: boolean; keepTrailingSpace: boolean },
): string {
  if (whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'break-spaces') {
    return s
  }
  const collapsed = s.replace(/\s+/g, ' ')
  const trimmed = collapsed.trim()
  if (trimmed === '') return ''
  const lead = opts.keepLeadingSpace && /^\s/.test(s) ? ' ' : ''
  const trail = opts.keepTrailingSpace && /\s$/.test(s) ? ' ' : ''
  return lead + trimmed + trail
}

/**
 * Walk siblings in `direction` until we find one that contributes inline
 * content (a non-empty text node, or any non-block element with visible
 * content). Pure-whitespace text nodes and HTML comments are skipped — the
 * browser collapses them, and so should we.
 */
function hasContentSibling(node: Node, direction: 'previous' | 'next'): boolean {
  let sib: Node | null = direction === 'previous' ? node.previousSibling : node.nextSibling
  while (sib) {
    if (sib.nodeType === Node.TEXT_NODE) {
      if ((sib.nodeValue ?? '').trim() !== '') return true
    } else if (sib.nodeType === Node.ELEMENT_NODE) {
      const el = sib as Element
      const cs = window.getComputedStyle(el)
      if (cs.display !== 'none' && el.textContent && el.textContent.trim() !== '') return true
    }
    sib = direction === 'previous' ? sib.previousSibling : sib.nextSibling
  }
  return false
}

interface Line {
  text: string
  rect: DOMRect
}

/**
 * Browsers may return multiple rect fragments for one visual line (notably
 * bidi runs such as Arabic + Latin + digits). For line-level extraction we
 * need one rect per line, so we merge same-top fragments into their union.
 */
function mergeRectsByVisualLine(rects: DOMRect[]): DOMRect[] {
  if (rects.length <= 1) return rects
  const sorted = [...rects].sort((a, b) =>
    Math.abs(a.top - b.top) < 0.1 ? a.left - b.left : a.top - b.top,
  )
  const out: DOMRect[] = []
  const lineTolPx = 1
  for (const r of sorted) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(r.top - prev.top) <= lineTolPx) {
      const left = Math.min(prev.left, r.left)
      const top = Math.min(prev.top, r.top)
      const right = Math.max(prev.right, r.right)
      const bottom = Math.max(prev.bottom, r.bottom)
      out[out.length - 1] = new DOMRect(left, top, right - left, bottom - top)
      continue
    }
    out.push(new DOMRect(r.left, r.top, r.width, r.height))
  }
  return out
}

/**
 * Map characters of a text node onto the line rects it occupies. For wrapped
 * text, `lineRects` has one entry per visual line; we binary-search for each
 * line break by character offset.
 */
function splitTextByLines(text: Text, lineRects: DOMRect[]): Line[] {
  if (lineRects.length === 1) {
    const only = lineRects[0]
    if (!only) return []
    return [{ text: text.data, rect: only }]
  }

  const range = document.createRange()
  const length = text.data.length
  const result: Line[] = []
  let charStart = 0

  for (let i = 0; i < lineRects.length - 1; i++) {
    const currentLine = lineRects[i]
    if (!currentLine) continue
    const lineTop = currentLine.top
    // Find smallest offset > charStart whose character starts on a line below.
    let lo = charStart + 1
    let hi = length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      range.setStart(text, mid)
      range.setEnd(text, Math.min(mid + 1, length))
      const charRect = range.getBoundingClientRect()
      if (charRect.top > lineTop + 0.5) {
        hi = mid
      } else {
        lo = mid + 1
      }
    }
    result.push({ text: text.data.slice(charStart, lo), rect: currentLine })
    charStart = lo
  }
  const last = lineRects[lineRects.length - 1]
  if (last) {
    result.push({ text: text.data.slice(charStart), rect: last })
  }
  return result
}

function parseFontWeight(value: string): number {
  const n = Number.parseInt(value, 10)
  if (!Number.isNaN(n)) return n
  if (value === 'bold') return 700
  if (value === 'normal') return 400
  return 400
}

function parseFontStyle(value: string): FontStyle {
  if (value === 'italic' || value === 'oblique') return value
  return 'normal'
}

// Re-export DomPx for tests that want to assert on it
export type { DomPx }
