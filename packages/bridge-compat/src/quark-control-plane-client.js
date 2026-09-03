export class QuarkControlPlaneClient {
  constructor({
    baseUrl = process.env.QUARK_CONTROL_URL || 'http://127.0.0.1:3210',
    token = process.env.CONTROL_PLANE_TOKEN,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '')
    this.token = token
    this.fetchImpl = fetchImpl
  }

  async request(pathname, payload) {
    if (!this.token) throw new Error('CONTROL_PLANE_TOKEN is not configured')
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    const envelope = await response.json().catch(() => ({}))
    if (!response.ok || envelope.ok !== true) {
      throw new Error(`QuarkSelfAI control plane rejected the request (${response.status}): ${String(envelope.error || 'unknown error')}`)
    }
    return envelope
  }

  async proposePolicy(sourceText, document) {
    const envelope = await this.request('/internal/policies/proposals', { sourceText, document })
    return envelope.proposal
  }

  async activatePolicy(id, revision, ownerConfirmed) {
    await this.request(`/internal/policies/${encodeURIComponent(id)}/revisions/${revision}/activate`, { ownerConfirmed })
    return { id, revision, status: 'enabled' }
  }

  async evaluatePolicies(facts) {
    const envelope = await this.request('/internal/policies/evaluate', { facts })
    return envelope.evaluation
  }

  async queryWorkJournal(from, to, limit = 3660) {
    const envelope = await this.request('/internal/work-journal/query', { from, to, limit })
    return envelope.result
  }
}
