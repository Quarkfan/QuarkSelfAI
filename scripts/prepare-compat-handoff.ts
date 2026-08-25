import { homedir } from 'node:os'
import { join } from 'node:path'
import { inspectCompatibilityConfig } from '../src/migration/compat-preflight.js'
import { prepareCompatibilityHandoff } from '../src/migration/compat-handoff.js'

const [legacyConfigPath, legacyStatePath, legacyDidaDirectory, destinationRoot] = process.argv.slice(2).filter((argument) => argument !== '--')
if (!legacyConfigPath || !legacyStatePath || !legacyDidaDirectory || !destinationRoot) {
  process.stderr.write('Usage: npm run prepare:compat-handoff -- /absolute/config.json /absolute/state.json /absolute/var/dida /absolute/staging-root\n')
  process.exitCode = 2
} else {
  const inspection = await inspectCompatibilityConfig(legacyConfigPath, {
    home: homedir(),
    ...(process.env.PATH === undefined ? {} : { path: process.env.PATH }),
  })
  const required = ['lark', 'dida', 'claude', 'codex'] as const
  const missing = required.filter((name) => !inspection.executables[name]?.path)
  if (missing.length) throw new Error(`cannot prepare handoff; executables not found: ${missing.join(', ')}`)
  const result = await prepareCompatibilityHandoff({
    legacyConfigPath,
    legacyStatePath,
    legacyDidaDirectory,
    destinationRoot,
    home: homedir(),
    ...(process.env.PATH === undefined ? {} : { path: process.env.PATH }),
    executables: {
      larkCli: inspection.executables.lark?.path ?? '',
      didaCli: inspection.executables.dida?.path ?? '',
      claudeCli: inspection.executables.claude?.path ?? '',
      codexCli: inspection.executables.codex?.path ?? '',
    },
    didaCliConfigPath: join(homedir(), '.config', 'dida-cli', 'config.json'),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
