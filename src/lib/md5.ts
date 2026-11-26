/**
 * Small MD5 implementation for the browser development backend.
 * (The desktop app computes these in Rust.)
 */

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

export function md5Hex(data: Uint8Array): string {
  const len = data.length
  const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64)
  padded.set(data)
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const M = new Uint32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const tmp = d
      d = c
      c = b
      const x = (a + f + K[i] + M[g]) >>> 0
      const s = S[(i >> 4) * 4 + (i % 4)]
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0
      a = tmp
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  const out = new DataView(new ArrayBuffer(16))
  ;[a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true))
  return Array.from(new Uint8Array(out.buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Same sampling as KOReader's util.partialMD5 (see src-tauri/src/lib.rs). */
export function partialMd5Bytes(bytes: Uint8Array): string {
  const parts: Uint8Array[] = []
  for (let i = -1; i <= 10; i++) {
    const offset = i < 0 ? 0 : 1024 * 4 ** i
    if (offset >= bytes.length) break
    parts.push(bytes.subarray(offset, offset + 1024))
  }
  const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    total.set(p, o)
    o += p.length
  }
  return md5Hex(total)
}
