export { domToPdf } from './dom-to-pdf'
export type {
  DomPx,
  DomToPdfOptions,
  DomToPdfResult,
  FontStyle,
  PdfPt,
  RGB,
  SelfCheckPageResult,
  TextSpan,
  TimingEvent,
} from './types'
export { type ValidationIssue, type ValidationResult, validate } from './validate'

// Single source of truth is package.json — injected at build/test time via
// the `__VELLUM_VERSION__` define (see tsup.config.ts / vitest.config.ts) so the
// version is never duplicated as a literal in source.
declare const __VELLUM_VERSION__: string
export const VERSION: string = __VELLUM_VERSION__
