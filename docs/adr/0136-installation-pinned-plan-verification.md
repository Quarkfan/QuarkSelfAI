# ADR 0136: installation-pinned plan verification

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Every installed client configuration must pin one control-plane execution-plan signing identity as an exact key id plus Ed25519 SPKI public key. The pin is part of the closed bootstrap document and therefore covered by the installation config digest. It is public verification material, not a credential, and remains local rather than entering client cloud projection.

Provide a concrete Node verifier that accepts only the pinned key id, `ed25519`, a canonical `sha256:` payload digest and an exact 64-byte base64url signature. It verifies the digest string used by the existing execution-plan contract and returns false for key, digest, algorithm, encoding or signature drift. Malformed and non-Ed25519 SPKI keys fail during bootstrap before Keychain access, state recovery or network connection; temporary decoded buffers are cleared.

The configured-client facade can now initialize from only its installation plan plus local adapters, without an application-supplied trust fixture. Dependency injection remains available for isolated tests. This batch does not rotate keys, fetch trust remotely, connect, accept a plan, run an executor or activate effects. Key rotation requires a separately authenticated installation update with rollback evidence.

## Rollback

Remove the pinned verifier and bootstrap field, return the verifier to an injected dependency, update temporary installation fixtures, and remove this ADR. No live installation or signing key is created by the tests.
