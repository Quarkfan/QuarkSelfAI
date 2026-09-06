# ADR 0147: Transactional first cloud owner bootstrap

- Status: accepted for inactive implementation
- Date: 2026-09-06

## Context

The persistent cloud identity provider could authenticate provisioned accounts, but it had no safe way to create the first tenant owner. Exposing general account creation before an authenticated owner and recovery policy exist would create an account-takeover boundary.

## Decision

Add a deliberately narrow first-owner bootstrap. It accepts one exact absolute SQLite path under an existing private, canonical, process-owned directory; rejects symlinked or hard-linked databases and non-regular migrations; and requires the tenant, user and account tables all to be empty under `BEGIN IMMEDIATE`. It creates one active tenant, one active user and one fixed `owner` account in the same transaction. It creates no browser session.

The executable entry remains disabled unless `QUARK_CLOUD_BOOTSTRAP_ENABLE=1` and the exact `bootstrap-owner <config>` command are present. The bounded JSON config contains paths and public identity metadata only. The password is accepted solely from bounded stdin, never argv or config. Output is a bounded receipt without a password, hash, salt, session or database path; failures return one stable code.

This bootstrap is not a general tenant/account administration API. Later users, password recovery, MFA/passkeys, role changes and tenant lifecycle require authenticated durable operations with their own audit and recovery contracts.

## Verification and rollback

Tests create a synthetic owner, verify owner-only database permissions, authenticate through the real scrypt provider, confirm no raw password bytes occur in SQLite, reject a second bootstrap and prove an invalid credential leaves the database eligible for a clean retry.

No real database or account is created in this batch. Rollback removes the bootstrap function, entry, tests and identity-provider ownership update. A database that was explicitly bootstrapped later is durable user state and must never be deleted by code rollback.
