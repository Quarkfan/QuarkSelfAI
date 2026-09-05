import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import { parseJsonDocument, isRecord } from '../src/lark/json.js'

export type AccountStatus = 'ready' | 'configured' | 'unverified' | 'reauth-required' | 'unavailable'

type AccountSpec = {
  id: string
  class: string
  required: boolean
  loginHint: string
}

type AccountManifest = {
  schemaVersion: number
  projectId: string
  accounts: AccountSpec[]
}

export type CommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  unavailable?: boolean
  timedOut?: boolean
}

export interface AccountCommandRunner {
  run(command: string, args: readonly string[], options?: { cwd?: string; timeoutMs?: number }): Promise<CommandResult>
}

class ProcessAccountCommandRunner implements AccountCommandRunner {
  async run(command: string, args: readonly string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<CommandResult> {
    return await new Promise(resolveResult => {
      execFileCallback(command, [...args], {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 20_000,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        const code = error && 'code' in error ? error.code : 0
        resolveResult({
          exitCode: typeof code === 'number' ? code : error ? null : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          ...(code === 'ENOENT' ? { unavailable: true } : {}),
          ...(error && 'killed' in error && error.killed ? { timedOut: true } : {}),
        })
      })
    })
  }
}

export type AccountBootstrapOptions = {
  projectRoot: string
  environment: Record<string, string | undefined>
  online?: boolean
  runner?: AccountCommandRunner
}

export type AccountCheck = {
  id: string
  class: string
  required: boolean
  status: AccountStatus
  verification: 'local' | 'online' | 'configuration'
  reason: string
  loginHint: string
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function statusFromCommand(result: CommandResult, success: boolean, online: boolean): Pick<AccountCheck, 'status' | 'verification' | 'reason'> {
  if (result.unavailable) return { status: 'unavailable', verification: online ? 'online' : 'local', reason: 'command-unavailable' }
  if (result.timedOut) return { status: 'unavailable', verification: online ? 'online' : 'local', reason: 'verification-timeout' }
  if (result.exitCode !== 0 || !success) return { status: 'reauth-required', verification: online ? 'online' : 'local', reason: 'authentication-not-ready' }
  return { status: 'ready', verification: online ? 'online' : 'local', reason: online ? 'read-only-verification-succeeded' : 'local-login-state-ready' }
}

function record(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const item = value[key]
  return isRecord(item) ? item : undefined
}

function larkIdentityReady(output: string, identity: 'user' | 'bot'): boolean {
  try {
    const document = parseJsonDocument(output)
    const identities = record(document, 'identities')
    const value = identities?.[identity]
    return isRecord(value) && value.available === true && value.status === 'ready'
  } catch {
    return false
  }
}

function claudeReady(output: string): boolean {
  try {
    const document = parseJsonDocument(output)
    return isRecord(document) && document.loggedIn === true
  } catch {
    return false
  }
}

async function configuredRuntimeSecrets(root: string, environment: Record<string, string | undefined>): Promise<boolean> {
  const required = ['QUARK_INFERENCE_BASE_URL', 'QUARK_INFERENCE_API_KEY']
  const present = new Set(required.filter(key => Boolean(environment[key]?.trim())))
  try {
    const source = await readFile(resolve(root, 'var/runtime.env'), 'utf8')
    for (const raw of source.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const separator = line.indexOf('=')
      if (separator < 1) continue
      const key = line.slice(0, separator)
      if (required.includes(key) && line.slice(separator + 1).trim()) present.add(key)
    }
  } catch {
    // A clean clone normally has no runtime.env; environment injection remains valid.
  }
  return required.every(key => present.has(key))
}

async function loadManifest(root: string): Promise<AccountManifest> {
  const manifest = JSON.parse(await readFile(resolve(root, 'config/account-bootstrap.json'), 'utf8')) as AccountManifest
  if (manifest.schemaVersion !== 1 || manifest.projectId !== 'quarkselfai' || !Array.isArray(manifest.accounts)) {
    throw new Error('unsupported account bootstrap manifest')
  }
  const ids = new Set<string>()
  for (const account of manifest.accounts) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(account.id) || ids.has(account.id)) {
      throw new Error('account bootstrap manifest contains an invalid or duplicate id')
    }
    ids.add(account.id)
  }
  return manifest
}

