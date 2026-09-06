# ADR 0153: sshd subsystem process entry

- Status: accepted for inactive implementation
- Date: 2026-09-06

## Context

The Unix IPC bridge and proxy proved the ownership boundary, but sshd needs a concrete executable that speaks the subsystem's stdin/stdout convention. A generic shell wrapper could leak paths, accept arbitrary commands or accidentally open providers.

## Decision

Add a dedicated `quark-device-v1` Node entry. It runs only when `QUARK_SSH_SUBSYSTEM_ENABLE=1`, the command name is exact and one absolute config path is supplied. The config must be a single-link 0600 regular file under a canonical process-owned 0700 directory and contains only the Unix socket path, timeout, shared-host ownership and effects-off declaration.

The entry reads one bounded stdin frame, calls the IPC-only proxy and writes one bounded response to stdout. It never imports a cloud repository/provider, parses a remote command, launches a shell or emits internal failures. Every failure produces only `ssh-subsystem-failed` and a non-zero exit.

## Verification and rollback

A host test runs the built JavaScript entry as a real child process against a temporary owner-only IPC bridge. Enabled execution returns the exact synthetic response; disabled execution returns no stdout, one stable error and no path. The socket and config directory are removed.

This does not modify sshd, create an OS user/key, install the entry, start a service or connect remotely. Rollback removes the entry, test, ADR and module ownership update.
