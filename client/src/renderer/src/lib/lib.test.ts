import { describe, expect, it } from 'vitest'
import { dayKey, dayLabel, groupByDay } from './dates'
import { formatMinutes, formatMs, formatTimer, greeting, splitVariants, truncate, errorMessage } from './format'
import { acceleratorKeycaps, eventToAccelerator, parseAccelerator, pttKeyLabel, pttOptions } from './keys'
import { parseHash, parseSection } from './route'
import { dismissHero, heroKey, isHeroDismissed, resetHeroes } from './hero'
import { describeFiles, isAbsolutePath, layoutExample, metaRows, middleEllipsis, validateServerUrl } from './archive'
import { levelFromRms, rms } from './audio'

describe('keycap formatting', () => {
  it('maps PTT keys per platform', () => {
    expect(pttKeyLabel('AltRight', 'darwin')).toBe('Right ⌥')
    expect(pttKeyLabel('AltRight', 'win32')).toBe('Right Alt')
    expect(pttKeyLabel('CtrlRight', 'linux')).toBe('Right Ctrl')
    expect(pttKeyLabel('MetaRight', 'darwin')).toBe('Right ⌘')
    expect(pttKeyLabel('MetaRight', 'win32')).toBe('Right Win')
    expect(pttKeyLabel('F13', 'darwin')).toBe('F13')
  })

  it('renders accelerators as keycaps', () => {
    expect(acceleratorKeycaps('CommandOrControl+Shift+Space', 'darwin')).toEqual(['⌘', '⇧', 'Space'])
    expect(acceleratorKeycaps('CommandOrControl+Shift+Space', 'win32')).toEqual(['Ctrl', 'Shift', 'Space'])
    expect(acceleratorKeycaps('CommandOrControl+Shift+E', 'darwin')).toEqual(['⌘', '⇧', 'E'])
    expect(acceleratorKeycaps('Alt+F9', 'darwin')).toEqual(['⌥', 'F9'])
    expect(acceleratorKeycaps('Ctrl+Plus', 'linux')).toEqual(['Ctrl', '+'])
    expect(acceleratorKeycaps('Super+K', 'linux')).toEqual(['Super', 'K'])
  })

  it('parses accelerator tokens', () => {
    expect(parseAccelerator(' Ctrl + Shift+X ')).toEqual(['Ctrl', 'Shift', 'X'])
    expect(parseAccelerator('')).toEqual([])
  })

  it('offers the current PTT key even when custom', () => {
    expect(pttOptions('darwin').map((o) => o.value)).toContain('F15')
    expect(pttOptions('darwin', 'AltLeft').map((o) => o.value)).toContain('AltLeft')
    expect(pttOptions('darwin')[0].label).toBe('Right Option')
  })
})

describe('eventToAccelerator', () => {
  const ev = (code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    key: '',
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  })
  it('builds accelerators with modifiers', () => {
    expect(eventToAccelerator(ev('Space', { metaKey: true, shiftKey: true }), 'darwin')).toBe('CommandOrControl+Shift+Space')
    expect(eventToAccelerator(ev('KeyE', { ctrlKey: true, shiftKey: true }), 'win32')).toBe('CommandOrControl+Shift+E')
    expect(eventToAccelerator(ev('KeyK', { ctrlKey: true, metaKey: true }), 'darwin')).toBe('CommandOrControl+Control+K')
    expect(eventToAccelerator(ev('Digit4', { altKey: true }), 'linux')).toBe('Alt+4')
  })
  it('rejects bare letters and modifier-only presses; allows bare F-keys', () => {
    expect(eventToAccelerator(ev('KeyA'), 'darwin')).toBeNull()
    expect(eventToAccelerator(ev('ShiftLeft', { shiftKey: true }), 'darwin')).toBeNull()
    expect(eventToAccelerator(ev('F9'), 'linux')).toBe('F9')
  })
})

