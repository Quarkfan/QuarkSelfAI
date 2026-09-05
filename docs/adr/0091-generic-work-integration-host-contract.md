# ADR 0091: Generic work integration host contract

- Status: proposed, inactive, awaiting owner approval
- Date: 2026-09-06
- Decision owner: 常东旭
- Scope: QuarkSelfAI core, DSH/Cordis composition boundary, and separately versioned private work integration packs

## Context

The first private migration batch created a recoverable, inactive shadow copy of selected work-domain assets. It did not make the private pack
standalone: copied workflows still import host storage, workflow, task, channel, executor, and workspace modules by repository-relative path.
Allowing those imports to become the permanent integration boundary would couple the pack to QuarkSelfAI's source tree and make the product depend
on a company workspace during build, startup, or recovery.

The host already has durable workflows, effect ownership checks, action approval, an executor router, and one workspace policy. Phase 2 should expose
those capabilities through a small product-neutral contract instead of creating parallel work-domain infrastructure.

## Decision

Adopt an inverted, registration-based boundary:

1. QuarkSelfAI owns a generic, versioned `work-integration-contract` and the only registry that may bind a pack to host capabilities.
2. DSH/Cordis owns lifecycle and composition. Its base product profile contains only the generic registry. A device-local operator overlay may point
   at an exact private pack artifact, but the checked-in base profile never names or requires a private pack.
3. A private pack depends only on the published generic contract plus normal third-party libraries explicitly approved for that pack. It must not
   import QuarkSelfAI source paths, storage providers, compatibility modules, concrete channel clients, or a company workspace.
4. A pack is passive on load. It contributes manifests, bounded context enrichers, workflow definitions, and effect-handler factories. The host owns
   event consumers, durable scheduling, approval validation, executor routing, workspace resolution, and activation.
5. Registration, installation, and activation are separate states. Installing an exact artifact creates no consumer, provider binding, timer, or
   external write. Shadow replay uses an effect sink that records plans and cannot reach external adapters.
6. Every exclusive capability has one `ownershipKey`. Activation fails closed unless exactly one provider owns the key and the old owner is stopped;
   read providers that are intentionally composable must declare non-exclusive aggregation semantics.

## Contract surfaces

The contract is deliberately smaller than a general service locator:

- `WorkPackManifestV1`: pack id/version/revision/digest, contract range, declared contributions, required host capabilities, data classification,
  recovery policy, and exclusive ownership keys.
- `WorkPackRegistrationV1`: pure registration of context enrichers, workflow definitions, and effect-handler factories. It has no `startConsumer`,
  scheduler, credential reader, or unrestricted filesystem method.
- `WorkExecutionContextV1`: the canonical JSON envelope shared by Codex, Claude Code, and DSH. It carries action and approval references, bounded
  provider-neutral source references, a workspace handle and access mode, declared capabilities, privacy projection rules, and continuity/fallback
  metadata. Executor-specific prompts are rendered from this same envelope.
- `WorkHostPortsV1`: narrow ports for durable action enqueue, workflow registration/dispatch, effect registration, approval verification, executor
  invocation, workspace-handle resolution, and bounded clock/id generation. Direct `AssistantStore`, process spawning, or arbitrary environment
  access is not exposed.
- `WorkContributionV1`: namespaced pure policy/evidence contributions and effect implementations. External write implementations remain unusable
  until an exact owner-approved binding is activated through the host registry.

Messages, tasks, calendars, knowledge, read-only data, and approvals are capability ids and typed request/response schemas above these primitives;
they are not six new infrastructure stacks. Channel consumption and approval truth remain host-owned. Task/calendar/message writes remain durable
effects with existing idempotency and authorization evidence.

## Workspace and deployment

Local files are represented in the shared envelope by opaque workspace handles. Only the host workspace policy resolves a handle to a canonical
path at the local adapter boundary. The pack may request access within the granted handle but cannot see the global allowlist. Remote/server mode
rejects local-only handles and requires a separately declared remote capability; it does not silently upload file bodies, directory listings, or
absolute paths.

This keeps local CLI and desktop workflows first-class while allowing a server deployment to use the same contract with different adapters.

## Installation and recovery

- Build a pack from an exact private Git revision into a content-addressed artifact. Lifecycle scripts are disabled unless separately approved.
- Store artifact metadata and an operator overlay outside the product repository. The overlay binds an exact pack id/revision/digest and starts
  inactive. QuarkSelfAI's ordinary install, build, restore-safe, and core start never fetch the private repository.
- Recovery first restores and starts QuarkSelfAI in control-only mode with all work integrations absent. After private Git authentication is
  restored, fetch the exact pack revision, reproduce and verify the artifact, install it inactive, then restore only its namespaced encrypted state
  if that state was explicitly included. Credentials are re-injected from a secret store and never enter Git or the core recovery bundle.
- Consumer/provider takeover remains a later, separately approved maintenance-window action. Installing or restoring a pack cannot set
  `TAKEOVER_CONFIRMED` or enable an external effect.

## Rejected alternatives

- Core importing the private pack: reverses the dependency direction and blocks clean builds/restores.
- Pack importing repository-relative host modules: makes source layout an accidental ABI and cannot be independently versioned.
- Giving the pack its own Feishu consumer, scheduler, approval store, executor router, or workspace allowlist: creates double ownership and divergent
  safety semantics.
- A generic RPC/service-locator object: widens authority invisibly and makes compatibility impossible to audit.
- Dynamic runtime loading directly from a Git checkout: couples production behavior to mutable source and weakens artifact/recovery provenance.

## Consequences

Phase 2 requires a new public contract surface and a generic inactive Cordis registry, so it changes the DSH/Cordis boundary and cannot be
implemented without exact owner approval. The first approved implementation batch remains non-activating; shadow validation, single-provider
cutover, and source deletion each remain later approvals.

The machine-readable proposal and acceptance gates are in `config/work-integration-host-contract-proposal.json`; the operational design is in
`docs/project/work-integration-host-contract.md`.
