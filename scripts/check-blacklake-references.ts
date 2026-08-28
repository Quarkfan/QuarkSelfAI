import { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import { BlacklakeReferenceService } from '../src/blacklake/references.js'

const workspaceRoot = resolve(process.cwd(), process.env.BLACKLAKE_WORKSPACE_ROOT ?? '../..')
const ctx = new Context()
try {
  ctx.reflect.provide('quarkActionLedger', { async enqueue() { throw new Error('compatibility inspection must not enqueue') } })
  const fiber = ctx.plugin(BlacklakeReferenceService, { workspaceRoot })
  await fiber
  const snapshot = await ctx.blacklakeReferences.inspect()
  await ctx.blacklakeReferences.validate({
    blacklakeRelated: true,
    recommendedSkills: ['blacklake-reference-router', 'virtual-employee-operation-chain'],
    operationChain: true,
    reason: 'integration verification of the multi-step routing guard',
  })
  process.stdout.write(`BlackLake references verified sources=${snapshot.sources.length} skills=${snapshot.skills.length}\n`)
} finally {
  await ctx.fiber.dispose()
}
