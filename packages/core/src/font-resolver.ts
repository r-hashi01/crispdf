import * as fontkit from 'fontkit'
import { type FontFaceRule, isAllowedFontUrl, matchFontFaceRules } from './font-discovery'
import { encodeWinAnsi } from './pdf-writer/winansi'
import type { FontStyle, TextSpan } from './types'
import { type CodePointRange, rangeCoversCodePoint } from './unicode-range'
import { decodeWoff2ToSfnt, isSfntBytes } from './woff2-decoder'

/**
 * Pick the candidates that should be considered for a span — every candidate
 * that shares the best matched `(family, weight, style)` triple in the span's
 * `font-family` chain. They typically differ only in `unicode-range`, and the
 * caller picks per character at draw time.
 *
 * Returns `[]` if no family in the chain has any candidate.
 */
export function findCandidatesForSpan(
  candidates: readonly WebFontCandidate[],
  span: { fontFamily: string; fontWeight: number; fontStyle: FontStyle },
): WebFontCandidate[] {
  const families = span.fontFamily.split(',').map((s) =>
    s
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase(),
  )
  for (const fam of families) {
    const pool = candidates.filter((c) => c.family === fam)
    if (pool.length === 0) continue
    const sameStyle = pool.filter((c) => c.style === span.fontStyle)
    const ranked = sameStyle.length > 0 ? sameStyle : pool
    let bestWeight = ranked[0]?.weight ?? span.fontWeight
    let bestDistance = Math.abs(bestWeight - span.fontWeight)
    for (const c of ranked) {
      const d = Math.abs(c.weight - span.fontWeight)
      if (d < bestDistance) {
        bestWeight = c.weight
        bestDistance = d
      }
    }
    const bestStyle = ranked[0]?.style ?? span.fontStyle
    return pool.filter((c) => c.weight === bestWeight && c.style === bestStyle)
  }
  return []
}

/**
 * Backwards-compat shim: returns the first candidate from `findCandidatesForSpan`
 * (i.e. one of the unicode-range subsets, deterministic in input order). Kept
 * for callers that don't yet do per-character selection.
 */
export function findCandidate(
  candidates: readonly WebFontCandidate[],
  span: { fontFamily: string; fontWeight: number; fontStyle: FontStyle },
): WebFontCandidate | null {
  const found = findCandidatesForSpan(candidates, span)
  return found[0] ?? null
}

/**
 * A web font that has been fetched and is ready to embed in the PDF. `bytes`
 * are decoded SFNT bytes (TTF/OTF); WOFF2 is unwrapped before this boundary so
 * the PDF writer never has to embed web-font containers.
 *
 * `unicodeRange` mirrors the `@font-face` descriptor; `null` means "covers
 * everything" (the CSS default when the descriptor is absent).
 */
export interface WebFontCandidate {
  family: string
  weight: number
  style: FontStyle
  bytes: Uint8Array
  unicodeRange: CodePointRange[] | null
}

export interface ResolveOptions {
  pageSpans: TextSpan[][]
  rules: FontFaceRule[]
  /** Injectable for testing — defaults to `globalThis.fetch`. */
  fetch?: typeof fetch
  /** Injectable WOFF2 decoder — defaults to the bundled decoder. */
  decodeWoff2?: (bytes: Uint8Array) => Promise<Uint8Array>
  onWarning?: (msg: string) => void
}

interface UsedFont {
  family: string
  weight: number
  style: FontStyle
  codePoints: Set<number>
}

interface FontResolveJob {
  rule: FontFaceRule
}

/**
 * Resolve every (family, weight, style) triple that the deck actually uses
 * into either a fetched font binary, or nothing (silent fallback to standard
 * PDF font). Network problems and disallowed origins surface as warnings; the
 * pipeline never throws on font issues because the standard-font fallback
 * always produces *something* selectable.
 */
export async function resolveWebFonts(opts: ResolveOptions): Promise<WebFontCandidate[]> {
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const decodeWoff2 = opts.decodeWoff2 ?? decodeWoff2ToSfnt
  const used = collectUsedFonts(opts.pageSpans)
  const jobs: FontResolveJob[] = []

  for (const u of used) {
    const matched = matchFontFaceRules(opts.rules, {
      fontFamily: u.family,
      fontWeight: u.weight,
      fontStyle: u.style,
    })
    if (matched.length === 0) continue
    for (const rule of matched) {
      if (!isAllowedFontUrl(rule.src)) {
        opts.onWarning?.(
          `Skipping @font-face for "${rule.family}" (${rule.src}): not on the Google Fonts allowlist. Phase 2 v1 only embeds fonts from fonts.gstatic.com / fonts.googleapis.com.`,
        )
        continue
      }
      if (!ruleCoversAnyUsedCodePoint(rule.unicodeRange, u.codePoints)) continue
      jobs.push({ rule })
    }
  }

  // Start every unique URL fetch/decode before awaiting any result. Google
  // Fonts commonly splits one family into several unicode-range subsets; doing
  // these sequentially makes the `fonts` stage pay the full network+decode sum.
  const fetched = new Map<string, Promise<Uint8Array | null>>()
  for (const { rule } of jobs) {
    if (!fetched.has(rule.src)) {
      fetched.set(rule.src, tryFetchBytes(fetchFn, decodeWoff2, rule, opts.onWarning))
    }
  }

  const out: WebFontCandidate[] = []
  for (const { rule } of jobs) {
    const bytes = await fetched.get(rule.src)
    if (!bytes) continue
    out.push({
      family: rule.family,
      weight: rule.weight,
      style: rule.style,
      bytes,
      unicodeRange: rule.unicodeRange,
    })
  }

  return out
}

