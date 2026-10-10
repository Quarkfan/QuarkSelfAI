# ADR 0183: Stable server installation identity and reversible program upgrades

Status: accepted — implemented effects-off lifecycle

## Context

The cloud control plane is a durable tenant installation, not a disposable program directory. Its original receipt derived `installationId` from both the canonical install root and the first server version. Replacing the program with a later version would therefore invalidate configuration, owner, service, and state lineage even when all durable state stayed in place. The running pilot also had no verified way to retain the prior release and roll back without copying tenant state.

## Decision

- A version-1 install receipt remains valid and unchanged for compatibility.
- The first program upgrade writes a version-2 receipt. It keeps the original `installationId`, records the original version as `identityVersion`, records the new immutable distribution identity, and records exactly one previous distribution identity.
- Upgrade and rollback require an already prepared but inactive service. Activation receipts or in-progress activation/deactivation block the operation, so no second provider can appear.
- The candidate and current program distributions are fully verified before mutation. The currently installed distribution is copied to the private `rollback/previous` slot before the program swap.
- Only `program/`, `server-distribution.json`, and `install-receipt.json` may change. `config/`, `state/`, the prepared service definition, credentials, installation identity, and external-effect policy are preserved.
- The applicable service template must be byte-identical. A release that changes service-manager composition requires a separate lifecycle design and cannot pass this operation.
- A private durable upgrade intent permits a failed or interrupted swap to restore the prior verified distribution. Successful rollback uses the same upgrade transaction in reverse and retains the replaced release as the next rollback target.
- Administrative commands expose `upgrade-program <install-root> <distribution-root>` and `rollback-program <install-root>`. They never stop, start, register, or enable a service; callers must use the existing explicit deactivate/activate gates.

## Safety and validation

The tests prove version-1 recovery compatibility, stable installation identity across version changes, unchanged SQLite tenant bytes, a verified prior release, and reversible upgrade/rollback. Full deployment remains a composed maintenance sequence:

1. verify current service health and capture the active receipt;
2. deactivate the one provider;
3. upgrade the inactive program;
4. reactivate and require pinned TLS health with `externalEffectsEnabled=false`;
5. on failure, deactivate if necessary, roll back, and reactivate the prior release.

This ADR does not authorize SSH gateway installation, private-pack activation, consumer cutover, external writes, or state-schema downgrade.
