import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installInactiveClient, recoverInactiveClientInstallation, uninstallUnusedInactiveClient, type InactiveClientInstallationInputV1 } from './client-installation.js'
import { prepareInstalledClientUserServiceV1, recoverPreparedClientUserServiceV1, removeUnregisteredClientUserServiceV1, type InstalledClientServicePreparationInputV1 } from './client-installed-service.js'
import { activateInstalledClientUserServiceV1, deactivateInstalledClientUserServiceV1, reconcileInstalledClientUserServiceActivationV1, recoverInstalledClientUserServiceActivationV1, type InstalledClientServiceActivationInputV1 } from './client-service-activation.js'
import { LaunchctlClientUserServiceManagerV1 } from './launchctl-client-service-manager.js'
import { InactiveConfiguredLocalClientV1 } from './configured-local-client.js'
import { inspectInstalledDshInferenceSecretV1, provisionInstalledDshInferenceSecretV1, removeInstalledDshInferenceSecretV1 } from './client-secret-provisioning.js'
import { beginInstalledClientEnrollmentV1, pollInstalledClientEnrollmentV1, type InstalledClientEnrollmentReceiptV1 } from './client-enrollment-administration.js'

type InstallerCommandV1 =
  | { readonly mode: 'install'; readonly distributionRoot: string; readonly installRoot: string; readonly configPath: string }
  | { readonly mode: 'prepare-service'; readonly installRoot: string; readonly configPath: string }
  | { readonly mode: 'activate-service' | 'reconcile-service'; readonly installRoot: string; readonly configPath: string }
  | { readonly mode: 'status'; readonly installRoot: string }
  | { readonly mode: 'service-status' | 'activation-status' | 'deactivate-service' | 'provision-master-key' | 'provision-dsh-secret' | 'dsh-secret-status' | 'remove-dsh-secret' | 'begin-enrollment' | 'poll-enrollment'; readonly installRoot: string }
  | { readonly mode: 'remove-unregistered-service'; readonly installRoot: string }
  | { readonly mode: 'uninstall-unused'; readonly installRoot: string }

export function compileClientInstallerCommand(argv: readonly string[]): InstallerCommandV1 {
  if (argv[0] === 'install' && argv.length === 4) return Object.freeze({ mode: 'install', distributionRoot: exactPath(argv[1]!), installRoot: exactPath(argv[2]!), configPath: exactPath(argv[3]!) })
  if (argv[0] === 'prepare-service' && argv.length === 3) return Object.freeze({ mode: 'prepare-service', installRoot: exactPath(argv[1]!), configPath: exactPath(argv[2]!) })
  if (['activate-service', 'reconcile-service'].includes(argv[0] ?? '') && argv.length === 3) return Object.freeze({ mode: argv[0] as 'activate-service' | 'reconcile-service', installRoot: exactPath(argv[1]!), configPath: exactPath(argv[2]!) })
  if (['status', 'service-status', 'activation-status', 'deactivate-service', 'provision-master-key', 'provision-dsh-secret', 'dsh-secret-status', 'remove-dsh-secret', 'begin-enrollment', 'poll-enrollment', 'remove-unregistered-service', 'uninstall-unused'].includes(argv[0] ?? '') && argv.length === 2) return Object.freeze({ mode: argv[0] as 'status' | 'service-status' | 'activation-status' | 'deactivate-service' | 'provision-master-key' | 'provision-dsh-secret' | 'dsh-secret-status' | 'remove-dsh-secret' | 'begin-enrollment' | 'poll-enrollment' | 'remove-unregistered-service' | 'uninstall-unused', installRoot: exactPath(argv[1]!) })
  throw new Error('client installer command is invalid')
}

