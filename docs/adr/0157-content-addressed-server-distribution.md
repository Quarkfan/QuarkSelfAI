# ADR 0157: Content-addressed server distribution

- Status: accepted
- Date: 2026-09-06

## Context

The cloud server and SSH subsystem entries were still executable only from a checkout. A recoverable server cannot depend on repository paths, and a source revision must never describe bytes built from uncommitted source.

## Decision

Define a private, host-neutral server distribution containing bundled cloud-server and SSH-subsystem entries, all seven control-plane SQLite migrations, a minimal package manifest and an SPDX 2.3 SBOM. Its manifest records sorted file sizes and SHA-256 digests, an aggregate artifact digest, semantic version and exact 40-character source revision. It fixes auto-start, SSH gateway application and external effects to false. Host config, TLS keys/certificates, tenant databases, authorized keys and service definitions are excluded.

The builder accepts one exact argument sequence, requires the declared revision to equal repository HEAD, and refuses modified or untracked inputs under `src`, `migrations` or the builder itself. It bundles with the repository-locked build tool, makes all distribution files private, seals the manifest last and removes a partial output on failure. Verification independently recomputes every byte and rejects unknown layout, missing mandatory files, links, public permissions, oversized files and digest drift.

## Verification and rollback

Unit tests seal and recover a complete synthetic distribution and reject missing, public, already sealed and tampered forms. A real distribution must additionally be built only after this implementation is committed so the clean-revision provenance gate can pass; that result is recorded separately in the operations ledger.

Rollback removes the sealer, builder, tests, ADR and module ownership changes. Generated distributions are immutable artifacts and may be discarded independently; no installation or durable tenant state is affected.
