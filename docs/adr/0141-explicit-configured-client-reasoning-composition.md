# ADR 0141: Compose real reasoning executors behind the explicit configured-client cycle

- Status: accepted
- Date: 2026-09-06

## Context

ADR 0140 proved the fixed Claude Code, Codex and bundled DSH process boundaries independently, while the configured local client still accepted only caller-supplied executor ports. That separation was safe but did not prove that the installable-client composition could use the product adapters through its signed, durable action path. Directly starting a polling loop or mounting the adapters into the current daemon would also create a premature runtime owner.

The DSH process needs an additional state boundary. Its published headless runtime normally creates session state under `DSH_HOME`; leaving that state beneath the persistent client runtime would duplicate prompt and result retention outside the client run journal and content-addressed result store.

## Decision

Add one inactive operations composition which constructs exactly three `NoEffectClientExecutorPortV1` adapters in deterministic order: Claude Code, Codex and DSH. Construction validates private canonical runtime and result roots but does not discover, select or invoke an executor. The existing signed plan negotiation remains the sole selector, and the durable no-effect cycle remains the sole action owner.

Expose this composition through `InactiveConfiguredLocalClientV1.executeSignedReasoningNoEffectOnce`. The method is explicitly called; initialization still does not connect, poll, discover or run anything. It uses the existing device proof, session, lease, checkpoint-before-ack, exact executor selection and result synchronization flow. There is no adapter-internal or mid-action fallback. A paused action resumes only with the executor recorded in its checkpoint.

The result body remains in the client-private content-addressed store and only its digest plus a fixed summary code crosses the device result port. DSH creates a fresh private action home inside the validated runtime root and removes it after the product launcher resolves or fails, so its transient session state cannot become a second durable source. The DSH child environment no longer receives a persistent `DSH_HOME`; the fixed stdin host owns that lifecycle.

This composition stays `runtime=inactive`. It is not mounted into the current Cordis composition, a daemon, automatic polling, a consumer, provider, scheduler or effect path.

## Verification and rollback

Integration tests initialize the encrypted configured client, publish a DSH readiness report, receive one signed public reasoning plan from a fake device-session server, select only DSH, pass the program through stdin rather than argv, persist the local result and synchronize only its digest. The tests also verify zero effects, an empty persistent reasoning runtime and private/canonical root enforcement. Existing adapter and durable-resume tests continue to prove fixed invocation and no mid-action switch.

Rollback removes the configured facade method, operations composition, tests, catalog entry and this ADR, then restores the DSH host to its former temporary-state behavior if required. No schema, live state, service, consumer, provider, scheduler or external write needs migration or reversal.
