import { pickStandardFont, type StandardFontKey } from './font-mapping'
import { findCandidatesForSpan, type WebFontCandidate } from './font-resolver'
import { planInlineLayout } from './layout'
import type { CidFontHandle } from './pdf-writer/cid-font'
import { PdfDoc, type StandardFontHandle, type StandardFontName } from './pdf-writer/pdf-doc'
import { measureStandardFont } from './pdf-writer/standard-font-metrics'
import type { TextSpan } from './types'
import { rangeCoversCodePoint } from './unicode-range'

export interface EmitOptions {
  pageRasters: Uint8Array[]
  pageSpans: TextSpan[][]
  /**
   * @font-face fonts already fetched from allowed origins. Each becomes a
   * subsetted CID-keyed PDF font; spans whose font-family chain matches a
   * candidate use it instead of the standard PDF font fallback.
   */
  webFonts: WebFontCandidate[]
  /** Logical DOM size of every page (assumed identical). */
  source: { width: number; height: number }
  /** PDF page size in points. */
  output: { width: number; height: number }
  rasterFormat: 'jpeg' | 'png'
}

export interface EmitResult {
  bytes: Uint8Array
  warnings: string[]
}

type AnyFont = CidFontHandle | StandardFontHandle

export async function emitPdf(opts: EmitOptions): Promise<EmitResult> {
  const doc = new PdfDoc()
  const warnings: string[] = []
  const unencodableStandard = new Set<string>()

  // Pre-walk every page span, identify which @font-face candidates would
  // actually be picked at draw time (per char, by unicode-range), and embed
  // only those. Skipping unused subsets keeps the output minimal and
  // matches the contract finalize() expects (every embedded font has at
  // least one drawn glyph for sane subsetting).
  const usedCandidates = new Set<WebFontCandidate>()
  for (const pageSpansSet of opts.pageSpans) {
    for (const span of pageSpansSet) {
      const candidates = findCandidatesForSpan(opts.webFonts, span)
      if (candidates.length === 0) continue
      for (const ch of span.text) {
        const cp = ch.codePointAt(0) ?? 0
        for (const c of candidates) {
          if (rangeCoversCodePoint(c.unicodeRange, cp)) {
            usedCandidates.add(c)
            break
          }
        }
      }
    }
  }

  const cidFonts = new Map<WebFontCandidate, CidFontHandle>()
  for (const wf of opts.webFonts) {
    if (!usedCandidates.has(wf)) continue
    try {
      cidFonts.set(
        wf,
        doc.embedCidFont(wf.bytes, {
          onWarning: (msg) => warnings.push(`@font-face "${wf.family}": ${msg}`),
        }),
      )
    } catch (err) {
      warnings.push(
        `Embedding @font-face "${wf.family}" failed: ${(err as Error).message}. ` +
          `Falling back to the standard PDF font for that span.`,
      )
    }
  }

  // Lazily embed only the standard fonts that actually appear in the deck.
  const standardFonts = new Map<StandardFontKey, StandardFontHandle>()
  const getStandardFont = (key: StandardFontKey): StandardFontHandle => {
    let h = standardFonts.get(key)
    if (!h) {
      h = doc.embedStandardFont(key as StandardFontName)
      standardFonts.set(key, h)
    }
    return h
  }

  const scaleX = opts.output.width / opts.source.width
  const scaleY = opts.output.height / opts.source.height

  for (let i = 0; i < opts.pageRasters.length; i++) {
    const rasterBytes = opts.pageRasters[i]
    if (!rasterBytes) continue
    const page = doc.addPage(opts.output.width, opts.output.height)
    const img =
      opts.rasterFormat === 'jpeg' ? doc.embedJpeg(rasterBytes) : await doc.embedPng(rasterBytes)
    page.drawImage(img, 0, 0, opts.output.width, opts.output.height)

    const spans = opts.pageSpans[i] ?? []

    interface DrawRun {
      font: AnyFont
      text: string
      direction: 'ltr' | 'rtl'
      widthDom: number
    }
    interface SpanPlan {
      span: TextSpan
      runs: DrawRun[]
      totalWidthDom: number
    }
    const spanPlans: SpanPlan[] = []
    for (const span of spans) {
      const candidates = findCandidatesForSpan(opts.webFonts, span)
      const stdKey = pickStandardFont(span)
      const stdHandle = getStandardFont(stdKey)
      const fontSizePt = span.fontSize * scaleY
      const runs = splitIntoRuns(
        span.text,
        candidates,
        cidFonts,
        stdHandle,
        span.direction ?? 'ltr',
      )
      const drawRuns: DrawRun[] = []
      for (const r of runs) {
        if (r.font.kind === 'cid') {
          const enc = r.font.encode(r.text, r.direction)
          if (enc.bytes.length > 0) {
            const widthPt = (enc.widthUnits * fontSizePt) / 1000
            drawRuns.push({
              font: r.font,
              text: r.text,
              direction: r.direction,
              widthDom: widthPt / scaleX,
            })
            continue
          }
          // CID layout failed (encode emitted a warning). Try the span's
          // standard-font fallback so the chars don't silently disappear.
          const fallback = measureStandardFont(stdKey as StandardFontName, r.text, fontSizePt)
          for (const ch of fallback.unencodable) unencodableStandard.add(ch)
          if (fallback.widthPt > 0) {
            drawRuns.push({
              font: stdHandle,
              text: r.text,
              direction: r.direction,
              widthDom: fallback.widthPt / scaleX,
            })
          }
        } else {
          const m = measureStandardFont(stdKey as StandardFontName, r.text, fontSizePt)
          for (const ch of m.unencodable) unencodableStandard.add(ch)
          if (m.widthPt === 0) continue
          drawRuns.push({
            font: r.font,
            text: r.text,
            direction: r.direction,
            widthDom: m.widthPt / scaleX,
          })
        }
      }
      // The whole span is unencodable — skip entirely so the missing text is
      // *visible* (no selectable layer there) rather than silently substituted.
      if (drawRuns.length === 0) continue
      const totalWidthDom = drawRuns.reduce((s, d) => s + d.widthDom, 0)
      spanPlans.push({ span, runs: drawRuns, totalWidthDom })
    }

    const layout = planInlineLayout(
      spanPlans.map((sp) => ({ span: sp.span, drawnWidthDom: sp.totalWidthDom })),
    )

    for (let j = 0; j < spanPlans.length; j++) {
      const sp = spanPlans[j]
      const plan = layout[j]
      if (!sp || !plan) continue
      // CSS rect.y is the top of the line box (axis pointing down).
      // PDF drawText's y is the baseline (axis pointing up from page bottom).
      const baselineCss = sp.span.y + sp.span.h
      const baselinePdf = opts.output.height - baselineCss * scaleY
      const direction = sp.span.direction ?? 'ltr'
      if (direction === 'rtl') {
        let runX = plan.drawnX + sp.totalWidthDom
        for (const run of sp.runs) {
          runX -= run.widthDom
          page.drawText(
            run.text,
            run.font,
            runX * scaleX,
            baselinePdf,
            sp.span.fontSize * scaleY,
            run.direction,
            sp.span.color,
          )
        }
      } else {
        let runX = plan.drawnX
        for (const run of sp.runs) {
          page.drawText(
            run.text,
            run.font,
            runX * scaleX,
            baselinePdf,
            sp.span.fontSize * scaleY,
            run.direction,
            sp.span.color,
          )
          runX += run.widthDom
        }
      }
    }
  }

  if (unencodableStandard.size > 0) {
    const sample = [...unencodableStandard].slice(0, 12).join('')
    warnings.push(
      `Standard PDF fonts cannot encode ${unencodableStandard.size} character(s); ` +
        `text containing them was dropped from the selectable layer (raster still shows them). ` +
        `Sample: "${sample}". Add an @font-face that covers these characters to fix.`,
    )
  }

  return { bytes: doc.save(), warnings }
}

