# ADR 0145: Persistent multi-tenant cloud identity

- Status: accepted for inactive implementation
- Date: 2026-09-06

## Context

The cloud application already derived tenant and user scope from an opaque session port, but every executable fixture supplied an in-memory map. That proved authorization direction, not a real multi-user identity boundary. A deployable control plane must not trust tenant or user fields supplied to capability, Agent or device operations.

## Decision

Add a default-unmounted SQLite identity provider whose accounts are foreign-keyed to the canonical tenant and user tables. Passwords are bounded and derived with scrypt (`N=32768`, `r=8`, `p=1`) plus a random 32-byte salt. The database stores only salt and derived bytes. Successful authentication creates a random 256-bit session reference, stores only its domain-separated SHA-256 digest and expires it after eight hours using server time. Resolution rechecks session, account, user and tenant state and returns only tenant id, user id and closed roles. Revocation and expiry fail closed.

The HTTP boundary adds `login`, `me` and `logout` only when an authentication provider is explicitly supplied. Login is the sole route allowed to accept tenant/user claims; every later operation continues to resolve scope from the opaque session reference. Errors are stable and do not distinguish an unknown account from a wrong password. A persistent per-account throttle blocks for 15 minutes after five failures in a 15-minute window and still performs the bounded derivation before rejection. Session references are header credentials, not browser cookies.

## Verification and rollback

Tests provision the same user id in two synthetic tenants, verify distinct sessions and exact tenant scopes, wrong-password rejection, eight-hour expiry, revocation, weak-password and duplicate-account rejection, and confirm raw passwords/session references do not occur in SQLite bytes. HTTP tests cover login/me/logout and preserve tenant-injection rejection.

This is not a complete public identity service: account bootstrap/recovery, MFA or passkeys, edge/IP abuse protection, TLS termination and production secret policy remain required before activation. Rollback removes the provider, migration, optional HTTP routes, tests and catalog mapping. No real account, listener, credential or service is created in this batch.
