import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

export interface SshGatewayInstallPlanInputV1 { readonly osUser: string; readonly nodeExecutable: string; readonly subsystemEntry: string; readonly subsystemConfig: string; readonly authorizedPublicKey: string; readonly sshdDropInPath: string; readonly authorizedKeysPath: string }
export interface PreparedSshGatewayInstallPlanV1 { readonly schemaVersion: 1; readonly osUser: string; readonly requiredOpenSsh: '>=7.2'; readonly sshdMatchBlock: string; readonly authorizedKeyLine: string; readonly sshdDropInPath: string; readonly authorizedKeysPath: string; readonly planDigest: string; readonly state: 'prepared-inactive'; readonly applyAllowed: false; readonly reloadAllowed: false; readonly externalEffectsEnabled: false; readonly rollback: { readonly removeAuthorizedKeyFirst: true; readonly removeDropInSecond: true; readonly reloadOnlyAfterValidation: true; readonly preserveServerState: true } }

/** Renders reviewable OpenSSH artifacts. It never writes files, creates users or reloads sshd. */
export function prepareSshGatewayInstallPlanV1(input: SshGatewayInstallPlanInputV1): PreparedSshGatewayInstallPlanV1 {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(input.osUser) || input.osUser === 'root') throw new Error('SSH gateway OS user is invalid')
  for (const [name, value] of Object.entries(input).filter(([name]) => name !== 'osUser' && name !== 'authorizedPublicKey')) exactPath(String(value), name)
  if (!validEd25519Key(input.authorizedPublicKey) || /[\r\n"]/.test(input.authorizedPublicKey)) throw new Error('SSH gateway public key is invalid')
  const command = `QUARK_SSH_SUBSYSTEM_ENABLE=1 ${input.nodeExecutable} ${input.subsystemEntry} quark-device-v1 ${input.subsystemConfig}`
  const authorizedKeyLine = `restrict,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,command="${command}" ${input.authorizedPublicKey}\n`
  const sshdMatchBlock = `Match User ${input.osUser}\n  AuthenticationMethods publickey\n  PasswordAuthentication no\n  KbdInteractiveAuthentication no\n  PermitEmptyPasswords no\n  AllowTcpForwarding no\n  AllowAgentForwarding no\n  X11Forwarding no\n  PermitTTY no\n  PermitTunnel no\n  GatewayPorts no\n`
  const unsigned = { schemaVersion: 1 as const, osUser: input.osUser, requiredOpenSsh: '>=7.2' as const, sshdMatchBlock, authorizedKeyLine, sshdDropInPath: input.sshdDropInPath, authorizedKeysPath: input.authorizedKeysPath, state: 'prepared-inactive' as const, applyAllowed: false as const, reloadAllowed: false as const, externalEffectsEnabled: false as const, rollback: { removeAuthorizedKeyFirst: true as const, removeDropInSecond: true as const, reloadOnlyAfterValidation: true as const, preserveServerState: true as const } }
  return deepFreeze({ ...unsigned, planDigest: `sha256:${createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')}` })
}

function exactPath(value: string, label: string): void { if (!isAbsolute(value) || resolve(value) !== value || value === '/' || /[\s"'\\\0]/.test(value)) throw new Error(`SSH gateway ${label} must be an exact shell-safe absolute path`) }
function validEd25519Key(value: string): boolean { const match = /^ssh-ed25519 ([A-Za-z0-9+/]+={0,2})(?: [a-zA-Z0-9._@-]{1,64})?$/.exec(value); if (!match) return false; const bytes = Buffer.from(match[1]!, 'base64'); return bytes.byteLength === 51 && bytes.readUInt32BE(0) === 11 && bytes.subarray(4, 15).toString('ascii') === 'ssh-ed25519' && bytes.readUInt32BE(15) === 32 }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value) }; return value }
