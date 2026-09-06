# ADR 0105: Manifest evidence before publication

Status: Accepted (inactive publication gate)

## Decision

A product-level Capability candidate may become immutable `validated-unpublished` review metadata only when its Manifest identity and kind match, all
license/signature/SBOM/malware/maintenance/dependency checks pass, evidence revision and artifact digest match, and the Manifest declares a verified
signature plus a content-addressed SBOM.

The result always keeps publication and activation disabled and preserves the current owner. Public core refuses to prepare private integration
Manifests; those must be built and reviewed inside the private pack against the same public contract.

## Consequences

- an evidence report cannot bless different artifact bytes or source revision;
- warning evidence never becomes a release candidate;
- review preparation remains distinct from registry publication and installation;
- private implementation details do not enter public review metadata;
- rollback is a code revert without data migration.
