# ADR 0164: Encrypted installed-server state recovery

## Context

The repository recovery bundle rebuilds a personal-assistant checkout, while the new cloud control plane is delivered as a host-neutral installed distribution. Reusing checkout paths would make an installed server depend on the source tree. Copying an installed database or restoring host configuration verbatim would also lose SQLite WAL consistency, retain obsolete absolute paths and TLS material, or overwrite an existing owner.

## Decision

Add a server-specific recovery contract to the bundled, default-disabled admin entry. `backup-state` accepts one verified `owner-created-inactive` installation, snapshots `state/control.sqlite3` with Node's SQLite online backup API, verifies integrity, creates a content-addressed manifest, archives only the database plus manifest, and encrypts the archive directly to an age recipient. Runtime files, TLS keys/certificates, host configuration, executable bytes and absolute paths are excluded.

`stage-state` decrypts only into a caller-selected new directory. It rejects links, unknown or duplicate archive paths, unexpected files, manifest identity drift, digest drift and failed SQLite integrity. `prepare-state-restore` accepts only a separately installed and configured target whose runtime/state namespaces are empty and whose version, source revision and distribution digest match the bundle. It copies the database without overwrite and repairs a new owner receipt bound to the target installation/configuration after rechecking singleton owner identity and timestamp.

All three commands require the existing explicit local admin gate. Their bounded receipts contain bundle and installation identities but no host path, credential, TLS material or tenant/user metadata. Restore leaves service registration, SSH gateway apply, auto-start and external effects false.

## Consequences

- Installed-server recovery no longer depends on a repository checkout or source-tree `var` layout.
- Host TLS and network configuration are deliberately reprovisioned; they cannot be smuggled through a state bundle.
- Version-one restore is exact-distribution only. Cross-version migration and active-server quiescence require separate contracts.
- Decrypted staging is sensitive plaintext and remains caller-owned until explicitly removed.

## Verification and rollback

Synthetic tests exercise encryption, staging, content/digest/integrity verification, exact-distribution restore, target receipt rebinding and overwrite refusal. A post-commit rehearsal must use a clean built distribution and real age identity entirely under a temporary private root.

Code rollback removes the commands and module. Existing encrypted bundles and restored databases remain durable user data and must not be automatically deleted; an older compatible distribution may still recover them through an explicitly retained tool.
