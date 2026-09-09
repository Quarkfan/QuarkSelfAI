import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { CapabilityArtifactCandidateSpecV1 } from '../src/capability-platform/artifact-candidates.js'
import { compileCapabilityArtifactCandidates } from '../src/capability-platform/artifact-candidate-compiler.js'
import { compileModuleCapabilityOffers } from '../src/capability-platform/module-offer-compiler.js'
import { validateModuleCatalog } from '../src/platform/modules.js'

const revision = '8b41efaf01a599f797f1e4e193ae28377ab59bf0'

async function fixtures() {
  const catalog = validateModuleCatalog(JSON.parse(await readFile(new URL('../config/module-catalog.json', import.meta.url), 'utf8')))
  const migration = JSON.parse(await readFile(new URL('../config/capability-platform-migration.json', import.meta.url), 'utf8'))
  const specs = JSON.parse(await readFile(new URL('../config/capability-artifact-candidates.json', import.meta.url), 'utf8')).candidates as CapabilityArtifactCandidateSpecV1[]
  return { offers: compileModuleCapabilityOffers(catalog, migration, revision), specs }
}

test('groups every artifact offer exactly once without claiming publication or activation', async () => {
  const { offers, specs } = await fixtures()
  const result = compileCapabilityArtifactCandidates(offers, specs)
  assert.equal(result.eligibleOfferCount, 56)
  assert.equal(result.coveredOfferCount, 56)
  assert.deepEqual(result.uncoveredModuleIds, [])
  assert.equal(result.candidates.length, 25)
  assert.ok(result.candidates.every(item => item.manifestStatus === 'evidence-pending'))
  assert.ok(result.candidates.every(item => !item.activationAllowed && !item.publicationAllowed && item.currentOwnerPreserved))
})

test('redacts private module identities while retaining machine-verifiable coverage', async () => {
  const { offers, specs } = await fixtures()
  const result = compileCapabilityArtifactCandidates(offers, specs)
  const privateCandidate = result.candidates.find(item => item.id === 'private-work-integration')!
  assert.deepEqual(privateCandidate.moduleIds, [])
  assert.equal(privateCandidate.coveredModuleCount, 6)
  assert.match(privateCandidate.coveredModuleDigest, /^sha256:[a-f0-9]{64}$/)
  assert.ok(privateCandidate.blockers.includes('private-manifest-required'))
})

test('fails closed on duplicate, missing, private disclosure and premature publication', async () => {
  const { offers, specs } = await fixtures()
  const duplicate = structuredClone(specs)
  duplicate[1].moduleIds = [duplicate[0].moduleIds[0], ...duplicate[1].moduleIds]
  assert.throws(() => compileCapabilityArtifactCandidates(offers, duplicate), /multiple capability candidates/)
  assert.throws(() => compileCapabilityArtifactCandidates(offers, specs.slice(1)), /missing capability candidates/)
  const privateDisclosure = structuredClone(specs)
  const privateSpec = privateDisclosure.find(item => item.offerSelector === 'all-private-pack-offers')!
  privateSpec.moduleIds = [offers.offers.find(item => item.availability === 'private-pack-inactive')!.moduleId]
  assert.throws(() => compileCapabilityArtifactCandidates(offers, privateDisclosure), /cannot list private module ids/)
  const publishable = structuredClone(specs)
  publishable[0].publicationAllowed = true
  assert.throws(() => compileCapabilityArtifactCandidates(offers, publishable), /inactive and unpublished/)
})
