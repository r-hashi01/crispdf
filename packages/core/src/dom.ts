/**
 * The document / window a node belongs to. Pages may live in another document
 * than the one crispdf runs in — typically a same-origin iframe hosting a
 * print view — so styles, ranges, computed styles and fonts must come from the
 * page's own document, not the global one.
 */
export function docOf(node: Node): Document {
  return node.ownerDocument ?? document
}

export function winOf(node: Node): Window & typeof globalThis {
  return (docOf(node).defaultView ?? window) as Window & typeof globalThis
}
