# ADR 0159: Inactive server host configuration

- Status: accepted
- Date: 2026-09-06

## Context

An installed server has immutable program bytes and empty host namespaces, but it cannot be initialized safely until its listener, IPC, migration, state and plan-verification inputs are bound to that exact installation. Hand-written configuration could reference checkout files, accept mismatched TLS credentials or accidentally imply that a listener, database, service or SSH gateway is active.

## Decision

Provision host configuration only into a verified, unused inactive installation. The operation requires canonical owner-only TLS source files, cryptographically verifies that the certificate matches the private key and validates one pinned Ed25519 plan-verification key. It copies the credentials into the installation's private config namespace, renders closed server and SSH configurations that reference only installed program, runtime and state paths, and writes a content-addressed receipt last.

The configuration fixes listener activation off, external effects off, single shared provider ownership, no database initialization, no first owner, no service registration, no SSH gateway application and no auto-start. Recovery verifies the installation, exact configuration layout, all digests, private file invariants and the TLS key pair without opening a database or socket. Removal is allowed only while runtime and state namespaces remain empty and deletes only the known configuration files.

Database bootstrap or restore, first-owner creation, service definition/registration, OpenSSH plan application and process activation remain independent lifecycle transitions.

## Verification and rollback

Tests provision a synthetic installed distribution with a real self-signed certificate, recover the exact receipt and remove unchanged configuration. They also prove credential drift is detected and any durable state blocks configuration rollback.

Rollback removes the configuration implementation, tests, ADR and catalog ownership only before any installation has acquired state. A configured installation with runtime or durable state must be preserved and recovered forward; code rollback must not delete its credentials or tenant data.
