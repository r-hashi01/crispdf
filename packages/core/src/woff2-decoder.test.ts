import { describe, expect, it } from 'vitest'
import { decodeWoff2ToSfnt, isSfntBytes } from './woff2-decoder'

const INTER_LATIN =
  'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7.woff2'

describe('decodeWoff2ToSfnt', () => {
  it('decodes a real WOFF2 payload into SFNT bytes', async () => {
    const res = await fetch(INTER_LATIN)
    expect(res.ok).toBe(true)
    const woff2 = new Uint8Array(await res.arrayBuffer())
    expect(String.fromCharCode(...woff2.slice(0, 4))).toBe('wOF2')

    const sfnt = await decodeWoff2ToSfnt(woff2)
    expect(isSfntBytes(sfnt)).toBe(true)
    expect(String.fromCharCode(...sfnt.slice(0, 4))).not.toBe('wOF2')
  })

  it('throws on malformed WOFF2 payloads', async () => {
    const broken = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x02])
    await expect(decodeWoff2ToSfnt(broken)).rejects.toThrow()
  })
})
