import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { WorkIntegrationRegistryV1 } from '../src/work-integration/registry.js'

export async function auditWorkIntegrationHostContract(root = process.cwd()) {
  const [contracts, registry, plugin, profile, packageManifest, catalog, isolation] = await Promise.all([
    readFile(resolve(root, 'src/work-integration/contracts.ts'), 'utf8'),
    readFile(resolve(root, 'src/work-integration/registry.ts'), 'utf8'),
    readFile(resolve(root, 'src/work-integration/plugin.ts'), 'utf8'),
    readFile(resolve(root, 'cordis.patch.yml'), 'utf8'),
    readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'config/module-catalog.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'config/work-domain-isolation.json'), 'utf8').then(JSON.parse),
  ])
  const source = `${contracts}\n${registry}\n${plugin}`
  assert.ok(isolation.markers.every((marker: string) => !source.toLocaleLowerCase().includes(marker.toLocaleLowerCase())))
  assert.doesNotMatch(source, /\/Users\/|node:child_process|startConsumer|process\.env/iu)
  assert.ok(packageManifest.exports?.['./platform'])
  assert.equal((profile.match(/id:\s*quark-work-integration-registry\b/gu) ?? []).length, 1)
  assert.match(profile, /name:\s*['"]@quarkfan\/quark-self-ai\/platform['"]/u)
  const module = catalog.modules.find((item: { id: string }) => item.id === 'platform-api')
  assert.equal(module?.runtime, 'active')
  assert.equal(module?.providesServices?.[0], 'quarkWorkIntegrations')
  const snapshot = new WorkIntegrationRegistryV1().snapshot()
  assert.deepEqual(snapshot, {
    contractVersion: '1.0.0', packs: [], consumers: 0, activeProviders: 0, schedulers: 0,
    externalWriters: 0, activationAvailable: false,
  })
  return {
    ok: true,
    contractVersion: snapshot.contractVersion,
    packBindingCount: snapshot.packs.length,
    consumers: snapshot.consumers,
    activeProviders: snapshot.activeProviders,
    schedulers: snapshot.schedulers,
    externalWriters: snapshot.externalWriters,
    activationAvailable: snapshot.activationAvailable,
    privacy: { businessIdentifiersIncluded: false, hostPathsIncluded: false, credentialsIncluded: false },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const report = await auditWorkIntegrationHostContract()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