export async function runClientInstallerEntry(argv = process.argv.slice(2), environment: NodeJS.ProcessEnv = process.env, secretInput: AsyncIterable<Buffer | string> = process.stdin): Promise<void> {
  const command = compileClientInstallerCommand(argv)
  if (command.mode === 'status') { emitInstallation((await recoverInactiveClientInstallation(command.installRoot)).receipt); return }
  if (command.mode === 'service-status') { emitService(await recoverPreparedClientUserServiceV1(command.installRoot)); return }
  if (command.mode === 'activation-status') { emitActivation(await recoverInstalledClientUserServiceActivationV1(command.installRoot, new LaunchctlClientUserServiceManagerV1())); return }
  if (['activate-service', 'reconcile-service', 'deactivate-service', 'provision-master-key', 'provision-dsh-secret', 'remove-dsh-secret', 'begin-enrollment', 'poll-enrollment'].includes(command.mode) && environment.QUARK_CLIENT_ADMIN_ENABLE !== '1') throw new Error('client lifecycle mutation commands are disabled')
  if (['begin-enrollment', 'poll-enrollment'].includes(command.mode) && environment.QUARK_CLIENT_ENROLLMENT_ENABLE !== '1') throw new Error('client enrollment commands are disabled')
  if (command.mode === 'provision-master-key') { const installation = await recoverInactiveClientInstallation(command.installRoot); emitCredential(command.mode, installation.receipt.installationId, `master-key-${await InactiveConfiguredLocalClientV1.provisionMasterKey(installation.plan)}`); return }
  if (command.mode === 'provision-dsh-secret') { const value = await readSecret(secretInput); try { emitCredential(command.mode, (await provisionInstalledDshInferenceSecretV1(command.installRoot, value)).installationId, 'dsh-inference-secret-configured') } finally { value.fill(0) }; return }
  if (command.mode === 'dsh-secret-status') { const receipt = await inspectInstalledDshInferenceSecretV1(command.installRoot); emitCredential(command.mode, receipt.installationId, receipt.state); return }
  if (command.mode === 'remove-dsh-secret') { const receipt = await removeInstalledDshInferenceSecretV1(command.installRoot); emitCredential(command.mode, receipt.installationId, receipt.state); return }
  if (command.mode === 'begin-enrollment') { emitEnrollment(await beginInstalledClientEnrollmentV1(command.installRoot)); return }
  if (command.mode === 'poll-enrollment') { emitEnrollment(await pollInstalledClientEnrollmentV1(command.installRoot)); return }
  if (command.mode === 'activate-service' || command.mode === 'reconcile-service') { const input = exactActivationConfig(await readPrivateConfig(command.configPath), command.installRoot); const manager = new LaunchctlClientUserServiceManagerV1(); const result = command.mode === 'activate-service' ? await activateInstalledClientUserServiceV1(input, manager) : await reconcileInstalledClientUserServiceActivationV1(input, manager); if (result) emitActivation(result); else emitService(await recoverPreparedClientUserServiceV1(command.installRoot)); return }
  if (command.mode === 'deactivate-service') { emitActivation(await deactivateInstalledClientUserServiceV1(command.installRoot, new LaunchctlClientUserServiceManagerV1())); return }
  if (command.mode === 'remove-unregistered-service') { emitService(await removeUnregisteredClientUserServiceV1(command.installRoot)); return }
  if (command.mode === 'uninstall-unused') { emitInstallation(await uninstallUnusedInactiveClient(command.installRoot)); return }
  if (command.mode === 'prepare-service') {
    const config = exactServiceConfig(await readPrivateConfig(command.configPath), command.installRoot)
    emitService(await prepareInstalledClientUserServiceV1(config)); return
  }
  if (command.mode !== 'install') throw new Error('client installer command is invalid')
  const config = await readPrivateConfig(command.configPath)
  const input = exactInstallConfig(config, command.distributionRoot, command.installRoot)
  emitInstallation((await installInactiveClient(input)).receipt)
}

