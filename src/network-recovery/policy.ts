import type { ConnectivityProbe, ExecutorInfrastructureFailureSignal, NetworkRecoveryStep } from './types.js'

const CONNECTION_FAILURE = /(timed? out|timeout|reconnect|connection|network|transport|websocket|dns|no such host|econn|socket|tls|certificate|502|503|504)/i
const NON_NETWORK_FAILURE = /(401|403|unauthori[sz]ed|authentication|api key|quota|rate.?limit|429|schema|response_format|invalid_request|model not found|permission denied)/i

export function isNetworkRecoveryCandidate(signal: ExecutorInfrastructureFailureSignal, minimumAttempts = 2): boolean {
  return signal.attempt >= minimumAttempts
    && CONNECTION_FAILURE.test(signal.error)
    && !NON_NETWORK_FAILURE.test(signal.error)
}

export function endpointHealthy(probe: ConnectivityProbe): boolean {
  return probe.codex && probe.feishu
}

export function nextRecoveryStep(probe: ConnectivityProbe, completed: readonly NetworkRecoveryStep[]): Exclude<NetworkRecoveryStep, 'probe'> | null {
  if (endpointHealthy(probe)) return null
  if (!completed.includes('disable-clash')) return 'disable-clash'
  if (!completed.includes('switch-calvin')) return 'switch-calvin'
  if (!completed.includes('switch-blacklake')) return 'switch-blacklake'
  if (!completed.includes('enable-blacklake-route')) return 'enable-blacklake-route'
  return null
}

export function recoveryBucket(at: string, bucketMs = 30 * 60_000): string {
  const timestamp = new Date(at).getTime()
  if (!Number.isFinite(timestamp)) throw new Error('network recovery timestamp is invalid')
  return String(Math.floor(timestamp / bucketMs))
}
