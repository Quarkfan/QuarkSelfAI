# ADR 0179: Headless browser is a governed local capability, not an implicit tool

## Status

Accepted as a contract-only, runtime-inactive capability boundary.

## Context

The platform Manifest vocabulary already includes `browser-runtime`, but there was no product-owned host contract describing the minimum safe launch shape. Treating browser automation as an executor convenience would bypass the same workspace, network, lifecycle, recovery and effect boundaries required of every other Capability Artifact. It would also let a cloud plan imply an arbitrary persistent browser profile or download path.

## Decision

Add the closed `HeadlessBrowserLaunchV1` and `HeadlessBrowserHostPortV1` contract. A launch declaration is accepted only when it uses an ephemeral profile, denies downloads, keeps desktop visibility and external writes off, and selects network and workspace access from bounded values. `blueprint-allowlist`, `approved-read` and `approved-write` are declarations only; the future local adapter must still resolve them against the signed Blueprint, workspace policy and durable approval before launching anything.

Register the contract as a static `headless-browser-runtime` module and as an unpublished, inactive `browser-runtime` artifact candidate. The broader candidate catalog now uses canonical Manifest kinds for representative tool (`cli`), package, browser runtime, private integration pack and application forms. Candidate presence is not publication, installation, authorization, loading, activation or completion evidence.

## Safety and rollout

This change does not install or invoke a browser, create a profile, download content, grant workspace or network access, mount a capability, change product composition, or enable effects. A later implementation requires a content-addressed Manifest, verified supply-chain evidence, lifecycle adapter, local policy enforcement, recording-sink replay and recovery proof before any form-completion gate may advance.

## Verification and rollback

Contract tests reject persistent profiles, downloads, desktop visibility, external writes and open-ended scopes. Architecture and candidate-catalog checks prove unique ownership and preserve inactive/unpublished state. Rollback removes the contract, module and candidate mapping; no runtime or persistent state exists to migrate.
