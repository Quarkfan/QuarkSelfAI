import { constants } from 'node:fs'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRecoveryBundle, stageRecoveryBundle, type RecoveryBinaries } from './recovery-bundle.js'
import { readRuntimeEnvironment } from './audit-recovery-readiness.js'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type RecoveryPublicConfig = {
  schemaVersion: 1
  projectId: 'quarkselfai'
  ageRecipient: string
  retention?: {
    daily: number
    weekly: number
  }
}

type RecoveryTargetConfig = {
  schemaVersion: 1
  kind: 'filesystem'
  provider: 'icloud-drive' | 'managed-filesystem'
  path: string
  identityFile: string
}

export type PublishRecoveryOptions = {
  projectRoot: string
  home: string
  environment: Record<string, string | undefined>
  targetDirectory: string
  recipient: string
  identityFile: string
  includeOptional?: boolean
  quiesced?: boolean
  now?: Date
  binaries?: Partial<RecoveryBinaries>
}

export type RecoveryPublishReceipt = {
  receiptFormatVersion: 1
  projectId: 'quarkselfai'
  bundleId: string
  objectKey: string
  encryptedBytes: number
  encryptedSha256: string
  publishedAt: string
  captureMode: 'online-bounded' | 'quiesced'
  verification: 'filesystem-provider-readback-and-decrypt'
  remotePersistence: 'not-proven-by-local-provider-readback'
}

export type RecoveryRetentionPlan = {
  verifiedReceipts: number
  kept: string[]
  delete: string[]
  ignored: string[]
}

function safeSegment(value: string): boolean {
  return /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/.test(value)
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function verifyRecoveryPair(
  targetRoot: string,
  receiptPath: string,
): Promise<{ receipt: RecoveryPublishReceipt; objectPath: string; published: Date }> {
  const receiptInfo = await lstat(receiptPath)
  if (!receiptInfo.isFile() || receiptInfo.isSymbolicLink()) throw new Error('receipt is not a regular file')
  const receipt = await readJson<RecoveryPublishReceipt>(receiptPath)
  const objectPath = resolve(targetRoot, receipt.objectKey)
  if (receipt.receiptFormatVersion !== 1 || receipt.projectId !== 'quarkselfai'
    || relative(targetRoot, objectPath).startsWith('..') || receiptPath !== `${objectPath}.receipt.json`
    || !receipt.objectKey.endsWith(`-${receipt.bundleId}.age`)) throw new Error('invalid receipt lineage')
  const published = new Date(receipt.publishedAt)
  if (Number.isNaN(published.getTime())) throw new Error('invalid published time')
  const info = await lstat(objectPath)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== receipt.encryptedBytes
    || await sha256(objectPath) !== receipt.encryptedSha256) {
    throw new Error('stored object does not match receipt')
  }
  return { receipt, objectPath, published }
}

async function listReceiptFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) result.push(...await listReceiptFiles(root, path))
    else if (entry.isFile() && entry.name.endsWith('.age.receipt.json')) result.push(path)
  }
  return result
}

