# ADR 0156: Prepared OpenSSH gateway plan

- Status: accepted for non-applying implementation
- Date: 2026-09-06

## Context

The subsystem process exists but installing it with an unconstrained account or ordinary authorized key would still expose a remote shell, forwarding or command surface. Installation content must be deterministic and reviewable before privileged writes or sshd reload are introduced.

## Decision

Render a content-addressed, `prepared-inactive` OpenSSH plan for one dedicated non-root OS user and one structurally valid Ed25519 public key. The authorized-key line combines OpenSSH `restrict`, explicit forwarding/agent/X11/PTY prohibitions and an exact forced command that invokes only the built subsystem entry with its private config. Paths must be absolute, normalized and shell-safe. The matching sshd drop-in repeats public-key-only authentication and disables password, keyboard-interactive, empty-password, forwarding, X11, TTY, tunnel and gateway behaviors.

The plan declares OpenSSH 7.2 or newer because that is the portability floor for `restrict`. It contains no private key, password or credential and sets both application and reload permissions to false. Its rollback order removes the authorized key before the drop-in, validates before any reload and preserves server state.

The renderer performs no filesystem write, account creation, package installation, sshd validation/reload or network connection.

## Verification and rollback

Tests assert every restrictive directive, the exact forced-command shape, content digest and frozen rollback contract. Root accounts, caller-supplied key options, multiline/multiple keys and shell-ambiguous paths fail closed.

Rollback removes the renderer, test, ADR and module ownership entry. No system state exists to restore.
