import type { DeviceEnrollmentClientPortV1, DeviceEnrollmentRequestV1, DeviceEnrollmentStatusV1 } from '../control-plane/contracts.js'

const maxResponseBytes = 64 * 1024
const idPattern = /^[a-z0-9][a-z0-9._:-]{0,255}$/
const pollTokenPattern = /^[A-Za-z0-9_-]{43}$/
const userCodePattern = /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/

/** Outbound-only public enrollment client. It deliberately has no authenticated approval operation. */
export class NodeInactiveHttpDeviceEnrollmentTransportV1 implements DeviceEnrollmentClientPortV1 {
  readonly #base: URL

  constructor(endpoint: string, private readonly timeoutMs = 5_000, private readonly fetcher: typeof fetch = fetch) {
    let value: URL
    try { value = new URL(endpoint) } catch { throw new Error('device enrollment endpoint must be HTTPS or explicit ephemeral IPv4 loopback') }
    const loopback = value.protocol === 'http:' && value.hostname === '127.0.0.1' && Boolean(value.port)
    if ((!loopback && value.protocol !== 'https:') || value.username || value.password || value.search || value.hash || value.pathname !== '/' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('device enrollment endpoint must be HTTPS or explicit ephemeral IPv4 loopback')
    }
    this.#base = value
  }

  async begin(input: { readonly tenantId: string; readonly userId: string; readonly deviceId: string; readonly publicKey: string }): Promise<DeviceEnrollmentRequestV1> {
    if (![input.tenantId, input.userId, input.deviceId].every(value => idPattern.test(value)) || typeof input.publicKey !== 'string' || input.publicKey.length < 32 || input.publicKey.length > 2_048) throw new Error('device enrollment input is invalid')
    const item = exactObject(await this.#post('/v1/device-enrollments', input), ['schemaVersion', 'requestId', 'userCode', 'pollToken', 'verificationPath', 'expiresAt', 'pollAfterSeconds'])
    if (item.schemaVersion !== 1 || typeof item.requestId !== 'string' || !/^enrollment\.[a-f0-9]{32}$/.test(item.requestId) || typeof item.userCode !== 'string' || !userCodePattern.test(item.userCode) || typeof item.pollToken !== 'string' || !pollTokenPattern.test(item.pollToken) || item.verificationPath !== '/devices/activate' || item.pollAfterSeconds !== 5 || !validTime(item.expiresAt)) throw new Error('device enrollment transport returned an invalid request')
    return item as unknown as DeviceEnrollmentRequestV1
  }

  async poll(input: { readonly requestId: string; readonly pollToken: string }): Promise<DeviceEnrollmentStatusV1> {
    if (!/^enrollment\.[a-f0-9]{32}$/.test(input.requestId) || !pollTokenPattern.test(input.pollToken)) throw new Error('device enrollment poll input is invalid')
    const item = exactObject(await this.#post('/v1/device-enrollments/poll', input), ['schemaVersion', 'requestId', 'deviceId', 'state', 'expiresAt'])
    if (item.schemaVersion !== 1 || item.requestId !== input.requestId || typeof item.deviceId !== 'string' || !idPattern.test(item.deviceId) || !['pending', 'approved', 'expired'].includes(String(item.state)) || !validTime(item.expiresAt)) throw new Error('device enrollment transport returned an invalid status')
    return item as unknown as DeviceEnrollmentStatusV1
  }

  async #post(path: string, body: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher(new URL(path, this.#base), {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch {
      throw new Error('device enrollment transport request failed')
    }
    if (response.redirected) throw new Error('device enrollment transport rejected a redirect')
    const lengthHeader = response.headers.get('content-length')
    if (lengthHeader && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > maxResponseBytes)) throw new Error('device enrollment transport response is too large')
    const text = await readBounded(response)
    let value: unknown
    try { value = JSON.parse(text) } catch { throw new Error('device enrollment transport response is not JSON') }
    const envelope = exactObject(value, ['code', 'item'])
    const expectedCode = path.endsWith('/poll') ? 'ok' : 'created'
    if (!response.ok || envelope.code !== expectedCode) throw new Error('device enrollment transport rejected request')
    return envelope.item
  }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('device enrollment transport response is invalid')
  const item = value as Record<string, unknown>
  if (Object.keys(item).sort().join(',') !== [...keys].sort().join(',')) throw new Error('device enrollment transport response fields are invalid')
  return item
}

function validTime(value: unknown): boolean { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) }

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > maxResponseBytes) throw new Error('device enrollment transport response is too large')
      chunks.push(result.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  return Buffer.concat(chunks, size).toString('utf8')
}
