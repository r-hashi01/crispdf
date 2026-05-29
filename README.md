# Vellum

Browser-side DOM to PDF with high visual fidelity and selectable text.

Vellum renders each page as a raster background, then overlays real PDF text on
top. That hybrid model keeps complex HTML/CSS visually intact while preserving
search, selection, and copy/paste for text that can be mapped to a PDF font.

## Package

```sh
pnpm add @vellum/core
# npm i @vellum/core
# yarn add @vellum/core
```

```ts
import { domToPdf } from '@vellum/core'

const result = await domToPdf({
  pages: document.querySelectorAll<HTMLElement>('[data-page]'),
  source: { width: 800, height: 600 },
  output: { width: 800, height: 600, unit: 'pt' },
  rasterFormat: 'jpeg',
  jpegQuality: 0.85,
})

const url = URL.createObjectURL(result.blob)
```

## Why

Most browser PDF generators force a choice:

| Approach | Selectable text | Visual fidelity | Server |
| --- | --- | --- | --- |
| Canvas-only export | No | Good | No |
| Pure vector HTML-to-PDF | Partial | Fragile | No |
| Headless browser print | Yes | Good | Yes |
| Vellum hybrid renderer | Yes | Good | No |

Vellum is designed for slide-like pages, reports, certificates, invoices, and
other fixed-size DOM layouts where preserving the visual result matters.

## Current Capabilities

- Multi-page browser-only PDF generation; pages are walked and captured
  concurrently.
- Raster background capture through `html-to-image`.
- Selectable/searchable text overlay positioned from DOM ranges, including
  `::before` / `::after` generated text with literal-string `content`.
- Standard PDF font fallback for Latin text.
- Google Fonts `@font-face` discovery + `unicode-range`-aware per-character font
  selection.
- WOFF2 decoding before embedding, so PDFs do not embed raw web-font containers.
- CID-keyed embedded fonts with `/ToUnicode` maps for copy/paste.
- On-demand Noto Sans JP fallback for CJK text via the Google Fonts `text=` API.
- RTL shaping/placement support for Arabic-like runs when a covering font exists.
- `validate(pages)` static pre-flight + opt-in pdf.js visual self-check.
- Timing and warning callbacks for diagnostics.

## Constraints

- The runtime is browser-only. It needs `document`, `Blob`, `fetch`, and DOM range
  APIs.
- Web font embedding is currently restricted to Google Fonts hosts
  (`fonts.gstatic.com` / `fonts.googleapis.com`).
- Cross-origin stylesheets that cannot be inspected through CSSOM are skipped by
  the browser.
- Generated content beyond literal strings (counters, `attr()`, images), Shadow
  DOM, and iframes are not walked.
- Color emoji and unsupported glyphs are still visible in the raster layer, but
  may not be present in the selectable text layer unless an embeddable font
  covers them.
- This is an early `0.1.x` package. The public API is intentionally small, but
  internals are still moving.

## Development

```sh
pnpm install
pnpm lint
pnpm --filter @vellum/core typecheck
pnpm --filter @vellum/core test
pnpm --filter @vellum/core build
pnpm example
```

The example app runs from `examples/` and generates `vellum-poc.pdf` in the
browser.

## Repository Layout

- `packages/core`: the published package, `@vellum/core`.
- `examples`: manual browser example and compatibility stress pages.

## License

MIT
