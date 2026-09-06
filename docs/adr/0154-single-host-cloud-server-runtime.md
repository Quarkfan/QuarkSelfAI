# ADR 0154: Single-host cloud server runtime

- Status: accepted for unmounted implementation
- Date: 2026-09-06

## Context

TLS and SSH IPC had individually verified edges, but a future process could still open them around different provider graphs or leak a partially opened host when its second edge failed. The service boundary needs one owner and deterministic startup/rollback before any deployment entry is introduced.

## Decision

Add an explicitly called cloud server runtime factory. It validates a closed top-level config, opens exactly one prepared cloud transport host, then its owner-only SSH IPC bridge, then its TLS 1.3 edge. Both edges receive only methods from that host and require shared ownership with external effects disabled. Normal shutdown closes TLS, SSH IPC and the host in reverse startup order; startup failure best-effort closes every resource already opened before returning the original error. Close is idempotent.

This is a dormant library boundary, not a process entry or service definition. It does not read config, certificates or secrets from disk, create tenants, start a scheduler/executor, install sshd configuration, bind a production address or alter the existing product composition. A caller must inject certificate bytes and the existing verification dependencies.

## Verification and rollback

A host-level test uses a temporary private SQLite database, owner account, self-signed certificate, loopback ephemeral TLS port and owner-only Unix socket. Invalid TLS credentials after IPC startup prove rollback removes the socket and releases the provider; the same paths then reopen successfully, authenticate over TLS 1.3 and close without residue.

Rollback removes the runtime factory, test, ADR and module ownership entry. No deployment file, persistent service state or live listener is created by this change.