export async function auditAccountBootstrap(options: AccountBootstrapOptions) {
  const root = resolve(options.projectRoot)
  const runner = options.runner ?? new ProcessAccountCommandRunner()
  const manifest = await loadManifest(root)
  const online = options.online === true
  let larkResult: Promise<CommandResult> | undefined
  const runLark = () => larkResult ??= runner.run('lark-cli', ['auth', 'status', '--json', ...(online ? ['--verify'] : [])], { cwd: root })
  const checks: AccountCheck[] = []

  for (const account of manifest.accounts) {
    let result: Pick<AccountCheck, 'status' | 'verification' | 'reason'>
    if (account.id === 'github') {
      if (!online) result = { status: 'unverified', verification: 'local', reason: 'online-read-check-not-requested' }
      else {
        const command = await runner.run('git', ['ls-remote', '--exit-code', 'origin', 'HEAD'], { cwd: root })
        result = statusFromCommand(command, command.exitCode === 0, true)
      }
    } else if (account.id === 'codex') {
      const command = await runner.run('codex', ['login', 'status'], { cwd: root })
      result = statusFromCommand(command, /logged in/i.test(`${command.stdout}\n${command.stderr}`), false)
    } else if (account.id === 'claude') {
      const command = await runner.run('claude', ['auth', 'status', '--json'], { cwd: root })
      result = statusFromCommand(command, claudeReady(command.stdout), false)
    } else if (account.id === 'lark-user' || account.id === 'lark-bot') {
      const command = await runLark()
      result = statusFromCommand(command, larkIdentityReady(command.stdout, account.id === 'lark-user' ? 'user' : 'bot'), online)
    } else if (account.id === 'dida') {
      const local = await runner.run('dida', ['auth', 'status'], { cwd: root })
      if (local.exitCode !== 0 || local.unavailable || local.timedOut) {
        result = statusFromCommand(local, false, false)
      } else if (!online) {
        result = statusFromCommand(local, true, false)
      } else {
        const command = await runner.run('dida', ['project', 'list'], { cwd: root })
        result = statusFromCommand(command, command.exitCode === 0, true)
      }
    } else if (account.id === 'dsh-runtime') {
      try {
        const document = JSON.parse(await readFile(resolve(root, 'deploy/dsh-runtime/package.json'), 'utf8')) as { dependencies?: Record<string, string> }
        const ready = Boolean(document.dependencies?.['@deepseek-ai/dsh'])
        result = ready
          ? { status: 'ready', verification: 'local', reason: 'locked-runtime-declared' }
          : { status: 'unavailable', verification: 'local', reason: 'locked-runtime-missing' }
      } catch {
        result = { status: 'unavailable', verification: 'local', reason: 'locked-runtime-missing' }
      }
    } else if (account.id === 'dsh-inference') {
      result = await configuredRuntimeSecrets(root, options.environment)
        ? { status: 'configured', verification: 'configuration', reason: 'provider-secret-and-endpoint-configured' }
        : { status: 'reauth-required', verification: 'configuration', reason: 'provider-secret-or-endpoint-missing' }
    } else {
      throw new Error(`account bootstrap check is not implemented: ${account.id}`)
    }
    checks.push({ ...account, ...result })
  }

  const blockers = checks
    .filter(check => check.required && check.status !== 'ready' && check.status !== 'configured')
    .map(check => `${check.id}:${check.reason}`)
  return {
    ok: blockers.length === 0,
    projectId: manifest.projectId,
    onlineVerificationRequested: online,
    checkedAt: new Date().toISOString(),
    checks,
    blockers,
    privacy: {
      commandOutputIncluded: false,
      credentialValuesIncluded: false,
      personalIdentifiersIncluded: false,
    },
  }
}

async function main(): Promise<void> {
  const report = await auditAccountBootstrap({
    projectRoot,
    environment: process.env,
    online: process.argv.includes('--online'),
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (process.argv.includes('--strict') && !report.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}
