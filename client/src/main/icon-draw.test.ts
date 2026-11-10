import { describe, expect, it } from 'vitest'
import { drawCircleBitmap } from './icon-draw'

describe('drawCircleBitmap', () => {
  it('produces size*size BGRA pixels with an opaque centre and transparent corners', () => {
    const size = 22
    const buf = drawCircleBitmap(size, [10, 20, 30], false)
    expect(buf.length).toBe(size * size * 4)
    const px = (x: number, y: number) => [...buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)]
    expect(px(0, 0)[3]).toBe(0)
    const c = px(11, 11)
    expect(c[3]).toBe(255)
    expect(c.slice(0, 3)).toEqual([30, 20, 10]) // BGR order
  })
  it('ring has a hollow centre', () => {
    const size = 32
    const buf = drawCircleBitmap(size, [0, 0, 0], true)
    expect(buf[((16 * size) + 16) * 4 + 3]).toBe(0)
    expect(buf[((16 * size) + 4) * 4 + 3]).toBeGreaterThan(0)
  })
})
