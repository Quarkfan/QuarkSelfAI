import type { DeviceRecordV1, DispatchRecordV1 } from '../control-plane/contracts.js'
import type { DeviceProofVerifierV1, DeviceSessionChallengeV1, DeviceSessionProofV1, DeviceSessionV1, DeviceTaskLeaseV1 } from './contracts.js'

type ClockTokenSource = { next(label: 'challenge' | 'nonce' | 'session' | 'lease'): string }
type StoredSession = { value: DeviceSessionV1 }
type StoredTask = { dispatch: DispatchRecordV1; lease?: DeviceTaskLeaseV1; attempts: number }

/** In-memory protocol reference: no listener, socket, persistence, executor launch, consumer mount or effect path. */
export class InactiveDeviceSyncCoordinatorV1 {
  readonly #devices = new Map<string, DeviceRecordV1>()
  readonly #challenges = new Map<string, DeviceSessionChallengeV1>()
  readonly #sessions = new Map<string, StoredSession>()
  readonly #activeSessionByDevice = new Map<string, string>()
  readonly #tasks = new Map<string, StoredTask>()
  readonly #taskByIdempotencyKey = new Map<string, string>()
  readonly #issuedTokens = new Set<string>()

  constructor(private readonly tokens: ClockTokenSource) {}

  registerDevice(device: DeviceRecordV1): void {
    if (!device.tenantId.startsWith('test.') || device.state !== 'registered') throw new Error('inactive device sync accepts registered test devices only')
    const key = scope(device.tenantId, device.userId, device.deviceId)
    const existing = this.#devices.get(key)
    if (existing && existing.publicKey !== device.publicKey) throw new Error('registered device public key cannot drift')
    this.#devices.set(key, Object.freeze({ ...device }))
  }

