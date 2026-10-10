import { randomBytes } from 'node:crypto'
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { recoverInstalledClientProcessHealthV1, removeInstalledClientProcessHealthV1, type InstalledClientProcessHealthReceiptV1 } from './client-process-health.js'
import { recoverPreparedClientUserServiceV1 } from './client-installed-service.js'
import { assertInstalledClientEnrollmentApprovedV1 } from './client-enrollment-administration.js'

const digestPattern = /^sha256:[a-f0-9]{64}$/

export interface ClientUserServiceManagerV1 {
  readonly platform: 'launchd-user'
  installDefinition(sourcePath: string, targetPath: string, expectedDigest: string): Promise<void>
  register(targetPath: string): Promise<void>
  start(): Promise<void>
  inspect(): Promise<{ readonly registered: boolean; readonly running: boolean; readonly pid: number | null }>
  stopAndUnregister(): Promise<void>
  removeDefinition(targetPath: string, expectedDigest: string): Promise<void>
}

export interface InstalledClientServiceActivationInputV1 { readonly installRoot: string; readonly definitionTargetPath: string }
export interface InstalledClientServiceActivationReceiptV1 {
  readonly schemaVersion: 1; readonly transactionId: string; readonly installationId: string; readonly configDigest: string
  readonly platform: 'launchd-user'; readonly definitionTargetPath: string; readonly definitionDigest: string; readonly processPid: number
  readonly activatedAt: string; readonly state: 'service-active-effects-off'; readonly registered: true; readonly started: true; readonly autoStart: true
  readonly health: 'ready-effects-off'; readonly singleClientOwner: true; readonly externalWritesEnabled: false
}
interface ActivationIntentV1 { readonly schemaVersion: 1; readonly transactionId: string; readonly installationId: string; readonly configDigest: string; readonly platform: 'launchd-user'; readonly definitionTargetPath: string; readonly definitionDigest: string; readonly createdAt: string; readonly state: 'activating'; readonly externalWritesEnabled: false }
type HealthProbe = (installRoot: string) => Promise<InstalledClientProcessHealthReceiptV1>
type EnrollmentProbe = (installRoot: string) => Promise<unknown>

/** Registers and starts one prepared client, committing only after manager PID and bounded health agree. */
export async function activateInstalledClientUserServiceV1(input: InstalledClientServiceActivationInputV1, manager: ClientUserServiceManagerV1, now = new Date(), probe: HealthProbe = recoverInstalledClientProcessHealthV1, enrollmentProbe: EnrollmentProbe = assertInstalledClientEnrollmentApprovedV1): Promise<InstalledClientServiceActivationReceiptV1> {
  const values = await exactInput(input, manager); if (Number.isNaN(now.getTime())) throw new Error('client service activation timestamp is invalid')
  const prepared = await recoverPreparedClientUserServiceV1(values.installRoot); if (prepared.platform !== manager.platform) throw new Error('client service activation platform drifted')
  await enrollmentProbe(values.installRoot)
  const serviceRoot = join(values.installRoot, 'service'); const intentPath = join(serviceRoot, 'activation-intent.json'); const receiptPath = join(serviceRoot, 'activation-receipt.json')
  await absent(intentPath, 'client service activation is already in progress'); await absent(receiptPath, 'client service is already active')
  const intent: ActivationIntentV1 = Object.freeze({ schemaVersion: 1, transactionId: `client-service-activation.${randomBytes(16).toString('hex')}`, installationId: prepared.installationId, configDigest: prepared.configDigest, platform: manager.platform, definitionTargetPath: values.definitionTargetPath, definitionDigest: prepared.definitionDigest, createdAt: now.toISOString(), state: 'activating', externalWritesEnabled: false })
  await writePrivate(intentPath, Buffer.from(`${JSON.stringify(intent)}\n`))
  try {
    await manager.installDefinition(join(serviceRoot, prepared.definitionFile), values.definitionTargetPath, prepared.definitionDigest); await manager.register(values.definitionTargetPath); await manager.start()
    const status = await waitForReady(values.installRoot, manager, intent, probe)
    const receipt = committed(intent, status.pid, now); await replacePrivate(intentPath, receiptPath, Buffer.from(`${JSON.stringify(receipt)}\n`)); return receipt
  } catch (error) {
    const rollback: unknown[] = []; let stopped = false
    try { await manager.stopAndUnregister(); stopped = true } catch (failure) { rollback.push(failure) }
    if (stopped) { try { await removeHealthIfPresent(values.installRoot) } catch (failure) { rollback.push(failure) }; try { await manager.removeDefinition(values.definitionTargetPath, prepared.definitionDigest) } catch (failure) { rollback.push(failure) } }
    if (!rollback.length) { try { await unlink(intentPath) } catch {} }
    if (rollback.length) throw new AggregateError([error, ...rollback], 'client service activation failed and rollback is incomplete')
    throw error
  }
}

