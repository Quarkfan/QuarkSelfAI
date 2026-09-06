# ADR 0117: Persist the inactive device-session protocol behind one server port

- Status: accepted
- Date: 2026-09-06

## Decision

The initial persistent device-session provider implements both the device protocol server port and its internal dispatch queue port over the same SQLite database as the tenant/device identity repository. It reads a registered device and its public key from `cp_device`; it does not copy device identity into another in-memory registry.

Challenges are single-use and time-bounded. Opening a verified proof atomically consumes the challenge and supersedes any previous active session for the same tenant/device. Dispatches are immutable and tenant-scoped, accept only signed `test.*` plans with no allowed effects or approval grants, and use a unique tenant/idempotency key. Polling creates one durable lease at a time, acknowledgement remains scoped to the authenticated session, and result insertion plus dispatch completion is one transaction. Results contain only bounded status codes and artifact digests; tenant and user are derived from the server session.

Session expiry uses server time. A client-provided `completedAt` is evidence only and cannot extend or revive a session.

The provider is `runtime=inactive`. It owns no listener, identity provider, scheduler, executor, capability lifecycle, Cordis mount, transport connection, raw output store, external effect, or production tenant path.

## Consequences

- The loopback HTTP edge can be integration-tested against persistent device state without creating a second consumer, provider, scheduler, or writer.
- Restart-safe challenge, lease, acknowledgement and result behavior is testable before any real client or executor is activated.
- Production PostgreSQL isolation, cryptographic key infrastructure, queue concurrency policy and network transport remain separate future gates.
- Rollback removes migration `004`, the inactive provider and its tests from a database created for this pilot. No live database or service is migrated.
