import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { auditCapabilityEvolutionPortability, canonicalPrompt } from '../scripts/audit-capability-evolution-portability.js'

function tomlString(value: string): string {
  return JSON.stringify(value)
}

test('keeps capability evolution as a portable repository blueprint', async () => {
  const report = await auditCapabilityEvolutionPortability({ projectRoot: process.cwd() })
  assert.equal(report.ok, true)
  assert.equal(report.blueprint.valid, true)
  assert.equal(report.blueprint.promptTracked, true)
  assert.equal(report.blueprint.initialStatus, 'PAUSED')
  assert.equal(report.blueprint.activationRequiresOwnerApproval, true)
  assert.equal(report.blueprint.workDomainReferenceCount, 0)
  assert.equal(report.privacy.promptIncluded, false)
})

test('compares an installed task without exposing its prompt', async () => {
  const root = resolve(process.cwd())
  const blueprint = JSON.parse(await readFile(join(root, 'config/capability-evolution-automation.json'), 'utf8')) as {
    automationId: string
    name: string
    kind: string
    desiredStatus: string
    schedule: { rrule: string }
    executor: { model: string; reasoningEffort: string }
    task: { promptFile: string }
  }
  const prompt = await readFile(join(root, blueprint.task.promptFile), 'utf8')
  const codexHome = await mkdtemp(join(tmpdir(), 'quark-evolution-portability-'))
  const directory = join(codexHome, 'automations', blueprint.automationId)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'automation.toml'), [
    'version = 1',
    `id = ${tomlString(blueprint.automationId)}`,
    `kind = ${tomlString(blueprint.kind)}`,
    `name = ${tomlString(blueprint.name)}`,
    `prompt = ${tomlString(prompt)}`,
    `status = ${tomlString(blueprint.desiredStatus)}`,
    `rrule = ${tomlString(blueprint.schedule.rrule)}`,
    `model = ${tomlString(blueprint.executor.model)}`,
    `reasoning_effort = ${tomlString(blueprint.executor.reasoningEffort)}`,
    'target = { type = "project", project_id = "host-specific-id" }',
    '',
  ].join('\n'))

  const report = await auditCapabilityEvolutionPortability({ projectRoot: root, codexHome, inspectInstalled: true })
  assert.equal(report.ok, true)
  assert.equal(report.installed.matches, true)
  assert.equal(report.installed.activeDefinitionCount, 1)
  assert.equal(report.installed.scanFailureCount, 0)
  assert.equal('prompt' in report, false)
  assert.equal(report.blueprint.promptSha256, createHash('sha256').update(canonicalPrompt(prompt)).digest('hex'))

  await writeFile(join(directory, 'automation.toml'), `id = ${tomlString(blueprint.automationId)}\nprompt = "drift"\n`)
  const drift = await auditCapabilityEvolutionPortability({ projectRoot: root, codexHome, inspectInstalled: true })
  assert.equal(drift.ok, false)
  assert.ok(drift.installed.mismatches.includes('prompt-digest-mismatch'))
})