export async function recoverInstalledClientUserServiceActivationV1(installRoot: string, manager: ClientUserServiceManagerV1): Promise<InstalledClientServiceActivationReceiptV1> {
  const receipt = await loadReceipt(installRoot, manager, 'activation-receipt.json'); const status = await manager.inspect(); if (!status.registered || !status.running || status.pid !== receipt.processPid) throw new Error('client service activation is not running'); assertHealth(await recoverInstalledClientProcessHealthV1(installRoot), receipt, receipt.processPid); return receipt
}

/** Reconciles a crash-interrupted transaction to one active receipt or a fully removed service. */
export async function reconcileInstalledClientUserServiceActivationV1(input: InstalledClientServiceActivationInputV1, manager: ClientUserServiceManagerV1, now = new Date(), probe: HealthProbe = recoverInstalledClientProcessHealthV1): Promise<InstalledClientServiceActivationReceiptV1 | null> {
  const values = await exactInput(input, manager); try { return await recoverInstalledClientUserServiceActivationV1(values.installRoot, manager) } catch (error) { if (!(error instanceof Error) || error.message !== 'client service activation receipt is missing') throw error }
  const intentPath = join(values.installRoot, 'service/activation-intent.json'); const receiptPath = join(values.installRoot, 'service/activation-receipt.json'); const intent = exactIntent(JSON.parse((await readPrivate(intentPath)).toString('utf8'))); const prepared = await recoverPreparedClientUserServiceV1(values.installRoot)
  if (intent.installationId !== prepared.installationId || intent.configDigest !== prepared.configDigest || intent.definitionDigest !== prepared.definitionDigest || intent.definitionTargetPath !== values.definitionTargetPath) throw new Error('client service activation intent lineage drifted')
  const status = await manager.inspect(); if (status.registered && status.running && status.pid !== null) { try { assertHealth(await probe(values.installRoot), intent, status.pid); const receipt = committed(intent, status.pid, now); await replacePrivate(intentPath, receiptPath, Buffer.from(`${JSON.stringify(receipt)}\n`)); return receipt } catch {} }
  await manager.stopAndUnregister(); await removeHealthIfPresent(values.installRoot); await manager.removeDefinition(values.definitionTargetPath, prepared.definitionDigest); await unlink(intentPath); return null
}

/** Stops the exact owner before removing health and the verified service-manager definition. */
export async function deactivateInstalledClientUserServiceV1(installRoot: string, manager: ClientUserServiceManagerV1): Promise<InstalledClientServiceActivationReceiptV1> {
  const receiptPath = join(installRoot, 'service/activation-receipt.json'); const intentPath = join(installRoot, 'service/deactivation-intent.json'); let receipt: InstalledClientServiceActivationReceiptV1
  try { receipt = await loadReceipt(installRoot, manager, 'deactivation-intent.json') } catch (error) { if (!(error instanceof Error) || error.message !== 'client service activation receipt is missing') throw error; receipt = await loadReceipt(installRoot, manager, 'activation-receipt.json'); await absent(intentPath, 'client service deactivation is already in progress'); await rename(receiptPath, intentPath) }
  await manager.stopAndUnregister(); await removeHealthIfPresent(installRoot); await manager.removeDefinition(receipt.definitionTargetPath, receipt.definitionDigest); await unlink(intentPath); return receipt
}

