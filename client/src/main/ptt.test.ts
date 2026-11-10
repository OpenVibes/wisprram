import { describe, expect, it } from 'vitest'
import { PttDetector, type PttEvent } from './ptt'

const PTT = 3640
const OTHER = 30

function setup() {
  const events: PttEvent['type'][] = []
  const d = new PttDetector({ keycode: PTT }, (e) => events.push(e.type))
  return { d, events }
}

describe('PttDetector', () => {
  it('hold then release → start, stop', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 1000)
    d.keyUp(PTT, 1600)
    expect(events).toEqual(['start', 'stop'])
  })

  it('ignores OS key repeat', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyDown(PTT, 500)
    d.keyDown(PTT, 530)
    d.keyUp(PTT, 900)
    expect(events).toEqual(['start', 'stop'])
  })

  it('hold shorter than 250 ms cancels silently', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyUp(PTT, 249)
    expect(events).toEqual(['start', 'cancel'])
  })

  it('hold of exactly 250 ms is a real hold', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyUp(PTT, 250)
    expect(events).toEqual(['start', 'stop'])
  })

  it('double tap within 350 ms locks hands-free; its release does nothing', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyUp(PTT, 100)
    d.keyDown(PTT, 250)
    d.keyUp(PTT, 330)
    expect(events).toEqual(['start', 'cancel', 'lock'])
  })

  it('second tap after the window is just a new press', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyUp(PTT, 100)
    d.keyDown(PTT, 451) // 351 ms after release
    d.keyUp(PTT, 520)
    expect(events).toEqual(['start', 'cancel', 'start', 'cancel'])
  })

  it('a third quick tap does not chain into another lock', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyUp(PTT, 80)
    d.keyDown(PTT, 150)
    d.keyUp(PTT, 220)
    d.keyDown(PTT, 300)
    expect(events).toEqual(['start', 'cancel', 'lock', 'start'])
  })

  it('a long hold between taps resets double-tap tracking', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyUp(PTT, 100)
    d.keyDown(PTT, 600)
    d.keyUp(PTT, 1500)
    d.keyDown(PTT, 1600)
    expect(events).toEqual(['start', 'cancel', 'start', 'stop', 'start'])
  })

  it('another key during a short hold cancels (shortcut combo) and the release is ignored', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyDown(OTHER, 60)
    d.keyUp(OTHER, 100)
    d.keyUp(PTT, 400)
    expect(events).toEqual(['start', 'cancel'])
  })

  it('another key after the hold is committed does not cancel', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyDown(OTHER, 400)
    d.keyUp(PTT, 800)
    expect(events).toEqual(['start', 'stop'])
  })

  it('typing another key between taps breaks the double-tap', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.keyUp(PTT, 100)
    d.keyDown(OTHER, 150)
    d.keyUp(OTHER, 170)
    d.keyDown(PTT, 250)
    expect(events).toEqual(['start', 'cancel', 'start'])
  })

  it('ignores unrelated keys and stray keyup', () => {
    const { d, events } = setup()
    d.keyUp(PTT, 10)
    d.keyDown(OTHER, 20)
    d.keyUp(OTHER, 30)
    expect(events).toEqual([])
  })

  it('setKeycode switches the key and resets state', () => {
    const { d, events } = setup()
    d.keyDown(PTT, 0)
    d.setKeycode(3613)
    d.keyUp(PTT, 400)
    d.keyDown(3613, 500)
    d.keyUp(3613, 900)
    expect(events).toEqual(['start', 'start', 'stop'])
  })
})
