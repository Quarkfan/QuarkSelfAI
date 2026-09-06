# ADR 0160: Installed first-owner bootstrap

- Status: accepted
- Date: 2026-09-06

## Context

The transactional first-owner primitive previously accepted arbitrary validated paths, while the server installation lifecycle did not bind it to an installed distribution and configuration. An operator could therefore select checkout migrations or a different database and still believe the installed server had been initialized.

## Decision

Add one installation-scoped bootstrap operation. It first recovers the installed program and inactive host configuration, requires empty runtime and state namespaces, and derives the identity database plus tenant and identity migration paths from that installation. The existing transactional primitive then creates exactly one active tenant, user and fixed owner account without a session. A private receipt written after database close binds the owner identity to the installation and configuration while fixing service registration, SSH application, auto-start and external effects off.

Recovery verifies the program/configuration lineage, exact inactive state layout, owner-only single-link SQLite file, SQLite integrity and exactly one active tenant, user and owner account with no browser sessions. It does not authenticate, retain a credential, open a listener or mutate the database.

The database is durable user state as soon as bootstrap succeeds. There is deliberately no delete or rollback operation. Receipt-write interruption leaves recoverable state that must be repaired forward by a future explicit recovery operation; it must never trigger automatic database deletion.

## Verification and rollback

Tests build an installed/configured fixture, create one owner, authenticate through the persistent identity provider, prove the credential is absent from raw database bytes and recover the bounded receipt. They also prove a second bootstrap is refused and receipt/database identity drift fails closed.

Code rollback removes the wrapper, tests, ADR and catalog ownership only. Any database created through the operation must be preserved; restoring a prior binary or completing receipt recovery is safer than deleting state.
