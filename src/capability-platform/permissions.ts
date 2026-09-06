export type CapabilityPlacement = 'local' | 'cloud' | 'hybrid'

export type CapabilityPermissionKind =
  | 'workspace'
  | 'file'
  | 'browser'
  | 'desktop'
  | 'network'
  | 'secret-reference'
  | 'process'
  | 'container'
  | 'gpu'
  | 'port'
  | 'data'
  | 'external-effect'

export type CapabilityPermissionOperation =
  | 'discover'
  | 'read'
  | 'write'
  | 'execute'
  | 'connect'
  | 'listen'
  | 'render'
  | 'persist'

export interface CapabilityPermissionDeclarationV1 {
  readonly id: string
  readonly kind: CapabilityPermissionKind
  readonly operations: readonly CapabilityPermissionOperation[]
  /** Provider-neutral selector. Local absolute paths and secret values are forbidden. */
  readonly scope: string
  readonly placement: CapabilityPlacement
  readonly approval: 'none' | 'install' | 'session' | 'action'
  readonly required: boolean
  readonly dataClasses: readonly string[]
  readonly effect?: {
    readonly kind: string
    readonly externalWrite: boolean
    readonly writeVerificationRequired: boolean
  }
}

export interface WorkspaceGrantV1 {
  readonly handle: string
  readonly access: 'read' | 'read-write'
  readonly expiresAt: string
  readonly grantId: string
}

export interface ApprovalGrantV1 {
  readonly grantId: string
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly agentId: string
  readonly releaseDigest: string
  readonly actionId: string
  readonly effectKind: string
  readonly scope: string
  readonly grantedAt: string
  readonly expiresAt: string
  readonly singleUse: boolean
}

