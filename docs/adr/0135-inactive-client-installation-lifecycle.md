# ADR 0135: inactive client installation lifecycle

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Add a real local installation lifecycle for the inactive client. Installation requires an exact new absolute root under a canonical parent and a bounded regular migration source. It exclusively creates a `0700` root with private state/runtime directories, copies the migration as `0600`, emits a closed local bootstrap document and writes a `0600` content-addressed receipt last. The receipt binds installation root plus client version and records config/migration digests, `installed-inactive`, `autoStart=false` and `externalWritesEnabled=false` without source paths or credentials.

Recovery accepts only the exact top-level layout, private regular metadata and migration files, canonical directories, the root-bound installation identity, matching digests and a bootstrap plan whose state path is the installation's own state directory. It does not read the client database or encrypted secret content. Tests prove the recovered plan can initialize and close the single configured client owner without networking.

Unused uninstall is deliberately narrow. It refuses any non-empty state directory, atomically renames the complete installation to a sibling quarantine to exclude new path-based startup, rechecks state, and removes only the three verified metadata/runtime files followed by empty directories. It never recursively deletes client state; a racing or unexpected write fails directory removal rather than deleting durable identity or credentials.

This lifecycle does not provision Keychain automatically, register a background service, connect, poll, discover, execute, load a capability or enable effects. It does not install into a real user directory in repository tests.

## Rollback

Remove the installation lifecycle, tests, source ownership entry and this ADR. Test installations use temporary directories. A future real inactive installation can be removed only with the same unused-state guard; an initialized installation must be preserved for a state-aware uninstall/migration flow.
