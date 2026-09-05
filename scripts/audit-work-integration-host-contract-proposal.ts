import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface Proposal {
  readonly schemaVersion: number
  readonly proposalId: string
  readonly status: string
  readonly baseRevisions: Readonly<Record<string, string>>
  readonly architecture: Readonly<Record<string, unknown>>
  readonly implementationScope: Readonly<Record<string, readonly string[]>>
  readonly allowedActions: readonly string[]
  readonly explicitExclusions: readonly string[]
  readonly acceptanceGates: readonly string[]
  readonly rollback: Readonly<Record<string, unknown>>
  readonly activation: Readonly<Record<string, boolean>>
}

const shaPattern = /^[0-9a-f]{40}$/u

export async function auditWorkIntegrationHostContractProposal(root = process.cwd()): Promise<Readonly<Record<string, unknown>>> {
  const path = resolve(root, 'config/work-integration-host-contract-proposal.json')
  const proposal = JSON.parse(await readFile(path, 'utf8')) as Proposal
  invariant(proposal.schemaVersion === 1, 'unsupported host contract proposal schema')
  invariant(proposal.proposalId === 'phase-2-generic-host-contract-inactive', 'unexpected proposal id')
  invariant(proposal.status === 'awaiting-owner-approval', 'proposal must remain awaiting owner approval')
  invariant(Object.values(proposal.baseRevisions).every(value => shaPattern.test(value)), 'base revisions must be exact Git revisions')
  invariant(proposal.architecture.coreMayDependOnPrivatePack === false, 'core must not depend on the private pack')
  invariant(proposal.architecture.coreMayDependOnCompanyWorkspace === false, 'core must not depend on a company workspace')
  invariant(proposal.architecture.packMayImportCoreSource === false, 'pack must not import core source')
  invariant(proposal.architecture.packOwnsConsumers === false, 'pack must not own consumers')
  invariant(proposal.architecture.packOwnsDurableScheduler === false, 'pack must not own the durable scheduler')
  invariant(proposal.architecture.packOwnsApprovalTruth === false, 'pack must not own approval truth')
  invariant(proposal.architecture.packOwnsExecutorRouting === false, 'pack must not own executor routing')
  invariant(proposal.architecture.baseProfileMayNamePrivatePack === false, 'base profile must not name the private pack')
  invariant(Object.values(proposal.activation).every(value => value === false), 'all activation and cutover approvals must remain false')
  invariant(proposal.rollback.runtimeOrExternalStateRollbackRequired === false, 'inactive phase must not require runtime rollback')
  invariant(proposal.rollback.sourceDeletionAllowed === false, 'source deletion must remain excluded')
  for (const [name, values] of Object.entries(proposal.implementationScope)) uniqueNonEmpty(values, `implementationScope.${name}`)
  uniqueNonEmpty(proposal.allowedActions, 'allowedActions')
  uniqueNonEmpty(proposal.explicitExclusions, 'explicitExclusions')
  uniqueNonEmpty(proposal.acceptanceGates, 'acceptanceGates')
  for (const required of ['start-or-switch-consumer', 'activate-provider-or-external-write-effect', 'delete-or-move-mainline-work-domain-source', 'restart-service']) {
    invariant(proposal.explicitExclusions.includes(required), `missing explicit exclusion: ${required}`)
  }
  return {
    ok: true,
    proposalId: proposal.proposalId,
    status: proposal.status,
    baseRevisionCount: Object.keys(proposal.baseRevisions).length,
    scopedFileCount: new Set(Object.values(proposal.implementationScope).flat()).size,
    allowedActionCount: proposal.allowedActions.length,
    explicitExclusionCount: proposal.explicitExclusions.length,
    acceptanceGateCount: proposal.acceptanceGates.length,
    activationApprovedCount: Object.values(proposal.activation).filter(Boolean).length,
    privacy: { fileContentsIncluded: false, credentialValuesIncluded: false, businessMessagesIncluded: false },
  }
}

function uniqueNonEmpty(values: readonly string[], name: string): void {
  invariant(Array.isArray(values) && values.length > 0, `${name} must be non-empty`)
  invariant(values.every(value => typeof value === 'string' && value.trim().length > 0), `${name} contains an invalid value`)
  invariant(new Set(values).size === values.length, `${name} contains duplicates`)
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  auditWorkIntegrationHostContractProposal().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error instanceof Error ? error.message : 'host contract proposal audit failed')
    process.exitCode = 1
  })
}
