# ADR 0180: Signed public capability form evidence

Status: accepted, inactive

## Context

The platform completion gate requires representative tool, package, headless-browser, private-integration and interactive-application capability forms. A candidate row or TypeScript contract does not prove that an artifact has portable provenance, a valid manifest, an SBOM, a signature or a recoverable local installation lifecycle. At the same time, satisfying form coverage must not publish, load, authorize, execute or activate the existing product modules.

## Decision

Four first-party public forms are pinned to core revision `c941444db6aa440519b2708bf9a125b275fef750` in `config/public-capability-form-artifacts.json`:

- `network-recovery` as `cli`;
- `postgres-storage` as `package`;
- `headless-browser-runtime` as `browser-runtime`;
- `control-console` as `application`.

Each record contains a sorted source-file inventory, a content-addressed canonical bundle digest, a complete Capability Manifest, SPDX 2.3 evidence and an Ed25519 signature made with an ephemeral private key that was not persisted. Repository validation recomputes every digest, verifies the public key identity and signature, validates the manifest and checks every pinned source file at the declared Git revision.

The local inactive artifact store then rehearses install, recovery verification and uninstall for every form using a synthetic device and temporary SQLite state. This is lifecycle evidence for the artifact boundary only. It explicitly proves `unloaded`, `unauthorized`, `stopped`, effects disabled, zero owned consumers/providers/schedulers and zero external writes; it does not prove that the underlying capability can run.

The headless-browser form therefore retains `local-adapter-missing` until an actual governed local adapter passes its own no-effect execution tests. The private integration form remains independent and retains its host-contract and lifecycle blockers. Neither gap may be hidden by the four public artifact receipts.

## Consequences

- Supply-chain and inactive lifecycle evidence can be checked without a private repository, company workspace, service restart or network access.
- The evidence cannot activate or publish a capability and cannot alter the current `control-console` runtime owner.
- Source changes require a new pinned revision, regenerated digests/SBOM/signature and a fresh lifecycle rehearsal.
- Rollback is removal of the evidence document, validator, tests and completion-ledger updates; no runtime state or external data needs compensation.
