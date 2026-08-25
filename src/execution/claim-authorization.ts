import type { ExecutorRequest } from '../domain/contracts.js'

declare const durableExecutorAuthorization: unique symbol

/** Opaque, single-use capability issued only from a claimed durable action. */
export interface DurableExecutorAuthorization {
  readonly [durableExecutorAuthorization]: true
}

interface AuthorizationBinding {
  readonly actionId: string
  readonly title: string
  readonly prompt: string
  readonly workspace: string
  readonly mode: ExecutorRequest['mode']
}

const issued = new WeakMap<object, AuthorizationBinding>()

export function issueDurableExecutorAuthorization(
  request: ExecutorRequest,
  approvalGranted: boolean,
): DurableExecutorAuthorization | undefined {
  if (request.mode === 'read-only') return undefined
  if (!approvalGranted) throw new Error(`${request.mode} execution requires an approved durable action claim`)
  const capability = Object.freeze({}) as DurableExecutorAuthorization
  issued.set(capability, binding(request))
  return capability
}

export function consumeDurableExecutorAuthorization(
  authorization: DurableExecutorAuthorization | undefined,
  request: ExecutorRequest,
): void {
  if (request.mode === 'read-only') return
  if (!authorization) throw new Error(`${request.mode} execution requires an approved durable action claim`)
  const expected = issued.get(authorization)
  issued.delete(authorization)
  if (!expected || !sameBinding(expected, binding(request))) {
    throw new Error(`${request.mode} execution has invalid durable action claim authorization`)
  }
}

function binding(request: ExecutorRequest): AuthorizationBinding {
  return {
    actionId: request.actionId,
    title: request.title,
    prompt: request.prompt,
    workspace: request.workspace,
    mode: request.mode,
  }
}

function sameBinding(left: AuthorizationBinding, right: AuthorizationBinding): boolean {
  return left.actionId === right.actionId
    && left.title === right.title
    && left.prompt === right.prompt
    && left.workspace === right.workspace
    && left.mode === right.mode
}
