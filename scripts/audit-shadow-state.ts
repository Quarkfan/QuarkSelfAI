import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { auditShadowState } from '../src/migration/shadow-audit.js'

const requested = process.argv[2]?.trim()
if (!requested) {
  process.stderr.write('Usage: npm run audit:shadow -- /absolute/path/to/state.json [--strict]\n')
  process.exitCode = 2
} else {
  const filename = resolve(requested)
  const state = JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>
  const report = auditShadowState(state)
  process.stdout.write(`${JSON.stringify({ source: filename, ...report }, null, 2)}\n`)
  if (process.argv.includes('--strict') && !report.readyForEvaluation) process.exitCode = 1
}
