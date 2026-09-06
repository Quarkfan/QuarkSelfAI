export type CapabilityInterfaceKind = 'tool' | 'port' | 'event' | 'resource' | 'ui' | 'runtime' | 'experience'

export interface CapabilityInterfaceV1 {
  readonly kind: CapabilityInterfaceKind
  readonly id: string
  readonly version: string
  readonly direction: 'provides' | 'requires'
  readonly inputSchema?: string
  readonly outputSchema?: string
  readonly compatibility: readonly string[]
}

export interface CapabilityContributionV1 {
  readonly contributionId: string
  readonly interfaceId: string
  readonly factoryKind: 'tool' | 'context-enricher' | 'workflow' | 'effect-handler' | 'surface' | 'runtime-adapter'
}

export interface CapabilityRegistrationV1 {
  readonly manifestId: string
  readonly manifestVersion: string
  readonly artifactDigest: string
  /** Registration is descriptive and cannot start a consumer, scheduler, provider or effect. */
  readonly contributions: readonly CapabilityContributionV1[]
}

export interface CapabilityHostPortsV1 {
  readonly protocolVersion: '1'
  readonly supportedInterfaces: readonly CapabilityInterfaceKind[]
  readonly supportedPlacements: readonly ('local' | 'cloud' | 'hybrid')[]
  readonly supportsInactiveRegistration: true
}

