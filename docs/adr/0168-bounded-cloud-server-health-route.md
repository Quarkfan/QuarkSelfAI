# ADR 0168: Bounded cloud server health route

- Status: accepted for inactive cloud server
- Date: 2026-09-06

## Context

A future service activation cannot treat a service-manager command or process existence as proof that the single provider graph and TLS edge are ready. The cloud API had no unauthenticated readiness route, so an installer could only watch process stdout or attempt a tenant-scoped operation.

## Decision

Expose exact `GET /v1/health` through the existing cloud HTTP handler. It returns only the stable code `ok`, state `ready`, provider ownership `single-shared-host`, and `externalEffectsEnabled=false`. It requires no session and performs no tenant lookup, provider call, database write or effect. Other methods on the path remain absent.

The response is reachable only after the single cloud composition, SSH IPC and TLS edge have all opened, because the listener wraps that already-constructed host. A future service activation gate must verify this response over the configured TLS endpoint and pinned installed certificate; process existence alone is insufficient.

This route does not register or start a service, make the listener public, weaken tenant authorization, enable effects or declare the current runtime migrated.

## Verification and rollback

An offline handler test verifies the exact response, absence of provider calls and rejection of POST. Existing TLS adapter tests verify `/v1/health` is carried over TLS 1.3 with bounded no-store JSON responses. Rollback removes the exact route and test; no state migration or service action is required.
