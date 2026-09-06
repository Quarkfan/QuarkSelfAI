# ADR 0158: Inactive server installation lifecycle

- Status: accepted
- Date: 2026-09-06

## Context

A verified distribution is not yet an installable or recoverable server. Copying it ad hoc could silently alter bytes, mix host configuration with program state or make uninstall delete tenant data.

## Decision

Install only a verified server distribution into one new absolute root under a canonical parent. Copy every manifest-owned file, force private permissions and independently verify the copied distribution before creating empty private `config`, `runtime` and `state` namespaces. Write a bounded receipt last. The receipt binds installation identity, version, source revision and distribution digest while fixing configuration absent, auto-start off, service unregistered, SSH gateway unapplied and effects disabled.

Recovery revalidates the receipt identity, every distribution byte and all private namespaces without opening a database or reading credentials. Uninstall first requires all three host namespaces to be empty, atomically quarantines the installation and checks them again. It removes only manifest-owned program files and known empty directories. Any host configuration, runtime file or durable state prevents removal.

Configuration provisioning, database bootstrap/restore, TLS secrets, service registration, SSH application and process start remain separate lifecycle states.

## Verification and rollback

Tests perform real install, recovery and unused uninstall from a sealed synthetic distribution; they also prove distribution tampering is detected and a durable state byte blocks removal without moving the installation.

Rollback removes the lifecycle implementation, tests, ADR and ownership update. Existing inactive installations must be preserved or explicitly uninstalled with the verified old implementation; code rollback must never recursively delete their state.
