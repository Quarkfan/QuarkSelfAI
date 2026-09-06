# ADR 0155: Default-disabled cloud server process entry

- Status: accepted for uninstalled implementation
- Date: 2026-09-06

## Context

The single-host runtime had no process lifecycle, secure configuration loader or production verifier composition. Starting it through an ad-hoc script would weaken file ownership, signal handling, token entropy and readiness semantics.

## Decision

Add a dedicated built entry that accepts only `run <absolute-config>` with `QUARK_CLOUD_SERVER_ENABLE=1`. The config is a single-link 0600 file under a canonical, process-owned 0700 root. It contains one closed runtime config, two TLS credential paths confined to that root, and one Ed25519 plan-verification public-key pin. Credential files are single-link, owner-only and bounded; their read buffers are zeroed after the TLS edge imports them.

The entry supplies cryptographically random scoped tokens, the existing Ed25519 device proof verifier and the pinned Ed25519 plan verifier. Only after the single-host runtime and both edges open and signal handlers are installed does it emit one path-free readiness receipt. SIGTERM or SIGINT closes TLS, IPC and providers through the runtime owner. Startup failures emit one stable error without configuration, paths or internal exceptions.

The entry is not referenced by package scripts, deployment manifests, launchd/systemd, Docker or the current application selector. No config, certificate, tenant or listener is created by installing the source.

## Verification and rollback

A host test builds and spawns the actual JavaScript entry with a temporary private database, owner account, Ed25519 pin, self-signed certificate, loopback ephemeral TLS port and Unix socket. Disabled startup fails closed. Enabled startup emits the bounded readiness receipt; SIGTERM exits cleanly and removes the socket. The first host run exposed a socket-before-signal readiness race, which the explicit receipt closes.

Rollback removes the entry, test, ADR and module dependency/ownership changes. Since no service definition points at it, rollback has no live process or persistent deployment state to migrate.
