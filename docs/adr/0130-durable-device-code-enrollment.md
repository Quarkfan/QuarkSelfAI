# ADR 0130: durable device-code enrollment

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Register installed clients through an OAuth-device-style flow so a client never receives the user's browser session, cookie or bearer credential. The client begins with its claimed tenant/user scope, device id and a syntactically and cryptographically valid Ed25519 SPKI public key. The provider persists a ten-minute pending request and returns a 64-bit display code plus an independent 256-bit poll token. Only the SHA-256 poll-token digest is stored.

An already authenticated user approves the display code. The application derives tenant and user from its opaque cloud session and rejects any mismatch with the request hints before invoking the existing `TenantDevicePortV1`; the enrollment provider does not become a second device writer. Approval is serialized per provider, uses an explicit `approving` state, retries an idempotent device registration after failure or interrupted approval, and exposes `approving` only as pending. Requests that never begin approval expire deterministically. Poll requires exact request id and poll-token possession and returns only request id, device id, state and expiry.

The inactive HTTP contract exposes public begin/poll and authenticated approve routes. No listener or runtime composition mounts the provider. Before any public activation, the edge must add request-size, per-source and per-scope rate limits, bounded retention/cleanup, origin and CSRF protection for approval, security telemetry and a real authenticated activation UI. This batch performs no live registration, connection, consumer/provider switch or external effect.

## Rollback

Remove the enrollment contracts, SQLite provider and migration, inactive application/HTTP routes, tests, catalog entry and this ADR. No existing control-plane schema or device record requires migration because the new table is additive and was exercised only in temporary test databases.
