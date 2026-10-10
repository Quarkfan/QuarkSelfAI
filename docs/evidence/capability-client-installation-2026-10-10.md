# Capability client installation evidence — 2026-10-10

## Verified installation

Client source revision `a45a1545e066a3fb444e80ac273ca03f9a0d699d` was sealed as version `0.2.0`. The distribution contains 30,368 files and 428 runtime packages with artifact digest `sha256:4846ca6329927332560b0d80aaa0084b23f7d21095e64347337e2e1c7edd0a1c`.

The bundled installer byte-verified that distribution and created installation `installation.55d77b67c79ec65ad1e0b93edc9a3458`. Independent status recovery returned `installed-inactive`, `autoStart=false` and `externalWritesEnabled=false`.

The build entry now verifies that the declared 40-character revision is exactly the current Git HEAD before bundling. An earlier newly generated distribution whose caller-supplied revision did not match HEAD was never installed and was precisely removed.

## Current boundary

- no client master key exists for this installation;
- no device identity or enrollment request exists;
- no service definition is prepared, registered or running;
- no Claude Code, Codex or DSH executor was invoked;
- no capability, workspace or desktop access was granted;
- no external write occurred;
- the existing QuarkSelfAI consumer/provider/writer was unchanged.

The host safety reviewer rejected the exact master-key provisioning operation because credential mutation requires an explicit owner confirmation beyond the prior broad platform mandate. No alternate Keychain command, environment injection or other workaround was attempted. The installation remains recoverable and cannot be activated until that exact gate succeeds.

## Next operation and rollback

After explicit confirmation, the bundled installer may create one random client master key under the fixed Keychain service and installation account, with secret bytes only on stdin and metadata-only receipts. Enrollment then uses the loopback HTTPS endpoint with the owner-only public CA certificate path; approval and polling precede any service preparation or activation.

Before durable client state exists, the verified unused uninstall path remains available. After master-key-backed device state is created, rollback must preserve state and use the explicit enrollment/service lifecycle; recursive deletion is prohibited.
