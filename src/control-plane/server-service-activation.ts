import { randomBytes } from 'node:crypto'
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { probeInstalledCloudServerHealthV1, type InstalledCloudServerHealthReceiptV1 } from './server-health.js'
import { recoverPreparedServerUserService } from './server-service.js'

const digestPattern = /^sha256:[a-f0-9]{64}$/

export interface ServerUserServiceManagerV1 {
  readonly platform: 'launchd-user'
  installDefinition(sourcePath: string, targetPath: string, expectedDigest: string): Promise<void>
  register(targetPath: string): Promise<void>
  start(): Promise<void>
  inspect(): Promise<{ readonly registered: boolean; readonly running: boolean }>
  stopAndUnregister(): Promise<void>
  removeDefinition(targetPath: string, expectedDigest: string): Promise<void>
}

export interface InstalledServerServiceActivationInputV1 {
  readonly installRoot: string
  readonly definitionTargetPath: string
}

export interface InstalledServerServiceActivationReceiptV1 {
  readonly schemaVersion: 1
  readonly transactionId: string
  readonly installationId: string
  readonly configurationDigest: string
  readonly platform: 'launchd-user'
  readonly definitionTargetPath: string
  readonly definitionDigest: string
  readonly activatedAt: string
  readonly state: 'service-active-effects-off'
  readonly registered: true
  readonly started: true
  readonly autoStart: true
  readonly health: 'ready-effects-off'
  readonly singleProvider: true
  readonly externalEffectsEnabled: false
}

interface ActivationIntentV1 {
  readonly schemaVersion: 1
  readonly transactionId: string
  readonly installationId: string
  readonly configurationDigest: string
  readonly platform: 'launchd-user'
  readonly definitionTargetPath: string
  readonly definitionDigest: string
  readonly createdAt: string
  readonly state: 'activating'
  readonly externalEffectsEnabled: false
}

type HealthProbe = (installRoot: string, now?: Date) => Promise<InstalledCloudServerHealthReceiptV1>

/** Registers one already-prepared service, starts it, and commits only after the pinned TLS probe succeeds. */
export async function activateInstalledServerUserServiceV1(input: InstalledServerServiceActivationInputV1, manager: ServerUserServiceManagerV1, now = new Date(), probe: HealthProbe = probeInstalledCloudServerHealthV1): Promise<InstalledServerServiceActivationReceiptV1> {
  const values = await exactInput(input, manager); if (Number.isNaN(now.getTime())) throw new Error('server service activation timestamp is invalid')
  const prepared = await recoverPreparedServerUserService(values.installRoot)
  if (prepared.platform !== manager.platform) throw new Error('server service activation platform drifted')
  const serviceRoot = join(values.installRoot, 'service'); const intentPath = join(serviceRoot, 'activation-intent.json'); const receiptPath = join(serviceRoot, 'activation-receipt.json')
  await absent(intentPath, 'server service activation is already in progress'); await absent(receiptPath, 'server service is already active')
  const intent: ActivationIntentV1 = Object.freeze({ schemaVersion: 1, transactionId: `service-activation.${randomBytes(16).toString('hex')}`, installationId: prepared.installationId, configurationDigest: prepared.configurationDigest, platform: manager.platform, definitionTargetPath: values.definitionTargetPath, definitionDigest: prepared.definitionDigest, createdAt: now.toISOString(), state: 'activating', externalEffectsEnabled: false })
  await writePrivate(intentPath, Buffer.from(`${JSON.stringify(intent)}\n`))
  try {
    await manager.installDefinition(join(serviceRoot, prepared.definitionFile), values.definitionTargetPath, prepared.definitionDigest)
    await manager.register(values.definitionTargetPath); await manager.start()
    const status = await manager.inspect(); if (!status.registered || !status.running) throw new Error('server service manager did not confirm one running service')
    const health = await probe(values.installRoot, now); if (health.installationId !== prepared.installationId || health.configurationDigest !== prepared.configurationDigest || health.externalEffectsEnabled !== false) throw new Error('server service activation health lineage drifted')
    const receipt = committed(intent, now); await replacePrivate(intentPath, receiptPath, Buffer.from(`${JSON.stringify(receipt)}\n`)); return receipt
  } catch (error) {
    const rollback: unknown[] = []; let stopped = false
    try { await manager.stopAndUnregister(); stopped = true } catch (failure) { rollback.push(failure) }
    if (stopped) { try { await manager.removeDefinition(values.definitionTargetPath, prepared.definitionDigest) } catch (failure) { rollback.push(failure) } }
    if (!rollback.length) { try { await unlink(intentPath) } catch {} }
    if (rollback.length) throw new AggregateError([error, ...rollback], 'server service activation failed and rollback is incomplete')
    throw error
  }
}

