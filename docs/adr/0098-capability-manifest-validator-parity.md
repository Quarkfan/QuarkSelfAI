# ADR 0098: Capability Manifest validator parity

Status: Accepted (inactive contract hardening)

## Context

The V1 TypeScript contract and JSON Schema constrain artifact kinds, source types, runtime isolation, interface versions, permission vocabulary,
test declarations, health checks, SBOM evidence and recovery. The original runtime validator checked only part of that contract, so a value could
pass runtime validation while failing the public schema or referencing a lifecycle handler that the artifact did not provide.

## Decision

The runtime validator fails closed on the same closed vocabularies and structural invariants. Every lifecycle handler and health check must reference
a declared provided interface. Permission data classes must be declared by the manifest. Verified signatures require a key identifier, and declared
SPDX or CycloneDX SBOMs require a digest.

This decision validates declarations only. It does not verify artifact bytes, signatures, licenses or SBOM contents, publish a Manifest, register a
consumer/provider, or authorize lifecycle execution.

## Consequences

- malformed and internally inconsistent Manifests are rejected before registry or Blueprint use;
- fixture Manifests must declare lifecycle interfaces explicitly and use semantic interface versions;
- supply-chain verification remains an independent prerequisite for installation;
- rollback is a code revert and requires no state migration or service restart.
