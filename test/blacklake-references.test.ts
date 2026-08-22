import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { BLACKLAKE_REFERENCE_SOURCES, BlacklakeReferenceService } from '../src/blacklake/references.js'

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
