# ADR 0161: Default-disabled server administration entry

- Status: accepted
- Date: 2026-09-06

## Context

The server distribution contained runtime and SSH entries, but install, configuration and first-owner lifecycle operations were callable only from repository source. A host-neutral distribution therefore could not administer itself without a checkout, undermining reproducible installation and recovery.

## Decision

Add one bundled local administration entry to the content-addressed distribution. It requires `QUARK_SERVER_ADMIN_ENABLE=1` and one exact command: install, configure, bootstrap-owner, status, remove-unused-configuration or uninstall-unused. All paths are absolute and normalized. Configuration documents are owner-only, single-link, bounded JSON with closed keys. The first-owner credential is accepted only through bounded stdin.

The entry delegates to the existing lifecycle owners and emits only a bounded receipt without credential, TLS material, database path, tenant metadata or internal error. It cannot start or stop the server, register a service, apply SSH configuration, alter effects or delete durable state. Stage selection for status is based on the installed namespaces and every selected recovery path independently revalidates its full lineage.

The server manifest now pins the admin entry as a third executable alongside the cloud runtime and SSH subsystem. This changes distribution digests but not activation state.

## Verification and rollback

Contract tests reject relative, root, unknown and disabled commands. Distribution/install/configuration/owner tests now require and preserve the admin entry. A post-commit rehearsal must build the distribution and drive the complete inactive lifecycle through the bundled entry itself.

Rollback may remove the admin entry from a future distribution and restore the prior manifest schema. Existing distributions remain immutable and addressable by their original digest; installed durable databases must not be deleted.
