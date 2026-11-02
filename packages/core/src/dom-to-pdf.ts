import { captureRaster } from './capture'
import { docOf } from './dom'
import { emitPdf } from './emit'
import { discoverFontFaces } from './font-discovery'
import { resolveFallbackFonts, resolveWebFonts, type WebFontCandidate } from './font-resolver'
import { keepUndrawableInRaster } from './raster-text'
import { defaultSelfCheckDeps, runSelfCheck, type SelfCheckPageResult } from './self-check'
import { measure } from './timing'
import type { DomToPdfOptions, DomToPdfResult, TextSpan } from './types'
import { extractSpans } from './walk'

export async function domToPdf(opts: DomToPdfOptions): Promise<DomToPdfResult> {
  const pages = Array.from(opts.pages)
  if (pages.length === 0) {
    throw new Error('domToPdf: at least one page element is required')
  }

  const rasterFormat = opts.rasterFormat ?? 'jpeg'
  const jpegQuality = opts.jpegQuality ?? 0.85
  const wantGroundTruth = opts.selfCheck?.enabled ?? false
  const resolverWarnings: string[] = []

  // Phase 1: walk every page for its text spans.
  const walked: TextSpan[][] = []
  for (const [i, page] of pages.entries()) {
    opts.onProgress?.(i, pages.length)
    walked.push(
      await measure(
        async () => extractSpans(page),
        (durationMs) => opts.onTiming?.({ stage: 'walk', page: i + 1, durationMs }),
      ),
    )
  }

  // Phase 2: discover document @font-face rules and fetch the bytes for the
  // (family, weight, style) triples spans actually use. Resolution lives
  // outside emit because it needs the live Document, while emit only sees
  // serializable data.
  const webFonts: WebFontCandidate[] = await measure(
    async () =>
      resolveWebFonts({
        pageSpans: walked,
        // The pages' own documents: they may be iframes, not this document.
        rules: [...new Set(Array.from(opts.pages, (p) => docOf(p)))].flatMap((doc) =>
          discoverFontFaces(doc),
        ),
        onWarning: (msg) => resolverWarnings.push(msg),
      }),
    (durationMs) => opts.onTiming?.({ stage: 'fonts', durationMs }),
  )

  // Characters neither the deck's fonts nor the standard PDF fonts can draw
  // (CJK, arrows …) are fetched on demand as minimal Noto Sans JP subsets
  // (Google Fonts text= API), one per weight, so they stay selectable.
  const fallbacks = await measure(
    async () =>
      resolveFallbackFonts({
        pageSpans: walked,
        candidates: webFonts,
        onWarning: (msg) => resolverWarnings.push(msg),
      }),
    (durationMs) => opts.onTiming?.({ stage: 'fonts', durationMs }),
  )

  // Phase 3: text still without a font stays in the raster — before the
  // capture, which otherwise makes all text transparent.
  const rasterText = keepUndrawableInRaster(walked, webFonts, fallbacks)
  const pageSpans = rasterText.pageSpans
  if (rasterText.undrawable.size > 0) {
    const sample = [...rasterText.undrawable].slice(0, 12).join('')
    resolverWarnings.push(
      `No font can draw ${rasterText.undrawable.size} character(s); the text containing them ` +
        `stays in the raster (visible, not selectable). Sample: "${sample}".`,
    )
  }

  // Phase 4: capture every page concurrently. Capture (rasterization) is the
  // dominant stage (PoC timings) and is mostly async waits — font readiness,
  // requestAnimationFrame, image decode — so overlapping pages collapses those
  // idle gaps. The transparency stylesheet is shared and removed only once no
  // page still carries the capture class, so concurrent captures don't race.
  let perPage: { raster: Uint8Array; groundTruth: Uint8Array | null }[]
  try {
    perPage = await Promise.all(
      pages.map(async (page, i) => {
        // Self-check needs a ground-truth raster — the page exactly as rendered,
        // text included — to diff against. Capture it before the suppressed
        // raster (which toggles the transparency class on this page) so the two
        // don't interfere; across pages they still run concurrently.
        const groundTruth = wantGroundTruth
          ? await captureRaster(page, {
              format: rasterFormat,
              quality: jpegQuality,
              width: opts.source.width,
              height: opts.source.height,
              suppressText: false,
            })
          : null
        const raster = await measure(
          async () =>
            captureRaster(page, {
              format: rasterFormat,
              quality: jpegQuality,
              width: opts.source.width,
              height: opts.source.height,
            }),
          (durationMs) => opts.onTiming?.({ stage: 'capture', page: i + 1, durationMs }),
        )
        return { raster, groundTruth }
      }),
    )
  } finally {
    rasterText.release()
  }
  const pageRasters: Uint8Array[] = perPage.map((p) => p.raster)

  const emitResult = await measure(
    async () =>
      emitPdf({
        pageRasters,
        pageSpans,
        webFonts,
        fallbacks,
        source: opts.source,
        output: { width: opts.output.width, height: opts.output.height },
        rasterFormat,
      }),
    (durationMs) => opts.onTiming?.({ stage: 'emit', durationMs }),
  )

  // Opt-in self-check: render the PDF back to pixels and diff against the
  // ground-truth rasters (page as rendered, text included). A faithful render
  // diffs low; a page that lost text — e.g. a font that didn't embed — diffs
  // high against the text-bearing ground truth, so the signal points the right
  // way. Failures here never sink generation; they only warn.
  let selfCheck: SelfCheckPageResult[] | undefined
  const selfCheckWarnings: string[] = []
  if (opts.selfCheck?.enabled) {
    const groundTruth = perPage.map((p) => p.groundTruth).filter((r): r is Uint8Array => r !== null)
    selfCheck = await measure(
      async () =>
        runSelfCheck({
          pdfBytes: emitResult.bytes,
          pageRasters: groundTruth,
          rasterFormat,
          threshold: opts.selfCheck?.threshold ?? 0.1,
          deps: defaultSelfCheckDeps(),
          onWarning: (msg) => selfCheckWarnings.push(msg),
        }),
      (durationMs) => opts.onTiming?.({ stage: 'selfCheck', durationMs }),
    )
  }

  opts.onProgress?.(pages.length, pages.length)

  return {
    blob: new Blob([emitResult.bytes as BlobPart], { type: 'application/pdf' }),
    warnings: [...resolverWarnings, ...emitResult.warnings, ...selfCheckWarnings],
    ...(selfCheck ? { selfCheck } : {}),
  }
}
