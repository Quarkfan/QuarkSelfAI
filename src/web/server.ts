import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AssistantStore } from '../storage/types.js'
import {
  ControlOnlyKernel, ControlOnlyRuntime, UnconfiguredReadiness,
  type KernelStatusProvider, type OperationalReadinessProvider, type RuntimeStatusProvider,
} from '../platform/operations.js'
import { PolicyAuthoringService, policyProposalId } from '../policy/authoring.js'
import { matchesPolicy } from '../policy/engine.js'
import type { PolicyDocument } from '../policy/types.js'
import { loadModuleCatalog, summarizeModules } from '../platform/modules.js'

const webRoot = fileURLToPath(new URL('../../web/', import.meta.url))
const startedAt = Date.now()
const sessionCookie = 'quark_console_session'

export interface ConsoleConfig {
  readonly execution: { readonly mode: 'local' | 'remote'; readonly workspaceRoots: readonly string[] }
  readonly web: {
    readonly consoleToken?: string
    readonly secureCookie: boolean
    readonly dshUrl?: string
  }
  readonly controlPlane: { readonly token?: string }
}

const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

function tokenHash(token: string): string {
  return createHash('sha256').update(`quark-self-ai:${token}`).digest('hex')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function cookie(request: IncomingMessage, name: string): string | undefined {
  for (const item of request.headers.cookie?.split(';') ?? []) {
    const [key, ...value] = item.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

function authorized(request: IncomingMessage, config: ConsoleConfig): boolean {
  const expected = config.web.consoleToken
  if (!expected) return true
  const current = cookie(request, sessionCookie)
  return current !== undefined && safeEqual(current, tokenHash(expected))
}

function controlPlaneAuthorized(request: IncomingMessage, config: ConsoleConfig): boolean {
  const expected = config.controlPlane.token
  if (!expected) return false
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) return false
  return safeEqual(authorization.slice('Bearer '.length), expected)
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 16_384) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) as Record<string, unknown> : {}
}

async function dashboard(store: AssistantStore, runtimeStatus: RuntimeStatusProvider, kernelStatus: KernelStatusProvider, readinessProvider: OperationalReadinessProvider, config: ConsoleConfig) {
  const [overview, events, matters, actions, approvals, policies, readiness, diagnostics, moduleCatalog] = await Promise.all([
    store.overview(),
    store.recentEvents(12),
    store.recentMatters(12),
    store.recentActions(12),
    store.pendingApprovals(12),
    store.policies(20),
    readinessProvider.inspect(),
    runtimeStatus.diagnostics?.() ?? Promise.resolve(undefined),
    loadModuleCatalog(),
  ])
  const worker = runtimeStatus.snapshot()
  return {
    runtime: {
      version: '0.1.0',
      storage: store.kind,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      mode: worker.operationalMode ?? 'unknown',
      worker,
      kernel: kernelStatus.snapshot(),
      execution: {
        mode: config.execution.mode,
        workspaceRootCount: config.execution.workspaceRoots.length,
      },
      conversationUrl: config.web.dshUrl,
    },
    diagnostics,
    overview,
    events,
    matters,
    actions,
    approvals,
    policies,
    readiness,
    architecture: {
      summary: summarizeModules(moduleCatalog),
      modules: moduleCatalog.modules,
    },
    generatedAt: new Date().toISOString(),
  }
}

async function staticFile(pathname: string, response: ServerResponse): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const filename = resolve(webRoot, relative)
  if (!filename.startsWith(`${resolve(webRoot)}${sep}`)) {
    response.writeHead(404).end()
    return
  }
  try {
    const data = await readFile(filename)
    response.writeHead(200, {
      'content-type': contentTypes[extname(filename)] ?? 'application/octet-stream',
      'cache-control': relative === 'index.html' || ['.js', '.css'].includes(extname(filename))
        ? 'no-cache'
        : 'public, max-age=300',
    })
    response.end(data)
  } catch {
    response.writeHead(404).end('Not found')
  }
}

