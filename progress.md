# Progress

Working notes — captured at the end of a session so the next one can pick up cold. Append-only history; the most recent entry is at the top.

---

## 2026-05-29 — committed the in-house-writer aftermath + shipped ::before/::after extraction

Note: progress.md fell behind reality — Phase 3 steps 1–9 (in-house PDF writer, drop pdf-lib) and the fontkit subset fallbacks all landed on `main` between the previous entry and now; check `git log` for the authoritative history. This entry resumes from there.

### What was uncommitted at session start (all green: 129 tests / lint / typecheck / build), now committed

Split the large uncommitted blob into two clean commits (progress.md + `.claude/settings.json` deliberately left local):

1. `30d15c9` **chore: collapse to single `@vellum/core` package + publish prep.** Dropped the react/astro/validator stubs, narrowed `pnpm-workspace.yaml` to `packages/core` — **the multi-package plan is shelved; core ships standalone.** Added publish metadata, LICENSE/CHANGELOG/CONTRIBUTING/SECURITY, the `woff2-encoder` dep, and `.gitignore`'d PLAN.md.
2. `c5cc3ea` **feat: RTL/bidi shaping + WOFF2 decode + capture fidelity.** New `woff2-decoder.ts` (WOFF2→SFNT before embed; `CidFontHandle` rejects WOFF2 + adds `/Length1`). Bidi: `walk.ts` records computed `direction` + merges per-line rect fragments; `emit.ts` splits directional runs, shapes RTL via `fontkit layout(direction)`, places RTL right-to-left; LTR splits per grapheme cluster. Capture: `-webkit-text-fill-color` transparent, `[data-vellum-raster-text]` opt-out (bake into raster + skip in walker), `skipFonts` in html-to-image.

### New work this session

3. `dfdeda1` **feat: extract `::before`/`::after` literal-string content** (PLAN §5.2). Found a silent-loss bug: capture forces `*::before/::after` transparent, but the walker never extracted generated text → it vanished from both layers. Fix: a second `SHOW_ELEMENT` pass reads `getComputedStyle(el, pseudo)`, `parsePseudoContent()` accepts only single literal-string `content` (counters/`attr()`/`url()`/quote keywords stay raster-only), and `pseudoRect()` derives geometry from the content-box edge → first/last real-content-rect gap (generated boxes have no Range). LTR + RTL anchored. No double-draw risk (raster already suppresses the glyph); width is re-measured in emit, so the approximate box only feeds line grouping. 3 TDD tests in `index.test.ts` (before / after / no-phantom-for-none).

### Roadmap, top-to-bottom (agreed with user: work down in order)

- ✅ `::before`/`::after` extraction (`dfdeda1`)
- ✅ **CJK fallback (Noto Sans JP), on-demand fetch** (`e1c650a`). Decision: user chose on-demand over bundling. `resolveCjkFallback()` (font-resolver.ts) collects uncovered CJK code points and fetches a Noto Sans JP subset via the Google Fonts `text=` API (few KB, not multi-MB); degrades to null+warning offline. emit offers it to *every* span (not family-matched) so per-char selection routes CJK to it, Latin stays on the deck font. Caught + fixed a latent bug: `pickBestCoverageCandidate` returns a font at zero coverage, so a universal fallback misrouted out-of-range symbols (→, ☃) onto the CID font; `splitLtrByFont` now requires `countCoveredCodePoints > 0` for the partial path. Tests: 4 resolver unit tests (injected fetch/decode) + 1 dom-to-pdf integration test (real Google Fonts fetch → asserts `/Subtype /Type0`).
  - Deferred: only weight 400 fetched (bold CJK falls to 400; raster shows bold). Only Noto Sans **JP** — Korean/Thai/etc. not covered. `isCjkCodePoint` covers kana + CJK ideographs + CJK punct + fullwidth forms.
