# Capability platform reasoning executor pilot 04 — 2026-10-10

## Result

The same signed `envelope.v1` public synthetic Agent program completed through Claude Code and Codex on the current host. DSH was detected but reported `authentication-required`, so the three-executor contract gate remains incomplete.

## Immutable scope

- Source revision: `e66311be21c8048a947c9ace5c9738e29e55142d`
- Input: fixed public synthetic science explanation
- Capabilities, graph nodes, context and workspace grants: empty
- Approval grants and allowed effects: empty
- Process arguments contain no prompt
- Executor fallback: disabled; each executor was selected and attempted independently
- Raw output: not retained or projected
- Temporary runtime and result directories: removed by the pilot

Claude Code first timed out inside the outer tool sandbox, then succeeded in the host execution context with result digest `sha256:e1839a0d99c236134cd93da633c699f95456eac19119531e44ec6e54a4ca300a`. Codex first failed because the outer sandbox denied its in-process app-server initialization, then succeeded in the host execution context with result digest `sha256:d4335db81a9e0d59750ab76bcca673f7f4ce508f760f516c500754aa5d1952c2`.

DSH was not executed because readiness failed before model invocation: the repository-locked runtime was present, but the current execution context did not expose its inference credential configuration. No credential value was read, printed or persisted.

## Boundary

This proves current-host Claude Code and Codex compatibility with the normalized no-effect envelope. It does not prove DSH execution, installed-client routing, fallback continuity, workspace/tool use, capability execution, service activation or external effects. `executorContractVerified` must remain false until DSH completes the same contract and the installed client verifies routing evidence.
