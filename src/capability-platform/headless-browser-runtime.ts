export interface HeadlessBrowserLaunchV1 {
  readonly schemaVersion: 1
  readonly profile: 'ephemeral'
  readonly network: 'denied' | 'blueprint-allowlist'
  readonly downloads: 'denied'
  readonly workspaceAccess: 'denied' | 'approved-read' | 'approved-write'
  readonly desktopVisible: false
  readonly externalWritesEnabled: false
}

export interface HeadlessBrowserSessionV1 {
  readonly sessionId: string
  readonly state: 'started' | 'stopped'
  readonly profile: 'ephemeral'
  readonly externalWritesEnabled: false
}

export interface HeadlessBrowserHostPortV1 {
  start(request: HeadlessBrowserLaunchV1): Promise<HeadlessBrowserSessionV1>
  stop(sessionId: string): Promise<HeadlessBrowserSessionV1>
}

/** Validates a cloud-authored declaration without launching a browser. */
export function validateHeadlessBrowserLaunchV1(value: unknown): HeadlessBrowserLaunchV1 {
  if (!record(value) || Object.keys(value).sort().join(',') !== ['desktopVisible','downloads','externalWritesEnabled','network','profile','schemaVersion','workspaceAccess'].sort().join(',')) throw new Error('headless browser launch must use the closed v1 schema')
  if (value.schemaVersion !== 1 || value.profile !== 'ephemeral' || value.downloads !== 'denied' || value.desktopVisible !== false || value.externalWritesEnabled !== false) throw new Error('headless browser launch expands local effects')
  if (!['denied', 'blueprint-allowlist'].includes(String(value.network)) || !['denied', 'approved-read', 'approved-write'].includes(String(value.workspaceAccess))) throw new Error('headless browser launch scope is invalid')
  return Object.freeze(value as unknown as HeadlessBrowserLaunchV1)
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
