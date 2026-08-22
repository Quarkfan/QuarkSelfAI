import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { auditLegacyState } from '../src/migration/legacy-state-audit.js'

const requested = process.argv[2]?.trim()
if (!requested) {
  process.stderr.write('Usage: npm run audit:legacy-handoff -- /absolute/path/to/state.json [--strict]\n')
  process.exitCode = 2
} else {
  const filename = resolve(requested)
  const state = JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>
  const report = auditLegacyState(state)
  process.stdout.write(`${JSON.stringify({ source: filename, ...report }, null, 2)}\n`)
  if (process.argv.includes('--strict') && !report.handoffSafe) process.exitCode = 1
}
