import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { DeviceRecordV1, TenantContextV1, TenantDevicePortV1 } from '../src/control-plane/contracts.js'
import { openSqliteInactiveDeviceEnrollment, type DeviceEnrollmentRandomSourceV1 } from '../src/control-plane/device-enrollment.js'

const migration = new URL('../migrations/control-plane-sqlite/005_device_enrollment.sql', import.meta.url).pathname
const at = new Date('2026-09-06T00:00:00.000Z'); const later = new Date('2026-09-06T00:01:00.000Z')
const context: TenantContextV1 = { tenantId: 'tenant.alpha', userId: 'user.owner', roles: ['member'] }
const publicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`

class Random implements DeviceEnrollmentRandomSourceV1 { #next = 0; bytes(length: number): Uint8Array { this.#next += 1; return new Uint8Array(length).fill(this.#next) } }
class Devices implements TenantDevicePortV1 {
  readonly records: DeviceRecordV1[] = []; fail = false
  async registerDevice(owner: TenantContextV1, input: { deviceId: string; publicKey: string }, now = at): Promise<DeviceRecordV1> {
    if (this.fail) throw new Error('device registration unavailable')
    const existing = this.records.find(item => item.tenantId === owner.tenantId && item.deviceId === input.deviceId)
    if (existing) return existing
    const record = { tenantId: owner.tenantId, userId: owner.userId, deviceId: input.deviceId, publicKey: input.publicKey, state: 'registered' as const, createdAt: now.toISOString() }; this.records.push(record); return record
  }
  async listDevices(): Promise<readonly DeviceRecordV1[]> { return this.records }
}

test('persists one scoped device-code enrollment without storing or returning a browser session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-device-enrollment-')); const database = join(directory, 'control.sqlite3'); const devices = new Devices()
  try {
    let service = await openSqliteInactiveDeviceEnrollment(database, migration, devices, new Random())
    const request = await service.begin({ tenantId: context.tenantId, userId: context.userId, deviceId: 'device.owner', publicKey }, at)
    assert.match(request.requestId, /^enrollment\.[a-f0-9]{32}$/); assert.match(request.userCode, /^[A-F0-9-]{19}$/); assert.equal(request.pollToken.length, 43)
    assert.equal(JSON.stringify(request).includes('session:'), false)
    assert.equal((await service.poll({ requestId: request.requestId, pollToken: request.pollToken }, at)).state, 'pending')
    await assert.rejects(() => service.poll({ requestId: request.requestId, pollToken: Buffer.alloc(32, 8).toString('base64url') }, at), /credential is invalid/)
    await assert.rejects(() => service.approve({ tenantId: 'tenant.beta', userId: context.userId, roles: ['member'] }, request.userCode, at), /not authorized/)
    const approved = await service.approve(context, request.userCode, later); assert.equal(approved.state, 'approved'); assert.equal(devices.records.length, 1)
    assert.equal((await service.approve(context, request.userCode, later)).state, 'approved'); assert.equal(devices.records.length, 1)
    await service.close()
    assert.equal((await readFile(database)).includes(Buffer.from(request.pollToken)), false)
    service = await openSqliteInactiveDeviceEnrollment(database, migration, devices, new Random())
    assert.equal((await service.poll({ requestId: request.requestId, pollToken: request.pollToken }, later)).state, 'approved'); await service.close()
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('expires pending requests and restores a failed registration to retryable pending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quark-device-enrollment-')); const devices = new Devices(); const service = await openSqliteInactiveDeviceEnrollment(join(directory, 'control.sqlite3'), migration, devices, new Random())
  try {
    const request = await service.begin({ tenantId: context.tenantId, userId: context.userId, deviceId: 'device.retry', publicKey }, at)
    await assert.rejects(() => service.begin({ tenantId: context.tenantId, userId: context.userId, deviceId: 'device.retry', publicKey }, at), /already pending/)
    await assert.rejects(() => service.begin({ tenantId: context.tenantId, userId: context.userId, deviceId: 'device.invalid', publicKey: 'ed25519-spki:not-a-key' }, at), /public key is invalid/)
    devices.fail = true; await assert.rejects(() => service.approve(context, request.userCode, later), /registration unavailable/)
    assert.equal((await service.poll({ requestId: request.requestId, pollToken: request.pollToken }, later)).state, 'pending')
    devices.fail = false; assert.equal((await service.approve(context, request.userCode, later)).state, 'approved')
    const expiring = await service.begin({ tenantId: context.tenantId, userId: context.userId, deviceId: 'device.expired', publicKey }, at)
    assert.equal((await service.poll({ requestId: expiring.requestId, pollToken: expiring.pollToken }, new Date(at.getTime() + 10 * 60_000))).state, 'expired')
    await assert.rejects(() => service.approve(context, expiring.userCode, new Date(at.getTime() + 10 * 60_000)), /expired/)
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }) }
})
