import { snapshotLegacyState } from '../src/migration/state-snapshot.js'

const source = process.argv[2]?.trim()
const destination = process.argv[3]?.trim()
if (!source || !destination) {
  process.stderr.write('Usage: npm run snapshot:legacy-state -- /absolute/state.json /protected/snapshot-directory\n')
  process.exitCode = 2
} else {
  const result = await snapshotLegacyState(source, destination)
  process.stdout.write(`${JSON.stringify({ ...result, sourceReadOnly: true, overwroteExistingFile: false }, null, 2)}\n`)
}
