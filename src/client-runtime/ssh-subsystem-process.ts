import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { DeviceTransportPolicyV1 } from './device-transport.js'

const hostPattern = /^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]+\])$/i
const userPattern = /^[a-z_][a-z0-9_-]{0,31}$/i

export interface ResolvedSshSubsystemInputsV1 {
  readonly endpointRef: string; readonly host: string; readonly port: number
  readonly userRef: string; readonly user: string
  readonly credentialRef: string; readonly identityFile: string
  readonly hostKeyFingerprintRef: string; readonly knownHostsFile: string
}

export interface InactiveSshSubsystemLaunchV1 {
  readonly command: 'ssh'; readonly args: readonly string[]
  readonly subsystem: 'quark-device-v1'; readonly protocol: 'quark-device-sync.v1'
  readonly shell: false; readonly processStarted: false; readonly activationAllowed: false
}

/** Builds one fixed subsystem-only ssh launch. Resolved paths are local-only and must never enter cloud projection. */
export function prepareInactiveSshSubsystemLaunch(policyInput: DeviceTransportPolicyV1, resolved: ResolvedSshSubsystemInputsV1): InactiveSshSubsystemLaunchV1 {
  const policy = validateLaunchPolicy(policyInput)
  if (resolved.endpointRef !== policy.ssh.endpointRef || resolved.userRef !== policy.ssh.userRef || resolved.credentialRef !== policy.ssh.credentialRef || resolved.hostKeyFingerprintRef !== policy.ssh.hostKeyFingerprintRef) throw new Error('resolved SSH inputs do not match opaque policy references')
  if (!hostPattern.test(resolved.host) || !userPattern.test(resolved.user) || !Number.isSafeInteger(resolved.port) || resolved.port < 1 || resolved.port > 65535) throw new Error('resolved SSH endpoint is invalid')
  if (![resolved.identityFile, resolved.knownHostsFile].every(path => isAbsolute(path) && !/[\r\n\0]/.test(path))) throw new Error('resolved SSH files must be absolute local paths')
  const args = Object.freeze([
    '-T', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${resolved.knownHostsFile}`, '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ForwardAgent=no',
    '-o', 'ClearAllForwardings=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'PermitLocalCommand=no', '-o', 'RequestTTY=no',
    '-i', resolved.identityFile, '-p', String(resolved.port), '-s', `${resolved.user}@${resolved.host}`, 'quark-device-v1',
  ])
  return Object.freeze({ command: 'ssh', args, subsystem: 'quark-device-v1', protocol: 'quark-device-sync.v1', shell: false, processStarted: false, activationAllowed: false })
}

function validateLaunchPolicy(value: DeviceTransportPolicyV1): DeviceTransportPolicyV1 {
  if (value.schemaVersion !== 1 || value.protocol !== 'quark-device-sync.v1' || JSON.stringify(value.preference) !== JSON.stringify(['direct-tls', 'ssh-subsystem'])) throw new Error('SSH launch policy is unsupported')
  if (value.ssh.kind !== 'ssh-subsystem' || value.ssh.state !== 'configured-inactive' || value.ssh.subsystem !== 'quark-device-v1' || value.ssh.hostKeyVerification !== 'pinned') throw new Error('SSH launch policy is not pinned to the fixed subsystem')
  if (!value.ssh.clientInitiated || !value.ssh.fallbackOnly || value.ssh.remoteShellAllowed || value.ssh.remoteCommandAllowed || value.ssh.portForwardingAllowed || value.ssh.agentForwardingAllowed || !value.singleActiveTransport || !value.resumeSameDeviceSession || !value.preservePlanLeaseAndIdempotency || value.activationAllowed) throw new Error('SSH launch policy expands transport ownership or command access')
  return value
}

type ProbeObservation = { readonly state: 'completed' | 'not-found' | 'timed-out'; readonly output: string }
export interface SshVersionProbeRunnerV1 { run(): Promise<ProbeObservation> }
export interface SshClientReadinessV1 { readonly schemaVersion: 1; readonly installation: 'detected' | 'not-detected' | 'unknown'; readonly version: string | null; readonly checkedAt: string; readonly rawOutputRetained: false }

/** Fixed local `ssh -V` readiness probe; it opens no network connection and discards raw output. */
export async function inspectSshClient(now = new Date(), runner: SshVersionProbeRunnerV1 = new NodeSshVersionProbeRunnerV1()): Promise<SshClientReadinessV1> {
  if (Number.isNaN(now.getTime())) throw new Error('SSH readiness timestamp is invalid')
  const observation = await runner.run()
  const match = observation.state === 'completed' ? /OpenSSH[_\s]([0-9]+(?:\.[0-9]+)?(?:p[0-9]+)?)/i.exec(observation.output) : null
  return Object.freeze({ schemaVersion: 1, installation: observation.state === 'not-found' ? 'not-detected' : observation.state === 'completed' ? 'detected' : 'unknown', version: match?.[1] ?? null, checkedAt: now.toISOString(), rawOutputRetained: false })
}

export class NodeSshVersionProbeRunnerV1 implements SshVersionProbeRunnerV1 {
  run(): Promise<ProbeObservation> { return new Promise(resolve => {
    let output = Buffer.alloc(0); let settled = false
    const child = spawn('ssh', ['-V'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const append = (chunk: Buffer | string) => { if (output.byteLength < 4096) output = Buffer.concat([output, Buffer.from(chunk).subarray(0, 4096 - output.byteLength)]) }
    child.stdout.on('data', append); child.stderr.on('data', append)
    const finish = (state: ProbeObservation['state']) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ state, output: state === 'completed' ? output.toString('utf8') : '' }) }
    child.once('error', error => finish((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'completed')); child.once('close', () => finish('completed'))
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish('timed-out') }, 5000); timer.unref()
  }) }
}