async function exactInput(value: InstalledClientServiceActivationInputV1, manager: ClientUserServiceManagerV1): Promise<InstalledClientServiceActivationInputV1> { if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'definitionTargetPath,installRoot' || manager?.platform !== 'launchd-user') throw new Error('client service activation input is invalid'); if (!isAbsolute(value.installRoot) || resolve(value.installRoot) !== value.installRoot || value.installRoot === '/' || await realpath(value.installRoot) !== value.installRoot) throw new Error('client service activation installation is invalid'); exactTarget(value.definitionTargetPath); return value }
function exactTarget(path: string): void { if (!isAbsolute(path) || resolve(path) !== path || basename(path) !== 'com.quarkfan.quark-client.plist' || /[\0\r\n]/.test(path)) throw new Error('client service definition target is invalid') }
function assertHealth(health: InstalledClientProcessHealthReceiptV1, lineage: { installationId: string; externalWritesEnabled: false }, pid: number): void { if (health.installationId !== lineage.installationId || health.pid !== pid || health.state !== 'ready-effects-off' || health.singleClientOwner !== true || health.externalWritesEnabled !== false) throw new Error('client service activation health lineage drifted') }
function committed(intent: ActivationIntentV1, processPid: number, now: Date): InstalledClientServiceActivationReceiptV1 { return Object.freeze({ schemaVersion: 1, transactionId: intent.transactionId, installationId: intent.installationId, configDigest: intent.configDigest, platform: intent.platform, definitionTargetPath: intent.definitionTargetPath, definitionDigest: intent.definitionDigest, processPid, activatedAt: now.toISOString(), state: 'service-active-effects-off', registered: true, started: true, autoStart: true, health: 'ready-effects-off', singleClientOwner: true, externalWritesEnabled: false }) }
async function loadReceipt(installRoot: string, manager: ClientUserServiceManagerV1, name: 'activation-receipt.json' | 'deactivation-intent.json'): Promise<InstalledClientServiceActivationReceiptV1> { const prepared = await recoverPreparedClientUserServiceV1(installRoot); let bytes: Buffer; try { bytes = await readPrivate(join(installRoot, 'service', name)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('client service activation receipt is missing'); throw error }; const receipt = exactReceipt(JSON.parse(bytes.toString('utf8'))); if (receipt.installationId !== prepared.installationId || receipt.configDigest !== prepared.configDigest || receipt.definitionDigest !== prepared.definitionDigest || receipt.platform !== manager.platform) throw new Error('client service activation receipt lineage drifted'); return receipt }
function exactIntent(value: unknown): ActivationIntentV1 { if (!record(value) || Object.keys(value).sort().join(',') !== ['schemaVersion','transactionId','installationId','configDigest','platform','definitionTargetPath','definitionDigest','createdAt','state','externalWritesEnabled'].sort().join(',') || value.schemaVersion !== 1 || typeof value.transactionId !== 'string' || !/^client-service-activation\.[a-f0-9]{32}$/.test(value.transactionId) || typeof value.installationId !== 'string' || typeof value.configDigest !== 'string' || typeof value.definitionDigest !== 'string' || !digestPattern.test(value.configDigest) || !digestPattern.test(value.definitionDigest) || value.platform !== 'launchd-user' || typeof value.definitionTargetPath !== 'string' || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) || value.state !== 'activating' || value.externalWritesEnabled !== false) throw new Error('client service activation intent is invalid'); exactTarget(value.definitionTargetPath); return Object.freeze(value as unknown as ActivationIntentV1) }
function exactReceipt(value: unknown): InstalledClientServiceActivationReceiptV1 { if (!record(value) || Object.keys(value).sort().join(',') !== ['schemaVersion','transactionId','installationId','configDigest','platform','definitionTargetPath','definitionDigest','processPid','activatedAt','state','registered','started','autoStart','health','singleClientOwner','externalWritesEnabled'].sort().join(',') || value.schemaVersion !== 1 || typeof value.transactionId !== 'string' || !/^client-service-activation\.[a-f0-9]{32}$/.test(value.transactionId) || typeof value.installationId !== 'string' || typeof value.configDigest !== 'string' || typeof value.definitionDigest !== 'string' || !digestPattern.test(value.configDigest) || !digestPattern.test(value.definitionDigest) || value.platform !== 'launchd-user' || typeof value.definitionTargetPath !== 'string' || !Number.isSafeInteger(value.processPid) || Number(value.processPid) < 1 || typeof value.activatedAt !== 'string' || Number.isNaN(Date.parse(value.activatedAt)) || value.state !== 'service-active-effects-off' || value.registered !== true || value.started !== true || value.autoStart !== true || value.health !== 'ready-effects-off' || value.singleClientOwner !== true || value.externalWritesEnabled !== false) throw new Error('client service activation receipt is invalid'); exactTarget(value.definitionTargetPath); return Object.freeze(value as unknown as InstalledClientServiceActivationReceiptV1) }
async function removeHealthIfPresent(root: string): Promise<void> { try { const health = await recoverInstalledClientProcessHealthV1(root); await removeInstalledClientProcessHealthV1(root, health.pid) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
async function waitForReady(root: string, manager: ClientUserServiceManagerV1, lineage: ActivationIntentV1, probe: HealthProbe): Promise<{ registered: true; running: true; pid: number }> { const deadline = Date.now() + 10_000; let failure: unknown = new Error('client service readiness was not observed'); while (Date.now() <= deadline) { try { const status = await manager.inspect(); if (status.registered && status.running && status.pid !== null) { assertHealth(await probe(root), lineage, status.pid); return { registered: true, running: true, pid: status.pid } } } catch (error) { failure = error }; await delay(50) }; throw new AggregateError([failure], 'client service did not become ready') }
async function absent(path: string, message: string): Promise<void> { try { await lstat(path); throw new Error(message) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
async function readPrivate(path: string): Promise<Buffer> { const state = await lstat(path); const uid = process.getuid?.(); if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || (state.mode & 0o077) !== 0 || state.size < 1 || state.size > 64 * 1024 || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('client service activation file is unsafe'); return await readFile(path) }
async function writePrivate(path: string, bytes: Uint8Array): Promise<void> { const handle = await open(path, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() } }
async function replacePrivate(source: string, target: string, bytes: Uint8Array): Promise<void> { const temporary = `${target}.tmp`; await absent(target, 'client service activation receipt already exists'); await absent(temporary, 'client service activation receipt temporary file exists'); await writePrivate(temporary, bytes); try { await rename(temporary, target); await unlink(source) } catch (error) { try { await unlink(temporary) } catch {}; throw error } }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
