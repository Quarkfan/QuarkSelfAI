import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

test('deployment targets share one allowlisted compatibility/native entry selector', async () => {
  const [entrypoint, systemd, compose, dockerfile] = await Promise.all([
    readFile(new URL('../deploy/container-entrypoint.sh', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/systemd/quark-self-ai.service', import.meta.url), 'utf8'),
    readFile(new URL('../compose.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
  ])
  assert.match(entrypoint, /compatibility\)\s+application_entry="dist\/app\.js"/)
  assert.match(entrypoint, /native\)\s+application_entry="dist\/product\/app\.js"/)
  assert.match(entrypoint, /QUARK_APPLICATION_MODE must be compatibility or native/)
  assert.doesNotMatch(entrypoint, /exec node dist\/app\.js/)
  assert.match(systemd, /ExecStart=\/opt\/quark-self-ai\/deploy\/container-entrypoint\.sh/)
  assert.doesNotMatch(systemd, /ExecStart=.*dist\/app\.js/)
  assert.match(compose, /QUARK_APPLICATION_MODE: compatibility/)
  assert.match(dockerfile, /COPY cordis\.patch\.yml \.\/cordis\.patch\.yml/)
  assert.match(dockerfile, /COPY compat \.\/compat/)
})

test('deployment selector rejects arbitrary entry modes before invoking DSH', () => {
  const result = spawnSync('sh', ['deploy/container-entrypoint.sh'], {
    cwd: projectRoot,
    env: { ...process.env, QUARK_APPLICATION_MODE: '../arbitrary-entry' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 64)
  assert.match(result.stderr, /must be compatibility or native/)
})
