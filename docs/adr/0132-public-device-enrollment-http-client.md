# ADR 0132: public device-enrollment HTTP client

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Split the client-visible enrollment contract from the server administration contract. `DeviceEnrollmentClientPortV1` exposes only public `begin` and `poll`; the server contract extends it with authenticated `approve`. Local client owners depend on the narrower contract, so a compromised or incorrectly wired client cannot approve its own enrollment through the injected port.

Provide an outbound-only Node HTTP adapter for that client contract. Production endpoints require HTTPS. Plaintext is accepted only for an explicit IPv4 loopback host with a non-empty port, for bounded tests. URL credentials, paths, query strings, fragments, redirects, browser credentials and cookies are rejected or omitted. Requests use only the two public enrollment routes. Responses are stream-limited to 64 KiB even without `Content-Length` and must match exact envelope and item schemas; request identity drift, unknown fields and invalid codes fail closed. Network and server errors are normalized without echoing response bodies or poll credentials.

The adapter remains runtime-inactive and is not mounted in the product composition. It does not poll automatically, approve a device, provision credentials, start a listener or daemon, discover or invoke an executor, activate a capability, or enable an effect. The real-network test edge binds only `127.0.0.1:0`, uses synthetic identity and temporary SQLite, and closes before exit.

## Rollback

Remove the enrollment HTTP adapter and its tests, return local enrollment owners to the server-wide contract, remove this ADR and the adapter ownership entry. No live configuration, credential, database, device or service state is created by this change.
