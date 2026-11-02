# Changelog

## 0.0.2

### Fixed
- Pages that live in another document, such as a same-origin iframe hosting a
  print view, rendered their text twice. The text-suppression stylesheet went
  into the global `document`, so the raster still contained the text under the
  vector layer. `@font-face` discovery, ranges and computed styles now use each
  page's own document as well, and rule detection no longer relies on
  `instanceof`, which fails across realms.
- Text no font can draw (for example when the fallback font is blocked by a
  Content-Security-Policy) disappeared from both layers. It now stays in the
  raster, is left out of the text layer, and a warning lists the characters.
- The Noto Sans JP fallback is fetched once per weight in use, so bold text
  stays bold.
- The fallback also covers symbols outside WinAnsi, such as `→`, and only the
  characters the font has glyphs for.

### Changed
- `engines.node` is `>=22.12.0` (Node 20 is end-of-life). crispdf runs in the
  browser; this only affects install-time checks.

## 0.0.1

Initial public package for `@astlide/crispdf`.

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
