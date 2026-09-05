export interface LaunchdRenderOptions {
  readonly applicationMode: 'compatibility' | 'native'
  readonly projectRoot: string
  readonly nodeExecutable: string
  readonly environmentFile: string
  readonly executablePath: string
  readonly stdoutPath: string
  readonly stderrPath: string
}

export interface RecoveryLaunchdRenderOptions {
  readonly projectRoot: string
  readonly nodeExecutable: string
  readonly executablePath: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly hour: number
  readonly minute: number
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function renderLaunchdTemplate(template: string, options: LaunchdRenderOptions): string {
  const applicationEntry = options.applicationMode === 'native' ? 'dist/product/app.js' : 'dist/app.js'
  const replacements: Readonly<Record<string, string>> = {
    __APPLICATION_ENTRY__: `${options.projectRoot}/${applicationEntry}`,
    __PROJECT_ROOT__: options.projectRoot,
    __NODE_EXECUTABLE__: options.nodeExecutable,
    __ENV_FILE__: options.environmentFile,
    __EXEC_PATH__: options.executablePath,
    __STDOUT_PATH__: options.stdoutPath,
    __STDERR_PATH__: options.stderrPath,
  }
  let rendered = template
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!value.startsWith('/')) throw new Error(`${placeholder} must start with an absolute path`)
    rendered = rendered.replaceAll(placeholder, xml(value))
  }
  if (/__[A-Z_]+__/.test(rendered)) throw new Error('launchd template still contains unresolved placeholders')
  return rendered
}

export function renderRecoveryLaunchdTemplate(template: string, options: RecoveryLaunchdRenderOptions): string {
  if (!Number.isInteger(options.hour) || options.hour < 0 || options.hour > 23) {
    throw new Error('recovery launchd hour must be an integer from 0 to 23')
  }
  if (!Number.isInteger(options.minute) || options.minute < 0 || options.minute > 59) {
    throw new Error('recovery launchd minute must be an integer from 0 to 59')
  }
  const replacements: Readonly<Record<string, string>> = {
    __PROJECT_ROOT__: options.projectRoot,
    __NODE_EXECUTABLE__: options.nodeExecutable,
    __EXEC_PATH__: options.executablePath,
    __STDOUT_PATH__: options.stdoutPath,
    __STDERR_PATH__: options.stderrPath,
  }
  let rendered = template
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!value.startsWith('/')) throw new Error(`${placeholder} must start with an absolute path`)
    rendered = rendered.replaceAll(placeholder, xml(value))
  }
  rendered = rendered.replaceAll('__BACKUP_HOUR__', String(options.hour))
  rendered = rendered.replaceAll('__BACKUP_MINUTE__', String(options.minute))
  if (/__[A-Z_]+__/.test(rendered)) throw new Error('recovery launchd template still contains unresolved placeholders')
  return rendered
}
