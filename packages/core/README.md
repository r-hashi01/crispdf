# crispdf

Browser-side DOM to PDF with high visual fidelity and selectable text.

`crispdf` renders each page as a raster background, then overlays real PDF
text on top. The result keeps complex HTML/CSS visually intact while preserving
search, selection, and copy/paste for text that can be mapped to a PDF font.

## Install

```sh
pnpm add crispdf
# npm i crispdf
# yarn add crispdf
```

## Usage

```ts
import { domToPdf } from 'crispdf'

const result = await domToPdf({
  pages: document.querySelectorAll<HTMLElement>('[data-page]'),
  source: { width: 800, height: 600 },
  output: { width: 800, height: 600, unit: 'pt' },
  rasterFormat: 'jpeg',
  jpegQuality: 0.85,
  onProgress: (pageIndex, totalPages) => {
    console.log(`page ${pageIndex}/${totalPages}`)
  },
  onTiming: (event) => {
    console.log(event)
  },
})

if (result.warnings.length > 0) {
  console.warn(result.warnings)
}

const url = URL.createObjectURL(result.blob)
```

## API

```ts
function domToPdf(opts: DomToPdfOptions): Promise<DomToPdfResult>

interface DomToPdfOptions {
  pages: ArrayLike<HTMLElement>
  source: { width: number; height: number }
  output: { width: number; height: number; unit: 'pt' }
  rasterFormat?: 'jpeg' | 'png' // default 'jpeg'
  jpegQuality?: number // default 0.85
  onProgress?: (pageIndex: number, totalPages: number) => void
  onTiming?: (event: TimingEvent) => void
  /** Opt-in visual self-check; off by default. Requires `pdfjs-dist`. */
  selfCheck?: { enabled: boolean; threshold?: number }
}

type TimingEvent =
  | { stage: 'walk'; page: number; durationMs: number }
  | { stage: 'capture'; page: number; durationMs: number }
  | { stage: 'fonts'; durationMs: number }
  | { stage: 'emit'; durationMs: number }
  | { stage: 'selfCheck'; durationMs: number }

interface DomToPdfResult {
  blob: Blob
  warnings: string[]
  /** Present only when `selfCheck.enabled` was set. */
  selfCheck?: SelfCheckPageResult[]
}

interface SelfCheckPageResult {
  page: number // 1-indexed
  diff: number // visual difference, 0..1
  exceeded: boolean // diff > threshold
}
```

## How It Works

1. Walk visible DOM text and record line rectangles through `Range`, including
   `::before` / `::after` generated text that has a literal-string `content`.
2. Capture each page as a raster image for visual fidelity (pages are walked
   and captured concurrently — capture dominates wall-clock).
3. Discover eligible `@font-face` rules and fetch/decode WOFF2 web fonts into
   SFNT/OTF/TTF bytes.
4. Resolve a Noto Sans JP fallback on demand for CJK text the deck's own fonts
   can't cover (see Font Behavior).
5. Emit a PDF with the raster page image plus a selectable text layer.

The PDF writer embeds web fonts as CID-keyed fonts with Identity-H encoding and
`/ToUnicode` maps. Raw WOFF2 containers are never embedded.

Every failure mode is designed to be **visible, not silent**: text the vector
layer can't reproduce still shows in the raster, and `validate()` (before) plus
`selfCheck` (after) surface the gap rather than dropping content quietly.

## Font Behavior

- Latin text can fall back to the PDF standard fonts: Helvetica, Times, Courier,
  and their bold/italic variants.
- Google Fonts web fonts are embedded when discoverable from CSSOM.
- `unicode-range` subsets are filtered to the actual code points used in the
  document, then fetched in parallel; per-character selection routes each glyph
  to the font that covers it.
- **CJK** (kana / kanji / CJK punctuation / fullwidth forms) that no embedded or
  standard font covers triggers an on-demand Noto Sans JP subset fetch via the
  Google Fonts `text=` API — only the characters used (a few KB), not the full
  multi-MB face. Offline, the text stays in the raster with a warning.
- Characters not covered by any embeddable font remain visible in the raster
  layer but may be dropped from the selectable layer with a warning.

## Validation

`validate(pages)` is a static pre-flight check — run it before `domToPdf` (in
CI or at runtime) to catch content that would lose selectable text.

```ts
import { validate } from 'crispdf'

const { ok, errors, warnings } = validate(pages)
if (!ok) {
  // errors mean text will be lost from the selectable layer
  console.error(errors)
}
```

- **Errors** (`ok: false`): `<canvas>` / `<video>` — raster-only elements whose
  text can never reach the selectable layer.
- **Warnings**: `mix-blend-mode`, `filter`, `backdrop-filter`,
  `position: sticky`, and 3D transforms — they render but rasterize and won't
  blend with the vector text overlay, so output may differ from the screen.

```ts
function validate(pages: ArrayLike<HTMLElement>): ValidationResult

interface ValidationResult {
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

interface ValidationIssue {
  rule: string
  message: string
  element: HTMLElement
  selector: string
}
```

## Self-check

With `selfCheck.enabled`, the generated PDF is rendered back to pixels with
pdf.js and each page is diffed against a ground-truth raster — the page as it
actually renders, text included (captured separately from the text-suppressed
embedding raster, so a page that lost text diffs *higher*, not lower). Pages
that diverge beyond `threshold` (default `0.1`) are reported in
`result.warnings` and `result.selfCheck`. This turns silent rendering drift — a
font that didn't embed, an unsupported CSS feature — into a detectable warning.

The diff is a whole-page mean-abs comparison, which is blunt: it catches gross
failures rather than subtle per-glyph drift. Enabling it adds a second capture
per page plus the pdf.js render, so it is opt-in.

`pdfjs-dist` is an **optional peer dependency**: install it only if you enable
self-check. It is loaded via dynamic import, so it never enters your bundle
otherwise.

## Browser Requirements

The package runs in browsers. It requires DOM APIs, `Blob`, `fetch`,
`document.fonts`, `Range.getClientRects()`, and the canvas/image APIs used by
`html-to-image`. Self-check additionally uses `OffscreenCanvas`,
`createImageBitmap`, and `pdfjs-dist`.

## Limitations

- Web font embedding is restricted to Google Fonts hosts
  (`fonts.gstatic.com` / `fonts.googleapis.com`) in the current release.
- Cross-origin stylesheets that cannot be inspected through CSSOM are skipped.
- Generated content other than literal-string `content` (counters, `attr()`,
  `url()` images, quote keywords) stays in the raster layer only.
- Shadow DOM and iframe content are not walked.
- The on-demand CJK fallback covers Japanese (Noto Sans JP) at weight 400; other
  scripts (Korean, Chinese-specific, Thai, …) are not yet auto-fetched.
- Color emoji support depends on an embeddable font; otherwise emoji are raster
  only.
- The API is stable enough to try, but this is still a `0.0.x` package.

## License

MIT
