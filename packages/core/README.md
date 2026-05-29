# @vellum/core

Browser-side DOM to PDF with high visual fidelity and selectable text.

`@vellum/core` renders each page as a raster background, then overlays real PDF
text on top. The result keeps complex HTML/CSS visually intact while preserving
search, selection, and copy/paste for text that can be mapped to a PDF font.

## Install

```sh
pnpm add @vellum/core
# npm i @vellum/core
# yarn add @vellum/core
```

## Usage

```ts
import { domToPdf } from '@vellum/core'

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
  rasterFormat?: 'jpeg' | 'png'
  jpegQuality?: number
  onProgress?: (pageIndex: number, totalPages: number) => void
  onTiming?: (event: TimingEvent) => void
}

type TimingEvent =
  | { stage: 'walk'; page: number; durationMs: number }
  | { stage: 'capture'; page: number; durationMs: number }
  | { stage: 'fonts'; durationMs: number }
  | { stage: 'emit'; durationMs: number }

interface DomToPdfResult {
  blob: Blob
  warnings: string[]
}
```

## How It Works

1. Walk visible DOM text and record line rectangles through `Range`.
2. Capture each page as a raster image for visual fidelity.
3. Discover eligible `@font-face` rules.
4. Fetch/decode WOFF2 web fonts into SFNT/OTF/TTF bytes.
5. Emit a PDF with the raster page image plus a selectable text layer.

The PDF writer embeds web fonts as CID-keyed fonts with Identity-H encoding and
`/ToUnicode` maps. Raw WOFF2 containers are never embedded.

## Font Behavior

- Latin text can fall back to the PDF standard fonts: Helvetica, Times, Courier,
  and their bold/italic variants.
- Google Fonts web fonts can be embedded when they are discoverable from CSSOM.
- `unicode-range` subsets are filtered to the actual code points used in the
  document, then fetched in parallel.
- Characters not covered by an embeddable font remain visible in the raster
  layer, but may be dropped from the selectable layer with a warning.

## Browser Requirements

The package runs in browsers. It requires DOM APIs, `Blob`, `fetch`,
`document.fonts`, `Range.getClientRects()`, and canvas/image APIs used by
`html-to-image`.

## Limitations

- Web font embedding is restricted to Google Fonts hosts
  (`fonts.gstatic.com` / `fonts.googleapis.com`) in the current release.
- Cross-origin stylesheets that cannot be inspected through CSSOM are skipped.
- `::before` / `::after` generated text, Shadow DOM, and iframes are not walked.
- Color emoji support depends on an embeddable font; otherwise emoji are raster
  only.
- The API is stable enough to try, but this is still a `0.1.x` package.

## License

MIT