export function createConsoleServer(
  store: AssistantStore,
  config: ConsoleConfig,
  runtimeStatus: RuntimeStatusProvider = new ControlOnlyRuntime(),
  kernelStatus: KernelStatusProvider = new ControlOnlyKernel(),
  readiness: OperationalReadinessProvider = new UnconfiguredReadiness(),
): Server {
  const policyAuthoring = new PolicyAuthoringService(store, {
    async compile() {
      throw new Error('the HTTP control plane accepts only an already-compiled candidate')
    },
  })
  return createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('x-frame-options', 'DENY')
    response.setHeader('referrer-policy', 'no-referrer')
    const dshOrigin = config.web.dshUrl ? new URL(config.web.dshUrl).origin : "'none'"
    response.setHeader('content-security-policy', `default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src ${dshOrigin}`)
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    try {
      if (request.method === 'POST' && url.pathname === '/api/login') {
        const expected = config.web.consoleToken
        if (!expected) {
          json(response, 200, { ok: true })
          return
        }
        const submitted = (await body(request)).token
        if (typeof submitted !== 'string' || !safeEqual(submitted, expected)) {
          json(response, 401, { ok: false, error: 'invalid token' })
          return
        }
        const secure = config.web.secureCookie ? '; Secure' : ''
        response.setHeader('set-cookie', `${sessionCookie}=${encodeURIComponent(tokenHash(expected))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`)
        json(response, 200, { ok: true })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/logout') {
        response.setHeader('set-cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
        json(response, 200, { ok: true })
        return
      }
      if (url.pathname.startsWith('/internal/')) {
        if (!controlPlaneAuthorized(request, config)) {
          json(response, 401, { ok: false, error: 'control-plane authentication required' })
          return
        }
        if (request.method === 'POST' && url.pathname === '/internal/policies/proposals') {
          const input = await body(request)
          if (typeof input.sourceText !== 'string' || typeof input.document !== 'object' || input.document === null || Array.isArray(input.document)) {
            json(response, 400, { ok: false, error: 'sourceText and document are required' })
            return
          }
          const samples = await store.recentPolicySamples(200)
          const proposal = await policyAuthoring.proposeCompiled(
            input.sourceText,
            input.document as unknown as PolicyDocument,
            samples,
            policyProposalId(input.sourceText, input.document as unknown as PolicyDocument),
          )
          json(response, 201, { ok: true, proposal })
          return
        }
        if (request.method === 'POST' && url.pathname === '/internal/policies/evaluate') {
          const input = await body(request)
          if (typeof input.facts !== 'object' || input.facts === null || Array.isArray(input.facts)) {
            json(response, 400, { ok: false, error: 'facts object is required' })
            return
          }
          const matches = (await store.policies(200))
            .filter((policy) => policy.status === 'enabled' && matchesPolicy(policy.document.when, input.facts as Record<string, unknown>))
            .sort((left, right) => right.document.priority - left.document.priority)
          const effect: Record<string, unknown> = {}
          for (const policy of matches) {
            for (const [key, value] of Object.entries(policy.document.effect)) {
              if (effect[key] === undefined) effect[key] = value
            }
          }
          json(response, 200, {
            ok: true,
            evaluation: {
              effect,
              matches: matches.map((policy) => ({ id: policy.id, revision: policy.revision, name: policy.name })),
            },
          })
          return
        }
        const activation = /^\/internal\/policies\/([^/]+)\/revisions\/(\d+)\/activate$/.exec(url.pathname)
        if (request.method === 'POST' && activation) {
          const input = await body(request)
          if (input.ownerConfirmed !== true) {
            json(response, 400, { ok: false, error: 'ownerConfirmed=true is required' })
            return
          }
          await policyAuthoring.activate(decodeURIComponent(activation[1] ?? ''), Number(activation[2]), true)
          json(response, 200, { ok: true })
          return
        }
        const rollback = /^\/internal\/policies\/([^/]+)\/revisions\/(\d+)\/rollback$/.exec(url.pathname)
        if (request.method === 'POST' && rollback) {
          const input = await body(request)
          if (input.ownerConfirmed !== true) {
            json(response, 400, { ok: false, error: 'ownerConfirmed=true is required' })
            return
          }
          await policyAuthoring.rollback(decodeURIComponent(rollback[1] ?? ''), Number(rollback[2]), true)
          json(response, 200, { ok: true })
          return
        }
        json(response, 404, { ok: false, error: 'not found' })
        return
      }
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/health') {
          await store.health()
          const readinessReport = await readiness.inspect()
          const worker = runtimeStatus.snapshot()
          const workerHealthy = worker.requiredForHealth === false || worker.state === 'ready'
          const kernel = kernelStatus.snapshot()
          const kernelHealthy = kernel.mode === 'off' || kernel.state === 'ready'
          json(response, workerHealthy && kernelHealthy ? 200 : 503, {
            ok: workerHealthy && kernelHealthy,
            storage: store.kind,
            readiness: {
              id: readinessReport.id,
              state: readinessReport.state,
              blockers: readinessReport.blockers,
            },
            operationalMode: worker.operationalMode ?? 'unknown',
            worker,
            kernel,
          })
          return
        }
        if (!authorized(request, config)) {
          json(response, 401, { ok: false, error: 'authentication required' })
          return
        }
        if (request.method === 'GET' && url.pathname === '/api/dashboard') {
          json(response, 200, { ok: true, data: await dashboard(store, runtimeStatus, kernelStatus, readiness, config) })
          return
        }
        if (request.method === 'GET' && url.pathname === '/api/dsh-health') {
          if (!config.web.dshUrl) {
            json(response, 503, { ok: false, error: 'DSH web surface is disabled' })
            return
          }
          try {
            const upstream = await fetch(config.web.dshUrl, { signal: AbortSignal.timeout(3_000) })
            json(response, upstream.ok ? 200 : 503, {
              ok: upstream.ok,
              status: upstream.status,
              embeddable: !upstream.headers.has('x-frame-options')
                && !/frame-ancestors/i.test(upstream.headers.get('content-security-policy') ?? ''),
            })
          } catch (error) {
            json(response, 503, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        const monitor = /^\/api\/monitors\/([^/]+)$/.exec(url.pathname)
        if (request.method === 'PATCH' && monitor) {
          if (!runtimeStatus.updateMonitor) {
            json(response, 409, { ok: false, error: 'monitor configuration is unavailable in this runtime' })
            return
          }
          const input = await body(request)
          const enabled = typeof input.enabled === 'boolean' ? input.enabled : undefined
          const intervalMs = typeof input.intervalMs === 'number' ? input.intervalMs : undefined
          await runtimeStatus.updateMonitor(decodeURIComponent(monitor[1] ?? ''), {
            ...(enabled !== undefined ? { enabled } : {}),
            ...(intervalMs !== undefined ? { intervalMs } : {}),
          })
          json(response, 200, { ok: true, restarting: true })
          setTimeout(() => {
            process.exitCode = 75
            process.kill(process.pid, 'SIGTERM')
          }, 250).unref()
          return
        }
        json(response, 404, { ok: false, error: 'not found' })
        return
      }
      await staticFile(url.pathname, response)
    } catch (error) {
      json(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
