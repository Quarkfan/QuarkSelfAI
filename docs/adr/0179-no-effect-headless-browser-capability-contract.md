# ADR 0179: Headless browser is a governed local capability, not an implicit tool

## Status

Accepted with a runtime-inactive local adapter and no-effect process lifecycle proof.

## Context

The platform Manifest vocabulary already includes `browser-runtime`, but there was no product-owned host contract describing the minimum safe launch shape. Treating browser automation as an executor convenience would bypass the same workspace, network, lifecycle, recovery and effect boundaries required of every other Capability Artifact. It would also let a cloud plan imply an arbitrary persistent browser profile or download path.

## Decision

Add the closed `HeadlessBrowserLaunchV1` and `HeadlessBrowserHostPortV1` contract. A launch declaration is accepted only when it uses an ephemeral profile, denies downloads, keeps desktop visibility and external writes off, and selects network and workspace access from bounded values. `blueprint-allowlist`, `approved-read` and `approved-write` are declarations only; the local adapter fails closed on them until the signed Blueprint, workspace policy and durable approval are resolved by a future active composition.

The host-owned local adapter accepts an absolute executable and fixed leading arguments only from local composition, never from cloud input. Its currently verified path accepts only `network=denied` and `workspaceAccess=denied`, launches a child with a fresh mode-0700 profile, a minimal environment and fixed no-background-network flags, and removes the profile after bounded termination. It exposes no profile path and is not mounted into the client or product composition.

Register the contract as a static `headless-browser-runtime` module and as an unpublished, inactive `browser-runtime` artifact candidate. The broader candidate catalog now uses canonical Manifest kinds for representative tool (`cli`), package, browser runtime, private integration pack and application forms. Candidate presence is not publication, installation, authorization, loading, activation or completion evidence.

## Safety and rollout

The adapter test invokes only a repository-owned inert fixture through the current Node executable to prove process and ephemeral-profile cleanup; it does not install or invoke a third-party browser, download content, grant workspace or network access, mount a capability, change product composition, or enable effects. The signed browser-runtime artifact may advance only after it includes this adapter and repeats the inactive lifecycle evidence.

## Verification and rollback

Contract tests reject persistent profiles, downloads, desktop visibility, external writes and open-ended scopes. Adapter tests prove a real child remains alive, reports one session, stops, and leaves no profile; policy-expanding declarations create neither profile nor process. Architecture and candidate-catalog checks prove unique ownership and preserve inactive/unpublished state. Rollback removes the adapter, fixture, module and artifact evidence; no runtime or persistent state exists to migrate.
