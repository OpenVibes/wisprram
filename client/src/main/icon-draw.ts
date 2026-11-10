// Pure fallback icon drawing (no Electron imports).

/** Antialiased filled circle (or ring) as a BGRA bitmap — fallback when the icon files are missing. */
export function drawCircleBitmap(size: number, rgb: [number, number, number], ring: boolean): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const r = size * 0.38
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      let a = Math.max(0, Math.min(1, r + 0.5 - d))
      if (ring) a = Math.min(a, Math.max(0, Math.min(1, d - (r - size * 0.14) + 0.5)))
      const i = (y * size + x) * 4
      buf[i] = rgb[2]
      buf[i + 1] = rgb[1]
      buf[i + 2] = rgb[0]
      buf[i + 3] = Math.round(a * 255)
    }
  }
  return buf
}
