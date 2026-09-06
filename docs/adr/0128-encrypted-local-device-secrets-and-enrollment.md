# ADR 0128: encrypted local device secrets and enrollment

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Persist client-owned device private keys through an authenticated encrypted file adapter. The adapter accepts an already available 32-byte local master key, copies it into process memory, and zeroes that copy on close. It never stores or derives the master key. Each secret uses a fresh 96-bit IV, AES-256-GCM, and domain-separated AAD containing its opaque `secret:` reference. The filename contains only the SHA-256 reference digest; the closed JSON record contains algorithm, reference digest, IV, tag and ciphertext, but neither reference nor plaintext.

The store root is canonical, private and revalidated on every operation; a direct symbolic-link root is rejected before canonicalization. Records are 0600, bounded, written through a synced temporary file and atomically hard-linked into place. Duplicate references are immutable. Invalid references, wrong keys, modified authentication tags, oversized records and symlinks fail closed. Returned plaintext is copied, and the adapter does not project secrets or local paths.

First device enrollment now runs under the same single-client instance lease as normal startup. It refuses an existing enrollment, validates the public identity before persisting a real Ed25519 private key through the removable secret-store port, persists only public identity plus opaque reference in SQLite, verifies the empty artifact recovery state and returns the public enrollment material. A failure before SQLite persistence removes the newly created secret; after SQLite persistence the secret is retained so a recoverable startup can be retried. Local enrollment no longer restricts tenants to `test.*`; the inactive cloud providers retain their own test-tenant gate.

This batch does not choose an OS/password-manager master-key provider, register a real cloud device, start a daemon, connect to a server, or activate an executor/effect.

## Rollback

Remove the encrypted adapter, enrollment composition method, tests, catalog/migration entry and this ADR; restore the local test-tenant enrollment restriction if the generic client identity is also rolled back. No live secret root or device was created because tests use temporary directories.
