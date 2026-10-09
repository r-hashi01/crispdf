import { toJpeg, toPng } from 'html-to-image'
import { docOf } from './dom'

/**
 * The transparency trick: while a single style element is in the document,
 * every element inside `.__vellum-capture` reports `color: transparent` and
 * has its text-shadow / -webkit-text-stroke neutralized. html-to-image inlines
 * computed styles when it serializes the DOM, so the rasterized JPEG/PNG ends
 * up with everything *except* the text glyphs (backgrounds, images, SVG, decorations).
 */
const CAPTURE_CLASS = '__vellum-capture'
const STYLE_ID = '__vellum-capture-style'

const TRANSPARENT_TEXT_CSS = `
.${CAPTURE_CLASS}, .${CAPTURE_CLASS} *,
.${CAPTURE_CLASS}::before, .${CAPTURE_CLASS}::after,
.${CAPTURE_CLASS} *::before, .${CAPTURE_CLASS} *::after {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  -webkit-text-stroke-color: transparent !important;
  text-shadow: none !important;
}

.${CAPTURE_CLASS} [data-vellum-raster-text],
.${CAPTURE_CLASS} [data-vellum-raster-text] *,
.${CAPTURE_CLASS} [data-vellum-raster-text]::before,
.${CAPTURE_CLASS} [data-vellum-raster-text]::after,
.${CAPTURE_CLASS} [data-vellum-raster-text] *::before,
.${CAPTURE_CLASS} [data-vellum-raster-text] *::after {
  color: initial !important;
  -webkit-text-fill-color: initial !important;
  -webkit-text-stroke-color: initial !important;
  text-shadow: initial !important;
}
`

export interface CaptureOptions {
  format: 'jpeg' | 'png'
  quality: number
  width: number
  height: number
  /**
   * Default true: apply the transparency trick so text is absent from the
   * raster (the PDF text layer is drawn on top). Set false to capture the page
   * exactly as rendered — text included — for the self-check ground truth.
   */
  suppressText?: boolean
}

export async function captureRaster(page: HTMLElement, opts: CaptureOptions): Promise<Uint8Array> {
  const suppress = opts.suppressText !== false
  // When capturing ground truth (text visible) we must inline @font-face blobs
  // so web-font glyphs render correctly; when suppressing, glyphs are
  // transparent so font inlining is pure overhead.
  const skipFonts = suppress
  // The page may live in another document (e.g. an iframe): the suppression
  // stylesheet and font loading belong to that document.
  const doc = docOf(page)
  const styleEl = suppress ? ensureStyle(doc) : null
  if (suppress) page.classList.add(CAPTURE_CLASS)
  try {
    await doc.fonts.ready
    await nextFrame()
    await nextFrame()
    const dataUrl =
      opts.format === 'jpeg'
        ? await toJpeg(page, {
            quality: opts.quality,
            width: opts.width,
            height: opts.height,
            skipFonts,
          })
        : await toPng(page, {
            width: opts.width,
            height: opts.height,
            skipFonts,
          })

    const buf = await (await fetch(dataUrl)).arrayBuffer()
    return new Uint8Array(buf)
  } finally {
    if (suppress) {
      page.classList.remove(CAPTURE_CLASS)
      // Leave the <style> in the document for concurrent/subsequent pages; we
      // remove it only when no element still carries the class.
      if (!doc.querySelector(`.${CAPTURE_CLASS}`)) {
        styleEl?.remove()
      }
    }
  }
}

function ensureStyle(doc: Document): HTMLStyleElement {
  const existing = doc.getElementById(STYLE_ID)
  // tagName, not instanceof: an iframe's elements come from another realm.
  if (existing && existing.tagName === 'STYLE') return existing as HTMLStyleElement
  const el = doc.createElement('style')
  el.id = STYLE_ID
  el.textContent = TRANSPARENT_TEXT_CSS
  doc.head.appendChild(el)
  return el
}

// This window's frames, not the page's: an off-screen (or hidden) iframe may
// get no animation frames at all, while its rendering still updates with ours.
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}