describe('day grouping', () => {
  const now = new Date(2026, 10, 9, 15, 0) // local Nov 9 2026
  const at = (d: number, h: number) => ({ created_at: new Date(2026, 10, d, h, 0).toISOString(), id: `${d}-${h}` })

  it('groups consecutive items by local day with friendly labels', () => {
    const groups = groupByDay([at(9, 14), at(9, 9), at(8, 22), at(3, 10), at(3, 8)], now)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Tuesday, Nov 3'])
    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 2])
    expect(groups[0].key).toBe('2026-11-09')
  })
  it('adds a year for older years and skips invalid dates', () => {
    expect(dayLabel(new Date(2025, 11, 31), now)).toContain('2025')
    expect(groupByDay([{ created_at: 'nope' }], now)).toEqual([])
  })
  it('dayKey pads', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('format helpers', () => {
  it('formats timers', () => {
    expect(formatTimer(0)).toBe('00:00')
    expect(formatTimer(83_900)).toBe('01:23')
    expect(formatTimer(-5)).toBe('00:00')
  })
  it('truncates and greets', () => {
    expect(truncate('hello   world', 20)).toBe('hello world')
    expect(truncate('abcdefghij', 5)).toBe('abcd…')
    expect(greeting(9)).toBe('Good morning')
    expect(greeting(20)).toBe('Good evening')
    expect(formatMinutes(386)).toBe('6.4 h')
    expect(formatMinutes(42)).toBe('42 min')
  })
  it('splits variants', () => {
    expect(splitVariants('a, b\nA,  c ,')).toEqual(['a', 'b', 'c'])
  })
  it('cleans IPC error prefixes', () => {
    expect(errorMessage(new Error("Error invoking remote method 'x:y': Error: boom"))).toBe('boom')
    expect(errorMessage(undefined, 'fallback')).toBe('fallback')
  })
})

describe('routing and audio math', () => {
  it('parses hashes', () => {
    expect(parseHash('#/history')).toBe('history')
    expect(parseHash('#/onboarding')).toBe('onboarding')
    expect(parseHash('#/settings?x=1')).toBe('settings')
    expect(parseHash('')).toBe('home')
    expect(parseHash('#/nope')).toBe('home')
  })
  it('computes rms and a bounded level', () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0)
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1)
    expect(levelFromRms(0)).toBe(0)
    expect(levelFromRms(5)).toBe(1)
    expect(levelFromRms(0.05)).toBeGreaterThan(0.3)
  })
})

describe('validateServerUrl', () => {
  it('accepts full URLs and strips trailing slashes, query and hash', () => {
    expect(validateServerUrl('http://192.168.1.50:8790')).toEqual({ ok: true, url: 'http://192.168.1.50:8790' })
    expect(validateServerUrl('  https://pc.example.com/api/?x=1#y ')).toEqual({ ok: true, url: 'https://pc.example.com/api' })
    expect(validateServerUrl('http://192.168.1.50:8790///')).toEqual({ ok: true, url: 'http://192.168.1.50:8790' })
  })
  it('assumes http and the default port when both are missing', () => {
    expect(validateServerUrl('192.168.1.50')).toEqual({ ok: true, url: 'http://192.168.1.50:8790' })
    expect(validateServerUrl('my-pc.local')).toEqual({ ok: true, url: 'http://my-pc.local:8790' })
    expect(validateServerUrl('localhost:9000')).toEqual({ ok: true, url: 'http://localhost:9000' })
    expect(validateServerUrl('http://192.168.1.50')).toEqual({ ok: true, url: 'http://192.168.1.50' })
  })
  it('rejects empty, spaced, wrong-scheme and malformed input with a friendly message', () => {
    for (const bad of ['', '   ', 'http://192.168 .1.50', 'ftp://host', 'http://', 'http://host:99999', 'http://user:pw@host']) {
      const r = validateServerUrl(bad)
      expect(r.ok, bad).toBe(false)
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10)
    }
  })
})

