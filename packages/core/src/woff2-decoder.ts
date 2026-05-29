type Woff2Decompress = (input: Uint8Array | ArrayBuffer) => Promise<Uint8Array>

let cached: Woff2Decompress | null = null

async function loadDecompress(): Promise<Woff2Decompress> {
  if (cached) return cached
  const mod = await import('woff2-encoder/decompress')
  const maybe = mod as unknown as { default?: unknown; decompress?: unknown }
  const fn = maybe.default ?? maybe.decompress ?? maybe
  if (typeof fn !== 'function') {
    throw new Error('woff2 decoder module did not expose a decompress function')
  }
  cached = fn as Woff2Decompress
  return cached
}

/**
 * Decode WOFF2 bytes to raw SFNT (TTF/OTF) bytes. PDF embedded-font streams
 * must carry decoded sfnt programs for broad reader compatibility.
 */
export async function decodeWoff2ToSfnt(bytes: Uint8Array): Promise<Uint8Array> {
  const decompress = await loadDecompress()
  const out = await decompress(bytes)
  const sfnt = out instanceof Uint8Array ? out : new Uint8Array(out)
  if (!isSfntBytes(sfnt)) {
    throw new Error(
      `woff2 decompressor returned non-SFNT bytes (tag "${readTag(sfnt)}"); refusing to embed`,
    )
  }
  return sfnt
}

export function isSfntBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  return (
    // TrueType outlines
    (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
    // OpenType/CFF
    (bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f) ||
    // TrueType collection
    (bytes[0] === 0x74 && bytes[1] === 0x74 && bytes[2] === 0x63 && bytes[3] === 0x66)
  )
}

function readTag(bytes: Uint8Array): string {
  if (bytes.length < 4) return '<short>'
  return String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0)
}
