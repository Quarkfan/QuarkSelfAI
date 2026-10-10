# Capability platform client service rehearsal — 2026-10-10

## Scope

This evidence covers an isolated, disposable rehearsal of the Phase 2 client distribution and installed-service preparation lifecycle. It did not register or start a service, enroll a device, contact a control plane, load capabilities, enable external writes, or change the current runtime composition.

## Immutable inputs

- Source revision: `fff14604fada14ef714098eb50566d377e0882ed`
- Client version: `0.1.0`
- Artifact digest: `sha256:d9e34a3ea5507e13d07474ad5c26d20d0539f24ab646f6d51b67655de2354af6`
- Manifest inventory: 30,368 files
- Runtime dependency closure: 428 packages
- Rehearsal transport endpoint: reserved, non-resolving `.invalid` hostname; no connection was attempted
- Credential references: inert rehearsal identifiers only; no private key or credential was created

The working tree contained pre-existing user changes to `package.json` and three generated web files. They were neither edited nor staged by this batch. The `package.json` delta only adds a web-client export and DSH web injection metadata; the client distribution builder does not read those fields.

## Executed lifecycle

The bundled installer from the sealed artifact performed this exact sequence in a private temporary directory:

1. install the client into a new root;
2. recover and verify installation, configuration and distribution lineage;
3. render and persist one launchd-user definition from the sealed template;
4. recover and verify the service definition and preparation receipt;
5. remove only the verified, unregistered service preparation;
6. uninstall the never-started client and verify that the install root no longer exists.

The installation receipt remained `installed-inactive`. The service receipt remained `service-prepared-inactive` with `registered=false`, `started=false`, `autoStart=false` and `externalWritesEnabled=false`. The prepared definition digest was `sha256:ee9228e9b211ecc919e9e3774fc5cdfab0854f7792187d5b5dacecc3a2c7cc3b`.

## Result and boundary

The disposable install-to-service-preparation rollback path is verified against the exact source revision and artifact digest above. This is not evidence of a durable installed client, device enrollment, cloud connectivity, daemon readiness, service-manager activation, capability execution or production cutover. Those remain separate completion gates.