/** Synthetic family for the on-demand fallback font; never matched by name. */
export const FALLBACK_FAMILY = '__vellum-fallback'

/** The weights Noto Sans JP comes in. */
const FALLBACK_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

/**
 * A span's candidates at draw time: its family-matched web fonts, then the
 * fallback font closest to its weight.
 */
export function candidatesForSpan(
  webFonts: readonly WebFontCandidate[],
  fallbacks: readonly WebFontCandidate[],
  span: TextSpan,
): WebFontCandidate[] {
  return [
    ...findCandidatesForSpan(webFonts, span),
    ...findCandidatesForSpan(fallbacks, { ...span, fontFamily: FALLBACK_FAMILY }),
  ]
}

/**
 * Whether a character needs no font from us: whitespace and control
 * characters, and what the standard PDF fonts encode (WinAnsi).
 */
export function standardDrawable(ch: string): boolean {
  return /\s|\p{Cc}/u.test(ch) || encodeWinAnsi(ch).unencodable.size === 0
}

export interface FallbackOptions {
  pageSpans: TextSpan[][]
  /** Already-resolved @font-face candidates, used to skip covered code points. */
  candidates: readonly WebFontCandidate[]
  fetch?: typeof fetch
  decodeWoff2?: (bytes: Uint8Array) => Promise<Uint8Array>
  /** The code points of `cps` the font has glyphs for. Default: read with fontkit. */
  coverage?: (bytes: Uint8Array, cps: ReadonlySet<number>) => Set<number>
  onWarning?: (msg: string) => void
}

/**
 * Resolve Noto Sans JP fallbacks for characters the deck uses but no embedded
 * font and no standard PDF font can render: CJK, and symbols outside WinAnsi
 * such as arrows. Rather than bundling a multi-MB face, we ask the Google
 * Fonts `text=` API for a subset holding only the characters used — one per
 * weight in use, so bold text stays bold.
 *
 * Each candidate covers exactly the code points its font has glyphs for (so
 * Latin keeps falling to the deck's own font). Network failures degrade to a
 * warning; that text then stays in the raster layer (see raster-text.ts).
 */
