# Local Docker mail installation

Run from the repository root on this Windows workstation:

```powershell
./deploy/local/start.ps1
py -3.11 deploy/local/verify.py
```

The mail image must be loaded first. The `Export local Docker test image` Actions
workflow exports a published image digest as a `mail-docker-image` artifact. Download
that artifact and run `docker load -i mail-image.tar.gz`. Alternatively, build it:

```powershell
docker build -f Dockerfile.fdb -t shippintech-mail:local .
```

The script generates local storage/setup credentials, starts the persistent Docker
stack, performs first-run account setup, saves the permanent account to
`.credentials.json`, and disables the temporary setup account. The `.env` and
credential files are ignored by git. Keep them with the volumes when restarting.

- Mail UI: http://127.0.0.1:28080/mail
- Administration: http://127.0.0.1:28080/portal
- SMTP: localhost:21025; submission: localhost:21587
- IMAPS: localhost:21993; HTTPS: localhost:21443

The `web` container serves the Svelte build and proxies mail APIs to the `mail`
container. The engine's direct HTTP test port is localhost:28081. The gateway
resolves the engine through Docker DNS so container replacement does not leave
it pointing at an old address.

The test domain is `local.test`. Ports bind only to localhost. TLS uses the server's
local fallback certificate; the test IMAP client explicitly permits it.
This installation proves local mail delivery and browser access, not Internet
delivery or public DNS/certificate configuration.

`verify.py` sends a local message through SMTP and reads its matching body through
JMAP and IMAP. To verify persistence without sending another message:

```powershell
docker compose -f deploy/local/compose.yaml restart mail
py -3.11 deploy/local/verify.py --existing
```

FoundationDB, object storage, NATS and mail configuration use named volumes. Stop
with `docker compose -f deploy/local/compose.yaml stop`; preserve the volumes.
The original empty `fdb-*` volumes from initialization troubleshooting are retained;
the active persistent database uses the `fdb-*-v2` volumes.

Observed on 2026-11-07: SMTP delivery, matching JMAP body retrieval, IMAPS login
and retrieval, retained message after mail-container restart, and browser OAuth
sign-in followed by inbox and message reading all passed against this Docker
installation. Run the browser proof from `ui/` with
`node scripts/prove-local-mail.mjs`; its screenshot is written under
`target/local-mail-proof/reader.png`.
