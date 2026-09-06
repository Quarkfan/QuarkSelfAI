# ADR 0101: Side-effect-free Capability developer SDK

Status: Accepted (inactive library surface)

## Decision

Expose `@quarkfan/quark-self-ai/capability-sdk` as the minimal authoring and contract-test SDK. It can combine caller-verified file digests into a
canonical artifact descriptor digest, validate and recursively freeze a Manifest, derive and validate a Blueprint digest, and produce identical
normalized inputs for multiple executor adapters.

The SDK never reads local files, downloads or builds code, signs releases, writes a registry, installs a capability, or invokes an executor. Those
operations remain behind explicit host ports and authorization gates.

## Consequences

- capability authors get one import surface without depending on private packs or runtime composition;
- source bytes and filesystem paths remain outside the authoring model;
- Claude Code, Codex and DSH parity can be asserted from one immutable envelope;
- artifact byte verification and lifecycle execution remain separate responsibilities;
- rollback removes the export and source without data migration.
