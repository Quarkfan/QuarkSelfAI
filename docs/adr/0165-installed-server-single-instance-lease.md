# ADR 0165: Installed server single-instance lease

## Context

The explicit cloud server entry opened its SQLite provider graph before TLS or Unix-socket conflicts could reveal a duplicate process. A service manager retry, manual invocation or overlapping deployment could therefore briefly create two provider owners even though only one listener eventually survived.

## Decision

Every installed server config now pins one lease path at `<installation>/runtime/instance`. The process entry must acquire that lease before reading TLS credentials, opening SQLite or creating either network edge. A private owner record contains only process id, random token and timestamp. An active process blocks a second entry before provider construction.

Lease recovery accepts only a canonical, process-owned `0700` directory containing exactly one single-link `0600` owner record. It reclaims the directory only when the recorded process is no longer alive, using a quarantine rename before exact-file removal. Malformed, aliased, public, extra-file or ownership-drifted state fails closed and is not deleted. Graceful shutdown closes TLS, SSH IPC and the shared provider graph before releasing the exact lease token.

The ready receipt remains privacy-bounded and effects-off. This change does not register a service, enable auto-start, apply SSH configuration or change the current QuarkSelfAI runtime owner.

## Consequences

- A second installed server cannot open another provider graph against the same installation.
- Crash recovery can reclaim a valid stale lease, but stale Unix-socket reconciliation remains a separate service-restart requirement.
- The server config digest changes because the lease path is now part of its closed installation-bound schema.

## Verification and rollback

Tests prove mutual exclusion, release/reacquire, valid stale-owner recovery, malformed-state preservation and a real child-process attempt where the second entry fails while the first listener remains healthy. Graceful signal handling removes both socket and lease.

Rollback requires the installed server to be stopped. Remove only a verified stale lease after confirming no owner process remains, then restore the prior matching distribution and configuration together; never edit a receipt digest around the schema change.
