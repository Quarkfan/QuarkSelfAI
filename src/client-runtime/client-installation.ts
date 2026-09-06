import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { compileInactiveClientBootstrap, type InactiveClientBootstrapDocumentV1, type InactiveClientBootstrapPlanV1 } from './configured-local-client.js'

const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const digestPattern = /^sha256:[a-f0-9]{64}$/

export interface InactiveClientInstallationInputV1 extends Omit<InactiveClientBootstrapDocumentV1, 'schemaVersion' | 'stateRoot'> {
  readonly installRoot: string
  readonly clientVersion: string
  readonly migrationSourcePath: string
}

export interface InactiveClientInstallationReceiptV1 {
  readonly schemaVersion: 1
  readonly installationId: string
  readonly clientVersion: string
  readonly configDigest: string
  readonly migrationDigest: string
  readonly installedAt: string
  readonly state: 'installed-inactive'
  readonly autoStart: false
  readonly externalWritesEnabled: false
}

export interface InactiveClientInstallationV1 { readonly plan: InactiveClientBootstrapPlanV1; readonly receipt: InactiveClientInstallationReceiptV1 }

/** Installs portable inactive client state only. It does not provision credentials or register/start a service. */
export async function installInactiveClient(input: InactiveClientInstallationInputV1, now = new Date()): Promise<InactiveClientInstallationV1> {
  const root = await validateNewRoot(input.installRoot)
  if (!versionPattern.test(input.clientVersion) || !isAbsolute(input.migrationSourcePath)) throw new Error('client installation input is invalid')
  const source = await lstat(input.migrationSourcePath)
  if (!source.isFile() || source.isSymbolicLink() || source.size <= 0 || source.size > 1024 * 1024) throw new Error('client installation migration is invalid')
  let created = false; let migrationBytes: Buffer | undefined; let configBytes: Buffer | undefined
  try {
    await mkdir(root, { mode: 0o700 }); created = true
    const stateRoot = join(root, 'state'); const runtimeRoot = join(root, 'runtime')
    await mkdir(stateRoot, { mode: 0o700 }); await mkdir(runtimeRoot, { mode: 0o700 })
    const migrationPath = join(runtimeRoot, basename(input.migrationSourcePath))
    await copyFile(input.migrationSourcePath, migrationPath); await chmod(migrationPath, 0o600)
    migrationBytes = await readFile(migrationPath)
    const migrationDigest = digest(migrationBytes)
    const bootstrap: InactiveClientBootstrapDocumentV1 = { schemaVersion: 1, controlPlaneEndpoint: input.controlPlaneEndpoint, stateRoot, tenantId: input.tenantId, userId: input.userId, deviceId: input.deviceId, privateKeyRef: input.privateKeyRef, keychainAccount: input.keychainAccount, planVerification: input.planVerification }
    configBytes = Buffer.from(`${JSON.stringify(bootstrap)}\n`, 'utf8')
    await writeDurable(join(root, 'client.json'), configBytes)
    const receipt: InactiveClientInstallationReceiptV1 = Object.freeze({ schemaVersion: 1, installationId: `installation.${createHash('sha256').update(root).update('\0').update(input.clientVersion).digest('hex').slice(0, 32)}`, clientVersion: input.clientVersion, configDigest: digest(configBytes), migrationDigest, installedAt: now.toISOString(), state: 'installed-inactive', autoStart: false, externalWritesEnabled: false })
    await writeDurable(join(root, 'install-receipt.json'), Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'))
    return Object.freeze({ plan: await compileInactiveClientBootstrap(bootstrap, migrationPath), receipt })
  } catch (error) {
    if (created) await rm(root, { recursive: true, force: true })
    throw error
  } finally { migrationBytes?.fill(0); configBytes?.fill(0) }
}

/** Revalidates local installation evidence without reading client databases or secrets. */
export async function recoverInactiveClientInstallation(installRoot: string): Promise<InactiveClientInstallationV1> {
  const root = await validateExistingRoot(installRoot)
  if ((await readdir(root)).sort().join(',') !== 'client.json,install-receipt.json,runtime,state') throw new Error('client installation layout is invalid')
  let configBytes: Buffer | undefined; let receiptBytes: Buffer | undefined; let migrationBytes: Buffer | undefined
  try {
    configBytes = await readBounded(join(root, 'client.json')); receiptBytes = await readBounded(join(root, 'install-receipt.json'))
    let config: unknown; let receipt: unknown
    try { config = JSON.parse(configBytes.toString('utf8')); receipt = JSON.parse(receiptBytes.toString('utf8')) } catch { throw new Error('client installation metadata is invalid') }
    const item = exactReceipt(receipt)
    const expectedInstallationId = `installation.${createHash('sha256').update(root).update('\0').update(item.clientVersion).digest('hex').slice(0, 32)}`
    if (item.installationId !== expectedInstallationId) throw new Error('client installation identity drifted')
    if (item.configDigest !== digest(configBytes)) throw new Error('client installation config digest drifted')
    const migrationPath = join(root, 'runtime', basename((await onlyMigration(join(root, 'runtime')))))
    migrationBytes = await readBounded(migrationPath, 1024 * 1024)
    if (item.migrationDigest !== digest(migrationBytes)) throw new Error('client installation migration digest drifted')
    const plan = await compileInactiveClientBootstrap(config, migrationPath)
    if (dirname(plan.client.paths.databasePath) !== join(root, 'state')) throw new Error('client installation state root drifted')
    return Object.freeze({ plan, receipt: item })
  } finally { configBytes?.fill(0); receiptBytes?.fill(0); migrationBytes?.fill(0) }
}

/** Removes only a never-started installation whose state directory is still empty. */
export async function uninstallUnusedInactiveClient(installRoot: string): Promise<InactiveClientInstallationReceiptV1> {
  const recovered = await recoverInactiveClientInstallation(installRoot)
  const root = resolve(installRoot); const stateRoot = dirname(recovered.plan.client.paths.databasePath)
  if ((await readdir(stateRoot)).length !== 0) throw new Error('client installation contains durable state')
  const quarantine = `${root}.uninstalling`
  try { await lstat(quarantine); throw new Error('client uninstall quarantine already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await rename(root, quarantine)
  const quarantinedState = join(quarantine, 'state')
  if ((await readdir(quarantinedState)).length !== 0) { await rename(quarantine, root); throw new Error('client installation acquired durable state during uninstall') }
  const runtimeRoot = join(quarantine, 'runtime')
  await unlink(join(quarantine, 'client.json')); await unlink(join(quarantine, 'install-receipt.json')); await unlink(await onlyMigration(runtimeRoot)); await rmdir(runtimeRoot)
  // Never recursively delete state: any unexpected write makes an atomic directory removal fail.
  await rmdir(quarantinedState); await rmdir(quarantine)
  return recovered.receipt
}

async function validateNewRoot(value: string): Promise<string> {
  if (!isAbsolute(value) || resolve(value) !== value || value === '/') throw new Error('client install root must be an exact absolute path')
  const parent = dirname(value)
  if (await realpath(parent) !== parent) throw new Error('client install parent must be canonical')
  try { await lstat(value); throw new Error('client install root already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return value
}

async function validateExistingRoot(value: string): Promise<string> {
  if (!isAbsolute(value) || resolve(value) !== value || value === '/' || await realpath(value) !== value) throw new Error('client install root must be canonical')
  const state = await lstat(value)
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0) throw new Error('client install root must be private')
  return value
}

async function writeDurable(path: string, bytes: Uint8Array): Promise<void> { const handle = await open(path, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() } }
async function readBounded(path: string, limit = 64 * 1024): Promise<Buffer> { const state = await lstat(path); if (!state.isFile() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || state.size <= 0 || state.size > limit) throw new Error('client installation file is invalid'); return await readFile(path) }
async function onlyMigration(root: string): Promise<string> { const state = await lstat(root); if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || await realpath(root) !== root) throw new Error('client installation runtime is invalid'); const entries = await readdir(root); if (entries.length !== 1) throw new Error('client installation runtime is invalid'); return join(root, entries[0]!) }
function digest(value: Uint8Array): string { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
function exactReceipt(value: unknown): InactiveClientInstallationReceiptV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client installation receipt is invalid')
  const item = value as Record<string, unknown>; const keys = ['schemaVersion', 'installationId', 'clientVersion', 'configDigest', 'migrationDigest', 'installedAt', 'state', 'autoStart', 'externalWritesEnabled']
  if (Object.keys(item).sort().join(',') !== keys.sort().join(',') || item.schemaVersion !== 1 || typeof item.installationId !== 'string' || !/^installation\.[a-f0-9]{32}$/.test(item.installationId) || typeof item.clientVersion !== 'string' || !versionPattern.test(item.clientVersion) || typeof item.configDigest !== 'string' || !digestPattern.test(item.configDigest) || typeof item.migrationDigest !== 'string' || !digestPattern.test(item.migrationDigest) || typeof item.installedAt !== 'string' || Number.isNaN(Date.parse(item.installedAt)) || item.state !== 'installed-inactive' || item.autoStart !== false || item.externalWritesEnabled !== false) throw new Error('client installation receipt is invalid')
  return Object.freeze(item as unknown as InactiveClientInstallationReceiptV1)
}