interface RunSlice {
  font: AnyFont
  text: string
  direction: 'ltr' | 'rtl'
}

/**
 * Split a span's text into runs, each mapped to the first font that can
 * actually serve that character — first-match-wins through the matched
 * web-font candidates by unicode-range, falling back to the standard 14
 * font picked for the span.
 *
 * Consecutive characters with the same font collapse into one run, so we
 * only emit one drawText per font-switch and each font's glyph subset stays
 * tight.
 */
function splitIntoRuns(
  text: string,
  candidates: readonly WebFontCandidate[],
  cidFonts: Map<WebFontCandidate, CidFontHandle>,
  fallback: StandardFontHandle,
  direction: 'ltr' | 'rtl' = 'ltr',
): RunSlice[] {
  const directionalRuns = splitDirectionalRuns(text, direction)

  // Complex RTL scripts (Arabic, Hebrew, etc.) depend on contextual shaping.
  // Splitting per-character across unicode-range subsets breaks joins/marks.
  // For RTL spans we pick one best CID candidate and lay out the whole run
  // through a single shaper invocation.
  if (direction === 'rtl') {
    const runs: RunSlice[] = []
    for (const dr of directionalRuns) {
      const best = pickBestCoverageCandidate(dr.text, candidates)
      const handle = best ? cidFonts.get(best) : null
      runs.push({ font: handle ?? fallback, text: dr.text, direction: dr.direction })
    }
    return runs
  }

  // LTR paragraph with embedded RTL script (e.g. "Latin العربية BOLD"):
  // detect the RTL segment and shape that sub-run with direction=rtl.
  if (directionalRuns.some((r) => r.direction === 'rtl')) {
    const out: RunSlice[] = []
    for (const dr of directionalRuns) {
      if (dr.direction === 'rtl') {
        const best = pickBestCoverageCandidate(dr.text, candidates)
        const handle = best ? cidFonts.get(best) : null
        out.push({ font: handle ?? fallback, text: dr.text, direction: 'rtl' })
        continue
      }
      out.push(...splitLtrByFont(dr.text, candidates, cidFonts, fallback))
    }
    return mergeAdjacentRuns(out)
  }

  return splitLtrByFont(text, candidates, cidFonts, fallback)
}

