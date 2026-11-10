import type { ConnectionState } from '../../../shared/ipc'

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  unconfigured: 'Not set up',
  unpaired: 'Not paired',
  connecting: 'Connecting…',
  connected: 'Connected',
  unreachable: 'Unreachable',
  unauthorized: 'Needs re-pairing'
}

export function connectionTone(c: ConnectionState): 'good' | 'warn' | 'bad' | 'idle' {
  if (c === 'connected') return 'good'
  if (c === 'connecting' || c === 'unpaired' || c === 'unconfigured') return 'warn'
  return 'bad'
}

export function StatusDot({ tone }: { tone: 'good' | 'warn' | 'bad' | 'idle' }): React.JSX.Element {
  return <span className={`dot dot-${tone}`} aria-hidden="true" />
}
