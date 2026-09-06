# ADR 0149: Transactional tenant account provisioning

- Status: accepted for inactive implementation
- Date: 2026-09-06

## Context

First-owner bootstrap made an empty control-plane database recoverable, but it deliberately could not create later users. Calling the tenant repository and identity provider independently would leave an orphan user after a credential failure and would provide no durable evidence of who granted the account.

## Decision

Extend the persistent identity provider with one narrow authenticated operation: an existing active tenant owner may provision one user and account in that same tenant. Tenant scope comes only from the resolved owner session; the request contains no tenant field. The closed authorization port has a distinct `user.provision-account` action, and member or auditor roles cannot invoke it.

The provider validates the target identity, display name, bounded password and closed role set before `BEGIN IMMEDIATE`. Inside the transaction it rechecks that the actor account, user and tenant are active, then inserts the user, salted scrypt account and privacy-bounded audit record together. A failure rolls back all three. The receipt contains no credential, hash, salt, database path or session, and provisioning does not log in the new user automatically.

The route exists only inside the already inactive, listener-free composition. This batch does not add password recovery, password rotation, account disabling, invitations, email identity, MFA/passkeys, platform-admin access or cross-tenant administration.

## Verification and rollback

Integration tests authenticate a synthetic non-fixture owner, create a member, authenticate that member, reject member account creation and reject tenant injection. SQLite readback proves one matching audit record and no orphan target. Existing identity tests continue to cover credential secrecy, duplicate accounts, session isolation and persistent throttle.

No listener, service, real account, email, notification or external effect is created. Rollback removes the route, application/identity method, migration and tests. Once explicitly used outside tests, created users and audit evidence are durable user state and must not be deleted by code rollback.
