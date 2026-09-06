# ADR 0146: Executable unary SSH device transport

- Status: accepted for inactive implementation
- Date: 2026-09-06

## Context

The SSH fallback had a pinned launch specification and a transport label, but no adapter could carry the canonical device-session port. The inactive wire contract also represented acknowledgement and result as client-side outcomes rather than requests, so it could not express the server calls without inventing a second protocol.

## Decision

Complete the unactivated V1 wire contract with distinct acknowledgement request/response and result submit/response payloads. Add an explicit unary SSH client adapter that starts only the fixed `quark-device-v1` subsystem for a single framed request and expects one correlated framed response. The process receives the frame on stdin, never in argv; it uses an allowlisted environment, drains but discards stderr, bounds stdout and time, and inherits no agent socket or SSH config path.

The transport-neutral frame codec moves from the negotiation provider's ownership into its own inactive adapter module; both direct and SSH transports can depend on it while the message declarations remain pure contracts.

Add the matching server adapter over the existing `DeviceSessionServerPortV1`. It derives the pre-authentication challenge scope from the validated message, delegates session, lease, acknowledgement and result operations to the one canonical provider, returns only a stable rejection code, and exposes a one-frame function suitable for an sshd subsystem stdin/stdout entry. It owns no database, scheduler, queue, task or effect.

Each operation uses a separate SSH process. The durable server session and lease remain authoritative across calls, avoiding a hidden connection-local owner. Direct TLS and SSH are not raced or activated together; selecting and mounting this adapter remains a later composition gate.

## Verification and rollback

An injected byte-level runner executes challenge, proof, poll, acknowledgement and result through the same framed contract and provider, verifies exact correlation and scope, and proves provider error details are not returned. Existing codec and pinned-launch tests continue to pass.

No gateway, sshd configuration, account, key, known-hosts file, network connection, client composition or service is created. Rollback removes the two adapters, restores the previous inactive payload declarations, and reverts the module ownership entry. There is no live or persisted transport state to migrate.