export async function resolveFallbackFonts(opts: FallbackOptions): Promise<WebFontCandidate[]> {
  const byWeight = collectUncovered(opts.pageSpans, opts.candidates)
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const decodeWoff2 = opts.decodeWoff2 ?? decodeWoff2ToSfnt
  const coverage = opts.coverage ?? glyphCoverage
  const resolved = await Promise.all(
    [...byWeight].map(async ([weight, needed]) => {
      const chars = [...needed]
        .sort((a, b) => a - b)
        .map((cp) => String.fromCodePoint(cp))
        .join('')
      const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&text=${encodeURIComponent(chars)}`
      const fail = (why: string): null => {
        opts.onWarning?.(
          `Noto Sans JP fallback (weight ${weight}): ${why}. That text stays in the raster (visible, not selectable).`,
        )
        return null
      }
      try {
        const cssRes = await fetchFn(cssUrl)
        if (!cssRes.ok) return fail(`fetching the CSS failed: HTTP ${cssRes.status}`)
        const src = parseFirstFontUrl(await cssRes.text())
        if (!src || !isAllowedFontUrl(src)) return fail('no Google Fonts subset URL in the CSS')
        const fontRes = await fetchFn(src)
        if (!fontRes.ok) return fail(`fetching the subset failed: HTTP ${fontRes.status}`)
        const raw = new Uint8Array(await fontRes.arrayBuffer())
        const bytes = isWoff2(raw) ? await decodeWoff2(raw) : raw
        if (!isSfntBytes(bytes)) return fail('the subset did not decode to SFNT')
        const covered = coverage(bytes, needed)
        if (covered.size === 0) return null
        const candidate: WebFontCandidate = {
          family: FALLBACK_FAMILY,
          weight,
          style: 'normal',
          bytes,
          unicodeRange: codePointsToRanges(covered),
        }
        return candidate
      } catch (err) {
        return fail(`resolving it threw: ${(err as Error).message}`)
      }
    }),
  )
  return resolved.filter((c): c is WebFontCandidate => c !== null)
}

/**
 * Code points, by fallback weight, that spans use but neither a matched
 * @font-face candidate nor a standard PDF font can draw.
 */
function collectUncovered(
  pageSpans: TextSpan[][],
  candidates: readonly WebFontCandidate[],
): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>()
  for (const spans of pageSpans) {
    for (const s of spans) {
      const spanCandidates = findCandidatesForSpan(candidates, s)
      for (const ch of s.text) {
        const cp = ch.codePointAt(0)
        if (cp === undefined || standardDrawable(ch)) continue
        if (spanCandidates.some((c) => rangeCoversCodePoint(c.unicodeRange, cp))) continue
        const weight = nearestWeight(s.fontWeight)
        let set = out.get(weight)
        if (!set) {
          set = new Set()
          out.set(weight, set)
        }
        set.add(cp)
      }
    }
  }
  return out
}

function nearestWeight(weight: number): number {
  return FALLBACK_WEIGHTS.reduce((best, w) =>
    Math.abs(w - weight) < Math.abs(best - weight) ? w : best,
  )
}

function glyphCoverage(bytes: Uint8Array, cps: ReadonlySet<number>): Set<number> {
  const font = (
    fontkit as unknown as {
      create: (b: Uint8Array) => { hasGlyphForCodePoint(cp: number): boolean }
    }
  ).create(bytes)
  return new Set([...cps].filter((cp) => font.hasGlyphForCodePoint(cp)))
}

function codePointsToRanges(cps: ReadonlySet<number>): CodePointRange[] {
  return [...cps].sort((a, b) => a - b).map((cp) => ({ start: cp, end: cp }))
}

function parseFirstFontUrl(css: string): string | null {
  const m = css.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)
  return m?.[1] ?? null
}

async function tryFetchBytes(
  fetchFn: typeof fetch,
  decodeWoff2: (bytes: Uint8Array) => Promise<Uint8Array>,
  rule: FontFaceRule,
  onWarning: ((msg: string) => void) | undefined,
): Promise<Uint8Array | null> {
  try {
    const res = await fetchFn(rule.src)
    if (!res.ok) {
      onWarning?.(
        `Fetching @font-face for "${rule.family}" (${rule.src}) failed: HTTP ${res.status}. Falling back to standard PDF font.`,
      )
      return null
    }
    const raw = new Uint8Array(await res.arrayBuffer())
    if (!isWoff2(raw)) {
      if (!isSfntBytes(raw)) {
        onWarning?.(
          `Skipping @font-face for "${rule.family}" (${rule.src}): unsupported font container "${readTag(raw)}". ` +
            `Only SFNT/OTF/TTF (or WOFF2 that decodes to SFNT) are embedded to keep Adobe-compatible PDFs.`,
        )
        return null
      }
      return raw
    }
    try {
      return await decodeWoff2(raw)
    } catch (err) {
      onWarning?.(
        `Decoding WOFF2 @font-face for "${rule.family}" (${rule.src}) failed: ${(err as Error).message}. ` +
          `Skipping this font to keep PDF font embedding Adobe-compatible.`,
      )
      return null
    }
  } catch (err) {
    onWarning?.(
      `Fetching @font-face for "${rule.family}" (${rule.src}) threw: ${(err as Error).message}. Falling back to standard PDF font.`,
    )
    return null
  }
}

function isWoff2(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x77 &&
    bytes[1] === 0x4f &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x32
  )
}

function readTag(bytes: Uint8Array): string {
  if (bytes.length < 4) return '<short>'
  return String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0)
}

function ruleCoversAnyUsedCodePoint(
  ranges: CodePointRange[] | null,
  codePoints: ReadonlySet<number>,
): boolean {
  if (ranges === null) return true
  for (const cp of codePoints) {
    if (rangeCoversCodePoint(ranges, cp)) return true
  }
  return false
}

/**
 * Per-span resolution wraps each span's `font-family` chain. We deduplicate
 * here on the *raw* `font-family` string (not the matched rule) because two
 * spans with the same family chain will resolve to the same rule, but two
 * spans whose chains differ may legitimately need different fonts.
 */
function collectUsedFonts(pageSpans: TextSpan[][]): UsedFont[] {
  const seen = new Map<string, UsedFont>()
  const out: UsedFont[] = []
  for (const spans of pageSpans) {
    for (const s of spans) {
      const key = `${s.fontFamily}\0${s.fontWeight}\0${s.fontStyle}`
      let used = seen.get(key)
      if (!used) {
        used = {
          family: s.fontFamily,
          weight: s.fontWeight,
          style: s.fontStyle,
          codePoints: new Set(),
        }
        seen.set(key, used)
        out.push(used)
      }
      for (const ch of s.text) {
        const cp = ch.codePointAt(0)
        if (cp !== undefined) used.codePoints.add(cp)
      }
    }
  }
  return out
}
