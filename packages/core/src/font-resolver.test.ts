import { describe, expect, it, vi } from 'vitest'
import type { FontFaceRule } from './font-discovery'
import {
  findCandidatesForSpan,
  resolveFallbackFonts,
  resolveWebFonts,
  type WebFontCandidate,
} from './font-resolver'
import { domPx, type FontStyle, type TextSpan } from './types'
import { rangeCoversCodePoint } from './unicode-range'

function span(
  fontFamily: string,
  fontWeight = 400,
  fontStyle: FontStyle = 'normal',
  text = 'x',
): TextSpan {
  return {
    text,
    x: domPx(0),
    y: domPx(0),
    w: domPx(0),
    h: domPx(0),
    fontFamily,
    fontSize: domPx(16),
    fontWeight,
    fontStyle,
    color: { r: 0, g: 0, b: 0, a: 1 },
    letterSpacing: domPx(0),
  }
}

const interBytes = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x01]) // SFNT stub
const interBoldBytes = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0x02]) // OTF stub

function makeFetch(map: Record<string, Uint8Array>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const bytes = map[url]
    if (!bytes) {
      return new Response(null, { status: 404 })
    }
    return new Response(bytes.slice().buffer, { status: 200 })
  })
}

describe('resolveWebFonts', () => {
  const interRule: FontFaceRule = {
    family: 'inter',
    weight: 400,
    style: 'normal',
    src: 'https://fonts.gstatic.com/s/inter/inter-regular.woff2',
    unicodeRange: null,
  }
  const interBoldRule: FontFaceRule = {
    family: 'inter',
    weight: 700,
    style: 'normal',
    src: 'https://fonts.gstatic.com/s/inter/inter-bold.woff2',
    unicodeRange: null,
  }

  it('fetches one set of bytes per unique (family, weight, style) used by spans', async () => {
    const fetchFn = makeFetch({
      [interRule.src]: interBytes,
      [interBoldRule.src]: interBoldBytes,
    })
    const candidates = await resolveWebFonts({
      pageSpans: [
        [span('Inter, sans-serif', 400)],
        [span('Inter, sans-serif', 400, 'normal', 'more text')], // dup → same fetch
        [span('Inter, sans-serif', 700)],
      ],
      rules: [interRule, interBoldRule],
      fetch: fetchFn,
    })
    expect(candidates).toHaveLength(2)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    const families = candidates.map((c) => `${c.family}-${c.weight}`).sort()
    expect(families).toEqual(['inter-400', 'inter-700'])
  })

  it('skips spans with no @font-face match (silently — the standard-font fallback handles them)', async () => {
    const fetchFn = makeFetch({})
    const candidates = await resolveWebFonts({
      pageSpans: [[span('Arial, sans-serif')]], // no rule for arial
      rules: [interRule],
      fetch: fetchFn,
    })
    expect(candidates).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('skips rules whose src is not on the Google Fonts allowlist and emits a warning', async () => {
    const evilRule: FontFaceRule = {
      family: 'evil',
      weight: 400,
      style: 'normal',
      src: 'https://attacker.example/font.woff2',
      unicodeRange: null,
    }
    const fetchFn = makeFetch({})
    const result = await resolveWebFonts({
      pageSpans: [[span('Evil, sans-serif')]],
      rules: [evilRule],
      fetch: fetchFn,
      onWarning: vi.fn(),
    })
    expect(result).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('fetches every unicode-range subset that shares the matched (family, weight, style)', async () => {
    // Google Fonts splits a single Inter 400 into latin / latin-ext / cyrillic
    // subsets. All three must be fetched so per-character selection at draw
    // time can pick the right one for non-ASCII characters.
    const latin: FontFaceRule = {
      family: 'inter',
      weight: 400,
      style: 'normal',
      src: 'https://fonts.gstatic.com/s/inter/latin.woff2',
      unicodeRange: [{ start: 0, end: 0x024f }],
    }
    const latinExt: FontFaceRule = {
      family: 'inter',
      weight: 400,
      style: 'normal',
      src: 'https://fonts.gstatic.com/s/inter/latin-ext.woff2',
      unicodeRange: [{ start: 0x0100, end: 0x024f }],
    }
    const cyrillic: FontFaceRule = {
      family: 'inter',
      weight: 400,
      style: 'normal',
      src: 'https://fonts.gstatic.com/s/inter/cyrillic.woff2',
      unicodeRange: [{ start: 0x0400, end: 0x04ff }],
    }
    const fetchFn = makeFetch({
      [latin.src]: new Uint8Array([0x00, 0x01, 0x00, 0x00, 1]),
      [latinExt.src]: new Uint8Array([0x00, 0x01, 0x00, 0x00, 2]),
      [cyrillic.src]: new Uint8Array([0x00, 0x01, 0x00, 0x00, 3]),
    })
    const candidates = await resolveWebFonts({
      pageSpans: [[span('Inter, sans-serif', 400, 'normal', 'xĀЖ')]],
      rules: [latin, latinExt, cyrillic],
      fetch: fetchFn,
    })
    expect(candidates).toHaveLength(3)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    const ranges = candidates.map((c) => c.unicodeRange?.[0]?.start ?? -1).sort((a, b) => a - b)
    expect(ranges).toEqual([0, 0x100, 0x400])
  })

  it('skips unicode-range subsets that cannot cover any used code point', async () => {
    const latin: FontFaceRule = {
      family: 'inter',
      weight: 400,
      style: 'normal',
      src: 'https://fonts.gstatic.com/s/inter/latin.woff2',
      unicodeRange: [{ start: 0, end: 0x024f }],
    }
    const cyrillic: FontFaceRule = {
      family: 'inter',
      weight: 400,
      style: 'normal',
      src: 'https://fonts.gstatic.com/s/inter/cyrillic.woff2',
      unicodeRange: [{ start: 0x0400, end: 0x04ff }],
    }
    const fetchFn = makeFetch({
      [latin.src]: new Uint8Array([0x00, 0x01, 0x00, 0x00, 1]),
      [cyrillic.src]: new Uint8Array([0x00, 0x01, 0x00, 0x00, 2]),
    })
    const candidates = await resolveWebFonts({
      pageSpans: [[span('Inter, sans-serif', 400, 'normal', 'only latin')]],
      rules: [latin, cyrillic],
      fetch: fetchFn,
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.unicodeRange).toEqual(latin.unicodeRange)
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledWith(latin.src)
  })

  it('starts unique unicode-range font fetches in parallel while preserving candidate order', async () => {
    const rules: FontFaceRule[] = [
      {
        family: 'inter',
        weight: 400,
        style: 'normal',
        src: 'https://fonts.gstatic.com/s/inter/latin.woff2',
        unicodeRange: [{ start: 0, end: 0x024f }],
      },
      {
        family: 'inter',
        weight: 400,
        style: 'normal',
        src: 'https://fonts.gstatic.com/s/inter/latin-ext.woff2',
        unicodeRange: [{ start: 0x0100, end: 0x024f }],
      },
      {
        family: 'inter',
        weight: 400,
        style: 'normal',
        src: 'https://fonts.gstatic.com/s/inter/cyrillic.woff2',
        unicodeRange: [{ start: 0x0400, end: 0x04ff }],
      },
    ]
    const pending: Array<() => void> = []
    const fetchFn = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(new Response(interBytes.slice().buffer, { status: 200 })))
        }),
    )

    const result = resolveWebFonts({
      pageSpans: [[span('Inter, sans-serif', 400, 'normal', 'xĀЖ')]],
      rules,
      fetch: fetchFn,
    })

    await Promise.resolve()
    expect(fetchFn).toHaveBeenCalledTimes(3)

    pending[1]?.()
    pending[2]?.()
    pending[0]?.()

    const candidates = await result
    expect(candidates).toHaveLength(3)
    expect(candidates.map((c) => c.unicodeRange?.[0]?.start ?? -1)).toEqual([0, 0x100, 0x400])
  })

  it('treats a fetch failure as a soft fallback (no throw, warning emitted, std font used downstream)', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 503 }))
    const onWarning = vi.fn()
    const result = await resolveWebFonts({
      pageSpans: [[span('Inter, sans-serif')]],
      rules: [interRule],
      fetch: fetchFn,
      onWarning,
    })
    expect(result).toEqual([])
    expect(onWarning).toHaveBeenCalledOnce()
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/inter/i)
  })

  it('decodes fetched WOFF2 bytes to SFNT before returning candidates', async () => {
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x02, 0x03])
    const sfnt = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0xaa])
    const fetchFn = makeFetch({ [interRule.src]: woff2 })
    const decodeWoff2 = vi.fn(async (input: Uint8Array) => {
      expect(input).toEqual(woff2)
      return sfnt
    })
    const result = await resolveWebFonts({
      pageSpans: [[span('Inter, sans-serif')]],
      rules: [interRule],
      fetch: fetchFn,
      decodeWoff2,
    })
    expect(decodeWoff2).toHaveBeenCalledOnce()
    expect(result).toHaveLength(1)
    expect(result[0]?.bytes).toEqual(sfnt)
  })

  it('skips a WOFF2 rule when decode fails and reports a warning', async () => {
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00])
    const fetchFn = makeFetch({ [interRule.src]: woff2 })
    const onWarning = vi.fn()
    const result = await resolveWebFonts({
      pageSpans: [[span('Inter, sans-serif')]],
      rules: [interRule],
      fetch: fetchFn,
      decodeWoff2: vi.fn(async () => {
        throw new Error('decoder exploded')
      }),
      onWarning,
    })
    expect(result).toEqual([])
    expect(onWarning).toHaveBeenCalledOnce()
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/WOFF2/i)
  })

  it('skips non-SFNT and non-WOFF2 payloads (e.g. WOFF1) to keep embedding Adobe-compatible', async () => {
    const woff1 = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0x00, 0x01]) // "wOFF"
    const fetchFn = makeFetch({ [interRule.src]: woff1 })
    const onWarning = vi.fn()
    const result = await resolveWebFonts({
      pageSpans: [[span('Inter, sans-serif')]],
      rules: [interRule],
      fetch: fetchFn,
      onWarning,
    })
    expect(result).toEqual([])
    expect(onWarning).toHaveBeenCalledOnce()
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/unsupported font container/i)
  })
})

