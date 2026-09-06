# ADR 0119: client-owned Ed25519 device identity

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

The local client generates one Ed25519 key pair per enrolled device. The cloud identity repository receives only the SPKI public key. Private PKCS8 bytes are written through a `LocalDeviceSecretStoreV1` port addressed by an opaque `secret:` or `keychain:` reference; neither the key bytes nor that reference enter device protocol messages or cloud projections.

Session proof signs a domain-separated server nonce only after tenant, user and device scope exactly match the enrolled public identity. The server verifies with the public key already bound to that tenant device record. A private key that does not derive the enrolled public key fails closed before signing.

This implementation does not select a concrete OS secret store, enroll a live device, open a connection, start a daemon, invoke an executor or alter runtime composition. Secret-store adapters must copy key bytes and may not expose enumeration or raw values to the cloud plane.

## Rollback

Remove the identity adapter, tests and this ADR, then remove its module ownership and migration disposition. No live key, database, service or owner state exists to restore.
