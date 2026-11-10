import { shell, systemPreferences } from 'electron'
import type { PermissionKind, PermissionState, Permissions } from '@shared/ipc'
import { log } from './log'

/** Set by hotkeys.ts: null = unknown / not started, true = hook running and seeing keys, false = failed. */
let inputMonitoring: boolean | null = null
export function setInputMonitoringState(v: boolean | null): void {
  inputMonitoring = v
}

const isMac = process.platform === 'darwin'

function micState(): PermissionState {
  if (process.platform === 'linux') return 'unknown'
  try {
    const s = systemPreferences.getMediaAccessStatus('microphone')
    if (s === 'granted' || s === 'denied' || s === 'restricted' || s === 'not-determined') return s
    return 'unknown'
  } catch {
    return process.platform === 'win32' ? 'granted' : 'unknown'
  }
}

export function getPermissions(): Permissions {
  if (!isMac) {
    return { microphone: micState(), accessibility: 'not-applicable', 'input-monitoring': 'not-applicable' }
  }
  return {
    microphone: micState(),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
    'input-monitoring': inputMonitoring === true ? 'granted' : inputMonitoring === false ? 'denied' : 'unknown'
  }
}

export async function requestPermission(kind: PermissionKind, retryInputHook: () => void): Promise<PermissionState> {
  try {
    if (kind === 'microphone' && (isMac || process.platform === 'win32')) {
      if (isMac) await systemPreferences.askForMediaAccess('microphone')
    } else if (kind === 'accessibility' && isMac) {
      systemPreferences.isTrustedAccessibilityClient(true) // shows the system prompt
    } else if (kind === 'input-monitoring' && isMac) {
      retryInputHook() // starting the hook is what makes macOS ask
    }
  } catch (err) {
    log('permission request failed', kind, err)
  }
  return getPermissions()[kind]
}

export async function openPermissionSettings(kind: PermissionKind): Promise<void> {
  if (isMac) {
    const pane = kind === 'microphone' ? 'Privacy_Microphone' : kind === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ListenEvent'
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
  } else if (process.platform === 'win32' && kind === 'microphone') {
    await shell.openExternal('ms-settings:privacy-microphone')
  }
}
