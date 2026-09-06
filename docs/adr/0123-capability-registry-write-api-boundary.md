# ADR 0123: Capability Registry write API boundary

Status: Accepted for inactive implementation on 2026-09-06.

## Decision

Expose the existing persistent inactive Capability Registry through an authenticated `POST /v1/capabilities`. The closed body contains only a validated-unpublished candidate, its verification evidence and `private` or `tenant` visibility. Tenant/user ownership is derived only from the opaque cloud session; `public` publication is not accepted.

The provider remains the authoritative evidence and canonical-digest gate and always records `catalogued-inactive` with zero consumer, provider, scheduler and effects. This API does not download, install, load, authorize, execute or publish a marketplace artifact.

## Rollback

Remove the route, tests and this ADR. Existing inactive catalog records remain readable and require no migration.
