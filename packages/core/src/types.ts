// Branded numeric types so coordinate-system mistakes (DOM px vs PDF pt) become
// compile-time errors. There is exactly one place that converts between them
// (the `emit` stage); everywhere else, the brand is preserved.

export type DomPx = number & { readonly __brand: 'DomPx' }
export type PdfPt = number & { readonly __brand: 'PdfPt' }

export const domPx = (n: number): DomPx => n as DomPx
export const pdfPt = (n: number): PdfPt => n as PdfPt

export interface RGB {
  /** 0-1 */ r: number
  /** 0-1 */ g: number
  /** 0-1 */ b: number
  /** 0-1 */ a: number
}

export type FontStyle = 'normal' | 'italic' | 'oblique'

export interface TextSpan {
  text: string
  /** Position relative to the page element's top-left, in DOM pixels. */
  x: DomPx
  y: DomPx
  /** Line-box width and height in DOM pixels. */
  w: DomPx
  h: DomPx
  fontFamily: string
  fontSize: DomPx
  /** CSS font-weight as a number (100-900). */
  fontWeight: number
  fontStyle: FontStyle
  /** CSS inline direction (`ltr` or `rtl`), used for shaping/placement. */
  direction?: 'ltr' | 'rtl'
  color: RGB
  letterSpacing: DomPx
}

export interface DomToPdfOptions {
  /** The page elements to render. Each becomes one PDF page. */
  pages: ArrayLike<HTMLElement>
  /** Logical DOM dimensions of each page (must match the element's rendered size). */
  source: { width: number; height: number }
  /** Output PDF page dimensions in PDF points. */
  output: { width: number; height: number; unit: 'pt' }
  /** Default: 'jpeg'. */
  rasterFormat?: 'jpeg' | 'png'
  /** Default: 0.85. Only used when rasterFormat === 'jpeg'. */
  jpegQuality?: number
  /** Called as `(pageIndex, totalPages)` before each page is processed. */
  onProgress?: (pageIndex: number, totalPages: number) => void
  /** Called once per stage with timing data. */
  onTiming?: (event: TimingEvent) => void
  /**
   * Opt-in Phase 3 self-check: render the generated PDF back to pixels and
   * pixel-diff each page against a ground-truth raster (the page as rendered,
   * text included), flagging pages that diverge. Requires `pdfjs-dist`
   * (optional peer dependency). Off by default.
   */
  selfCheck?: {
    enabled: boolean
    /** Mean per-channel diff (0..1) above which a page is flagged. Default 0.1. */
    threshold?: number
  }
}

export type TimingEvent =
  | { stage: 'walk'; page: number; durationMs: number }
  | { stage: 'capture'; page: number; durationMs: number }
  | { stage: 'fonts'; durationMs: number }
  | { stage: 'emit'; durationMs: number }
  | { stage: 'selfCheck'; durationMs: number }

export interface SelfCheckPageResult {
  /** 1-indexed page number. */
  page: number
  /** Visual diff 0..1 between the rendered PDF page and the ground-truth raster. */
  diff: number
  /** Whether `diff` exceeded the configured threshold. */
  exceeded: boolean
}

export interface DomToPdfResult {
  blob: Blob
  warnings: string[]
  /** Per-page visual-diff results when `selfCheck.enabled` was set; else absent. */
  selfCheck?: SelfCheckPageResult[]
}