async function readPrivateConfig(path: string): Promise<unknown> { const state = await lstat(path); if (!state.isFile() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || state.size <= 0 || state.size > 64 * 1024) throw new Error('client installer config is unsafe'); try { return JSON.parse(await readFile(path, 'utf8')) } catch { throw new Error('client installer config is invalid') } }
function exactInstallConfig(value: unknown, distributionSourcePath: string, installRoot: string): InactiveClientInstallationInputV1 { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client installer config is invalid'); const item = value as Record<string, unknown>; const keys = ['clientVersion', 'controlPlaneEndpoint', 'tenantId', 'userId', 'deviceId', 'privateKeyRef', 'keychainAccount', 'planVerification', ...(item.dshInference === undefined ? [] : ['dshInference'])]; if (Object.keys(item).sort().join(',') !== keys.sort().join(',')) throw new Error('client installer config is invalid'); return { ...item, installRoot, distributionSourcePath } as unknown as InactiveClientInstallationInputV1 }
function exactServiceConfig(value: unknown, installRoot: string): InstalledClientServicePreparationInputV1 { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client service config is invalid'); const item = value as Record<string, unknown>; const keys = ['platform', 'nodeExecutable', 'workspacePath', 'stdoutPath', 'stderrPath', 'executablePath', 'tlsCaCertificatePath']; if (Object.keys(item).sort().join(',') !== keys.sort().join(',')) throw new Error('client service config is invalid'); return { ...item, installRoot } as unknown as InstalledClientServicePreparationInputV1 }
function exactActivationConfig(value: unknown, installRoot: string): InstalledClientServiceActivationInputV1 { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client service activation config is invalid'); const item = value as Record<string, unknown>; if (Object.keys(item).sort().join(',') !== 'definitionTargetPath') throw new Error('client service activation config is invalid'); return { ...item, installRoot } as unknown as InstalledClientServiceActivationInputV1 }
function exactPath(value: string): string { if (!value.startsWith('/') || resolve(value) !== value || value === '/') throw new Error('client installer path must be exact and absolute'); return value }
function emitInstallation(receipt: Awaited<ReturnType<typeof uninstallUnusedInactiveClient>>): void { process.stdout.write(`${JSON.stringify({ schemaVersion: 1, installationId: receipt.installationId, clientVersion: receipt.clientVersion, sourceRevision: receipt.sourceRevision, distributionDigest: receipt.distributionDigest, state: receipt.state, autoStart: false, externalWritesEnabled: false })}\n`) }
function emitService(receipt: Awaited<ReturnType<typeof recoverPreparedClientUserServiceV1>>): void { process.stdout.write(`${JSON.stringify({ schemaVersion: 1, installationId: receipt.installationId, platform: receipt.platform, definitionDigest: receipt.definitionDigest, state: receipt.state, registered: false, started: false, autoStart: false, externalWritesEnabled: false })}\n`) }
function emitActivation(receipt: Awaited<ReturnType<typeof recoverInstalledClientUserServiceActivationV1>>): void { process.stdout.write(`${JSON.stringify({ schemaVersion: 1, installationId: receipt.installationId, platform: receipt.platform, definitionDigest: receipt.definitionDigest, state: receipt.state, registered: true, started: true, autoStart: true, health: receipt.health, externalWritesEnabled: false })}\n`) }
function emitCredential(operation: string, installationId: string, state: string): void { process.stdout.write(`${JSON.stringify({ schemaVersion: 1, operation, installationId, state, externalWritesEnabled: false })}\n`) }
function emitEnrollment(receipt: InstalledClientEnrollmentReceiptV1): void { process.stdout.write(`${JSON.stringify(receipt)}\n`) }
async function readSecret(input: AsyncIterable<Buffer | string>): Promise<Buffer> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of input) { const bytes = Buffer.from(chunk); size += bytes.byteLength; if (size > 8_194) { bytes.fill(0); for (const prior of chunks) prior.fill(0); throw new Error('client secret input is invalid') }; chunks.push(bytes) }; const value = Buffer.concat(chunks); for (const chunk of chunks) chunk.fill(0); let end = value.length; if (end && value[end - 1] === 10) { end -= 1; if (end && value[end - 1] === 13) end -= 1 }; const result = Buffer.from(value.subarray(0, end)); value.fill(0); if (!result.length || result.length > 8_192 || result.includes(0) || result.includes(10) || result.includes(13)) { result.fill(0); throw new Error('client secret input is invalid') }; return result }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url && fileURLToPath(import.meta.url) === resolve(process.argv[1])) runClientInstallerEntry().catch(() => { process.stderr.write('Client installer failed: validation-or-lifecycle-failure\n'); process.exitCode = 1 })
