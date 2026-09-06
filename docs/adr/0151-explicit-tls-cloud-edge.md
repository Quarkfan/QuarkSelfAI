# ADR 0151: Explicit TLS cloud edge

- Status: accepted for inactive implementation
- Date: 2026-09-06

## Context

The control plane had a bounded HTTP handler and a single-provider transport host, but no real encrypted server edge. A deployable client/server platform cannot treat a plaintext loopback fixture as evidence for its primary direct transport.

## Decision

Add an explicit Node TLS edge around an already-constructed handler. It never creates a repository or provider. Configuration is closed and requires `enabled=true`, a literal IP bind, bounded port/timeouts/connections, `providerOwnership=shared-host`, and `externalEffectsEnabled=false`. Port zero is allowed only for the IPv4 loopback test path. TLS is pinned to version 1.3.

Certificate and key bytes are injected by the caller and are never accepted through JSON config, argv, logs or receipts. The edge inherits the existing 64 KiB request body, closed method/path/session-header parsing, stable error responses and no-store headers. Starting it always requires an explicit function call; it is not mounted in any product or service composition.

## Verification and rollback

A host-level test generates a one-day temporary certificate, completes a real TLS 1.3 request over `127.0.0.1:0`, verifies bounded handler routing, then closes every connection and deletes the certificate directory. A first run exposed an incorrect connection-close ordering; the edge now enters server close before destroying remaining connections, and the test process exits cleanly. Static tests reject wildcard ephemeral bind, independent provider ownership and invalid PEM material.

Rollback removes the TLS edge, test, ADR and module ownership update. No service, real certificate, DNS, firewall, public port or external effect is created.
