# ADR 0131: resumable client device enrollment

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Persist the client half of device-code enrollment without persisting its bearer credential in SQLite. The local database stores one request id, display code, device id, expiry, poll cadence, state and opaque `secret:` reference. The poll token itself is written to the authenticated encrypted local secret store. Public views expose only the request, display code, verification path, bounded status and whether credential cleanup remains pending.

Repeated begin calls reuse the same pending request across process restart. Poll loads the encrypted token only for one server call, validates exact request/device/expiry correspondence, and clears temporary byte buffers. On approved or expired status, SQLite first advances to a durable cleanup-pending state, then removes the token and records the final state. A crash after token removal is recoverable because an already absent token counts as cleaned. An approved request remains final; only a fully cleaned expired request may be deleted and replaced by a new begin.

The flow is exposed only through explicit methods on the inactive encrypted-client owner. It does not poll automatically, open an HTTP connection, approve itself, start a daemon, discover or invoke an executor, or alter any current consumer/provider/effect owner.

## Rollback

Remove the local enrollment table and state methods, client enrollment workflow, application delegates, tests, catalog entry and this ADR. Existing identity, artifact and run-checkpoint rows are independent. Tests create only temporary SQLite and encrypted-secret directories.