describe('archive helpers', () => {
  it('detects absolute paths on every OS', () => {
    for (const p of ['/home/me/audio', 'C:\\Recordings', 'D:/rec', '\\\\nas\\share', ' /x']) expect(isAbsolutePath(p), p).toBe(true)
    for (const p of ['audio', './audio', '../x', '~/audio', 'rec/dir', '']) expect(isAbsolutePath(p), p).toBe(false)
  })
  it('shortens long paths in the middle', () => {
    expect(middleEllipsis('/short', 40)).toBe('/short')
    const long = '/Users/someone/Documents/Projects/WisprRam/archive/2026'
    const out = middleEllipsis(long, 30)
    expect(out).toHaveLength(30)
    expect(out).toContain('…')
    expect(out.startsWith('/Users')).toBe(true)
    expect(out.endsWith('2026')).toBe(true)
  })
  it('renders the folder layout for the selected files', () => {
    expect(layoutExample({})).toBe('2026-11-09/\n  193412-dictation-6ab1e37e/\n    audio.webm\n    transcript.txt\n    output.txt\n    meta.json')
    expect(layoutExample({ archiveAudio: false, archiveMeta: false })).toBe('2026-11-09/\n  193412-dictation-6ab1e37e/\n    transcript.txt\n    output.txt')
    expect(layoutExample({ archiveAudio: false, archiveTranscript: false, archiveOutput: false, archiveMeta: false })).toContain('nothing selected')
  })
  it('describes entry files', () => {
    expect(describeFiles(['audio.webm', 'transcript.txt', 'output.txt', 'meta.json'])).toBe('audio, transcript, final text, details')
    expect(describeFiles(['audio.wav', 'meta.json'])).toBe('audio, details')
    expect(describeFiles([])).toBe('no files')
  })
  it('turns meta into labelled rows and tolerates junk', () => {
    const rows = metaRows(
      { stt_model: 'large-v3-turbo', llm_model: 'qwen2.5:3b', cleanup: 'full', cleanup_used: 'llm', style: 'very_casual', language: 'en', timings: { stt_ms: 240, llm_ms: 1850, total_ms: 2100 }, applied_snippets: ['my email'], selected_text: 'x'.repeat(300) },
      'Slack'
    )
    const m = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(m['Speech model']).toBe('large-v3-turbo')
    expect(m['Cleanup']).toBe('Full AI · AI model')
    expect(m['Style']).toBe('Very casual')
    expect(m['App']).toBe('Slack')
    expect(m['Timings']).toBe('Speech 240 ms · Cleanup 1.9 s · Total 2.1 s')
    expect(m['Snippets used']).toBe('my email')
    expect(m['Selected text'].length).toBeLessThanOrEqual(140)
    expect(metaRows(undefined, null)).toEqual([])
    expect(metaRows({ stt_model: 5, timings: 'x', style: '', applied_snippets: [1] } as never, '')).toEqual([])
  })
  it('formats milliseconds', () => {
    expect(formatMs(410)).toBe('410 ms')
    expect(formatMs(1850)).toBe('1.9 s')
  })
  it('parses #/settings/<section> anchors without changing the route', () => {
    expect(parseSection('#/settings/archive')).toBe('archive')
    expect(parseSection('#/settings')).toBeNull()
    expect(parseSection('')).toBeNull()
    expect(parseHash('#/settings/archive')).toBe('settings')
  })
})

describe('hero dismissal storage', () => {
  const mem = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
  }
  it('remembers and resets dismissals', () => {
    const s = mem()
    expect(isHeroDismissed('snippets', s)).toBe(false)
    dismissHero('snippets', s)
    expect(s.data.get(heroKey('snippets'))).toBe('1')
    expect(isHeroDismissed('snippets', s)).toBe(true)
    expect(isHeroDismissed('home', s)).toBe(false)
    resetHeroes(['snippets'], s)
    expect(isHeroDismissed('snippets', s)).toBe(false)
  })
  it('never throws when storage is unavailable or broken', () => {
    const boom = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
    expect(isHeroDismissed('x', boom)).toBe(false)
    expect(() => dismissHero('x', boom)).not.toThrow()
    expect(() => resetHeroes(['x'], boom)).not.toThrow()
    expect(isHeroDismissed('x', null)).toBe(false)
    expect(() => dismissHero('x', null)).not.toThrow()
  })
})