function isoWeekKey(date: Date): string {
  const cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const weekday = cursor.getUTCDay() || 7
  cursor.setUTCDate(cursor.getUTCDate() + 4 - weekday)
  const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((cursor.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
  return `${cursor.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export async function planRecoveryRetention(
  targetDirectory: string,
  retention: { daily: number; weekly: number },
): Promise<RecoveryRetentionPlan> {
  if (!Number.isInteger(retention.daily) || retention.daily < 1 || !Number.isInteger(retention.weekly) || retention.weekly < 0) {
    throw new Error('recovery retention values are invalid')
  }
  const targetRoot = resolve(targetDirectory)
  await assertManagedDirectory(targetRoot, false)
  const verified: Array<{ receipt: RecoveryPublishReceipt; receiptPath: string; published: Date }> = []
  const ignored: string[] = []
  for (const receiptPath of await listReceiptFiles(targetRoot)) {
    const relativeReceipt = relative(targetRoot, receiptPath).split('/').join('/')
    try {
      const { receipt, published } = await verifyRecoveryPair(targetRoot, receiptPath)
      verified.push({ receipt, receiptPath, published })
    } catch {
      ignored.push(relativeReceipt)
    }
  }
  verified.sort((left, right) => right.published.getTime() - left.published.getTime())
  const keep = new Set<string>()
  const dailyDates = new Set<string>()
  for (const item of verified) {
    const date = item.published.toISOString().slice(0, 10)
    if (!dailyDates.has(date) && dailyDates.size < retention.daily) {
      dailyDates.add(date)
      keep.add(item.receipt.objectKey)
    }
  }
  const oldestDaily = [...dailyDates].sort()[0]
  const weeklyKeys = new Set<string>()
  for (const item of verified) {
    const date = item.published.toISOString().slice(0, 10)
    if (!oldestDaily || date >= oldestDaily) continue
    const week = isoWeekKey(item.published)
    if (!weeklyKeys.has(week) && weeklyKeys.size < retention.weekly) {
      weeklyKeys.add(week)
      keep.add(item.receipt.objectKey)
    }
  }
  return {
    verifiedReceipts: verified.length,
    kept: verified.filter(item => keep.has(item.receipt.objectKey)).map(item => item.receipt.objectKey),
    delete: verified.filter(item => !keep.has(item.receipt.objectKey)).map(item => item.receipt.objectKey),
    ignored: ignored.sort(),
  }
}

export async function applyRecoveryRetention(targetDirectory: string, plan: RecoveryRetentionPlan): Promise<number> {
  const targetRoot = resolve(targetDirectory)
  let deleted = 0
  for (const objectKey of plan.delete) {
    const objectPath = resolve(targetRoot, objectKey)
    if (relative(targetRoot, objectPath).startsWith('..')) throw new Error('retention candidate escapes target root')
    const verified = await verifyRecoveryPair(targetRoot, `${objectPath}.receipt.json`)
    if (verified.receipt.objectKey !== objectKey) throw new Error('retention candidate changed after planning')
    await rm(objectPath, { force: true })
    await rm(`${objectPath}.receipt.json`, { force: true })
    deleted += 1
  }
  return deleted
}

function assertPublicConfig(value: RecoveryPublicConfig): void {
  if (value.schemaVersion !== 1 || value.projectId !== 'quarkselfai' || !value.ageRecipient.startsWith('age1')) {
    throw new Error('recovery public configuration is incomplete or unsupported')
  }
}

function assertTargetConfig(value: RecoveryTargetConfig): void {
  if (value.schemaVersion !== 1 || value.kind !== 'filesystem') throw new Error('unsupported recovery target')
  if (value.provider !== 'icloud-drive' && value.provider !== 'managed-filesystem') {
    throw new Error('unsupported recovery target provider')
  }
  if (!isAbsolute(value.path) || !isAbsolute(value.identityFile)) {
    throw new Error('recovery target and identity paths must be absolute')
  }
}

async function assertManagedDirectory(path: string, create = true): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('recovery target must be a regular directory')
}

export async function publishRecoveryBundle(options: PublishRecoveryOptions): Promise<RecoveryPublishReceipt> {
  const targetRoot = resolve(options.targetDirectory)
  const identityFile = resolve(options.identityFile)
  await assertManagedDirectory(targetRoot)
  const identityInfo = await lstat(identityFile)
  if (!identityInfo.isFile() || identityInfo.isSymbolicLink()) throw new Error('age identity must be a regular file')

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'quark-recovery-publish-'))
  await chmod(temporaryRoot, 0o700)
  const localBundle = join(temporaryRoot, 'bundle.age')
  let publishedBundle: string | undefined
  let publishedReceipt: string | undefined
  try {
    const document = await createRecoveryBundle({
      projectRoot: options.projectRoot,
      home: options.home,
      environment: options.environment,
      output: localBundle,
      recipient: options.recipient,
      includeOptional: options.includeOptional,
      quiesced: options.quiesced,
      binaries: options.binaries,
    })
    const now = options.now ?? new Date()
    const timestamp = now.toISOString().replaceAll(':', '').replaceAll('-', '').replace('.000Z', 'Z')
    const fileName = `${timestamp}-${document.bundleId}.age`
    if (!safeSegment(fileName)) throw new Error('generated recovery object name is unsafe')
    const objectDirectory = join(targetRoot, 'daily', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'))
    await mkdir(objectDirectory, { recursive: true, mode: 0o700 })
    publishedBundle = join(objectDirectory, fileName)
    publishedReceipt = `${publishedBundle}.receipt.json`
    if (relative(targetRoot, publishedBundle).startsWith('..')) throw new Error('recovery object escapes target root')

    await copyFile(localBundle, publishedBundle, constants.COPYFILE_EXCL)
    await chmod(publishedBundle, 0o600)
    const encryptedInfo = await stat(publishedBundle)
    const encryptedSha256 = await sha256(publishedBundle)

    const readback = join(temporaryRoot, 'readback.age')
    await copyFile(publishedBundle, readback, constants.COPYFILE_EXCL)
    const readbackInfo = await stat(readback)
    if (readbackInfo.size !== encryptedInfo.size || await sha256(readback) !== encryptedSha256) {
      throw new Error('recovery target readback checksum mismatch')
    }
    const staged = join(temporaryRoot, 'verified')
    const restored = await stageRecoveryBundle({
      input: readback,
      outputDirectory: staged,
      identityFile,
      binaries: options.binaries,
    })
    if (restored.bundleId !== document.bundleId) throw new Error('recovery target readback bundle identity mismatch')

    const objectKey = relative(targetRoot, publishedBundle).split('/').join('/')
    const receipt: RecoveryPublishReceipt = {
      receiptFormatVersion: 1,
      projectId: 'quarkselfai',
      bundleId: document.bundleId,
      objectKey,
      encryptedBytes: encryptedInfo.size,
      encryptedSha256,
      publishedAt: now.toISOString(),
      captureMode: document.captureMode,
      verification: 'filesystem-provider-readback-and-decrypt',
      remotePersistence: 'not-proven-by-local-provider-readback',
    }
    await writeFile(publishedReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    return receipt
  } catch (error) {
    if (publishedReceipt) await rm(publishedReceipt, { force: true })
    if (publishedBundle) await rm(publishedBundle, { force: true })
    throw error
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'publish' && process.argv[2] !== 'prune' && process.argv[2] !== 'cycle') {
    throw new Error('usage: recovery-target.ts publish|prune|cycle [options]')
  }
  const publicConfigPath = argument('--public-config') || resolve(scriptRoot, 'config/recovery-public.json')
  const targetConfigPath = argument('--target-config') || resolve(scriptRoot, 'var/recovery-target.json')
  const publicConfig = await readJson<RecoveryPublicConfig>(publicConfigPath)
  const targetConfig = await readJson<RecoveryTargetConfig>(targetConfigPath)
  assertPublicConfig(publicConfig)
  assertTargetConfig(targetConfig)
  if (process.argv[2] === 'prune') {
    const retention = publicConfig.retention ?? { daily: 14, weekly: 8 }
    const plan = await planRecoveryRetention(targetConfig.path, retention)
    const applied = process.argv.includes('--apply')
    const deleted = applied ? await applyRecoveryRetention(targetConfig.path, plan) : 0
    process.stdout.write(`${JSON.stringify({ ok: true, applied, deleted, ...plan })}\n`)
    return
  }
  const runtimeEnvironment = await readRuntimeEnvironment(resolve(scriptRoot, 'var/runtime.env'))
  const receipt = await publishRecoveryBundle({
    projectRoot: scriptRoot,
    home: homedir(),
    environment: { ...runtimeEnvironment, ...process.env },
    targetDirectory: targetConfig.path,
    recipient: publicConfig.ageRecipient,
    identityFile: targetConfig.identityFile,
    includeOptional: process.argv.includes('--include-optional'),
    quiesced: process.argv.includes('--quiesced'),
  })
  if (process.argv[2] === 'cycle') {
    const retention = publicConfig.retention ?? { daily: 14, weekly: 8 }
    const plan = await planRecoveryRetention(targetConfig.path, retention)
    const deleted = await applyRecoveryRetention(targetConfig.path, plan)
    process.stdout.write(`${JSON.stringify({ ok: true, ...receipt, retention: {
      verifiedReceipts: plan.verifiedReceipts,
      kept: plan.kept.length,
      deleted,
      ignored: plan.ignored.length,
    } })}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...receipt })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