/** Completes a crash-interrupted activation only when service state and pinned health both agree; otherwise rolls it back. */
export async function reconcileInstalledServerUserServiceActivationV1(input: InstalledServerServiceActivationInputV1, manager: ServerUserServiceManagerV1, now = new Date(), probe: HealthProbe = probeInstalledCloudServerHealthV1): Promise<InstalledServerServiceActivationReceiptV1 | null> {
  const values = await exactInput(input, manager); const serviceRoot = join(values.installRoot, 'service'); const intentPath = join(serviceRoot, 'activation-intent.json'); const receiptPath = join(serviceRoot, 'activation-receipt.json')
  try { return await recoverInstalledServerUserServiceActivationV1(values.installRoot, manager) } catch (error) { if (!(error instanceof Error) || error.message !== 'server service activation receipt is missing') throw error }
  const intent = exactIntent(JSON.parse((await readPrivate(intentPath, 64 * 1024)).toString('utf8'))); const prepared = await recoverPreparedServerUserService(values.installRoot)
  if (intent.installationId !== prepared.installationId || intent.configurationDigest !== prepared.configurationDigest || intent.definitionDigest !== prepared.definitionDigest || intent.definitionTargetPath !== values.definitionTargetPath || intent.platform !== manager.platform) throw new Error('server service activation intent lineage drifted')
  const status = await manager.inspect()
  if (status.registered && status.running) {
    try { const health = await probe(values.installRoot, now); if (health.installationId !== intent.installationId || health.configurationDigest !== intent.configurationDigest || health.externalEffectsEnabled !== false) throw new Error('server service activation health lineage drifted'); const receipt = committed(intent, now); await replacePrivate(intentPath, receiptPath, Buffer.from(`${JSON.stringify(receipt)}\n`)); return receipt } catch {}
  }
  await manager.stopAndUnregister(); await manager.removeDefinition(values.definitionTargetPath, prepared.definitionDigest); await unlink(intentPath); return null
}

export async function recoverInstalledServerUserServiceActivationV1(installRoot: string, manager: ServerUserServiceManagerV1): Promise<InstalledServerServiceActivationReceiptV1> {
  const receipt = await loadActivationReceipt(installRoot, manager, 'activation-receipt.json')
  const status = await manager.inspect(); if (!status.registered || !status.running) throw new Error('server service activation is not running')
  return receipt
}

/** Stops and unregisters the exact service before removing only its verified manager definition. Durable tenant state is preserved. */
export async function deactivateInstalledServerUserServiceV1(installRoot: string, manager: ServerUserServiceManagerV1): Promise<InstalledServerServiceActivationReceiptV1> {
  const receiptPath = join(installRoot, 'service/activation-receipt.json'); const intentPath = join(installRoot, 'service/deactivation-intent.json'); let receipt: InstalledServerServiceActivationReceiptV1
  try { receipt = await loadActivationReceipt(installRoot, manager, 'deactivation-intent.json') }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'server service activation receipt is missing') throw error
    receipt = await loadActivationReceipt(installRoot, manager, 'activation-receipt.json'); await absent(intentPath, 'server service deactivation is already in progress'); await rename(receiptPath, intentPath)
  }
  await manager.stopAndUnregister(); await manager.removeDefinition(receipt.definitionTargetPath, receipt.definitionDigest); await unlink(intentPath); return receipt
}