- ✅ **self-check via pdf.js (visual diff, PLAN §8)** (`c3d9990`). Decision (user): dynamic import + opt-in. `self-check.ts` = pure `meanPixelDiff` (RGB, alpha-ignored, 0..1) + `runSelfCheck` with injected decode/render deps; default deps decode via createImageBitmap+OffscreenCanvas and render via pdf.js (`import('pdfjs-dist')`, kept out of the bundle by `tsup external`, optional peer dep). API: `selfCheck:{enabled,threshold?}` (off by default, threshold 0.02) → `result.selfCheck: {page,diff,exceeded}[]`. A page whose render throws is skipped with a warning, never sinks generation. Tests: 6 unit (injected fakes) + 2 in-browser integration (real pdf.js render works in vitest/Playwright via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` worker).
  - Deferred: diff is mean-abs RGB, not SSIM (PLAN §8 mentions both); no per-region localization; pdf.js worker config relies on bundler URL resolution (Vite/webpack OK; document for other bundlers).
- ✅ **Concurrent capture** (`60f9fba`). Measure-first: benchmarked 8-page deck, sequential ~200-227ms wall-clock (capture ~90%, fully serialized). Switched walk+capture to per-page `Promise.all` → ~97-135ms (~2x), zero new deps. Safe: shared transparency stylesheet removed only once no page carries the capture class; html-to-image clones before rasterizing; order preserved via Promise.all+map. Locked by a "4 pages → 4 /Type /Page" test.
  - **Worker deferred (deliberate).** Main-thread concurrency captured most of the win; remaining floor is html-to-image's synchronous CPU work, which a worker can't help because html-to-image needs the live DOM (main thread only). An OffscreenCanvas worker would improve main-thread *responsiveness*, not throughput — revisit only if blocking the UI thread becomes a real UX complaint.
- ~~@vellum/react / astro~~ — shelved (single-package pivot)

### Roadmap status: PLAN §9 Phase 2 + Phase 3 substantively complete

Phase 2 (webfont subset, unicode-range, ::before/::after, CJK fallback, capture parallelism) and Phase 3 (in-house PDF writer, self-check) are all landed. The visible-degradation invariant is now backstopped by self-check. Remaining/optional, no committed order:
- ✅ **`validate(pages)`** (`11947b0`) — the last Phase 2 item. Static pre-flight (PLAN §6), the *before* pair to self-check's *after*. Exported from root: `{ ok, errors, warnings }`. Hard errors: `<canvas>`/`<video>` (raster-only → silent text loss). Soft warnings: mix-blend-mode, filter, backdrop-filter, position:sticky, 3D transform (matrix3d/perspective). 9 browser tests; public-API lock updated. **Phase 2 + Phase 3 now fully complete.**
- SSIM (vs current mean-abs-RGB) for self-check; per-region diff localization.
- Bold-weight CJK fetch (currently 400 only); non-JP Noto scripts (KR/SC/TC/Thai).
- Phase 4: docs, benchmarks, npm publish (CD intentionally not wired — see CLAUDE.md).

### Deferred within the pseudo-element increment
- Only literal-string `content`. Counters (`counter()`), `attr()`, and `content: url(img)` are not extracted — they remain raster-only (visible, not selectable). Open/close-quote keywords likewise.
- Pseudo-only elements (no real DOM content to anchor) fall back to a content-box-first-line box — placement is rough; revisit if a real deck needs it.

---

## 2026-05-07 (later 3) — Phase 2 (c) shipped, Phase 3 (in-house PDF emitter) decided

### What landed in Phase 2 (c)

1. **`unicode-range` parser** (`unicode-range.ts`): single point, hex-hex range, `?` wildcard, comma list. `null` ranges = "covers everything" (CSS default). Strict-ish — malformed segment → null so we fall open, never silently drop characters.
2. **`FontFaceRule.unicodeRange`** + new **`matchFontFaceRules()`** that returns *every* rule sharing the matched (family, weight, style) triple. Resolver now fetches every unicode-range subset (latin / latin-ext / cyrillic / …), deduplicating by URL.
3. **Per-character run splitting in emit**: `splitIntoRuns()` walks span text and picks the first candidate whose `unicode-range` covers each code point; consecutive same-font chars collapse into one drawText call. Layout planner sees span-level totals; intra-span runs lay out cumulatively from the planned x.
4. **Pre-walk for unused subsets**: emit identifies which candidates would actually be picked at draw time and skips embedding the rest. (Originally meant to dodge the encodeStream crash by avoiding empty subsets — see below for the real cause.)
5. **subset-failure fallback**: `emitPdf` retries with `subset: false` when save throws `_this.subset.encodeStream is not a function`. PDF size grows but generation always completes.

### Root cause for the `subset.encodeStream` crash

Diagnostic instrumentation (since removed) confirmed: **pdf-lib@1.17.1 ↔ fontkit@2.x ABI mismatch**. fontkit 2.x's `Subset` class no longer exposes `encodeStream()`; pdf-lib's `CustomFontSubsetEmbedder.serializeFont()` calls it at save time. pdf-lib hasn't released since 2023 and hasn't adopted the new fontkit API. The fallback to `subset: false` works but ships the full font file (Inter latin ~48KB + latin-ext ~85KB per weight, then everything else used).

### Phase 3 decision (next session, on `main`)

Build an **in-house PDF emitter** (`@vellum/pdf` or internal `pdf-writer.ts`) that uses fontkit 2.x directly:

- Comparison considered: pdf-lib (current; subset stuck), pdfme (built on pdf-lib → same bug), jsPDF (no subsetting + no woff2), PDFKit-browser (old fontkit, no woff2). Self-build is the only path that keeps every invariant.
- Estimated ~1500-1800 LoC: PDF object writer + xref/trailer + page tree + image XObject (DCTDecode JPEG, FlateDecode PNG) + Standard 14 (Type 1 + WinAnsi) + Type 0/CID font with subsetted bytes + ToUnicode CMap + content-stream text ops.
- Cutover plan: build alongside the existing pdf-lib path, swap `emit.ts` over once functional parity + tests are green, drop pdf-lib from `@vellum/core` deps.

### Tests

- 10 new unicode-range parser tests
- 1 `matchFontFaceRules` test (returns all matching rules across ranges)
- 1 `resolveWebFonts` test (fetches every unicode-range subset)
- 2 `findCandidatesForSpan` tests
- Total 70/70, lint + typecheck + build all green.

---

## 2026-05-07 (later) — Phase 2 (b) shipped

### What landed

Two fixes, both visually verified in `pnpm example` on the Phase 1 (Times) and Phase 2 (Inter) slides:

1. **Walker preserves boundary whitespace.** `normalizeLineWhitespace` now takes `keepLeadingSpace` / `keepTrailingSpace` flags driven by `hasContentSibling()`. A text node adjacent to an inline sibling (e.g. text + `<b>` + text) no longer trims the boundary space, so copy-paste yields `"Hello bold and code!"` instead of `"Helloboldandcode!"`. Block-level boundaries still trim source-HTML indentation as before. Locked by `extractSpans > preserves a single space between inline siblings`.

2. **Snap-to-previous layout planner (`layout.ts`).** A pure function `planInlineLayout(items)` groups spans by baseline, sorts by x, and — when `span.x ≈ prev.x + prev.w` (within 1.5px DOM, i.e. inline-adjacent) — snaps the next span's draw-x to where the previous span's PDF glyphs actually end. This eliminates the visible gap that opened at every `<b>` / `<code>` / `<i>` boundary because PDF font metrics ≠ CSS-rendered font metrics. The drift is small per character but accumulates visibly at every inline boundary.

`emit.ts` now does a two-pass loop per page: pass 1 encodes each span and measures `font.widthOfTextAtSize(safeText, …)` to convert drawn width into DOM units; pass 2 draws each span at the planned x. The planner stays pure / serializable — no live DOM, no PDF objects — so it remains compatible with the eventual Worker boundary.

### Tests

7 new tests in `layout.test.ts` (single span, snap, compound snap, gap-preserved, line-break-not-snapped, input-order-preserved, baseline-tolerance). Suite: **55/55**, lint/typecheck/build green.

### Known issue (deferred)

`html-to-image` logs `SecurityError: Cannot access rules` when rasterizing pages that link cross-origin stylesheets (Google Fonts CSS). This is a raster-side warning only — the JPEG still renders, the vector text layer is unaffected. Look at it when we revisit `capture.ts`.

---

## 2026-05-07 — Phase 2 (a) shipped, Phase 2 (b) in progress

### Phase milestones

- ✅ **Phase 0 (PoC)** — DOM → PDF pipeline, raster + vector hybrid, per-stage timing. (commit `0cad936`)
- ✅ **Phase 1 (MVP)** — standard PDF font auto-mapping (Helvetica / Times / Courier × bold / italic), publish-ready package metadata + README, version `0.1.0`, `pnpm pack` verified. (commit `8e797b6`)
- ✅ **Phase 2 (a) — webfont discovery + subsetted embed** — `@font-face` parsing, Google Fonts allowlist (`fonts.gstatic.com` / `fonts.googleapis.com`), fetch + `pdf-lib` `embedFont(bytes, { subset: true })`. Spans matched by family chain + weight/style; non-matching spans fall back to standard PDF fonts. (commit `5066b0d`)
- 🚧 **Phase 2 (b) — visual fidelity bug fixes** — currently uncommitted on `main`. See "Open issue" below.

### TDD adopted

User requested mid-Phase-1. Workflow now:

1. Write a failing test that locks the desired contract (in `packages/core/src/*.test.ts`).
2. Implement the minimum to make it green.
3. Lint + typecheck + build + full test run before commit.

Tests run via `vitest` in **browser mode** through `@vitest/browser` + Playwright Chromium — the library uses real `Range.getClientRects()` / `getComputedStyle` / `document.fonts`, so jsdom-mode would lie.

### What `@vellum/core` looks like now

```
src/
├── capture.ts           # html-to-image wrapper (rasterizer)
├── color.ts             # CSS color → RGB parser
├── dom-to-pdf.ts        # public entry; orchestrates walk → fonts → emit
├── emit.ts              # pdf-lib glue: embed (web)fonts, draw spans, JPEG bg
├── font-discovery.ts    # @font-face parser, family/weight matcher, allowlist
├── font-mapping.ts      # CSS family/weight/style → 12 standard PDF fonts
├── font-resolver.ts     # fetch web fonts, build WebFontCandidate[]
├── timing.ts            # `measure()` helper for onTiming hook
├── types.ts             # public types (DomToPdfOptions, TextSpan, …)
├── walk.ts              # TreeWalker → per-line TextSpan[]
├── index.ts             # public exports (`domToPdf`, `VERSION`, types)
└── *.test.ts            # 48 tests across 5 files
```

Public exports remain `domToPdf` + `VERSION` + types — internal helpers are not re-exported. Locked by `public-api.test.ts`.

### Conventions confirmed in this session

- **No `.js` suffix on local imports.** `moduleResolution: Bundler` + tsup/esbuild handle resolution. Already updated `CLAUDE.md`.
- **Visible-degradation invariant.** Bad font bytes / network errors / disallowed origins push warnings into `result.warnings` and fall back to standard fonts — never throw.
- **Single rasterizer-fonts boundary.** Web font resolution lives in `dom-to-pdf.ts` (needs live `Document`), `emit.ts` only sees serializable `WebFontCandidate[]`. This keeps the path open for OffscreenCanvas / Worker parallelism (PLAN § "Performance philosophy").

### Empirical findings

- Per-page timing on the example deck (5 slides, 800×600): `walk` ≪ 1 ms, `capture` 30–100 ms (first page warmup ~100 ms, subsequent ~30 ms), `fonts` ~10 ms, `emit` ~13 ms. **Capture (rasterization) dominates** — confirms PLAN's framing that WASM doesn't help and Worker parallelism is the scaling lever.
- pdf-lib's `embedFont(bytes, { subset: true })` accepts woff2 directly in the browser (fontkit handles brotli decompression in-browser). One earlier worry was that woff2 would fall back to standard fonts; it doesn't.
- `fontkit` must be imported as `import * as fontkit from 'fontkit'` (no default export when bundled by Vite).

### Open issue (Phase 2 b — uncommitted, fix in progress)

**Symptom:** in the example deck, around bold/inline `<b>` and inline `<code>` elements the visible spacing is "歪んでる" — gap before bold word looks too wide, gap after inline code looks too tight. User-confirmed visually.

**Root cause:** `walk.ts::normalizeLineWhitespace` was `.trim()`-ing every span. For text nodes adjacent to inline siblings (e.g. `"Hello "` + `<b>"bold"</b>` + `" and "`), the leading/trailing space at the inline boundary is semantically meaningful — it's the space between two visible words. Stripping it both:

- Loses the space in copy-paste (`"Helloboldand…"`),
- And — more visibly — the drawn vector text ends earlier than the original layout's run width, so the visible gap to the next inline span widens past one character.

**Fix (uncommitted):**

- New per-line normalize signature: `normalizeLineWhitespace(line, whiteSpace, { keepLeadingSpace, keepTrailingSpace })`.
- `keepLeadingSpace` flips on for the first line of a text node when it has a content-bearing previous sibling. `keepTrailingSpace` mirrors for the last line and next sibling. `hasContentSibling()` walks siblings, skipping pure-whitespace text nodes and `display: none` elements.
- Block-level boundaries (text alone in a `<p>`, with HTML-source indentation) are unaffected — no inline sibling, so trim happens as before. Phase 0's indent-stripping test still passes.

**Status:** new TDD test `extractSpans > preserves a single space between inline siblings` was red, then green after the fix. Full suite 48/48. Visually still needs to be re-verified in the example browser — that's the next concrete step.

### Repo state at session end

```
On branch main; up to date with origin (1 commit ahead before this writeup).

Uncommitted (Phase 2 b — walker whitespace fix):
  packages/core/src/walk.ts                # the fix
  packages/core/src/index.test.ts          # the test that pinned it
  examples/index.html                      # added Inter (Google Fonts) slide for Phase 2 visual check
  examples/main.ts                         # surface result.warnings in the timing log
```

Will be committed and pushed at the end of this writeup.

### To pick up next session

1. Re-run `pnpm example` and visually verify the spacing fix on the bold/code slide.
2. If good: continue Phase 2 to-dos from `PLAN.md` § 9 in priority order:
   - Google Fonts CSS API has multiple `@font-face` rules per family split by `unicode-range` (latin, latin-ext, cyrillic, …). Today we pick the first weight/style match and ignore `unicode-range` — works for ASCII-only decks but will silently misembed for Latin-Ext / CJK. Add `unicode-range` parsing + per-character font selection.
   - Noto Sans JP fallback so CJK characters become selectable.
   - `::before` / `::after` text extraction.
   - Web Worker / OffscreenCanvas parallelism for `capture` (the dominant stage).
3. `@vellum/validator` (canvas detection + warning CSS) is its own package and can wait until A→F above are done.

### Useful commands

```sh
pnpm install
pnpm test             # 48 tests across 5 files (Chromium)
pnpm typecheck
pnpm lint             # biome
pnpm format           # biome --write
pnpm build            # tsup → dist/index.js + dist/index.d.ts
pnpm example          # vite-served playground at http://localhost:5173/
```
