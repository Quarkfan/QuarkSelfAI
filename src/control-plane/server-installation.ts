import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { verifyServerDistribution, type ServerDistributionManifestV1 } from './server-distribution.js'

const digestPattern = /^sha256:[a-f0-9]{64}$/
export interface InactiveServerInstallationReceiptV1 { readonly schemaVersion: 1; readonly installationId: string; readonly serverVersion: string; readonly distributionDigest: string; readonly sourceRevision: string; readonly installedAt: string; readonly state: 'installed-inactive'; readonly configurationPresent: false; readonly autoStart: false; readonly serviceRegistered: false; readonly sshGatewayApplied: false; readonly externalEffectsEnabled: false }

/** Copies one verified server distribution without configuration, credentials, durable state or activation. */
export async function installInactiveServer(installRoot: string, distributionSourcePath: string, now = new Date()): Promise<InactiveServerInstallationReceiptV1> {
  const root = await validateNewRoot(installRoot); const distribution = await verifyServerDistribution(distributionSourcePath)
  if (Number.isNaN(now.getTime())) throw new Error('server installation timestamp is invalid')
  let created = false
  try {
    await mkdir(root, { mode: 0o700 }); created = true; await copyDistribution(distributionSourcePath, root, distribution); await verifyServerDistribution(root)
    for (const name of ['config','runtime','state']) await mkdir(join(root, name), { mode: 0o700 })
    const receipt = Object.freeze({ schemaVersion: 1 as const, installationId: `server-installation.${createHash('sha256').update(root).update('\0').update(distribution.serverVersion).digest('hex').slice(0, 32)}`, serverVersion: distribution.serverVersion, distributionDigest: distribution.artifactDigest, sourceRevision: distribution.sourceRevision, installedAt: now.toISOString(), state: 'installed-inactive' as const, configurationPresent: false as const, autoStart: false as const, serviceRegistered: false as const, sshGatewayApplied: false as const, externalEffectsEnabled: false as const })
    await writeExclusive(join(root, 'install-receipt.json'), Buffer.from(`${JSON.stringify(receipt)}\n`)); return receipt
  } catch (error) { if (created) { const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true, force: true }) }; throw error }
}

/** Revalidates an inactive installation without opening state or reading host credentials. */
export async function recoverInactiveServerInstallation(installRoot: string): Promise<InactiveServerInstallationReceiptV1> {
  const root = await validateExistingRoot(installRoot); const bytes = await readPrivate(join(root, 'install-receipt.json'), 64 * 1024)
  let parsed: unknown; try { parsed = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('server installation receipt is invalid') }
  const receipt = exactReceipt(parsed); const expected = `server-installation.${createHash('sha256').update(root).update('\0').update(receipt.serverVersion).digest('hex').slice(0, 32)}`
  if (receipt.installationId !== expected) throw new Error('server installation identity drifted')
  const distribution = await verifyServerDistribution(root)
  if (distribution.serverVersion !== receipt.serverVersion || distribution.sourceRevision !== receipt.sourceRevision || distribution.artifactDigest !== receipt.distributionDigest) throw new Error('server installation distribution drifted')
  for (const name of ['config','runtime','state']) await privateDirectory(join(root, name))
  return receipt
}

/** Removes only a never-configured installation with no runtime or durable state. */
export async function uninstallUnusedInactiveServer(installRoot: string): Promise<InactiveServerInstallationReceiptV1> {
  const receipt = await recoverInactiveServerInstallation(installRoot); const root = resolve(installRoot)
  await assertEmptyNamespaces(root); const quarantine = `${root}.uninstalling`
  try { await lstat(quarantine); throw new Error('server uninstall quarantine already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await rename(root, quarantine)
  try { await assertEmptyNamespaces(quarantine) } catch (error) { await rename(quarantine, root); throw error }
  await removeVerifiedDistribution(quarantine); await unlink(join(quarantine, 'install-receipt.json'))
  for (const name of ['config','runtime','state']) await rmdir(join(quarantine, name)); await rmdir(quarantine); return receipt
}

async function validateNewRoot(value: string): Promise<string> { if (!isAbsolute(value) || resolve(value) !== value || value === '/' || await realpath(dirname(value)) !== dirname(value)) throw new Error('server install root must be a new exact path'); try { await lstat(value); throw new Error('server install root already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }; return value }
async function validateExistingRoot(value: string): Promise<string> { if (!isAbsolute(value) || resolve(value) !== value || value === '/' || await realpath(value) !== value) throw new Error('server install root must be canonical'); await privateDirectory(value); return value }
async function privateDirectory(path: string): Promise<void> { const state = await lstat(path); const uid = process.getuid?.(); if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('server installation directory is unsafe') }
async function assertEmptyNamespaces(root: string): Promise<void> { for (const name of ['config','runtime','state']) if ((await readdir(join(root, name))).length) throw new Error('server installation contains host configuration or durable state') }
async function copyDistribution(sourceRoot: string, destinationRoot: string, manifest: ServerDistributionManifestV1): Promise<void> { for (const file of manifest.files) { const destination = join(destinationRoot, file.path); await mkdir(dirname(destination), { recursive: true, mode: 0o700 }); await copyFile(join(sourceRoot, file.path), destination); await chmod(destination, 0o600) }; await copyFile(join(sourceRoot, 'server-distribution.json'), join(destinationRoot, 'server-distribution.json')); await chmod(join(destinationRoot, 'server-distribution.json'), 0o600) }
async function removeVerifiedDistribution(root: string): Promise<void> { const manifest = await verifyServerDistribution(root); for (const file of [...manifest.files].sort((a, b) => b.path.localeCompare(a.path))) await unlink(join(root, file.path)); const directories = new Set<string>(); for (const file of manifest.files) { let current = dirname(join(root, file.path)); while (current !== root) { directories.add(current); current = dirname(current) } }; for (const path of [...directories].sort((a, b) => b.length - a.length)) await rmdir(path); await unlink(join(root, 'server-distribution.json')) }
async function writeExclusive(path: string, bytes: Uint8Array): Promise<void> { const handle = await open(path, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() } }
async function readPrivate(path: string, max: number): Promise<Buffer> { const state = await lstat(path); if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || (state.mode & 0o077) !== 0 || state.size <= 0 || state.size > max) throw new Error('server installation file is unsafe'); return await readFile(path) }
function exactReceipt(value: unknown): InactiveServerInstallationReceiptV1 { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('server installation receipt is invalid'); const item = value as Record<string, unknown>; const keys = ['schemaVersion','installationId','serverVersion','distributionDigest','sourceRevision','installedAt','state','configurationPresent','autoStart','serviceRegistered','sshGatewayApplied','externalEffectsEnabled']; if (Object.keys(item).sort().join(',') !== keys.sort().join(',') || item.schemaVersion !== 1 || typeof item.installationId !== 'string' || !/^server-installation\.[a-f0-9]{32}$/.test(item.installationId) || typeof item.serverVersion !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(item.serverVersion) || typeof item.distributionDigest !== 'string' || !digestPattern.test(item.distributionDigest) || typeof item.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(item.sourceRevision) || typeof item.installedAt !== 'string' || Number.isNaN(Date.parse(item.installedAt)) || item.state !== 'installed-inactive' || item.configurationPresent !== false || item.autoStart !== false || item.serviceRegistered !== false || item.sshGatewayApplied !== false || item.externalEffectsEnabled !== false) throw new Error('server installation receipt is invalid'); return Object.freeze(item as unknown as InactiveServerInstallationReceiptV1) }
