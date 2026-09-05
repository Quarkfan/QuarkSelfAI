# Phase 2 work integration host contract

## Outcome of the design review

Phase 2 should not introduce separate message, task, calendar, knowledge, data, and approval subsystems. It should expose one small host contract
over QuarkSelfAI's existing durable event/workflow/effect, approval, executor, and workspace primitives. The private pack remains a passive
implementation package. DSH/Cordis remains the lifecycle host and QuarkSelfAI remains the sole authority for activation and exclusive ownership.

Current status is `design-complete-awaiting-owner`; no contract implementation, private-pack install, provider binding, consumer, external write,
source deletion, or service restart is authorized by this document.

## Dependency direction

```text
Codex / Claude Code / DSH
            |
            v
canonical WorkExecutionContextV1 + existing executor router
            |
            v
QuarkSelfAI core ----> generic work-integration contract
      |                         ^
      | lifecycle/registry      |
      v                         |
   DSH/Cordis             private Work Integration Pack
                           (contract implementation only)
```

Forbidden arrows are core to private pack, core to a company workspace, and pack to core source/storage/compatibility modules. A device-local
operator overlay may bind an exact artifact to the generic registry; it is deployment state, not a core source dependency.

## Runtime ownership rules

| Concern | Sole owner | Pack contribution |
| --- | --- | --- |
| Channel consumer and event journal | QuarkSelfAI host | event predicate/handler registration only |
| Durable workflow scheduling and state | QuarkSelfAI host | versioned workflow definitions |
| Approval truth and callback correlation | QuarkSelfAI host | required scope and interaction schema |
| Executor selection and fallback | QuarkSelfAI host | objective/context enrichment only |
| Workspace allowlist and path resolution | QuarkSelfAI host | opaque handle requests only |
| Effect ownership and idempotency | QuarkSelfAI host | inactive handler factory for declared capability |
| Work-specific routes, schemas and policy | Private pack | implementation and private tests |

An exclusive `ownershipKey` must resolve to zero or one active provider. Shadow mode always resolves external effects to a recording sink. It cannot
fall back to a live provider.

## Canonical executor context

All three executors receive the same validated JSON object before provider-specific rendering:

- contract version, action id, mode, durable approval reference, and idempotency key;
- bounded provider-neutral source references without stable internal ids unless explicitly allowed for the action;
- objective and structured inputs with field-level classification/projection rules;
- workspace handle and requested access, resolved locally only inside the host adapter;
- available capability ids and unavailable reasons;
- requested executor, actual executor, fallback policy, session continuity key, and prior failure stage.

The envelope cannot contain credentials, raw environment maps, full message history, directory listings, production logs, or a host absolute path.
Executor adapters may receive a resolved local path out of band only after the same durable claim and workspace policy validation already required
for native actions.

## Installation protocol

1. Fetch an exact private revision after private Git authentication is available.
2. Verify the repository identity, clean source state, lockfile, approved dependency set, and source revision.
3. Build and test without lifecycle scripts; create a content-addressed artifact and record its digest/SBOM.
4. Install into a device integration store outside the main checkout. Do not modify the base product lockfile or source tree.
5. Write a device-local operator overlay binding pack id, revision, digest, contract version, and `enabled=false`.
6. Start a control-only validation host or use an offline contract harness. Registration must report zero consumers, zero active exclusive providers,
   and zero live external effects.
7. Only a later approved shadow batch may execute replay through the recording sink.

## Restore protocol

1. Restore QuarkSelfAI alone into fresh-clone `restore-safe`; prove core build/start with no private repo, work workspace, or company network.
2. Restore account access separately. Fetch and reproduce the exact private artifact; mismatch fails closed.
3. Install the pack inactive. Restore only namespaced pack state that was explicitly included in an encrypted work-state artifact.
4. Re-inject credentials from the target secret store and run read-only identity/capability checks without outputting identifiers.
5. Run contract, privacy, executor-parity, local/server, and single-owner preflight.
6. Keep consumers and external writes off until a distinct takeover approval is bound to exact revisions and checkpoints.

## Test gates

- Core independence: cold `npm ci`, build, architecture check, restore-safe startup, and health with the pack/workspace/network absent.
- Dependency closure: no main source import of the private package; no pack relative import of main source, compat, storage provider, or concrete CLI.
- Contract conformance: manifest/schema validation, contract-version range, effect schema compatibility, and unknown-field fail-closed behavior.
- Executor parity: one golden context produces semantically equivalent inputs for Codex, Claude Code, and DSH; fallback preserves action,
  authorization, workspace handle, and session rules.
- Ownership: duplicate consumer, exclusive provider, scheduler, effect writer, or namespace registration is rejected before start.
- Privacy: secret patterns, stable company identifiers, message bodies, customer data, internal hosts, absolute device paths, and unbounded diagnostics are
  absent from artifacts and emitted reports.
- Workspace: traversal and symlink escape are rejected locally; remote mode rejects local-only handles and never uploads implicitly.
- Shadow safety: replays use deterministic time/id sources and a recording effect sink; attempted network/process/write access fails.
- Recovery: exact revision/digest reproduction, inactive restore, missing-pack core startup, corrupt/missing artifact refusal, and no activation restoration.
- Compatibility: existing main checks plus Lark, DSH, server, work-domain isolation, assistant continuity, and private-pack audits.

## Migration sequence

1. **2A — contract and inactive registry:** implement product-neutral types/validators, registry and audit; export the contract; add the registry to the
   base DSH profile with no pack bindings and no activation capability.
2. **2B — private conformance:** give the private repository its own build; replace repository-relative host imports with the approved contract;
   keep all registrations inactive and execute only offline redacted replays.
3. **2C — reproducible inactive install:** build an exact artifact and device-local disabled overlay; prove core-absent and pack-present inactive modes.
4. **3 — shadow:** replay sanitized inputs against old behavior and the pack with a recording effect sink. No second consumer/provider/write path.
5. **4 — cutover:** in a separately approved maintenance window, quiesce old ownership, checkpoint, activate exactly one pack provider, verify, and
   rollback on any mismatch.
6. **5 — cleanup:** after the rollback retention window, remove or genericize mainline work sources and prove clean build/start/recovery again.

## Rollback

For 2A–2C, remove the device-local overlay/artifact and revert the exact implementation commits; because nothing is activated, no runtime state or
external system requires rollback. For shadow, delete only shadow outputs with strict lineage. For cutover, stop the new owner before restoring the
old owner at the recorded checkpoint; never run both. Source deletion is deferred until rollback evidence and retention gates pass.

The next authorization request is machine-pinned in `config/work-integration-host-contract-proposal.json`. Approval of that proposal permits only
2A–2C implementation and offline/inactive validation. It does not approve shadow execution, live installation, provider/consumer cutover, external
writes, source deletion, service restart, credentials, or production changes.
