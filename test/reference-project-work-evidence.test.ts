import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { ReferenceProjectWorkEvidenceProvider } from '../src/work-journal/reference-project-evidence.js'

test('adds bounded Jira and GitLab evidence without exposing auth material', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-journal-reference-'))
  const state = join(root, 'ai', 'devops-virtual-employee', 'state')
  await mkdir(state, { recursive: true })
  const cookie = '.example\tTRUE\t/\tFALSE\t0\tsession\tsecret-value\n'
  await writeFile(join(state, 'jira-session.json'), JSON.stringify({ base_url: 'http://jira2.blacklake.tech', cookie_jar: 'state/jira-cookies.txt' }))
  await writeFile(join(state, 'jira-cookies.txt'), cookie)
  await writeFile(join(state, 'gitlab-session.json'), JSON.stringify({ base_url: 'https://gitlab.blacklake.tech', cookie_jar: 'state/gitlab-cookies.txt', user: { id: 482 } }))
  await writeFile(join(state, 'gitlab-cookies.txt'), cookie)
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.match(String(init?.headers && (init.headers as Record<string, string>).cookie), /secret-value/)
    const url = String(input)
    if (url.includes('jira2')) return Response.json({ issues: [{ key: 'HHZZ3-1', fields: { summary: '事项', status: { name: '进行中' }, updated: '2026-09-02T10:00:00+0800' } }] })
    if (url.includes('/events')) return Response.json([{ action_name: 'pushed', target_type: 'project', target_title: 'Repo', project_id: 1, created_at: '2026-09-02T10:00:00+08:00', push_data: { ref: 'main', commit_count: 1 } }])
    return Response.json([{ title: 'MR', state: 'merged', web_url: 'https://gitlab.blacklake.tech/a/-/merge_requests/1', project_id: 1, iid: 1, updated_at: '2026-09-02T11:00:00+08:00' }])
  }
  const provider = new ReferenceProjectWorkEvidenceProvider({ async load(day) { return { day, local: true } } }, root, fetcher)
  const evidence = await provider.load('2026-09-02')
  assert.equal(evidence.local, true)
  const serialized = JSON.stringify(evidence)
  assert.match(serialized, /HHZZ3-1/)
  assert.match(serialized, /merge_requests\/1/)
  assert.doesNotMatch(serialized, /secret-value/)
})

test('degrades each unavailable reference source independently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-journal-reference-missing-'))
  const provider = new ReferenceProjectWorkEvidenceProvider({ async load(day) { return { day } } }, root, async () => Response.json({}))
  const evidence = await provider.load('2026-09-02')
  const sources = evidence.referenceProjects as Record<string, Record<string, unknown>>
  assert.equal(sources.jira.status, 'unavailable')
  assert.equal(sources.gitlab.status, 'unavailable')
})

test('classifies reference authentication and permission gaps without retaining response bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-journal-reference-auth-'))
  const state = join(root, 'ai', 'devops-virtual-employee', 'state')
  await mkdir(state, { recursive: true })
  const cookie = '.example\tTRUE\t/\tFALSE\t0\tsession\tsecret-value\n'
  await writeFile(join(state, 'jira-session.json'), JSON.stringify({ base_url: 'http://jira2.blacklake.tech', cookie_jar: 'state/jira-cookies.txt' }))
  await writeFile(join(state, 'jira-cookies.txt'), cookie)
  await writeFile(join(state, 'gitlab-session.json'), JSON.stringify({ base_url: 'https://gitlab.blacklake.tech', cookie_jar: 'state/gitlab-cookies.txt', user: { id: 482 } }))
  await writeFile(join(state, 'gitlab-cookies.txt'), cookie)
  const provider = new ReferenceProjectWorkEvidenceProvider({ async load(day) { return { day } } }, root, async input => {
    return new Response('sensitive upstream response', { status: String(input).includes('jira2') ? 401 : 403 })
  })

  const evidence = await provider.load('2026-09-02')
  const sources = evidence.referenceProjects as Record<string, Record<string, unknown>>
  assert.deepEqual(sources.jira, { status: 'unavailable', reason: 'authentication-required' })
  assert.deepEqual(sources.gitlab, { status: 'unavailable', reason: 'permission-required' })
  assert.doesNotMatch(JSON.stringify(evidence), /sensitive|secret-value/)
})