function splitLtrByFont(
  text: string,
  candidates: readonly WebFontCandidate[],
  cidFonts: Map<WebFontCandidate, CidFontHandle>,
  fallback: StandardFontHandle,
): RunSlice[] {
  // If one candidate fully covers this run, keep it as a single run.
  // This avoids unnecessary per-character font switching on scripts like CJK.
  const best = pickBestCoverageCandidate(text, candidates)
  if (best) {
    const covered = countCoveredCodePoints(text, best)
    const total = countRelevantCodePoints(text)
    const handle = cidFonts.get(best)
    if (handle && total > 0 && covered === total) {
      return [{ font: handle, text, direction: 'ltr' }]
    }
  }

  const runs: RunSlice[] = []
  let cur: RunSlice | null = null
  for (const cluster of splitGraphemeClusters(text)) {
    const cps = [...cluster]
      .map((ch) => ch.codePointAt(0) ?? 0)
      .filter((cp) => !isIgnorableForFontPick(cp))
    let chosen: AnyFont = fallback
    if (cps.length === 0 && cur) {
      chosen = cur.font
    } else {
      const full = findFullyCoveringCandidate(cps, candidates)
      if (full) {
        const handle = cidFonts.get(full)
        if (handle) chosen = handle
      } else {
        const partial = pickBestCoverageCandidate(cluster, candidates)
        const handle = partial ? cidFonts.get(partial) : null
        if (handle) chosen = handle
      }
    }
    if (cur && cur.font === chosen) {
      cur.text += cluster
    } else {
      cur = { font: chosen, text: cluster, direction: 'ltr' }
      runs.push(cur)
    }
  }
  return runs
}