  issueChallenge(input: { tenantId: string; userId: string; deviceId: string }, now: Date, ttlMs = 60_000): DeviceSessionChallengeV1 {
    const device = this.#device(input.tenantId, input.userId, input.deviceId)
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('challenge ttl must be a positive integer')
    const challenge = Object.freeze({
      schemaVersion: 1 as const,
      challengeId: this.#token('challenge'),
      tenantId: device.tenantId,
      userId: device.userId,
      deviceId: device.deviceId,
      nonce: this.#token('nonce'),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    })
    this.#challenges.set(challenge.challengeId, challenge)
    return challenge
  }

  async openSession(proof: DeviceSessionProofV1, verifier: DeviceProofVerifierV1, now: Date, ttlMs = 300_000): Promise<DeviceSessionV1> {
    if (proof.schemaVersion !== 1) throw new Error('device proof schema is unsupported')
    const challenge = this.#challenges.get(proof.challengeId)
    if (!challenge || challenge.deviceId !== proof.deviceId) throw new Error('device challenge is unavailable or out of scope')
    if (Date.parse(challenge.expiresAt) <= now.getTime()) throw new Error('device challenge expired')
    if (proof.algorithm !== 'ed25519' || !proof.keyId || !proof.signature) throw new Error('device proof is invalid')
    const device = this.#device(challenge.tenantId, challenge.userId, challenge.deviceId)
    const verified = await verifier.verify({ publicKey: device.publicKey, algorithm: proof.algorithm, challenge: challenge.nonce, signature: proof.signature })
    if (!verified) throw new Error('device proof verification failed')
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('session ttl must be a positive integer')
    this.#challenges.delete(challenge.challengeId)
    const deviceScope = scope(device.tenantId, device.userId, device.deviceId)
    const previousId = this.#activeSessionByDevice.get(deviceScope)
    if (previousId) {
      const previous = this.#sessions.get(previousId)
      if (previous) previous.value = Object.freeze({ ...previous.value, state: 'superseded' })
    }
    const session = Object.freeze({
      schemaVersion: 1 as const,
      sessionId: this.#token('session'),
      tenantId: device.tenantId,
      userId: device.userId,
      deviceId: device.deviceId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      state: 'active' as const,
    })
    this.#sessions.set(session.sessionId, { value: session })
    this.#activeSessionByDevice.set(deviceScope, session.sessionId)
    return session
  }

  enqueue(dispatch: DispatchRecordV1): void {
    if (!dispatch.tenantId.startsWith('test.') || dispatch.state !== 'queued') throw new Error('inactive device sync accepts queued test dispatches only')
    if (dispatch.plan.envelope.allowedEffects.length || dispatch.plan.envelope.approvalGrants.length) throw new Error('inactive device sync rejects effectful plans')
    if (dispatch.plan.envelope.tenantId !== dispatch.tenantId || dispatch.plan.envelope.userId !== dispatch.userId || dispatch.plan.envelope.deviceId !== dispatch.deviceId) throw new Error('dispatch plan scope mismatch')
    const existing = this.#tasks.get(taskScope(dispatch.tenantId, dispatch.taskId))
    if (existing && existing.dispatch.idempotencyKey !== dispatch.idempotencyKey) throw new Error('task id already exists with another idempotency key')
    const idempotencyScope = `${dispatch.tenantId}\0${dispatch.idempotencyKey}`
    const existingTaskScope = this.#taskByIdempotencyKey.get(idempotencyScope)
    const currentTaskScope = taskScope(dispatch.tenantId, dispatch.taskId)
    if (existingTaskScope && existingTaskScope !== currentTaskScope) throw new Error('idempotency key is already assigned to another task')
    if (!existing) {
      this.#tasks.set(currentTaskScope, { dispatch: Object.freeze({ ...dispatch }), attempts: 0 })
      this.#taskByIdempotencyKey.set(idempotencyScope, currentTaskScope)
    }
  }

  poll(sessionId: string, now: Date, leaseTtlMs = 60_000): DeviceTaskLeaseV1 | null {
    const session = this.#activeSession(sessionId, now)
    if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs <= 0) throw new Error('lease ttl must be a positive integer')
    const eligible = [...this.#tasks.values()].filter(task => task.dispatch.tenantId === session.tenantId && task.dispatch.userId === session.userId && task.dispatch.deviceId === session.deviceId)
    for (const task of eligible) {
      if (task.lease && Date.parse(task.lease.expiresAt) > now.getTime()) return task.lease
      if (Date.parse(task.dispatch.plan.expiresAt) <= now.getTime()) throw new Error('signed execution plan expired before lease')
      task.attempts += 1
      task.lease = Object.freeze({
        schemaVersion: 1,
        taskId: task.dispatch.taskId,
        planId: task.dispatch.plan.planId,
        plan: task.dispatch.plan,
        deviceId: session.deviceId,
        leaseToken: this.#token('lease'),
        attempt: task.attempts,
        leasedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + leaseTtlMs).toISOString(),
        externalWritesEnabled: false,
      })
      return task.lease
    }
    return null
  }

  acknowledge(sessionId: string, leaseToken: string, taskId: string, now: Date): DispatchRecordV1 {
    const session = this.#activeSession(sessionId, now)
    const task = this.#tasks.get(taskScope(session.tenantId, taskId))
    if (!task || task.dispatch.userId !== session.userId || task.dispatch.deviceId !== session.deviceId || task.lease?.leaseToken !== leaseToken) throw new Error('task lease is unavailable or out of scope')
    if (Date.parse(task.lease.expiresAt) <= now.getTime()) throw new Error('task lease expired')
    task.dispatch = Object.freeze({ ...task.dispatch, state: 'leased' })
    return task.dispatch
  }

  session(sessionId: string): DeviceSessionV1 | undefined {
    return this.#sessions.get(sessionId)?.value
  }

  #activeSession(sessionId: string, now: Date): DeviceSessionV1 {
    const stored = this.#sessions.get(sessionId)
    if (!stored || stored.value.state !== 'active') throw new Error('device session is not active')
    if (Date.parse(stored.value.expiresAt) <= now.getTime()) {
      stored.value = Object.freeze({ ...stored.value, state: 'expired' })
      throw new Error('device session expired')
    }
    if (this.#activeSessionByDevice.get(scope(stored.value.tenantId, stored.value.userId, stored.value.deviceId)) !== sessionId) throw new Error('device session lost single-owner lease')
    return stored.value
  }

  #device(tenantId: string, userId: string, deviceId: string): DeviceRecordV1 {
    const device = this.#devices.get(scope(tenantId, userId, deviceId))
    if (!device) throw new Error('registered device is unavailable')
    return device
  }

  #token(label: 'challenge' | 'nonce' | 'session' | 'lease'): string {
    const value = this.tokens.next(label)
    if (!/^[a-z0-9][a-z0-9._:-]{0,255}$/.test(value) || this.#issuedTokens.has(value)) throw new Error(`${label} token is invalid or reused`)
    this.#issuedTokens.add(value)
    return value
  }
}

function scope(tenantId: string, userId: string, deviceId: string): string {
  return `${tenantId}\0${userId}\0${deviceId}`
}

function taskScope(tenantId: string, taskId: string): string {
  return `${tenantId}\0${taskId}`
}
