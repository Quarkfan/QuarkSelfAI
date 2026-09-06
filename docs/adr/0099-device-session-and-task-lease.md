# ADR 0099: Device session and task lease protocol

Status: Accepted (inactive reference implementation)

## Decision

A registered device proves possession of its private key by signing a bounded, expiring challenge. The cloud-side protocol keeps only the public key,
supersedes the previous active session for the same tenant/user/device, and permits exactly one active session owner. Tasks are scoped to that identity
and leased one at a time. Polling before lease expiry returns the same lease; retry after expiry creates a new token and increments the attempt.

The lease carries the immutable signed execution plan, but the reference coordinator accepts only `test.*` tenants and plans with no effects or
approval grants. It cannot launch an executor or complete a task.

## Consequences

- reconnects do not create parallel device consumers;
- tenant/user/device scope and idempotency survive polling and retry;
- the client still independently verifies the signed plan before execution;
- production transport, persistence, revocation, rate limiting and certificate binding remain future approval-gated work;
- rollback is a code revert with no state or service operation.
