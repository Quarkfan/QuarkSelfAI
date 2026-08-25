import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface DshProfileSetupDefaults {
  readonly profile: string
  readonly profilePatch?: string
}

export interface DshProfileSetupOptions {
  readonly projectRoot: string
  readonly checkout: string
  readonly home: string
  readonly profile: string
  readonly profilePatch?: string
}

/** Resolve only generic DSH paths; product and migration entrypoints supply their own profile contract. */
export function resolveDshProfileSetup(
  defaults: DshProfileSetupDefaults,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): DshProfileSetupOptions {
  const profile = env.DSH_PROFILE?.trim() || defaults.profile.trim()
  if (!profile) throw new Error('DSH profile name is required')
  return {
    projectRoot: cwd,
    checkout: resolve(cwd, env.DSH_CHECKOUT?.trim() || '../deepseek-harness'),
    home: resolve(cwd, env.DSH_HOME?.trim() || 'var/dsh'),
    profile,
    ...(defaults.profilePatch ? { profilePatch: resolve(cwd, defaults.profilePatch) } : {}),
  }
}

/** Install one isolated profile and make its profile-owned patch deterministic. */
export async function setupDshProfile(options: DshProfileSetupOptions): Promise<void> {
  const baseline = JSON.parse(await readFile(resolve(options.projectRoot, 'config/dsh-baseline.json'), 'utf8')) as {
    version: string
    sourceCommit: string
  }
  const manifest = JSON.parse(await readFile(resolve(options.checkout, 'apps/cli/package.json'), 'utf8')) as { version?: string }
  if (manifest.version !== baseline.version) {
    throw new Error(`DSH checkout version ${String(manifest.version)} does not match baseline ${baseline.version}`)
  }
  const { stdout: revision } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: options.checkout })
  if (revision.trim() !== baseline.sourceCommit) {
    throw new Error(`DSH checkout commit ${revision.trim()} does not match baseline ${baseline.sourceCommit}`)
  }
  await exec('corepack', [
    'pnpm', 'dsh', 'plugin', '--profile', options.profile, 'add', `link:${options.projectRoot}`,
  ], {
    cwd: options.checkout,
    env: { ...process.env, DSH_HOME: options.home },
    maxBuffer: 4 * 1024 * 1024,
  })
  const profileDirectory = resolve(options.home, 'profiles', options.profile)
  const profileManifestPath = resolve(profileDirectory, 'package.json')
  const profileManifest = JSON.parse(await readFile(profileManifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  const bundles = profileManifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) throw new Error(`DSH profile ${options.profile} has no bundle list`)
  profileManifest.dsh = profileManifest.dsh ?? {}
  profileManifest.dsh.profile = profileManifest.dsh.profile ?? {}
  profileManifest.dsh.profile.bundles = [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@quarkfan/quark-self-ai',
  ]
  await writeFile(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`, { mode: 0o600 })
  const profilePatch = options.profilePatch ? await readFile(options.profilePatch, 'utf8') : '[]\n'
  await writeFile(resolve(profileDirectory, 'cordis.patch.yml'), profilePatch, { mode: 0o600 })
  process.stdout.write(`DSH profile ready profile=${options.profile} home=${options.home} baseline=${baseline.version}@${baseline.sourceCommit}\n`)
}
