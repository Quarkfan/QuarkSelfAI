# ADR 0176: Gated installed-device enrollment before service activation

## Status

Accepted as an inactive client lifecycle boundary. No real device, credential, network request or service-manager state was created or changed by this decision.

## Context

The installed client already had a resumable device-code enrollment protocol, but the sealed installer could not invoke it. More importantly, the service activation transaction committed solely from process health and did not prove that the device had been approved by the cloud. This allowed a locally healthy but unregistered device to be represented as an active client service.

## Decision

The bundled installer gains exact `begin-enrollment` and `poll-enrollment` commands. Both are mutations and require `QUARK_CLIENT_ADMIN_ENABLE=1` plus the narrower `QUARK_CLIENT_ENROLLMENT_ENABLE=1` network gate. They recover the sealed installation, open the single encrypted client owner, use the fixed HTTPS or explicit ephemeral-loopback endpoint, persist the poll credential only in the encrypted local store and always close the client lease.

Their public receipt contains only installation identity, user code, fixed verification path, expiry, bounded state and cleanup status. It omits tenant, user, device, endpoint, absolute paths, public/private keys, poll token and response bodies. Repeated begin resumes the same durable request; polling retains pending state on transport failure and removes the poll credential before committing approved or expired.

Client service activation now runs an enrollment preflight before writing its intent or calling the service manager. A missing local database fails without creating identity or reading Keychain. Existing state must reopen with its configured master key and report durable `approved` with no credential cleanup pending. Process health remains necessary but is no longer sufficient.

## Consequences

Installation, local identity creation, cloud enrollment and service activation remain separate transitions. No auto-enrollment, browser approval, polling loop, auto-start, capability load or effect is introduced. The current deployment remains not installed and unenrolled.

Rollback removes the installer commands, administration module and activation preflight. It must preserve any local identity, encrypted poll credential or approved enrollment already created by a later explicit operation; those are durable user state and require forward recovery, not implicit deletion.
