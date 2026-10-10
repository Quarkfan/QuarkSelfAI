import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installInactiveClient, recoverInactiveClientInstallation, uninstallUnusedInactiveClient, type InactiveClientInstallationInputV1 } from './client-installation.js'
import { prepareInstalledClientUserServiceV1, recoverPreparedClientUserServiceV1, removeUnregisteredClientUserServiceV1, type InstalledClientServicePreparationInputV1 } from './client-installed-service.js'
import { activateInstalledClientUserServiceV1, deactivateInstalledClientUserServiceV1, reconcileInstalledClientUserServiceActivationV1, recoverInstalledClientUserServiceActivationV1, type InstalledClientServiceActivationInputV1 } from './client-service-activation.js'
import { LaunchctlClientUserServiceManagerV1 } from './launchctl-client-service-manager.js'

type InstallerCommandV1 =
  | { readonly mode: 'install'; readonly distributionRoot: string; readonly installRoot: string; readonly configPath: string }
  | { readonly mode: 'prepare-service'; readonly installRoot: string; readonly configPath: string }
  | { readonly mode: 'activate-service' | 'reconcile-service'; readonly installRoot: string; readonly configPath: string }
  | { readonly mode: 'status'; readonly installRoot: string }
  | { readonly mode: 'service-status' | 'activation-status' | 'deactivate-service'; readonly installRoot: string }
  | { readonly mode: 'remove-unregistered-service'; readonly installRoot: string }
  | { readonly mode: 'uninstall-unused'; readonly installRoot: string }

export function compileClientInstallerCommand(argv: readonly string[]): InstallerCommandV1 {
  if (argv[0] === 'install' && argv.length === 4) return Object.freeze({ mode: 'install', distributionRoot: exactPath(argv[1]!), installRoot: exactPath(argv[2]!), configPath: exactPath(argv[3]!) })
  if (argv[0] === 'prepare-service' && argv.length === 3) return Object.freeze({ mode: 'prepare-service', installRoot: exactPath(argv[1]!), configPath: exactPath(argv[2]!) })
  if (['activate-service', 'reconcile-service'].includes(argv[0] ?? '') && argv.length === 3) return Object.freeze({ mode: argv[0] as 'activate-service' | 'reconcile-service', installRoot: exactPath(argv[1]!), configPath: exactPath(argv[2]!) })
  if (['status', 'service-status', 'activation-status', 'deactivate-service', 'remove-unregistered-service', 'uninstall-unused'].includes(argv[0] ?? '') && argv.length === 2) return Object.freeze({ mode: argv[0] as 'status' | 'service-status' | 'activation-status' | 'deactivate-service' | 'remove-unregistered-service' | 'uninstall-unused', installRoot: exactPath(argv[1]!) })
  throw new Error('client installer command is invalid')
}

export async function runClientInstallerEntry(argv = process.argv.slice(2), environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const command = compileClientInstallerCommand(argv)
  if (command.mode === 'status') { emitInstallation((await recoverInactiveClientInstallation(command.installRoot)).receipt); return }
  if (command.mode === 'service-status') { emitService(await recoverPreparedClientUserServiceV1(command.installRoot)); return }
  if (command.mode === 'activation-status') { emitActivation(await recoverInstalledClientUserServiceActivationV1(command.installRoot, new LaunchctlClientUserServiceManagerV1())); return }
  if (['activate-service', 'reconcile-service', 'deactivate-service'].includes(command.mode) && environment.QUARK_CLIENT_ADMIN_ENABLE !== '1') throw new Error('client service activation commands are disabled')
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
function exactInstallConfig(value: unknown, distributionSourcePath: string, installRoot: string): InactiveClientInstallationInputV1 { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client installer config is invalid'); const item = value as Record<string, unknown>; const keys = ['clientVersion', 'controlPlaneEndpoint', 'tenantId', 'userId', 'deviceId', 'privateKeyRef', 'keychainAccount', 'planVerification']; if (Object.keys(item).sort().join(',') !== keys.sort().join(',')) throw new Error('client installer config is invalid'); return { ...item, installRoot, distributionSourcePath } as unknown as InactiveClientInstallationInputV1 }
function exactServiceConfig(value: unknown, installRoot: string): InstalledClientServicePreparationInputV1 { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client service config is invalid'); const item = value as Record<string, unknown>; const keys = ['platform', 'nodeExecutable', 'workspacePath', 'stdoutPath', 'stderrPath', 'executablePath']; if (Object.keys(item).sort().join(',') !== keys.sort().join(',')) throw new Error('client service config is invalid'); return { ...item, installRoot } as unknown as InstalledClientServicePreparationInputV1 }
function exactActivationConfig(value: unknown, installRoot: string): InstalledClientServiceActivationInputV1 { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client service activation config is invalid'); const item = value as Record<string, unknown>; if (Object.keys(item).sort().join(',') !== 'definitionTargetPath') throw new Error('client service activation config is invalid'); return { ...item, installRoot } as unknown as InstalledClientServiceActivationInputV1 }
function exactPath(value: string): string { if (!value.startsWith('/') || resolve(value) !== value || value === '/') throw new Error('client installer path must be exact and absolute'); return value }
function emitInstallation(receipt: Awaited<ReturnType<typeof uninstallUnusedInactiveClient>>): void { process.stdout.write(`${JSON.stringify({ schemaVersion: 1, installationId: receipt.installationId, clientVersion: receipt.clientVersion, sourceRevision: receipt.sourceRevision, distributionDigest: receipt.distributionDigest, state: receipt.state, autoStart: false, externalWritesEnabled: false })}\n`) }
function emitService(receipt: Awaited<ReturnType<typeof recoverPreparedClientUserServiceV1>>): void { process.stdout.write(`${JSON.stringify({ schemaVersion: 1, installationId: receipt.installationId, platform: receipt.platform, definitionDigest: receipt.definitionDigest, state: receipt.state, registered: false, started: false, autoStart: false, externalWritesEnabled: false })}\n`) }
function emitActivation(receipt: Awaited<ReturnType<typeof recoverInstalledClientUserServiceActivationV1>>): void { process.stdout.write(`${JSON.stringify({ schemaVersion: 1, installationId: receipt.installationId, platform: receipt.platform, definitionDigest: receipt.definitionDigest, state: receipt.state, registered: true, started: true, autoStart: true, health: receipt.health, externalWritesEnabled: false })}\n`) }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url && fileURLToPath(import.meta.url) === resolve(process.argv[1])) runClientInstallerEntry().catch(() => { process.stderr.write('Client installer failed: validation-or-lifecycle-failure\n'); process.exitCode = 1 })
