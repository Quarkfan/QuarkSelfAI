import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { auditMeetingBriefingAuthorization, authorizationFingerprint } from '../scripts/audit-meeting-briefing-authorization.js'

const requestPath = 'docs/operations/pre-meeting-briefing-pilot-01-authorization-request.json'

test('audits the exact inactive meeting briefing authorization request', async () => {
  const result = await auditMeetingBriefingAuthorization()
  assert.equal(result.ok, true)
  assert.equal(result.revision, 3)
  assert.equal(result.runtimeActive, false)
  assert.equal(result.approvalRecorded, false)
})

test('fails closed when scope drifts without a new authorization fingerprint', async () => {
  const root = await fixtureRoot()
  const request = JSON.parse(await readFile(join(root, requestPath), 'utf8')) as Record<string, unknown>
  request.notificationPolicy = 'send a preview'
  await writeFile(join(root, requestPath), `${JSON.stringify(request, null, 2)}\n`)
  await assert.rejects(auditMeetingBriefingAuthorization(root, false), /fingerprint drifted/)
})

test('fails closed when the module becomes runtime active even with a matching fingerprint', async () => {
  const root = await fixtureRoot()
  const request = JSON.parse(await readFile(join(root, requestPath), 'utf8')) as Record<string, unknown>
  request.authorizationFingerprint = authorizationFingerprint(request)
  request.approvalPhrase = `批准 pre-meeting-briefing-pilot-01 revision 3，授权指纹 ${request.authorizationFingerprint as string}，仅执行静默只读影子试运行。`
  await writeFile(join(root, requestPath), `${JSON.stringify(request, null, 2)}\n`)
  await writeFile(join(root, 'config/module-catalog.json'), `${JSON.stringify({ modules: [{ id: 'meeting-briefing-planner', runtime: 'active', owns: ['src/meeting-briefing/planner.ts'] }] })}\n`)
  await assert.rejects(auditMeetingBriefingAuthorization(root, false), /must remain runtime-inactive/)
})

test('fails closed when a semantic policy still names a superseded revision', async () => {
  const root = await fixtureRoot()
  const request = JSON.parse(await readFile(join(root, requestPath), 'utf8')) as Record<string, unknown>
  request.notificationPolicy = 'Silent for the entire revision 2 shadow pilot. Any owner-visible delivery requires a new revision and separate approval.'
  request.authorizationFingerprint = authorizationFingerprint(request)
  request.approvalPhrase = `批准 pre-meeting-briefing-pilot-01 revision 3，授权指纹 ${request.authorizationFingerprint as string}，仅执行静默只读影子试运行。`
  await writeFile(join(root, requestPath), `${JSON.stringify(request, null, 2)}\n`)
  await assert.rejects(auditMeetingBriefingAuthorization(root, false), /notification policy does not bind the current request revision/)
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'meeting-briefing-authorization-'))
  await mkdir(dirname(join(root, requestPath)), { recursive: true })
  await mkdir(join(root, 'config'), { recursive: true })
  await writeFile(join(root, requestPath), await readFile(requestPath))
  await writeFile(join(root, 'config/module-catalog.json'), `${JSON.stringify({ modules: [{ id: 'meeting-briefing-planner', runtime: 'inactive', owns: ['src/meeting-briefing/planner.ts'] }] })}\n`)
  return root
}
