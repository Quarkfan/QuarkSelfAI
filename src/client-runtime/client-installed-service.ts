import { lstat, open, readFile, readdir, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { recoverInactiveClientInstallation } from './client-installation.js'
import { prepareInactiveClientLaunchd, prepareInactiveClientSystemd, type ClientServiceRenderOptionsV1, type PreparedClientServiceV1 } from './client-service.js'

const digestPattern = /^sha256:[a-f0-9]{64}$/

export interface InstalledClientServicePreparationInputV1 extends ClientServiceRenderOptionsV1 {
  readonly platform: 'launchd-user' | 'systemd-user'
}

export interface InstalledClientServicePreparationReceiptV1 {
  readonly schemaVersion: 1
  readonly installationId: string
  readonly configDigest: string
  readonly distributionDigest: string
  readonly platform: 'launchd-user' | 'systemd-user'
  readonly definitionFile: 'com.quarkfan.quark-client.plist' | 'quark-client.service'
  readonly definitionDigest: string
  readonly nodeExecutable: string
  readonly workspacePath: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly executablePath: string
  readonly preparedAt: string
  readonly state: 'service-prepared-inactive'
  readonly registered: false
  readonly started: false
  readonly autoStart: false
  readonly singleClientOwner: true
  readonly externalWritesEnabled: false
}

/** Persists one sealed user-service definition inside an installed client without registering or starting it. */
export async function prepareInstalledClientUserServiceV1(input: InstalledClientServicePreparationInputV1, now = new Date()): Promise<InstalledClientServicePreparationReceiptV1> {
  const values = exactInput(input)
  if (Number.isNaN(now.getTime())) throw new Error('client service preparation timestamp is invalid')
  const installation = await recoverInactiveClientInstallation(values.installRoot)
  const serviceRoot = join(values.installRoot, 'service')
  await privateDirectory(serviceRoot)
  if ((await readdir(serviceRoot)).length) throw new Error('client service preparation already exists')
  const template = await readPrivate(templatePath(values.installRoot, values.platform), 64 * 1024)
  const options: ClientServiceRenderOptionsV1 = { installRoot: values.installRoot, nodeExecutable: values.nodeExecutable, workspacePath: values.workspacePath, stdoutPath: values.stdoutPath, stderrPath: values.stderrPath, executablePath: values.executablePath }
  const prepared = render(values.platform, template.toString('utf8'), options)
  const definitionFile = values.platform === 'launchd-user' ? 'com.quarkfan.quark-client.plist' as const : 'quark-client.service' as const
  const definitionPath = join(serviceRoot, definitionFile)
  const receiptPath = join(serviceRoot, 'preparation-receipt.json')
  const receipt = Object.freeze({
    schemaVersion: 1 as const,
    installationId: installation.receipt.installationId,
    configDigest: installation.receipt.configDigest,
    distributionDigest: installation.receipt.distributionDigest,
    platform: values.platform,
    definitionFile,
    definitionDigest: prepared.definitionDigest,
    nodeExecutable: values.nodeExecutable,
    workspacePath: values.workspacePath,
    stdoutPath: values.stdoutPath,
    stderrPath: values.stderrPath,
    executablePath: values.executablePath,
    preparedAt: now.toISOString(),
    state: 'service-prepared-inactive' as const,
    registered: false as const,
    started: false as const,
    autoStart: false as const,
    singleClientOwner: true as const,
    externalWritesEnabled: false as const,
  })
  try {
    await writePrivate(definitionPath, Buffer.from(prepared.definition))
    await writePrivate(receiptPath, Buffer.from(`${JSON.stringify(receipt)}\n`))
    return receipt
  } catch (error) {
    for (const path of [receiptPath, definitionPath]) { try { await unlink(path) } catch {} }
    throw error
  }
}

/** Re-renders only from installed, content-addressed inputs and verifies the disabled definition. */
export async function recoverPreparedClientUserServiceV1(installRoot: string): Promise<InstalledClientServicePreparationReceiptV1> {
  const root = await exactExistingRoot(installRoot)
  const installation = await recoverInactiveClientInstallation(root)
  const serviceRoot = join(root, 'service')
  await privateDirectory(serviceRoot)
  const receipt = exactReceipt(JSON.parse((await readPrivate(join(serviceRoot, 'preparation-receipt.json'), 64 * 1024)).toString('utf8')))
  if (receipt.installationId !== installation.receipt.installationId || receipt.configDigest !== installation.receipt.configDigest || receipt.distributionDigest !== installation.receipt.distributionDigest) throw new Error('client service preparation lineage drifted')
  const entries = (await readdir(serviceRoot)).sort()
  if (entries.join(',') !== [receipt.definitionFile, 'preparation-receipt.json'].sort().join(',')) throw new Error('client service preparation layout is invalid')
  const options: ClientServiceRenderOptionsV1 = { installRoot: root, nodeExecutable: receipt.nodeExecutable, workspacePath: receipt.workspacePath, stdoutPath: receipt.stdoutPath, stderrPath: receipt.stderrPath, executablePath: receipt.executablePath }
  const template = await readPrivate(templatePath(root, receipt.platform), 64 * 1024)
  const definition = await readPrivate(join(serviceRoot, receipt.definitionFile), 64 * 1024)
  const rendered = render(receipt.platform, template.toString('utf8'), options)
  if (rendered.definitionDigest !== receipt.definitionDigest || definition.toString('utf8') !== rendered.definition) throw new Error('client service preparation digest drifted')
  return receipt
}

/** Removes only a verified definition that has never acquired activation state. */
export async function removeUnregisteredClientUserServiceV1(installRoot: string): Promise<InstalledClientServicePreparationReceiptV1> {
  const receipt = await recoverPreparedClientUserServiceV1(installRoot)
  const serviceRoot = join(installRoot, 'service')
  await unlink(join(serviceRoot, receipt.definitionFile))
  await unlink(join(serviceRoot, 'preparation-receipt.json'))
  return receipt
}

function render(platform: InstalledClientServicePreparationInputV1['platform'], template: string, options: ClientServiceRenderOptionsV1): PreparedClientServiceV1 {
  return platform === 'launchd-user' ? prepareInactiveClientLaunchd(template, options) : prepareInactiveClientSystemd(template, options)
}

function exactInput(value: unknown): InstalledClientServicePreparationInputV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client service preparation input is invalid')
  const item = value as Record<string, unknown>
  const keys = ['installRoot', 'platform', 'nodeExecutable', 'workspacePath', 'stdoutPath', 'stderrPath', 'executablePath']
  if (Object.keys(item).sort().join(',') !== keys.sort().join(',') || (item.platform !== 'launchd-user' && item.platform !== 'systemd-user')) throw new Error('client service preparation input is invalid')
  const options = { installRoot: item.installRoot, nodeExecutable: item.nodeExecutable, workspacePath: item.workspacePath, stdoutPath: item.stdoutPath, stderrPath: item.stderrPath, executablePath: item.executablePath }
  prepareInactiveClientLaunchd('__NODE_EXECUTABLE__ __CLIENT_ENTRY__ __PROGRAM_ROOT__ __INSTALL_ROOT__ __WORKSPACE_PATH__ __EXEC_PATH__ __STDOUT_PATH__ __STDERR_PATH__', options as ClientServiceRenderOptionsV1)
  return item as unknown as InstalledClientServicePreparationInputV1
}

