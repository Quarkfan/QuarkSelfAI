# ADR 0143: Add a recoverable installed-client process entry

- Status: accepted
- Date: 2026-09-06

## Context

The no-effect worker had lifecycle semantics but no production composition that recovered an installed client, opened the pinned verifier and local Keychain-backed state, and closed them in the correct order. A future service manager also needs a deterministic process entry which cannot be activated accidentally by merely installing files.

## Decision

Add `InstalledNoEffectClientProcessV1` as the sole owner of one recovered installation, one configured encrypted client and one no-effect worker. Opening validates the installation and local workspace but remains inert; starting is separate. Closing first stops and drains the worker, then closes the configured client and releases its instance lease. Partial construction closes the client before returning an error.

Add a direct Node entry with exactly two commands. `status` only revalidates the inactive installation and emits a closed privacy-bounded receipt; it does not read Keychain, create client state, connect or discover. `run` requires the explicit environment gate `QUARK_CLIENT_ENABLE_NO_EFFECT_WORKER=1`, plus install root and workspace supplied locally. Its interval values use decimal-only bounded worker validation. SIGTERM and SIGINT drain the worker and close the single owner. Startup/runtime failure output is a stable code and never includes nested exception text or local paths.

The default scheduler keeps the explicitly started process alive between passes. No package bin, launchd/systemd registration or automatic installation activation is added in this batch.

## Verification and rollback

Tests prove inert composition, ordered and idempotent close, partial-open cleanup, closed command parsing and explicit activation. A built-process test creates a real temporary inactive installation and invokes `node dist/client-runtime/client-entry.js status`; output contains only the installation identity/version/state and the state directory remains empty.

Rollback removes the process owner, entry, tests, catalog ownership and this ADR. No service is registered, no real Keychain item is accessed, no network is opened and no persistent client state needs migration.
