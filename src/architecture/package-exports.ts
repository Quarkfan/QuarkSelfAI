export interface PackageExportOwnershipIndex {
  readonly ownerByPath: ReadonlyMap<string, string>
  readonly pluginOwnerByExport: ReadonlyMap<string, string>
}

export function validateTrackedPackageExportOwnership(
  exports: Readonly<Record<string, unknown>>,
  tracked: ReadonlySet<string>,
  ownership: PackageExportOwnershipIndex,
): void {
  for (const [exportKey, value] of Object.entries(exports)) {
    if (exportKey === './package.json') {
      invariant(value === './package.json', 'package metadata export must point to package.json')
      continue
    }
    invariant(isRecord(value), `package export ${exportKey} must be an object`)
    const runtimeTarget = typeof value.import === 'string' ? value.import : value.default
    const typesTarget = value.types
    invariant(typeof runtimeTarget === 'string', `package export ${exportKey} must define import or default`)
    invariant(typeof typesTarget === 'string', `package export ${exportKey} must define types`)
    const targets = [runtimeTarget, typesTarget].map(packageExportSource)
    const trackedTargets = targets.filter(target => tracked.has(target))

    // A completely untracked local experiment is outside repository
    // ownership. Partial entry into Git is never allowed.
    if (trackedTargets.length === 0) continue
    invariant(trackedTargets.length === targets.length, `package export ${exportKey} mixes tracked and untracked targets`)
    const owners = targets.map(target => ownership.ownerByPath.get(target))
    for (let index = 0; index < targets.length; index += 1) {
      invariant(owners[index] !== undefined, `package export ${exportKey} target has no module owner: ${targets[index]}`)
    }
    invariant(owners[1] === owners[0], `package export ${exportKey} runtime/types targets have different module owners`)
    const pluginOwner = ownership.pluginOwnerByExport.get(exportKey)
    if (pluginOwner) invariant(owners[0] === pluginOwner, `plugin export ${exportKey} differs from its module binding`)
  }
}

export function packageExportSource(target: string): string {
  invariant(/^\.\//.test(target), `package export target must be package-relative: ${target}`)
  const path = target.slice(2)
  if (!path.startsWith('dist/')) return path
  return path.replace(/^dist\//, 'src/').replace(/\.d\.ts$/, '.ts').replace(/\.js$/, '.ts')
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
