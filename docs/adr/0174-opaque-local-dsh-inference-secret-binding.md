# ADR 0174: Opaque local DSH inference secret binding

## Status

Accepted as an inactive, backward-compatible client contract. No existing inference credential is read, copied or changed by this decision, and no DSH process is started.

## Context

The product already stored device credentials behind encrypted local references, but bundled DSH discovery and execution still depended on `QUARK_INFERENCE_API_KEY` being present in the parent process environment. An installed background client cannot safely assume an interactive shell environment, and placing the key in a launchd/systemd definition would leak a durable secret into service metadata.

## Decision

Client bootstrap schema version 1 gains one optional closed `dshInference` object containing an HTTPS base URL, bounded model identifier and `secret:*` API-key reference. Existing documents without the object remain valid. The compiled plan carries only that reference and non-secret provider metadata.

The configured client may explicitly provision the referenced key into its existing encrypted local secret store. Discovery tests only whether the exact reference resolves and passes synthetic presence markers to the manifest-only DSH probe; it never reads or projects the value. Execution resolves the secret only inside a bounded callback owned by the encrypted client, injects it into the allowlisted DSH child environment for that process lifetime and zeroes the decrypted byte copy afterward. Claude Code and Codex receive no provider variables from this binding.

## Consequences

DSH readiness no longer requires a secret in the launch shell or service definition. The cloud sees only the existing bounded executor availability report. Actual provisioning remains an explicit local credential mutation and is not performed by this batch. A future UI/installer command must bind approval to the exact client, reference and provider metadata without accepting the key in argv.

Rollback removes the optional binding and returns to parent-environment discovery. Existing encrypted records remain local user data and must not be deleted automatically.