async function exactInput(value: InstalledServerServiceActivationInputV1, manager: ServerUserServiceManagerV1): Promise<InstalledServerServiceActivationInputV1> { if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'definitionTargetPath,installRoot' || manager?.platform !== 'launchd-user') throw new Error('server service activation input is invalid'); if (!isAbsolute(value.installRoot) || resolve(value.installRoot) !== value.installRoot || value.installRoot === '/' || await realpath(value.installRoot) !== value.installRoot) throw new Error('server service activation installation is invalid'); exactTarget(value.definitionTargetPath, 'com.quarkfan.quark-server.plist'); return value }
function exactTarget(path: string, name: string): void { if (!isAbsolute(path) || resolve(path) !== path || basename(path) !== name || /[\0\r\n]/.test(path)) throw new Error('server service definition target is invalid') }
function committed(intent: ActivationIntentV1, now: Date): InstalledServerServiceActivationReceiptV1 { return Object.freeze({ schemaVersion: 1, transactionId: intent.transactionId, installationId: intent.installationId, configurationDigest: intent.configurationDigest, platform: intent.platform, definitionTargetPath: intent.definitionTargetPath, definitionDigest: intent.definitionDigest, activatedAt: now.toISOString(), state: 'service-active-effects-off', registered: true, started: true, autoStart: true, health: 'ready-effects-off', singleProvider: true, externalEffectsEnabled: false }) }
async function loadActivationReceipt(installRoot: string, manager: ServerUserServiceManagerV1, name: 'activation-receipt.json' | 'deactivation-intent.json'): Promise<InstalledServerServiceActivationReceiptV1> { const prepared = await recoverPreparedServerUserService(installRoot); let bytes: Buffer; try { bytes = await readPrivate(join(installRoot, 'service', name), 64 * 1024) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('server service activation receipt is missing'); throw error }; const receipt = exactReceipt(JSON.parse(bytes.toString('utf8'))); if (receipt.installationId !== prepared.installationId || receipt.configurationDigest !== prepared.configurationDigest || receipt.definitionDigest !== prepared.definitionDigest || receipt.platform !== manager.platform) throw new Error('server service activation receipt lineage drifted'); return receipt }
function exactIntent(value: unknown): ActivationIntentV1 { if (!record(value) || Object.keys(value).sort().join(',') !== ['schemaVersion','transactionId','installationId','configurationDigest','platform','definitionTargetPath','definitionDigest','createdAt','state','externalEffectsEnabled'].sort().join(',') || value.schemaVersion !== 1 || typeof value.transactionId !== 'string' || !/^service-activation\.[a-f0-9]{32}$/.test(value.transactionId) || typeof value.installationId !== 'string' || typeof value.configurationDigest !== 'string' || typeof value.definitionDigest !== 'string' || !digestPattern.test(value.configurationDigest) || !digestPattern.test(value.definitionDigest) || value.platform !== 'launchd-user' || typeof value.definitionTargetPath !== 'string' || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) || value.state !== 'activating' || value.externalEffectsEnabled !== false) throw new Error('server service activation intent is invalid'); exactTarget(value.definitionTargetPath, 'com.quarkfan.quark-server.plist'); return Object.freeze(value as unknown as ActivationIntentV1) }
function exactReceipt(value: unknown): InstalledServerServiceActivationReceiptV1 { if (!record(value) || Object.keys(value).sort().join(',') !== ['schemaVersion','transactionId','installationId','configurationDigest','platform','definitionTargetPath','definitionDigest','activatedAt','state','registered','started','autoStart','health','singleProvider','externalEffectsEnabled'].sort().join(',') || value.schemaVersion !== 1 || typeof value.transactionId !== 'string' || !/^service-activation\.[a-f0-9]{32}$/.test(value.transactionId) || typeof value.installationId !== 'string' || typeof value.configurationDigest !== 'string' || typeof value.definitionDigest !== 'string' || !digestPattern.test(value.configurationDigest) || !digestPattern.test(value.definitionDigest) || value.platform !== 'launchd-user' || typeof value.definitionTargetPath !== 'string' || typeof value.activatedAt !== 'string' || Number.isNaN(Date.parse(value.activatedAt)) || value.state !== 'service-active-effects-off' || value.registered !== true || value.started !== true || value.autoStart !== true || value.health !== 'ready-effects-off' || value.singleProvider !== true || value.externalEffectsEnabled !== false) throw new Error('server service activation receipt is invalid'); exactTarget(value.definitionTargetPath, 'com.quarkfan.quark-server.plist'); return Object.freeze(value as unknown as InstalledServerServiceActivationReceiptV1) }
async function absent(path: string, message: string): Promise<void> { try { await lstat(path); throw new Error(message) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
async function readPrivate(path: string, max: number): Promise<Buffer> { const state = await lstat(path); const uid = process.getuid?.(); if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || (state.mode & 0o077) !== 0 || state.size < 1 || state.size > max || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('server service activation file is unsafe'); return await readFile(path) }
async function writePrivate(path: string, bytes: Uint8Array): Promise<void> { const handle = await open(path, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() } }
async function replacePrivate(source: string, target: string, bytes: Uint8Array): Promise<void> { const temporary = `${target}.tmp`; await absent(target, 'server service activation receipt already exists'); await absent(temporary, 'server service activation receipt temporary file exists'); await writePrivate(temporary, bytes); try { await rename(temporary, target); await unlink(source) } catch (error) { try { await unlink(temporary) } catch {}; throw error } }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
