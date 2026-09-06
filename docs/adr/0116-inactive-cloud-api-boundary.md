# ADR 0116: Cloud API routing is testable without owning a listener

- Status: accepted
- Date: 2026-09-06

## Decision

The authenticated cloud application exposes device registration/listing together with Capability Registry and Agent Studio operations. Tenant and user context always comes from an opaque session reference resolved by the identity port; request bodies cannot provide either identifier.

A fetch-independent HTTP handler defines the initial `/v1/devices`, `/v1/capabilities`, and `/v1/agent-drafts` routes. It accepts already-decoded bounded request objects, enforces closed bodies, rejects tenant injection, and returns stable error codes without returning exception details.

The handler does not open a listener, parse bearer tokens or cookies, own TLS, select an identity provider, or mount into the current product composition.

## Consequences

- Device onboarding and control-plane reads have executable API semantics before a network surface is authorized.
- A future HTTP/TLS adapter remains responsible for request-size limits, credential parsing, rate limits and listener lifecycle.
- Rollback removes the unmounted application/handler and tests; no live state or service requires restoration.
