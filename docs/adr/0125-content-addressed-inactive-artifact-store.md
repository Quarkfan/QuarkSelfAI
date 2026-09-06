# ADR 0125: content-addressed inactive artifact store

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Land a local capability artifact only from a previously validated `InactiveInstallationPlanV1` and a caller-selected regular file. The client streams the file through SHA-256 before copying it, stages it with mode 0600, verifies the staged bytes, and atomically links the blob under its digest. A conflicting or tampered digest path fails closed. Symlink sources, path-like identities and digest drift are rejected.

Each capability/version has an immutable local receipt containing plan identity, digest, device and the five inactive lifecycle states, but never the source path or artifact root. The existing client SQLite database remains the only owner of installed lifecycle snapshots and adds one selected/previous version record per capability. First install selects the version; upgrade lands and verifies a different version before changing the pointer; rollback verifies the previous blob before swapping pointers. Reopen tests verify both filesystem and SQLite state.

This store does not download or unpack artifacts, invoke declared lifecycle handlers, load modules, grant permission, run code, start consumers/providers/schedulers, or enable effects. It is not mounted in product composition and does not alter the live assistant.

## Recovery

Recover the client database and artifact directory together into isolated staging. Reopen and call installed verification for every selected version before accepting the state; recovery never loads or runs the artifact and effects remain disabled.

## Rollback

Remove the provider, selection table, tests, catalog/migration entry and this ADR. Because the provider is not mounted, no live runtime state changes. Test-only artifact directories and SQLite files are disposable; a future activated client must retain the last verified blob until its rollback window closes.