function exactReceipt(value: unknown): InstalledClientServicePreparationReceiptV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client service preparation receipt is invalid')
  const item = value as Record<string, unknown>
  const keys = ['schemaVersion', 'installationId', 'configDigest', 'distributionDigest', 'platform', 'definitionFile', 'definitionDigest', 'nodeExecutable', 'workspacePath', 'stdoutPath', 'stderrPath', 'executablePath', 'preparedAt', 'state', 'registered', 'started', 'autoStart', 'singleClientOwner', 'externalWritesEnabled']
  const platformFile = item.platform === 'launchd-user' && item.definitionFile === 'com.quarkfan.quark-client.plist' || item.platform === 'systemd-user' && item.definitionFile === 'quark-client.service'
  if (Object.keys(item).sort().join(',') !== keys.sort().join(',') || item.schemaVersion !== 1 || typeof item.installationId !== 'string' || !/^installation\.[a-f0-9]{32}$/.test(item.installationId) || typeof item.configDigest !== 'string' || !digestPattern.test(item.configDigest) || typeof item.distributionDigest !== 'string' || !digestPattern.test(item.distributionDigest) || !platformFile || typeof item.definitionDigest !== 'string' || !digestPattern.test(item.definitionDigest) || typeof item.preparedAt !== 'string' || Number.isNaN(Date.parse(item.preparedAt)) || item.state !== 'service-prepared-inactive' || item.registered !== false || item.started !== false || item.autoStart !== false || item.singleClientOwner !== true || item.externalWritesEnabled !== false) throw new Error('client service preparation receipt is invalid')
  const options = { installRoot: '/private/validation', nodeExecutable: item.nodeExecutable, workspacePath: item.workspacePath, stdoutPath: item.stdoutPath, stderrPath: item.stderrPath, executablePath: item.executablePath }
  prepareInactiveClientLaunchd('__NODE_EXECUTABLE__ __CLIENT_ENTRY__ __PROGRAM_ROOT__ __INSTALL_ROOT__ __WORKSPACE_PATH__ __EXEC_PATH__ __STDOUT_PATH__ __STDERR_PATH__', options as ClientServiceRenderOptionsV1)
  return Object.freeze(item as unknown as InstalledClientServicePreparationReceiptV1)
}

function templatePath(root: string, platform: InstalledClientServicePreparationInputV1['platform']): string { return join(root, platform === 'launchd-user' ? 'program/deploy/launchd/com.quarkfan.quark-client.plist.template' : 'program/deploy/systemd/quark-client.service.template') }
async function exactExistingRoot(value: string): Promise<string> { if (!isAbsolute(value) || resolve(value) !== value || value === '/' || await realpath(value) !== value) throw new Error('client service installation root is invalid'); return value }
async function privateDirectory(path: string): Promise<void> { const state = await lstat(path); const uid = process.getuid?.(); if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('client service directory is unsafe') }
async function readPrivate(path: string, max: number): Promise<Buffer> { const state = await lstat(path); const uid = process.getuid?.(); if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1 || (state.mode & 0o077) !== 0 || state.size < 1 || state.size > max || await realpath(path) !== path || (uid !== undefined && state.uid !== uid)) throw new Error('client service file is unsafe'); return await readFile(path) }
async function writePrivate(path: string, bytes: Uint8Array): Promise<void> { const handle = await open(path, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() } }
