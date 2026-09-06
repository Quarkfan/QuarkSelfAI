# ADR 0148: Registered-tenant inactive cloud composition

- Status: accepted for inactive implementation
- Date: 2026-09-06

## Context

The control-plane providers were persistent and tenant-scoped, but each standalone factory rejected every tenant outside the `test.*` fixture namespace. The cloud application therefore had no executable composition proving that a bootstrapped, authenticated tenant could use the same identity, tenant, device, Capability Registry and Agent Studio state without adding a second provider graph.

Removing the prefix check globally would weaken fixture safety. Mounting a listener at the same time would also combine tenant admission, provider composition and network activation into one irreversible boundary.

## Decision

Add an explicit `test-only | registered` admission mode to the persistent Agent Studio, Capability Registry and device-session providers. Their public factory default remains `test-only`. Only `InactiveCloudControlPlaneCompositionV1` selects `registered`, and all application requests derive tenant, user and roles from the persistent identity session. The same closed role authorization instance is injected into tenant, Registry and Studio operations; there is no administrator bypass or cross-tenant subject.

The composition opens all providers against one already-bootstrapped SQLite database. It requires an exact config, absolute canonical migrations, and an existing single-link 0600 database under a canonical process-owned 0700 directory. Both `listenerEnabled` and `externalEffectsEnabled` must be exactly `false`. It owns no listener, scheduler, dispatcher, executor, capability lifecycle or effect port.

The application remains a workflow module with runtime provider dependencies. The concrete provider graph is a separate inactive operations module, so workflow source code does not import provider implementations and the composition cannot be mistaken for an active owner.

## Verification and rollback

Integration tests bootstrap a synthetic non-fixture tenant, authenticate through the real scrypt identity provider, and read device, Capability and Agent Studio endpoints from the session-derived scope. Separate tests prove the closed owner/member/auditor matrix, reject unknown roles, activation flags, unknown config fields and unsafe database permissions, while existing provider tests retain `test-only` as their default.

No listener, real account, service, client connection, executor, scheduler, external effect or current product composition is created. Rollback removes this composition and its catalog mapping, removes the optional admission parameter, and restores the providers to unconditional `test.*` admission. Because the composition is not mounted and the test database is deleted, rollback has no live state migration or owner cutover.
