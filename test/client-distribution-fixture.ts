import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sealClientDistribution } from '../src/client-runtime/client-distribution.js'

export async function createClientDistributionFixture(parent: string, entrypoint = 'process.exitCode = 0\n'): Promise<string> {
  const root = join(parent, 'distribution')
  for (const directory of ['program/dist/client-runtime', 'program/config', 'program/migrations/client-sqlite']) await mkdir(join(root, directory), { recursive: true, mode: 0o700 })
  const files: Record<string, string> = {
    'program/dist/client-runtime/client-entry.js': entrypoint,
    'program/dist/client-runtime/client-installer-entry.js': 'process.exitCode = 0\n',
    'program/dist/client-runtime/dsh-stdin-host.js': 'process.exitCode = 1\n',
    'program/package.json': '{"type":"module"}\n',
    'program/config/dsh-baseline.json': '{"version":"fixture"}\n',
    'program/config/dsh-inference-provider.patch.yml': 'plugins: {}\n',
    'program/config/dsh-reasoning-only.patch.yml': 'plugins: {}\n',
    'program/migrations/client-sqlite/001_client_state.sql': await readFile(new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url), 'utf8'),
    'program/sbom.spdx.json': '{"spdxVersion":"SPDX-2.3"}\n',
  }
  for (const [path, content] of Object.entries(files)) { await writeFile(join(root, path), content, { mode: 0o600 }); await chmod(join(root, path), 0o600) }
  await sealClientDistribution(await realpath(root), '0.1.0', 'a'.repeat(40))
  return await realpath(root)
}
