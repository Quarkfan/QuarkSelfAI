import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

interface AuthorizationRequest extends Readonly<Record<string, unknown>> {
  readonly schemaVersion: number
  readonly requestId: string
  readonly revision: number
  readonly status: string
  readonly implementationBaselineRevision: string
  readonly authorizationFingerprint: string
  readonly approvalPhrase: string
  readonly notificationPolicy: string
  readonly implementationScope: {
    readonly moduleIds: readonly string[]
    readonly reuseOnlyModuleIds: readonly string[]
    readonly forbiddenChanges: readonly string[]
  }
  readonly explicitExclusions: readonly string[]
}

const requestPath = 'docs/operations/pre-meeting-briefing-pilot-01-authorization-request.json'
const sha1Pattern = /^[0-9a-f]{40}$/u
const sha256Pattern = /^[0-9a-f]{64}$/u
const execFileAsync = promisify(execFile)
const expectedTopLevelKeys = [
  'allowedActions', 'approvalPhrase', 'authorizationFingerprint', 'compatibility', 'dataSources', 'evaluation',
  'evidence', 'explicitExclusions', 'implementationBaselineRevision', 'implementationScope', 'notDoingCost',
  'notificationPolicy', 'perInstanceConfirmation', 'purpose', 'requestId', 'revision', 'rollback', 'schemaVersion',
  'status', 'trigger',
]

export function authorizationFingerprint(request: Readonly<Record<string, unknown>>): string {
  const payload = Object.fromEntries(Object.entries(request).filter(([key]) => !['approvalPhrase', 'authorizationFingerprint', 'status'].includes(key)))
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

export async function auditMeetingBriefingAuthorization(root = process.cwd(), verifyRepository = true): Promise<Readonly<Record<string, unknown>>> {
  const request = JSON.parse(await readFile(resolve(root, requestPath), 'utf8')) as AuthorizationRequest
  exactKeys(request, expectedTopLevelKeys, 'authorization request')
  invariant(request.schemaVersion === 2, 'unsupported meeting briefing authorization schema')
  invariant(request.requestId === 'pre-meeting-briefing-pilot-01', 'unexpected authorization request id')
  invariant(request.revision === 3, 'meeting briefing authorization must remain revision 3')
  invariant(request.status === 'awaiting-exact-owner-approval', 'authorization request must remain awaiting exact owner approval')
  invariant(sha1Pattern.test(request.implementationBaselineRevision), 'implementation baseline must be an exact Git revision')
  if (verifyRepository) {
    await git(root, ['cat-file', '-e', `${request.implementationBaselineRevision}^{commit}`], 'implementation baseline does not resolve to a commit')
    await git(root, ['merge-base', '--is-ancestor', request.implementationBaselineRevision, 'HEAD'], 'implementation baseline is not an ancestor of HEAD')
  }
  invariant(sha256Pattern.test(request.authorizationFingerprint), 'authorization fingerprint must be SHA-256')
  const computedFingerprint = authorizationFingerprint(request)
  invariant(request.authorizationFingerprint === computedFingerprint, 'authorization request fingerprint drifted')
  invariant(
    request.approvalPhrase === `批准 pre-meeting-briefing-pilot-01 revision 3，授权指纹 ${computedFingerprint}，仅执行静默只读影子试运行。`,
    'approval phrase does not bind the exact request fingerprint',
  )
  invariant(
    request.notificationPolicy === 'Silent for the entire revision 3 shadow pilot. Any owner-visible delivery requires a new revision and separate approval.',
    'notification policy does not bind the current request revision',
  )

  exactKeys(request.implementationScope, ['forbiddenChanges', 'moduleIds', 'reuseOnlyModuleIds'], 'implementation scope')
  uniqueNonEmpty(request.implementationScope.moduleIds, 'implementationScope.moduleIds')
  uniqueNonEmpty(request.implementationScope.reuseOnlyModuleIds, 'implementationScope.reuseOnlyModuleIds')
  uniqueNonEmpty(request.implementationScope.forbiddenChanges, 'implementationScope.forbiddenChanges')
  invariant(request.implementationScope.moduleIds.length === 1 && request.implementationScope.moduleIds[0] === 'meeting-briefing-planner', 'pilot must remain in the existing meeting briefing module')
  for (const forbidden of ['new-consumer', 'new-scheduler', 'new-writer', 'new-effect', 'runtime-dependency-change', 'dsh-cordis-composition-change']) {
    invariant(request.implementationScope.forbiddenChanges.includes(forbidden), `missing forbidden change: ${forbidden}`)
  }
  for (const exclusion of ['send a Feishu message or any other notification, even to the owner', 'add a scheduler, event consumer, provider graph, database owner or external write effect', 'change DSH/Cordis composition, credentials, permissions, runtime dependencies or the active LaunchAgent']) {
    invariant(request.explicitExclusions.includes(exclusion), `missing explicit exclusion: ${exclusion}`)
  }

  const catalog = JSON.parse(await readFile(resolve(root, 'config/module-catalog.json'), 'utf8')) as { modules?: readonly Readonly<Record<string, unknown>>[] }
  const module = catalog.modules?.find(candidate => candidate.id === 'meeting-briefing-planner')
  invariant(module?.runtime === 'inactive', 'meeting briefing module must remain runtime-inactive')
  invariant(!('plugin' in (module ?? {})), 'meeting briefing module must not have runtime plugin activation')
  invariant(Array.isArray(module?.owns) && module.owns.length === 1 && module.owns[0] === 'src/meeting-briefing/planner.ts', 'meeting briefing module ownership expanded before approval')

  return {
    ok: true,
    requestId: request.requestId,
    revision: request.revision,
    status: request.status,
    implementationBaselineRevision: request.implementationBaselineRevision,
    authorizationFingerprint: request.authorizationFingerprint,
    scopedModuleCount: request.implementationScope.moduleIds.length,
    reusedBoundaryCount: request.implementationScope.reuseOnlyModuleIds.length,
    forbiddenChangeCount: request.implementationScope.forbiddenChanges.length,
    runtimeActive: false,
    approvalRecorded: false,
    privacy: { rawContentIncluded: false, credentialValuesIncluded: false, absolutePathsIncluded: false },
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function exactKeys(value: object, expected: readonly string[], name: string): void {
  invariant(Object.keys(value).sort().join(',') === [...expected].sort().join(','), `${name} contains unsupported fields`)
}

function uniqueNonEmpty(values: readonly string[], name: string): void {
  invariant(Array.isArray(values) && values.length > 0, `${name} must be non-empty`)
  invariant(values.every(value => typeof value === 'string' && value.trim().length > 0), `${name} contains an invalid value`)
  invariant(new Set(values).size === values.length, `${name} contains duplicates`)
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function git(root: string, args: readonly string[], message: string): Promise<void> {
  try {
    await execFileAsync('git', ['-C', root, ...args], { timeout: 5_000 })
  } catch {
    throw new Error(message)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  auditMeetingBriefingAuthorization().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error instanceof Error ? error.message : 'meeting briefing authorization audit failed')
    process.exitCode = 1
  })
}
