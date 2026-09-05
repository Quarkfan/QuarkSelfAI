import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderRecoveryLaunchdTemplate } from '../src/deploy/launchd.js'

const argumentsByName = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]
  if (name?.startsWith('--') && value) argumentsByName.set(name.slice(2), value)
}
const required = ['output', 'project-root', 'node', 'path', 'stdout', 'stderr']
const missing = required.filter(name => !argumentsByName.get(name))
if (missing.length > 0) {
  process.stderr.write(`Missing arguments: ${missing.join(', ')}\n`)
  process.exitCode = 2
} else {
  const templatePath = fileURLToPath(new URL('../deploy/launchd/com.quarkfan.quark-self-ai.recovery.plist.template', import.meta.url))
  const template = await readFile(templatePath, 'utf8')
  const rendered = renderRecoveryLaunchdTemplate(template, {
    projectRoot: resolve(argumentsByName.get('project-root') ?? ''),
    nodeExecutable: resolve(argumentsByName.get('node') ?? ''),
    executablePath: argumentsByName.get('path') ?? '',
    stdoutPath: resolve(argumentsByName.get('stdout') ?? ''),
    stderrPath: resolve(argumentsByName.get('stderr') ?? ''),
    hour: Number(argumentsByName.get('hour') ?? '3'),
    minute: Number(argumentsByName.get('minute') ?? '15'),
  })
  const output = resolve(argumentsByName.get('output') ?? '')
  await writeFile(output, rendered, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`${output}\n`)
}
