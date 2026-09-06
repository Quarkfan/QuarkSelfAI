# ADR 0113: One framed device protocol across direct TLS and SSH

Status: Accepted (codec implemented; transports inactive)

## Decision

Direct TLS and the SSH subsystem carry the same `quark-device-sync.v1` messages. The protocol covers client hello, device challenge/proof, session,
task poll/lease/acknowledgement, redacted result and heartbeat. Every message is explicitly scoped to tenant, user and device, has a message id and
optional correlation id, and is encoded as a 32-bit length-prefixed JSON frame capped at 256 KiB.

The incremental decoder supports arbitrary stream chunking, so HTTPS/WebSocket and SSH adapters do not reinterpret business or execution semantics.
Unknown top-level fields, unknown payload kinds, cross-scope nested records, host paths, secret-shaped assignments, invalid framing and oversized data
fail closed. Signed-plan verification, device proof verification, lease ownership and result acceptance remain downstream gates and are not replaced by
the codec.

## Consequences

- switching network transports cannot create a second task format or weaken approvals;
- raw local files, directory listings, credentials and process output remain outside the wire contract;
- the codec opens no socket and neither transport is activated by this decision;
- rollback removes the codec and ADR without state migration or service recovery.