function mergeAdjacentRuns(runs: readonly RunSlice[]): RunSlice[] {
  const merged: RunSlice[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && last.font === r.font && last.direction === r.direction) {
      last.text += r.text
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

interface DirectionalTextRun {
  text: string
  direction: 'ltr' | 'rtl'
}

interface RawDirectionalRun {
  text: string
  cls: 'ltr' | 'rtl' | 'neutral'
}

const RTL_STRONG_RE =
  /[\p{Script_Extensions=Arabic}\p{Script_Extensions=Hebrew}\p{Script_Extensions=Syriac}\p{Script_Extensions=Thaana}\p{Script_Extensions=Nko}\p{Script_Extensions=Adlam}\p{Script_Extensions=Mandaic}]/u
const LTR_STRONG_RE = /[\p{Letter}\p{Number}]/u

function splitDirectionalRuns(text: string, baseDir: 'ltr' | 'rtl'): DirectionalTextRun[] {
  const raw: RawDirectionalRun[] = []
  for (const ch of text) {
    const cls = classifyDirection(ch)
    const last = raw[raw.length - 1]
    if (last && last.cls === cls) last.text += ch
    else raw.push({ text: ch, cls })
  }
  const resolved: DirectionalTextRun[] = raw.map((r, i) => {
    if (r.cls === 'neutral') {
      return {
        text: r.text,
        // Keep neutral punctuation/numbers LTR-shaped so they are not
        // character-reversed under a surrounding rtl paragraph.
        direction: 'ltr',
      }
    }
    return { text: r.text, direction: resolveRunDirection(raw, i, baseDir) }
  })
  const merged: DirectionalTextRun[] = []
  for (const r of resolved) {
    const last = merged[merged.length - 1]
    if (last && last.direction === r.direction) last.text += r.text
    else merged.push({ ...r })
  }
  return merged
}

function resolveRunDirection(
  runs: readonly RawDirectionalRun[],
  index: number,
  baseDir: 'ltr' | 'rtl',
): 'ltr' | 'rtl' {
  const cls = runs[index]?.cls
  if (cls === 'ltr' || cls === 'rtl') return cls

  for (let i = index - 1; i >= 0; i--) {
    const c = runs[i]?.cls
    if (c === 'ltr' || c === 'rtl') return c
  }
  for (let i = index + 1; i < runs.length; i++) {
    const c = runs[i]?.cls
    if (c === 'ltr' || c === 'rtl') return c
  }
  return baseDir
}

function classifyDirection(ch: string): 'ltr' | 'rtl' | 'neutral' {
  if (RTL_STRONG_RE.test(ch)) return 'rtl'
  if (LTR_STRONG_RE.test(ch)) return 'ltr'
  return 'neutral'
}

function pickBestCoverageCandidate(
  text: string,
  candidates: readonly WebFontCandidate[],
): WebFontCandidate | null {
  let best: WebFontCandidate | null = null
  let bestScore = -1
  for (const c of candidates) {
    let score = 0
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0
      if (rangeCoversCodePoint(c.unicodeRange, cp)) score++
    }
    if (score > bestScore) {
      best = c
      bestScore = score
    }
  }
  return best
}

function countCoveredCodePoints(text: string, candidate: WebFontCandidate): number {
  let count = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isIgnorableForFontPick(cp)) continue
    if (rangeCoversCodePoint(candidate.unicodeRange, cp)) count++
  }
  return count
}

function countRelevantCodePoints(text: string): number {
  let count = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isIgnorableForFontPick(cp)) continue
    count++
  }
  return count
}

function findFullyCoveringCandidate(
  cps: readonly number[],
  candidates: readonly WebFontCandidate[],
): WebFontCandidate | null {
  for (const c of candidates) {
    let ok = true
    for (const cp of cps) {
      if (!rangeCoversCodePoint(c.unicodeRange, cp)) {
        ok = false
        break
      }
    }
    if (ok) return c
  }
  return null
}

function isIgnorableForFontPick(cp: number): boolean {
  if (cp === 0x200d) return true
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true
  return false
}

function splitGraphemeClusters(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return [...seg.segment(text)].map((s) => s.segment)
  }
  return [...text]
}
