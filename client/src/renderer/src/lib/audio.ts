// Microphone helpers shared by the Settings meter and onboarding (the overlay has its own capture pipeline).
export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was denied. Allow it in your system privacy settings.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found.'
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is busy or unavailable.'
    default:
      return e instanceof Error && e.message ? e.message : 'Could not open the microphone.'
  }
}

export function audioConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: {
      deviceId: !deviceId || deviceId === 'default' ? undefined : { exact: deviceId },
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true
    }
  }
}

/** RMS (0..1) of a time-domain float buffer. */
export function rms(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / (buf.length || 1))
}

/** Maps raw RMS to a perceptual 0..1 meter value. */
export function levelFromRms(r: number): number {
  return Math.min(1, Math.pow(Math.min(1, r * 4.5), 0.6))
}

export interface MicMeter {
  getLevel(): number
  close(): void
}

/** Opens the mic and exposes a level reader. Falls back to the default device if the chosen one fails. */
export async function openMicMeter(deviceId: string): Promise<MicMeter> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(audioConstraints(deviceId))
  } catch (e) {
    if (deviceId === 'default' || (e as { name?: string }).name === 'NotAllowedError') throw e
    stream = await navigator.mediaDevices.getUserMedia(audioConstraints('default'))
  }
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  ctx.createMediaStreamSource(stream).connect(analyser)
  void ctx.resume().catch(() => undefined)
  const buf = new Float32Array(analyser.fftSize)
  let smooth = 0
  let closed = false
  return {
    getLevel() {
      if (closed) return 0
      analyser.getFloatTimeDomainData(buf)
      const v = levelFromRms(rms(buf))
      smooth = v > smooth ? v : smooth * 0.85 + v * 0.15
      return smooth
    },
    close() {
      if (closed) return
      closed = true
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close().catch(() => undefined)
    }
  }
}