describe('resolveFallbackFonts', () => {
  const cssUrl = /^https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Sans\+JP:wght@(\d+)&text=/
  const gstaticUrl = (w: string) => `https://fonts.gstatic.com/l/font?kit=noto${w}`
  const sfnt = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x55])
  const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x09])
  // The fake font "has" every glyph it was asked for.
  const coverage = (_bytes: Uint8Array, cps: ReadonlySet<number>) => new Set(cps)

  function notoFetch() {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const m = url.match(cssUrl)
      if (m) {
        const css = `@font-face{font-family:'Noto Sans JP';font-style:normal;font-weight:${m[1]};src:url(${gstaticUrl(m[1] ?? '')}) format('woff2');}`
        return new Response(css, { status: 200 })
      }
      if (url.startsWith('https://fonts.gstatic.com/')) {
        return new Response(woff2.slice().buffer, { status: 200 })
      }
      return new Response(null, { status: 404 })
    })
  }
  const cssCalls = (fetchFn: ReturnType<typeof notoFetch>) =>
    fetchFn.mock.calls.map((c) => String(c[0])).filter((u) => cssUrl.test(u))

  it('fetches a Noto Sans JP subset for uncovered CJK code points via the text= API', async () => {
    const fetchFn = notoFetch()
    const decodeWoff2 = vi.fn(async () => sfnt)
    const [result, ...rest] = await resolveFallbackFonts({
      pageSpans: [[span('Arial, sans-serif', 400, 'normal', '日本語 Hello')]],
      candidates: [],
      fetch: fetchFn,
      decodeWoff2,
      coverage,
    })
    expect(rest).toEqual([])
    expect(result?.bytes).toEqual(sfnt)
    expect(result?.weight).toBe(400)
    // Covers the CJK glyphs it was fetched for, but not Latin — Latin must
    // keep falling to the deck's own font so we don't restyle ASCII text.
    expect(rangeCoversCodePoint(result?.unicodeRange ?? null, '日'.codePointAt(0) ?? 0)).toBe(true)
    expect(rangeCoversCodePoint(result?.unicodeRange ?? null, 'A'.codePointAt(0) ?? 0)).toBe(false)
    const [call] = cssCalls(fetchFn)
    expect(call).toContain(encodeURIComponent('日本語'))
    expect(call).not.toContain(encodeURIComponent('Hello'))
    expect(decodeWoff2).toHaveBeenCalledOnce()
  })

  it('fetches one subset per weight in use, so bold text stays bold', async () => {
    const fetchFn = notoFetch()
    const result = await resolveFallbackFonts({
      pageSpans: [[span('Arial', 400, 'normal', '本文'), span('Arial', 700, 'normal', '見出し')]],
      candidates: [],
      fetch: fetchFn,
      decodeWoff2: async () => sfnt,
      coverage,
    })
    expect(result.map((c) => c.weight).sort()).toEqual([400, 700])
    const bold = result.find((c) => c.weight === 700)
    expect(rangeCoversCodePoint(bold?.unicodeRange ?? null, '見'.codePointAt(0) ?? 0)).toBe(true)
    expect(rangeCoversCodePoint(bold?.unicodeRange ?? null, '本'.codePointAt(0) ?? 0)).toBe(false)
    expect(
      cssCalls(fetchFn)
        .map((u) => u.match(cssUrl)?.[1])
        .sort(),
    ).toEqual(['400', '700'])
  })

  it('asks for symbols outside WinAnsi too, and keeps only the glyphs the font has', async () => {
    const fetchFn = notoFetch()
    const [result] = await resolveFallbackFonts({
      pageSpans: [[span('Arial', 400, 'normal', 'A → B ☃')]],
      candidates: [],
      fetch: fetchFn,
      decodeWoff2: async () => sfnt,
      // The font has the arrow but no snowman.
      coverage: (_b, cps) => new Set([...cps].filter((cp) => cp === 0x2192)),
    })
    expect(cssCalls(fetchFn)[0]).toContain(encodeURIComponent('→☃'))
    expect(rangeCoversCodePoint(result?.unicodeRange ?? null, 0x2192)).toBe(true)
    expect(rangeCoversCodePoint(result?.unicodeRange ?? null, 0x2603)).toBe(false)
  })

  it('fetches nothing when the standard fonts or a resolved @font-face cover the text', async () => {
    const notoSans: WebFontCandidate = {
      family: 'noto sans jp',
      weight: 400,
      style: 'normal',
      bytes: new Uint8Array([0x00, 0x01, 0x00, 0x00]),
      unicodeRange: [{ start: 0x3000, end: 0x9fff }],
    }
    const fetchFn = notoFetch()
    const result = await resolveFallbackFonts({
      pageSpans: [
        [span('Arial', 400, 'normal', 'Just latin text — “quoted” €5')],
        [span('Noto Sans JP, sans-serif', 400, 'normal', '日本語')],
      ],
      candidates: [notoSans],
      fetch: fetchFn,
    })
    expect(result).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('soft-fails (no candidate + warning, no throw) when the subset fetch errors', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 503 }))
    const onWarning = vi.fn()
    const result = await resolveFallbackFonts({
      pageSpans: [[span('Arial', 400, 'normal', '日本語')]],
      candidates: [],
      fetch: fetchFn,
      onWarning,
    })
    expect(result).toEqual([])
    expect(onWarning).toHaveBeenCalledOnce()
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/stays in the raster/)
  })
})

describe('findCandidatesForSpan', () => {
  function cand(
    family: string,
    weight: number,
    style: FontStyle,
    range: { start: number; end: number }[] | null,
  ): WebFontCandidate {
    return { family, weight, style, bytes: new Uint8Array([0]), unicodeRange: range }
  }

  it('returns every candidate sharing the matched family/weight/style — emit.ts uses unicode-range to pick per char', () => {
    const latin = cand('inter', 400, 'normal', [{ start: 0, end: 0x024f }])
    const cyr = cand('inter', 400, 'normal', [{ start: 0x0400, end: 0x04ff }])
    const bold = cand('inter', 700, 'normal', null)
    const result = findCandidatesForSpan([latin, cyr, bold], {
      fontFamily: 'Inter',
      fontWeight: 400,
      fontStyle: 'normal',
    })
    expect(result).toEqual([latin, cyr])
  })

  it('walks the family chain and returns no candidates when none match', () => {
    const latin = cand('inter', 400, 'normal', null)
    const result = findCandidatesForSpan([latin], {
      fontFamily: 'Arial, sans-serif',
      fontWeight: 400,
      fontStyle: 'normal',
    })
    expect(result).toEqual([])
  })
})
