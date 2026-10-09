import { winOf } from './dom'
/**
 * Static pre-flight validation, the *before* counterpart to the self-check's
 * *after* detection (PLAN §6). It catches content that would lose information
 * silently — `<canvas>`/`<video>` text the raster keeps but the vector layer
 * can never extract (hard errors) — and content that renders but outside the
 * tool's quality guarantees (soft warnings: blend/filter/sticky/3D transform).
 *
 * Pure DOM read: it never mutates the page and never throws on content. Run it
 * before `domToPdf` in CI or at runtime; warnings are informational, an error
 * means a page will lose selectable text.
 */

export interface ValidationIssue {
  /** Stable identifier for the triggering condition (e.g. 'canvas'). */
  rule: string
  /** Human-readable explanation. */
  message: string
  /** The offending element. */
  element: HTMLElement
  /** A short tag/id/class hint for logs. */
  selector: string
}

export interface ValidationResult {
  /** True when there are no errors (warnings are allowed). */
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export function validate(pages: ArrayLike<HTMLElement>): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  for (const page of Array.from(pages)) {
    if (!page) continue

    // Hard errors: raster-only elements whose text can never be extracted.
    for (const el of page.querySelectorAll<HTMLElement>('canvas, video')) {
      const tag = el.tagName.toLowerCase()
      errors.push({
        rule: tag,
        element: el,
        selector: describe(el),
        message:
          `<${tag}> renders only as pixels — any text it contains cannot be extracted into ` +
          `the selectable PDF layer and would be silently lost. Replace text-bearing ` +
          `${tag} content with HTML or SVG, or accept it as image-only.`,
      })
    }

    // Soft warnings: computed-style features that rasterize but can't blend
    // with the vector text layer, or are meaningless for a fixed-size page.
    const candidates: HTMLElement[] = [page, ...page.querySelectorAll<HTMLElement>('*')]
    for (const el of candidates) {
      const cs = winOf(el).getComputedStyle(el)

      if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') {
        warnings.push(warn('mix-blend-mode', el, `mix-blend-mode: ${cs.mixBlendMode}`))
      }
      if (cs.filter && cs.filter !== 'none') {
        warnings.push(warn('filter', el, `filter: ${cs.filter}`))
      }
      const backdrop = cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter')
      if (backdrop && backdrop !== 'none') {
        warnings.push(warn('backdrop-filter', el, `backdrop-filter: ${backdrop}`))
      }
      if (cs.position === 'sticky') {
        warnings.push(warn('position-sticky', el, 'position: sticky'))
      }
      if (isTransform3d(cs.transform)) {
        warnings.push(warn('transform-3d', el, `transform: ${cs.transform}`))
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

const WARN_REASON: Record<string, string> = {
  'mix-blend-mode':
    'is baked into the background raster and will not blend with the vector text drawn on top.',
  filter:
    'is applied in the raster only; the vector text overlay is unaffected, so the result may differ from the screen.',
  'backdrop-filter':
    'is baked into the background raster and will not affect the vector text drawn on top.',
  'position-sticky':
    'has no meaning for a single fixed-size page and may place content unexpectedly.',
  'transform-3d':
    'is flattened into the raster; the vector text layer is drawn unrotated, so text placement may not match.',
}

function warn(rule: string, element: HTMLElement, detail: string): ValidationIssue {
  return {
    rule,
    element,
    selector: describe(element),
    message: `${detail} on <${describe(element)}> ${WARN_REASON[rule] ?? 'is outside quality guarantees.'}`,
  }
}

/** Computed transforms are serialized as matrices; matrix3d() means 3D. */
function isTransform3d(transform: string): boolean {
  return transform.startsWith('matrix3d(') || transform.includes('perspective(')
}

function describe(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${el.id}`
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).join('.')}`
      : ''
  return `${tag}${cls}`
}
