import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { DeviceSessionServerPortV1, RedactedResultV1 } from '../control-plane/contracts.js'
import type { DeviceSessionChallengeV1, DeviceSessionProofV1, DeviceSessionV1, DeviceTaskLeaseAcknowledgementV1, DeviceTaskLeaseV1 } from './contracts.js'
import { DeviceProtocolFrameDecoderV1, encodeDeviceProtocolFrame, MAX_DEVICE_FRAME_BYTES } from './device-codec.js'
import type { DeviceProtocolMessageV1, DeviceProtocolPayloadV1 } from './device-protocol.js'
import type { InactiveSshSubsystemLaunchV1 } from './ssh-subsystem-process.js'

const idPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/
type Scope = { readonly tenantId: string; readonly userId: string; readonly deviceId: string }

export interface SshSubsystemUnaryRunnerV1 { run(launch: InactiveSshSubsystemLaunchV1, request: Buffer, timeoutMs: number): Promise<Buffer> }

/** Explicit unary SSH fallback. Each call starts only the fixed subsystem and shares the canonical server session/lease owner. */
export class NodeInactiveSshDeviceTransportV1 implements DeviceSessionServerPortV1 {
  constructor(private readonly scope: Scope, private readonly launch: InactiveSshSubsystemLaunchV1, private readonly timeoutMs = 10_000, private readonly runner: SshSubsystemUnaryRunnerV1 = new NodeSshSubsystemUnaryRunnerV1()) {
    if (![scope.tenantId, scope.userId, scope.deviceId].every(value => idPattern.test(value)) || launch.subsystem !== 'quark-device-v1' || launch.protocol !== 'quark-device-sync.v1' || launch.shell || launch.processStarted || launch.activationAllowed || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new Error('SSH device transport configuration is invalid')
  }

  async issueChallenge(input: Scope): Promise<DeviceSessionChallengeV1> { this.#sameScope(input); return (await this.#request({ kind: 'client.hello', protocol: 'quark-device-sync.v1', transport: 'ssh-subsystem', executorReportDigests: [] }, 'server.challenge')).challenge }
  async openSession(proof: DeviceSessionProofV1): Promise<DeviceSessionV1> { if (proof.deviceId !== this.scope.deviceId) throw new Error('SSH device proof is out of scope'); return (await this.#request({ kind: 'client.proof', proof }, 'server.session')).session }
  async poll(sessionId: string): Promise<DeviceTaskLeaseV1 | null> { return (await this.#request({ kind: 'client.poll', sessionId }, 'server.lease')).lease }
  async acknowledge(sessionId: string, input: { readonly leaseToken: string; readonly taskId: string }): Promise<DeviceTaskLeaseAcknowledgementV1> { return (await this.#request({ kind: 'client.ack-request', sessionId, ...input }, 'server.ack')).acknowledgement }
  async submitResult(sessionId: string, input: Omit<RedactedResultV1, 'tenantId' | 'userId'>): Promise<RedactedResultV1> { return (await this.#request({ kind: 'client.result-submit', sessionId, result: input }, 'server.result')).result }

  async #request<K extends 'server.challenge' | 'server.session' | 'server.lease' | 'server.ack' | 'server.result'>(payload: DeviceProtocolPayloadV1, expected: K): Promise<Extract<DeviceProtocolPayloadV1, { kind: K }>> {
    const frameId = `frame.c.${randomBytes(12).toString('hex')}`
    const request: DeviceProtocolMessageV1 = { schemaVersion: 1, frameId, causationId: null, ...this.scope, sentAt: new Date().toISOString(), payload }
    const responseBytes = await this.runner.run(this.launch, encodeDeviceProtocolFrame(request), this.timeoutMs)
    const decoder = new DeviceProtocolFrameDecoderV1(); const decoded = decoder.push(responseBytes)
    if (decoded.length !== 1 || decoder.bufferedBytes() !== 0) throw new Error('SSH device transport returned an invalid response')
    const response = decoded[0]!
    if (response.causationId !== frameId || response.tenantId !== this.scope.tenantId || response.userId !== this.scope.userId || response.deviceId !== this.scope.deviceId) throw new Error('SSH device transport response is out of scope')
    if (response.payload.kind === 'server.error') throw new Error('SSH device transport request was rejected')
    if (response.payload.kind !== expected) throw new Error('SSH device transport response kind is invalid')
    validateServerPayload(response.payload)
    return response.payload as Extract<DeviceProtocolPayloadV1, { kind: K }>
  }

  #sameScope(input: Scope): void { if (input.tenantId !== this.scope.tenantId || input.userId !== this.scope.userId || input.deviceId !== this.scope.deviceId) throw new Error('SSH device transport request is out of scope') }
}

function validateServerPayload(payload: DeviceProtocolPayloadV1): void {
  const item = payload.kind === 'server.challenge' ? payload.challenge : payload.kind === 'server.session' ? payload.session : payload.kind === 'server.lease' ? payload.lease : payload.kind === 'server.ack' ? payload.acknowledgement : payload.kind === 'server.result' ? payload.result : undefined
  if (payload.kind === 'server.lease' && item === null) return
  if (!item || typeof item !== 'object') throw new Error('SSH device transport response payload is invalid')
  const value = item as unknown as Record<string, unknown>
  if (payload.kind === 'server.challenge' && (value.schemaVersion !== 1 || !ids(value, ['challengeId', 'tenantId', 'userId', 'deviceId', 'nonce']) || !times(value, ['issuedAt', 'expiresAt']))) throw new Error('SSH device transport challenge is invalid')
  if (payload.kind === 'server.session' && (value.schemaVersion !== 1 || !ids(value, ['sessionId', 'tenantId', 'userId', 'deviceId']) || !times(value, ['issuedAt', 'expiresAt']) || !['active', 'superseded', 'expired', 'revoked'].includes(String(value.state)))) throw new Error('SSH device transport session is invalid')
  if (payload.kind === 'server.lease' && (value.schemaVersion !== 1 || !ids(value, ['taskId', 'planId', 'deviceId', 'leaseToken']) || !Number.isSafeInteger(value.attempt) || Number(value.attempt) < 1 || value.externalWritesEnabled !== false || !times(value, ['leasedAt', 'expiresAt']) || !value.plan || typeof value.plan !== 'object')) throw new Error('SSH device transport lease is invalid')
  if (payload.kind === 'server.ack' && (value.schemaVersion !== 1 || !ids(value, ['taskId', 'planId', 'deviceId']) || value.state !== 'accepted' || !times(value, ['acceptedAt']))) throw new Error('SSH device transport acknowledgement is invalid')
  if (payload.kind === 'server.result' && (!ids(value, ['tenantId', 'userId', 'deviceId', 'taskId', 'planId', 'summaryCode']) || !['succeeded', 'failed', 'cancelled'].includes(String(value.outcome)) || !times(value, ['completedAt']) || !Array.isArray(value.artifactDigests))) throw new Error('SSH device transport result is invalid')
}

function ids(value: Record<string, unknown>, keys: readonly string[]): boolean { return keys.every(key => typeof value[key] === 'string' && idPattern.test(String(value[key]))) }
function times(value: Record<string, unknown>, keys: readonly string[]): boolean { return keys.every(key => typeof value[key] === 'string' && !Number.isNaN(Date.parse(String(value[key])))) }

export class NodeSshSubsystemUnaryRunnerV1 implements SshSubsystemUnaryRunnerV1 {
  run(launch: InactiveSshSubsystemLaunchV1, request: Buffer, timeoutMs: number): Promise<Buffer> { return new Promise((resolve, reject) => {
    let output = Buffer.alloc(0); let settled = false
    const child = spawn(launch.command, launch.args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } })
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(output) }
    child.stdout.on('data', (chunk: Buffer) => { if (output.byteLength + chunk.byteLength > MAX_DEVICE_FRAME_BYTES + 4) { child.kill('SIGTERM'); finish(new Error('SSH device transport response is too large')) } else output = Buffer.concat([output, chunk]) })
    child.stderr.on('data', () => undefined)
    child.once('error', () => finish(new Error('SSH device transport process failed')))
    child.once('close', code => finish(code === 0 ? undefined : new Error('SSH device transport process failed')))
    child.stdin.once('error', () => finish(new Error('SSH device transport process failed')))
    child.stdin.end(request)
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('SSH device transport process timed out')) }, timeoutMs); timer.unref()
  }) }
}
