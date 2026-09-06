import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'

export interface ClientServiceRenderOptionsV1 {
  readonly installRoot: string
  readonly nodeExecutable: string
  readonly workspacePath: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly executablePath: string
}

export interface PreparedClientServiceV1 {
  readonly schemaVersion: 1
  readonly platform: 'launchd' | 'systemd'
  readonly definition: string
  readonly definitionDigest: string
  readonly state: 'prepared-inactive'
  readonly registered: false
  readonly started: false
  readonly externalWritesEnabled: false
  readonly rollback: { readonly stopBeforeRemove: true; readonly removeDefinitionOnly: true; readonly preserveInstallationState: true }
}

/** Produces a LaunchAgent definition only. It never writes, registers or starts it. */
export function prepareInactiveClientLaunchd(template: string, options: ClientServiceRenderOptionsV1): PreparedClientServiceV1 {
  const values = checked(options)
  return prepared('launchd', replace(template, {
    __NODE_EXECUTABLE__: xml(values.nodeExecutable), __CLIENT_ENTRY__: xml(join(values.installRoot, 'program/dist/client-runtime/client-entry.js')),
    __PROGRAM_ROOT__: xml(join(values.installRoot, 'program')), __INSTALL_ROOT__: xml(values.installRoot), __WORKSPACE_PATH__: xml(values.workspacePath),
    __EXEC_PATH__: xml(values.executablePath), __STDOUT_PATH__: xml(values.stdoutPath), __STDERR_PATH__: xml(values.stderrPath),
  }))
}

/** Produces a systemd user/service definition only. It never writes, enables or starts it. */
export function prepareInactiveClientSystemd(template: string, options: ClientServiceRenderOptionsV1): PreparedClientServiceV1 {
  const values = checked(options)
  for (const value of Object.values(values)) if (/\s|["\\]/.test(value)) throw new Error('systemd client service paths cannot contain whitespace, quote or backslash')
  return prepared('systemd', replace(template, {
    __NODE_EXECUTABLE__: values.nodeExecutable, __CLIENT_ENTRY__: join(values.installRoot, 'program/dist/client-runtime/client-entry.js'),
    __PROGRAM_ROOT__: join(values.installRoot, 'program'), __INSTALL_ROOT__: values.installRoot, __WORKSPACE_PATH__: values.workspacePath,
    __EXEC_PATH__: values.executablePath, __STDOUT_PATH__: values.stdoutPath, __STDERR_PATH__: values.stderrPath,
  }))
}

function checked(options: ClientServiceRenderOptionsV1): ClientServiceRenderOptionsV1 {
  for (const [name, value] of Object.entries(options)) {
    const paths = name === 'executablePath' ? value.split(':') : [value]
    if (!paths.length || paths.some((path: string) => !isAbsolute(path) || resolve(path) !== path || path === '/' || path.includes('\0') || path.includes('\n') || path.includes('\r'))) throw new Error(`client service ${name} must contain exact absolute paths`)
  }
  return options
}
function replace(template: string, values: Readonly<Record<string, string>>): string { let output = template; for (const [key, value] of Object.entries(values)) output = output.replaceAll(key, value); if (/__[A-Z_]+__/.test(output)) throw new Error('client service template contains unresolved placeholders'); return output }
function prepared(platform: PreparedClientServiceV1['platform'], definition: string): PreparedClientServiceV1 { if (/API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|CLIENT_SECRET/i.test(definition)) throw new Error('client service definition contains a secret-shaped field'); return Object.freeze({ schemaVersion: 1, platform, definition, definitionDigest: `sha256:${createHash('sha256').update(definition).digest('hex')}`, state: 'prepared-inactive', registered: false, started: false, externalWritesEnabled: false, rollback: Object.freeze({ stopBeforeRemove: true, removeDefinitionOnly: true, preserveInstallationState: true }) }) }
function xml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;') }
