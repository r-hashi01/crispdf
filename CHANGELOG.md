# Changelog

## 0.1.0 (unreleased)

Initial public package for `@vellum/core`.

### Rendering
- Browser-only DOM to PDF hybrid renderer: raster background + selectable PDF
  text overlay.
- Multi-page output; pages walked and captured concurrently (~2× on multi-page
  decks vs sequential).
- In-house PDF writer (no `pdf-lib`): JPEG/PNG image XObjects, standard-14 fonts,
  CID-keyed Type0 fonts with Identity-H + `/ToUnicode` maps.
- `::before` / `::after` generated text (literal-string `content`) extraction.

### Fonts
- Standard PDF font fallback (Helvetica / Times / Courier + bold/italic).
- Google Fonts `@font-face` discovery with `unicode-range`-aware per-character
  font selection.
- WOFF2 → SFNT decoding before embedding (no raw web-font containers in the PDF).
- On-demand Noto Sans JP fallback for uncovered CJK via the Google Fonts `text=`
  subset API.
- RTL/bidi shaping and placement for Arabic-like runs when a covering font exists.

### Quality / safety
- `validate(pages)` static pre-flight: errors for raster-only `<canvas>`/`<video>`,
  warnings for blend/filter/sticky/3D-transform CSS.
- Opt-in self-check: re-render with pdf.js and pixel-diff each page against a
  ground-truth raster (page as rendered, text included), so a page that lost
  text diffs higher rather than lower (`pdfjs-dist` optional peer dependency).
- Timing (`onTiming`) and warning callbacks throughout; failures stay visible,
  never silent.
