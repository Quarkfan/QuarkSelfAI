import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkJournalEvidenceProvider } from './contract.js'

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface AuthState extends Record<string, unknown> {
  readonly base_url?: string
  readonly cookie_jar?: string
  readonly user?: Readonly<Record<string, unknown>>
}

function safeBase(value: unknown, allowedHost: string): URL {
  const url = new URL(String(value ?? ''))
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== allowedHost) throw new Error(`unexpected ${allowedHost} auth endpoint`)
  return url
}

function cookieHeader(text: string): string {
  return text.split(/\r?\n/u).flatMap(line => {
    const value = line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line
    if (!value || value.startsWith('#')) return []
    const columns = value.split('\t')
    return columns.length >= 7 ? [`${columns[5]}=${columns[6]}`] : []
  }).join('; ')
}

function dayBounds(day: string): { readonly start: string; readonly end: string; readonly nextDay: string } {
  const start = new Date(`${day}T00:00:00+08:00`)
  const end = new Date(`${day}T23:59:59.999+08:00`)
  const nextDay = new Date(start.getTime() + 86_400_000).toISOString().slice(0, 10)
  return { start: start.toISOString(), end: end.toISOString(), nextDay }
}

async function auth(root: string, name: string): Promise<{ readonly state: AuthState; readonly cookie: string }> {
  const state = JSON.parse(await readFile(join(root, `${name}-session.json`), 'utf8')) as AuthState
  const relativeJar = typeof state.cookie_jar === 'string' ? state.cookie_jar.replace(/^state\//u, '') : `${name}-cookies.txt`
  const cookie = cookieHeader(await readFile(join(root, relativeJar), 'utf8'))
  if (!cookie) throw new Error(`${name} cookie jar is empty`)
  return { state, cookie }
}

async function json(fetcher: Fetcher, url: URL, cookie: string): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { accept: 'application/json', cookie, 'user-agent': 'QuarkSelfAI-work-journal/1' },
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json()
}

function items(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Readonly<Record<string, unknown>>[] : []
}

export class ReferenceProjectWorkEvidenceProvider implements WorkJournalEvidenceProvider {
  private readonly stateRoot: string

  constructor(
    private readonly base: WorkJournalEvidenceProvider,
    workspace: string,
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.stateRoot = join(workspace, 'ai', 'devops-virtual-employee', 'state')
  }

  async load(day: string): Promise<Readonly<Record<string, unknown>>> {
    const [local, jira, gitlab] = await Promise.all([this.base.load(day), this.jira(day), this.gitlab(day)])
    return { ...local, referenceProjects: { jira, gitlab } }
  }

  private async jira(day: string): Promise<Readonly<Record<string, unknown>>> {
    try {
      const { state, cookie } = await auth(this.stateRoot, 'jira')
      const base = safeBase(state.base_url, 'jira2.blacklake.tech')
      const jql = `updated >= "${day} 00:00" AND updated <= "${day} 23:59" AND (assignee = changdongxu OR reporter = changdongxu)`
      const url = new URL('/rest/api/2/search', base)
      url.searchParams.set('jql', jql); url.searchParams.set('maxResults', '100'); url.searchParams.set('fields', 'summary,status,assignee,reporter,updated,resolution')
      const payload = await json(this.fetcher, url, cookie) as Record<string, unknown>
      return {
        status: 'available',
        issues: items(payload.issues).slice(0, 100).map(issue => {
          const fields = issue.fields && typeof issue.fields === 'object' ? issue.fields as Record<string, unknown> : {}
          const status = fields.status && typeof fields.status === 'object' ? fields.status as Record<string, unknown> : {}
          return { key: issue.key, summary: fields.summary, status: status.name, updated: fields.updated }
        }),
      }
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }
    }
  }

  private async gitlab(day: string): Promise<Readonly<Record<string, unknown>>> {
    try {
      const { state, cookie } = await auth(this.stateRoot, 'gitlab')
      const base = safeBase(state.base_url, 'gitlab.blacklake.tech')
      const userId = Number(state.user?.id)
      if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('GitLab auth state has no user id')
      const bounds = dayBounds(day)
      const eventUrl = new URL(`/api/v4/users/${userId}/events`, base)
      eventUrl.searchParams.set('after', day); eventUrl.searchParams.set('before', bounds.nextDay); eventUrl.searchParams.set('per_page', '100'); eventUrl.searchParams.set('sort', 'asc')
      const mrUrls = ['author_id', 'assignee_id', 'reviewer_id'].map(role => {
        const url = new URL('/api/v4/merge_requests', base)
        url.searchParams.set('scope', 'all'); url.searchParams.set(role, String(userId)); url.searchParams.set('updated_after', bounds.start)
        url.searchParams.set('updated_before', bounds.end); url.searchParams.set('per_page', '100')
        return url
      })
      const eventPayload = await json(this.fetcher, eventUrl, cookie)
      const mrResults = await Promise.allSettled(mrUrls.map(url => json(this.fetcher, url, cookie)))
      const mrPayloads = mrResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      const mergeRequests = new Map<string, Readonly<Record<string, unknown>>>()
      for (const mr of mrPayloads.flatMap(items)) mergeRequests.set(String(mr.web_url ?? `${mr.project_id}:${mr.iid}`), {
        title: mr.title, state: mr.state, webUrl: mr.web_url, projectId: mr.project_id, iid: mr.iid,
        updatedAt: mr.updated_at, mergedAt: mr.merged_at,
      })
      return {
        status: mrResults.every(result => result.status === 'fulfilled') ? 'available' : 'partial',
        events: items(eventPayload).slice(0, 100).map(event => ({
          action: event.action_name, targetType: event.target_type, targetTitle: event.target_title,
          projectId: event.project_id, createdAt: event.created_at,
          push: event.push_data && typeof event.push_data === 'object' ? {
            ref: (event.push_data as Record<string, unknown>).ref,
            action: (event.push_data as Record<string, unknown>).action,
            commitCount: (event.push_data as Record<string, unknown>).commit_count,
          } : undefined,
        })),
        mergeRequests: [...mergeRequests.values()].slice(0, 100),
      }
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }
    }
  }
}
