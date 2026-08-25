import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { BLACKLAKE_REFERENCE_SOURCES, BlacklakeReferenceService } from '../src/blacklake/references.js'
import { createSqliteStore } from '../src/storage/sqlite.js'
import { fileURLToPath } from 'node:url'

const migrations = fileURLToPath(new URL('../migrations/sqlite/', import.meta.url))

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quark-blacklake-references-'))
  for (const path of BLACKLAKE_REFERENCE_SOURCES) {
    const filename = join(root, path)
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, `# ${path}\n- current source\n`)
  }
  for (const [directory, name] of [
    ['ai/devops-virtual-employee/skills/virtual-employee-operation-chain', 'virtual-employee-operation-chain'],
    ['harness/bl-common-harness/.claude/skills/query-loki', 'query-loki'],
  ]) {
    const filename = join(root, directory, 'SKILL.md')
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, `---\nname: ${name}\n---\n# ${name}\n`)
  }
  return root
}

test('loads current three-source references and validates routed skills without copying their rules', async () => {
  const root = await fixture()
  const ctx = new Context()
  ctx.reflect.provide('quarkActionLedger', { async enqueue() { throw new Error('inspection must not enqueue') } })
  const fiber = ctx.plugin(BlacklakeReferenceService, { workspaceRoot: root })
  await fiber
  const snapshot = await ctx.blacklakeReferences.inspect()
  assert.equal(snapshot.sources.length, BLACKLAKE_REFERENCE_SOURCES.length)
  assert.ok(snapshot.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)))
  assert.ok(snapshot.skills.includes('blacklake-reference-router'))
  assert.ok(snapshot.skills.includes('virtual-employee-operation-chain'))
  await ctx.blacklakeReferences.validate({
    blacklakeRelated: true,
    recommendedSkills: ['blacklake-reference-router', 'virtual-employee-operation-chain'],
    operationChain: true,
    reason: 'the request spans multiple BlackLake operations',
  })
  await assert.rejects(ctx.blacklakeReferences.validate({
    blacklakeRelated: true,
    recommendedSkills: ['blacklake-reference-router', 'invented-skill'],
    operationChain: false,
    reason: 'fixture',
  }), /unknown BlackLake skills/)
  await ctx.fiber.dispose()
})

test('routes a confirmed BlackLake investigation into the durable ledger without executing before approval', async () => {
  const root = await fixture()
  const store = await createSqliteStore(join(root, 'assistant.sqlite3'), migrations)
  const ctx = new Context()
  ctx.reflect.provide('quarkActionLedger', { enqueue: store.enqueueAction.bind(store) })
  const fiber = ctx.plugin(BlacklakeReferenceService, { workspaceRoot: root })
  try {
    await store.migrate()
    await fiber
    const result = await ctx.blacklakeReferences.planResearch({
      actionId: 'blacklake-confirm-action', matterId: 'blacklake-confirm-matter',
      title: 'Synthetic BlackLake investigation', summary: 'Synthetic evidence only',
      source: { channel: 'feishu', resourceId: 'om-synthetic-blacklake' }, workspace: root,
      candidate: {
        blacklakeRelated: true,
        recommendedSkills: ['blacklake-reference-router', 'virtual-employee-operation-chain'],
        operationChain: true,
        reason: 'the synthetic request spans evidence routing and repository inspection',
      },
      researchDecision: 'confirm',
      decisionReason: 'the scope is useful but should not start without owner approval',
      expectedBenefit: 'prove that current sources can resolve a synthetic evidence gap',
      evidenceGap: 'no local source has been inspected for this synthetic case',
      researchPrompt: 'Inspect only the fixed synthetic fixture and return QUARK_BLACKLAKE_OK.',
      risk: 'ordinary', goalClear: true, evidenceNeedsLocalInspection: true, expectedDirectValue: true,
      approvalId: 'blacklake-confirm-approval',
      approvalPrompt: 'Start this exact synthetic read-only BlackLake investigation?',
    })
    assert.deepEqual(result, {
      decision: 'confirm', enqueued: true, awaitingApproval: true, actionId: 'blacklake-confirm-action',
    })
    assert.equal(await store.claimNextAction('worker', root, '2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z'), undefined)
    await store.decideApproval('blacklake-confirm-approval', 'approved', { actor: 'owner' }, '2099-01-01T00:01:00.000Z')
    const claimed = await store.claimNextAction('worker', root, '2099-01-01T00:02:00.000Z', '2099-01-01T01:02:00.000Z')
    assert.equal(claimed?.actionId, 'blacklake-confirm-action')
    assert.equal(claimed?.approvalGranted, true)
    assert.equal(claimed?.requestedExecutor, 'claude-code')
  } finally {
    await ctx.fiber.dispose()
    await store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps low-value BlackLake research skipped and rejects unsafe direct starts', async () => {
  const root = await fixture()
  const enqueued: unknown[] = []
  const ctx = new Context()
  ctx.reflect.provide('quarkActionLedger', { async enqueue(input: unknown) { enqueued.push(input); return { inserted: true } } })
  const fiber = ctx.plugin(BlacklakeReferenceService, { workspaceRoot: root })
  try {
    await fiber
    const base = {
      actionId: 'blacklake-synthetic-action', matterId: 'blacklake-synthetic-matter',
      title: 'Synthetic BlackLake work', summary: 'Synthetic only',
      source: { channel: 'feishu' as const }, workspace: root,
      candidate: {
        blacklakeRelated: true,
        recommendedSkills: ['blacklake-reference-router'],
        operationChain: false,
        reason: 'synthetic BlackLake routing check',
      },
      decisionReason: 'research would not change the next action',
      expectedBenefit: 'none for this fixture', evidenceGap: 'none requiring local inspection',
      risk: 'ordinary' as const, goalClear: false, evidenceNeedsLocalInspection: false, expectedDirectValue: false,
    }
    assert.deepEqual(await ctx.blacklakeReferences.planResearch({ ...base, researchDecision: 'skip' }), {
      decision: 'skip', enqueued: false, awaitingApproval: false,
    })
    await assert.rejects(ctx.blacklakeReferences.planResearch({
      ...base,
      researchDecision: 'start',
      researchPrompt: 'Do not execute this unsafe direct start.',
    }), /may start directly only/)
    assert.equal(enqueued.length, 0)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
