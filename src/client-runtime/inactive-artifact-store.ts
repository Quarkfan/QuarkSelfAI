import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants, createReadStream } from 'node:fs'
import { chmod, copyFile, link, lstat, mkdir, open, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { CapabilityLifecycleSnapshotV1 } from '../capability-platform/manifest.js'
import type { InactiveCapabilityRemovalV1, InactiveCapabilitySelectionV1, InactiveInstallationPlanV1 } from './contracts.js'
import { inactiveLifecycleSnapshot } from './install-planner.js'

const capabilityPattern = /^[a-z0-9][a-z0-9.-]{0,63}(?:\/[a-z0-9][a-z0-9.-]{0,63})?$/
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const digestPattern = /^sha256:[a-f0-9]{64}$/

export interface InactiveCapabilityStatePortV1 {
  saveInactiveCapability(state: CapabilityLifecycleSnapshotV1): CapabilityLifecycleSnapshotV1
  inactiveCapability(capabilityId: string, version: string): CapabilityLifecycleSnapshotV1 | null
  inactiveCapabilities(): readonly CapabilityLifecycleSnapshotV1[]
  inactiveCapabilitySelection(capabilityId: string): InactiveCapabilitySelectionV1 | null
  selectInactiveCapability(capabilityId: string, version: string, now?: Date): InactiveCapabilitySelectionV1
  rollbackInactiveCapability(capabilityId: string, now?: Date): InactiveCapabilitySelectionV1
  removeInactiveCapability(capabilityId: string, version: string, now?: Date): InactiveCapabilityRemovalV1
}

export interface InactiveArtifactReceiptV1 {
  readonly schemaVersion: 1
  readonly planId: string
  readonly capabilityId: string
  readonly version: string
  readonly artifactDigest: string
  readonly deviceId: string
  readonly targetState: 'installed-inactive'
  readonly installedAt: string
  readonly loading: 'unloaded'
  readonly authorization: 'unauthorized'
  readonly execution: 'stopped'
  readonly effects: 'disabled'
}

export interface InactiveArtifactRecoveryReportV1 {
  readonly schemaVersion: 1
  readonly installedVersionCount: number
  readonly selectedCapabilityCount: number
  readonly orphanBlobCount: number
  readonly orphanReceiptCount: number
  readonly loading: 'unloaded'
  readonly authorization: 'unauthorized'
  readonly execution: 'stopped'
  readonly effects: 'disabled'
}

export interface InactiveArtifactUninstallResultV1 {
  readonly schemaVersion: 1
  readonly capabilityId: string
  readonly version: string
  readonly selectedVersion: string | null
  readonly blobRemoved: boolean
  readonly cleanupPending: boolean
  readonly effects: 'disabled'
}

/** Content-addressed local landing only. It never invokes a lifecycle handler or opens an artifact. */
export class InactiveArtifactStoreV1 {
  private constructor(private readonly root: string, private readonly state: InactiveCapabilityStatePortV1) {}

  static async open(rootInput: string, state: InactiveCapabilityStatePortV1): Promise<InactiveArtifactStoreV1> {
    if (!rootInput || !isAbsolute(rootInput)) throw new Error('artifact root must be an absolute local path')
    const requested = resolve(rootInput)
    await mkdir(requested, { recursive: true, mode: 0o700 })
    const root = await realpath(requested)
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('artifact root must be a directory')
    await secureDirectory(root)
    await secureDirectory(join(root, 'blobs'))
    await secureDirectory(join(root, 'installations'))
    return new InactiveArtifactStoreV1(root, state)
  }

  async install(plan: InactiveInstallationPlanV1, sourcePath: string, now = new Date()): Promise<InactiveArtifactReceiptV1> {
    validatePlan(plan, now)
    await this.#secureLayout()
    const source = resolve(sourcePath)
    const sourceInfo = await lstat(source)
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error('artifact source must be a regular file')
    if (await sha256File(source) !== plan.artifactDigest) throw new Error('artifact digest does not match the installation plan')

    const blob = this.#blobPath(plan.artifactDigest)
    await this.#landBlob(source, blob, plan.artifactDigest)
    const receipt = Object.freeze({ schemaVersion: 1 as const, planId: plan.planId, capabilityId: plan.capabilityId, version: plan.version,
      artifactDigest: plan.artifactDigest, deviceId: plan.deviceId, targetState: 'installed-inactive' as const, installedAt: now.toISOString(),
      loading: 'unloaded' as const, authorization: 'unauthorized' as const, execution: 'stopped' as const, effects: 'disabled' as const })
    const persistedReceipt = await persistReceipt(this.#receiptPath(plan.capabilityId, plan.version), receipt)
    this.state.saveInactiveCapability(inactiveLifecycleSnapshot(plan, new Date(persistedReceipt.installedAt)))
    if (!this.state.inactiveCapabilitySelection(plan.capabilityId)) this.state.selectInactiveCapability(plan.capabilityId, plan.version, now)
    return persistedReceipt
  }

  async upgrade(plan: InactiveInstallationPlanV1, sourcePath: string, now = new Date()): Promise<InactiveCapabilitySelectionV1> {
    const current = this.state.inactiveCapabilitySelection(plan.capabilityId)
    if (!current || current.currentVersion === plan.version) throw new Error('inactive upgrade requires a different selected installed version')
    await this.install(plan, sourcePath, now)
    return this.state.selectInactiveCapability(plan.capabilityId, plan.version, now)
  }

  async rollback(capabilityId: string, now = new Date()): Promise<InactiveCapabilitySelectionV1> {
    const current = this.state.inactiveCapabilitySelection(capabilityId)
    if (!current?.previousVersion) throw new Error('inactive capability has no rollback version')
    await this.verifyInstalled(capabilityId, current.previousVersion)
    return this.state.rollbackInactiveCapability(capabilityId, now)
  }

  async uninstall(capabilityId: string, version: string, now = new Date()): Promise<InactiveArtifactUninstallResultV1> {
    const receipt = await this.verifyInstalled(capabilityId, version)
    const removal = this.state.removeInactiveCapability(capabilityId, version, now)
    let blobRemoved = false; let cleanupPending = false
    try { await secureDirectory(dirname(this.#receiptPath(capabilityId, version))); await rm(this.#receiptPath(capabilityId, version)) } catch { cleanupPending = true }
    if (!this.state.inactiveCapabilities().some(item => item.artifactDigest === receipt.artifactDigest)) {
      try { await secureDirectory(join(this.root, 'blobs')); await rm(this.#blobPath(receipt.artifactDigest)); blobRemoved = true } catch { cleanupPending = true }
    }
    return Object.freeze({ schemaVersion: 1, capabilityId, version, selectedVersion: removal.selection?.currentVersion ?? null, blobRemoved, cleanupPending, effects: 'disabled' })
  }

  async verifyRecovery(): Promise<InactiveArtifactRecoveryReportV1> {
    await this.#secureLayout()
    const installed = this.state.inactiveCapabilities()
    for (const item of installed) await this.verifyInstalled(item.capabilityId, item.version)
    const capabilityIds = [...new Set(installed.map(item => item.capabilityId))]
    const selectedCapabilityCount = capabilityIds.filter(id => this.state.inactiveCapabilitySelection(id) !== null).length
    const expectedBlobs = new Set(installed.map(item => item.artifactDigest.slice(7)))
    const expectedReceipts = new Set(installed.map(item => `${item.capabilityId}\0${item.version}`))
    const blobs = await this.#scanBlobs(); const receipts = await this.#scanReceipts()
    return Object.freeze({ schemaVersion: 1, installedVersionCount: installed.length, selectedCapabilityCount,
      orphanBlobCount: blobs.filter(item => !expectedBlobs.has(item)).length,
      orphanReceiptCount: receipts.filter(item => !expectedReceipts.has(`${item.capabilityId}\0${item.version}`)).length,
      loading: 'unloaded', authorization: 'unauthorized', execution: 'stopped', effects: 'disabled' })
  }

  async garbageCollect(): Promise<{ readonly schemaVersion: 1; readonly removedBlobCount: number; readonly removedReceiptCount: number; readonly effects: 'disabled' }> {
    await this.verifyRecovery()
    const installed = this.state.inactiveCapabilities()
    const expectedBlobs = new Set(installed.map(item => item.artifactDigest.slice(7)))
    const expectedReceipts = new Set(installed.map(item => `${item.capabilityId}\0${item.version}`))
    let removedBlobCount = 0; let removedReceiptCount = 0
    for (const blob of await this.#scanBlobs()) if (!expectedBlobs.has(blob)) { await rm(join(this.root, 'blobs', blob)); removedBlobCount += 1 }
    for (const receipt of await this.#scanReceipts()) if (!expectedReceipts.has(`${receipt.capabilityId}\0${receipt.version}`)) { await rm(receipt.path); removedReceiptCount += 1 }
    return Object.freeze({ schemaVersion: 1, removedBlobCount, removedReceiptCount, effects: 'disabled' })
  }

  async verifyInstalled(capabilityId: string, version: string): Promise<InactiveArtifactReceiptV1> {
    validateIdentity(capabilityId, version)
    await this.#secureLayout()
    const snapshot = this.state.inactiveCapability(capabilityId, version)
    if (!snapshot) throw new Error('inactive capability version is not installed')
    const receipt = await readReceipt(this.#receiptPath(capabilityId, version))
    if (receipt.schemaVersion !== 1 || receipt.capabilityId !== capabilityId || receipt.version !== version || receipt.artifactDigest !== snapshot.artifactDigest || receipt.deviceId !== snapshot.deviceId || receipt.targetState !== 'installed-inactive' || receipt.loading !== 'unloaded' || receipt.authorization !== 'unauthorized' || receipt.execution !== 'stopped' || receipt.effects !== 'disabled') throw new Error('inactive artifact receipt does not match local state')
    if (await sha256File(this.#blobPath(receipt.artifactDigest)) !== receipt.artifactDigest) throw new Error('installed artifact blob failed integrity verification')
    return Object.freeze(receipt)
  }

  #blobPath(digest: string): string { if (!digestPattern.test(digest)) throw new Error('artifact digest is invalid'); return join(this.root, 'blobs', digest.slice(7)) }
  #receiptPath(capabilityId: string, version: string): string { validateIdentity(capabilityId, version); return join(this.root, 'installations', capabilityId.replace('/', '__'), `${version}.json`) }

  async #secureLayout(): Promise<void> { await secureDirectory(this.root); await secureDirectory(join(this.root, 'blobs')); await secureDirectory(join(this.root, 'installations')) }
  async #scanBlobs(): Promise<string[]> {
    const entries = await readdir(join(this.root, 'blobs'), { withFileTypes: true })
    for (const entry of entries) if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name)) throw new Error('artifact blob directory contains an unsafe entry')
    return entries.map(item => item.name).sort()
  }
  async #scanReceipts(): Promise<Array<{ capabilityId: string; version: string; path: string }>> {
    const result: Array<{ capabilityId: string; version: string; path: string }> = []
    for (const directory of await readdir(join(this.root, 'installations'), { withFileTypes: true })) {
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('artifact receipt directory contains an unsafe entry')
      const capabilityId = directory.name.replace('__', '/')
      if (!capabilityPattern.test(capabilityId) || capabilityId.replace('/', '__') !== directory.name) throw new Error('artifact receipt directory contains an unsafe identity')
      const parent = join(this.root, 'installations', directory.name); await secureDirectory(parent)
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        const version = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : ''
        if (!entry.isFile() || entry.isSymbolicLink() || !versionPattern.test(version)) throw new Error('artifact receipt directory contains an unsafe entry')
        result.push({ capabilityId, version, path: join(parent, entry.name) })
      }
    }
    return result.sort((left, right) => left.path.localeCompare(right.path))
  }

  async #landBlob(source: string, destination: string, digest: string): Promise<void> {
    try {
      if (await sha256File(destination) === digest) return
      throw new Error('content-addressed artifact path contains a different blob')
    } catch (error) { if (!isMissing(error)) throw error }
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      await copyFile(source, temporary, fsConstants.COPYFILE_EXCL)
      await chmod(temporary, 0o600)
      if (await sha256File(temporary) !== digest) throw new Error('staged artifact blob failed integrity verification')
      try { await link(temporary, destination) }
      catch (error) { if (!isAlreadyExists(error) || await sha256File(destination) !== digest) throw error }
    } finally { await rm(temporary, { force: true }) }
  }
}

function validatePlan(plan: InactiveInstallationPlanV1, now: Date): void {
  validateIdentity(plan.capabilityId, plan.version)
  if (!plan.planId || !digestPattern.test(plan.artifactDigest) || !plan.deviceId || /[\\/]/.test(plan.deviceId) || Number.isNaN(now.getTime()) || plan.targetState !== 'installed-inactive' || plan.loadAllowed !== false || plan.runAllowed !== false || plan.externalWritesEnabled !== false) throw new Error('inactive installation plan is invalid')
}
function validateIdentity(capabilityId: string, version: string): void { if (!capabilityPattern.test(capabilityId) || !versionPattern.test(version)) throw new Error('inactive artifact identity is invalid') }
async function sha256File(path: string): Promise<string> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('artifact blob must be a regular file')
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => { const stream = createReadStream(path); stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', resolvePromise) })
  return `sha256:${hash.digest('hex')}`
}
async function persistReceipt(path: string, value: InactiveArtifactReceiptV1): Promise<InactiveArtifactReceiptV1> {
  await secureDirectory(dirname(path))
  try {
    const existing = await readReceipt(path)
    if (!sameReceiptIdentity(existing, value)) throw new Error('inactive artifact receipt is immutable')
    return Object.freeze(existing)
  } catch (error) { if (!isMissing(error)) throw error }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8'); await handle.sync() } finally { await handle.close() }
    try { await link(temporary, path) }
    catch (error) {
      if (!isAlreadyExists(error)) throw error
      const existing = await readReceipt(path)
      if (!sameReceiptIdentity(existing, value)) throw new Error('inactive artifact receipt is immutable')
      return Object.freeze(existing)
    }
    return value
  }
  finally { await rm(temporary, { force: true }) }
}
function isMissing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' }
function isAlreadyExists(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && ['EEXIST', 'ENOTEMPTY'].includes(String(error.code)) }
function sameReceiptIdentity(left: InactiveArtifactReceiptV1, right: InactiveArtifactReceiptV1): boolean {
  const { installedAt: _leftAt, ...leftIdentity } = left
  const { installedAt: _rightAt, ...rightIdentity } = right
  return JSON.stringify(leftIdentity) === JSON.stringify(rightIdentity) && !Number.isNaN(Date.parse(left.installedAt))
}
async function readReceipt(path: string): Promise<InactiveArtifactReceiptV1> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('inactive artifact receipt must be a regular file')
  return JSON.parse(await readFile(path, 'utf8')) as InactiveArtifactReceiptV1
}
async function secureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error('artifact store path must be a real directory')
  await chmod(path, 0o700)
}
