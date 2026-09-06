# ADR 0152: Owner-only SSH subsystem IPC

- Status: accepted for inactive implementation
- Date: 2026-09-06

## Context

An sshd subsystem normally runs as a separate process. If that wrapper opened the control-plane database and providers, enabling SSH fallback alongside TLS would recreate the dual-provider condition that the transport host forbids.

## Decision

Keep the cloud transport host as the only provider owner. It may explicitly open one process-local Unix socket under an existing canonical, process-owned 0700 directory. The socket is created at an unused exact path, chmod 0600, and its device/inode identity is recorded before cleanup. Each connection carries exactly one bounded protocol frame to the existing host and one bounded response back.

The sshd-side proxy only exchanges stdin/stdout bytes with that Unix socket. It cannot import or construct a repository, provider, network listener, scheduler, executor or effect. The bridge requires `providerOwnership=shared-host` and effects disabled. Node `allowHalfOpen=true` is required so request EOF completes the unary frame without closing the response direction.

This establishes the internal ownership boundary, not sshd configuration. User/key provisioning, ForceCommand/subsystem registration, executable packaging and service activation remain separate work.

## Verification and rollback

A host-level test creates a private temporary Unix socket, exchanges one request/response through the proxy, verifies 0600 mode and single invocation, closes the bridge, and proves the socket was removed. Static tests reject public roots, independent ownership and empty frames. The first host run exposed default half-close behavior and was fixed before acceptance.

Rollback removes the bridge, proxy, tests, ADR and ownership entries. No persistent state or live sshd configuration exists.
