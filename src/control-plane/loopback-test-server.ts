import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DeviceTaskLeaseV1, PlanSignatureVerifierV1 } from '../client-runtime/contracts.js'
import { InactiveLocalRunJournalV1 } from '../client-runtime/inactive-run-journal.js'

const maxRequestBytes = 64 * 1024

export interface LoopbackPilotReceiptV1 {
  readonly schemaVersion: 1
  readonly tenantClass: 'synthetic-test'
  readonly taskId: string
  readonly planId: string
  readonly checkpointDigest: string
  readonly state: 'leased-unexecuted'
  readonly executorInvoked: false
  readonly externalWritesEnabled: false
  readonly currentOwnerPreserved: true
}

export interface LoopbackPilotServerV1 {
  readonly host: '127.0.0.1'
  readonly port: number
  close(): Promise<void>
}

/** Starts one test-only, ephemeral listener. No executor or effect port exists. */
export async function startLoopbackPilotServer(verifier: PlanSignatureVerifierV1, clock: () => Date = () => new Date()): Promise<LoopbackPilotServerV1> {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/pilot/lease' || request.headers['content-type'] !== 'application/json') {
        response.writeHead(404).end()
        return
      }
      const body = await readBoundedBody(request)
      const value = JSON.parse(body) as { lease?: DeviceTaskLeaseV1; executorId?: string }
      if (!value.lease || typeof value.executorId !== 'string' || !value.lease.plan.envelope.tenantId.startsWith('test.')) throw new Error('loopback pilot accepts synthetic test leases only')
      const journal = new InactiveLocalRunJournalV1(verifier)
      const checkpoint = await journal.acceptLease(value.lease, value.executorId, clock())
      const receipt: LoopbackPilotReceiptV1 = Object.freeze({
        schemaVersion: 1,
        tenantClass: 'synthetic-test',
        taskId: checkpoint.taskId,
        planId: checkpoint.plan.planId,
        checkpointDigest: checkpoint.checkpointDigest,
        state: 'leased-unexecuted',
        executorInvoked: false,
        externalWritesEnabled: false,
        currentOwnerPreserved: true,
      })
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(receipt))
    } catch {
      response.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: 'invalid-pilot-request' }))
    }
  })
  await listen(server)
  const address = server.address() as AddressInfo | null
  if (!address || address.address !== '127.0.0.1' || address.port <= 0) {
    await close(server)
    throw new Error('pilot listener did not bind to an ephemeral loopback address')
  }
  return Object.freeze({ host: '127.0.0.1', port: address.port, close: () => close(server) })
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

async function readBoundedBody(request: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxRequestBytes) throw new Error('pilot request is too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
