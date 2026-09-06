# ADR 0166: Portable Unix socket path and stale recovery

Status: accepted for default-disabled server runtime

## Context

The installed cloud server uses one owner-only Unix socket for the OpenSSH subsystem proxy. A real distribution rehearsal showed that a valid but long installation root can pass installation and configuration, then fail at runtime with `EINVAL` because macOS has a shorter `sockaddr_un.sun_path` than Linux. A hard process kill also leaves both the instance lease and socket pathname behind, so the lease can prove the prior PID is dead while the unchanged IPC adapter still refuses restart.

## Decision

Use one shared path validator for installer, server IPC and sshd-side proxy. The canonical absolute UTF-8 path is limited to 103 bytes, reserving the terminator in macOS's 104-byte `sun_path` while remaining valid on Linux. Installation rejects an overlong root before copying program bytes.

The server entry remains the only recovery coordinator. It may ask the IPC adapter to remove a stale socket only after the exact instance lease was structurally valid and its recorded PID was not alive. The adapter accepts only a single-link, owner-owned socket with no group/other permission. It first opens a connection without sending a frame: a successful connection proves an active listener and blocks deletion; only connection-refused or already-missing state may proceed. It rechecks device, inode, owner and mode immediately before unlinking. Unknown types, metadata drift, probe timeout or any other network error fail closed and preserve the path.

The stale socket is removed before TLS credentials, SQLite providers or either edge opens. Normal graceful shutdown still closes TLS, IPC and providers before releasing the lease. PID reuse conservatively blocks recovery.

## Consequences

An installation path too long for both supported server operating systems fails deterministically before durable state exists. A server killed without cleanup can restart from its exact installed configuration without creating a second provider graph. The liveness probe creates at most one empty local connection and cannot invoke a device frame or external effect.

This does not register or start a service, apply SSH configuration, activate effects, delete malformed runtime state or recover a socket whose lease lineage is absent. Service-manager registration, dedicated production identity and active-owner cutover remain separate work.
