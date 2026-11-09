# Pull-based test deployments

For a local Docker test installation on this workstation, use
[the persistent local stack](local/README.md). It includes the mail server,
FoundationDB, object storage and NATS, initial account setup, and a real
SMTP/JMAP/IMAP verification script. Start it with `./deploy/local/start.ps1`
from the repository root. The server UI is at `http://127.0.0.1:28080/portal`.

Requires Linux amd64, Docker Engine, Compose v2 with `up --wait`, and
util-linux (`flock`). Each server runs one mail node from a prebuilt image.

## Initial setup

1. Commit and push the workflow to your repository. Enable Actions and
   allow `GITHUB_TOKEN` to write packages. Push to `main`, or manually run
   **Test container build**. Download its `server-bundle` artifact and extract
   the included tarball into a dedicated directory on each host.
2. Provision persistent FoundationDB 7.4, an S3 bucket and NATS reachable
   from every node's container. This bundle does not provision infrastructure.
   Do not use `resources/scale/docker-compose.yml` for persistent servers:
   it stores FoundationDB and MinIO data in temporary memory-backed storage.
3. Copy `server.env.example` to `server.env`. Set real endpoints/credentials
   and a unique, stable `MAIL_HOSTNAME` on each host. Set a unique
   `COMPOSE_PROJECT_NAME` per instance to isolate containers/networks/volumes.
   Nodes in one cluster
   share FoundationDB, S3 and NATS. Separate test clusters need separate data.
   S3/NATS environment variables seed empty registry singletons on first
   boot; editing them later does not overwrite existing registry settings.
4. Copy the cluster's `fdb.cluster` alongside `config.json`. Its advertised
   addresses must be reachable inside containers on every host. Ensure both
   files are readable by container UID 2000. Run `chmod 600 server.env`.
5. For private GHCR packages, run `docker login ghcr.io -u YOUR_GITHUB_USER`
   using a token with package read access (`read:packages`, plus organization
   authorization if required).
6. Run the exact digest command shown in the successful workflow summary:

   ```sh
   bash update.sh ghcr.io/shippinai/shipping-tech-scale@sha256:DIGEST
   ```

The image name is always lowercase (`ghcr.io/shippinai/shipping-tech-scale`). A `:sha-<full-40-character-commit>` tag
is also accepted. Use the same digest on all servers. No `latest` tag is used.

Ports bind to loopback initially. Inspect bootstrap output and complete the
application's accounts/domains/listeners setup before exposing the server:

```sh
docker compose --env-file server.env logs --tail 100 mail
docker compose --env-file server.env ps
```

Set `MAIL_BIND` and `HTTPS_BIND` to the desired server interface and rerun the
update command when ready. Keep 8080 private. Configure domain DNS, firewall,
certificates and mail delivery settings separately. Health checks measure
process liveness; verify actual mail delivery, shared mailbox access and
tenant isolation before promoting a build.

## Control plan for per-instance operation

Use one deployment directory per node instance. For each instance:

1. Copy the bundle into an instance directory (example:
   `/srv/shippin-tech/node-a`, `/srv/shippin-tech/node-b`).
2. Set a unique `COMPOSE_PROJECT_NAME` in each `server.env`.
3. Set a unique `MAIL_HOSTNAME` for each node.
4. If multiple instances share one host/IP, set unique host ports in
   `server.env` (`HTTP_HOST_PORT`, `SMTP_HOST_PORT`, `SMTPS_HOST_PORT`,
   `SUBMISSION_HOST_PORT`, `IMAPS_HOST_PORT`, `HTTPS_HOST_PORT`).
5. Keep the same `SHIPPIN_IMAGE` digest across all instances in one rollout.

Recommended rollout controls:

- **Canary first:** run `bash update.sh <digest>` on one instance and validate
  login, send/receive and shared data access before touching the rest.
- **One-at-a-time updates:** update instances sequentially to reduce blast
  radius and keep other nodes serving.
- **Immutable release target:** pin exact digest; never deploy `latest`.
- **Change log:** keep `deployments.log` and `server.env.previous` for each
  instance; they are your fast recovery references.
- **Recovery action:** redeploy a known-good digest explicitly with
  `bash update.sh <digest>` from that instance directory.

## Enterprise client lanes

For client-by-client enterprise offers, support all lanes with one standard:

- **Dedicated stack per client:** strongest isolation, best for regulated or
  contract-sensitive tenants.
- **Shared cluster multi-tenant:** cost-efficient default when policy
  isolation is acceptable.
- **Hybrid:** shared by default with dedicated upgrades for premium or
  compliance clients.

[control-plan.template.json](./control-plan.template.json) records design
requirements only. It does not implement these lanes or deployment automation.
Unique Compose names and ports do not isolate clients sharing the same data
stores. Dedicated installations require distinct storage and credential
boundaries; hybrid placement requires explicit tenant-to-installation ownership.
Mail reload and web-bundle update actions are not rollout or rollback operations.

## Updates and recovery

Review new deployment bundles for configuration changes without overwriting
your `server.env`, `fdb.cluster` or named volume. Run the new digest command
on one server, validate it, then update the remaining servers. Each update
briefly interrupts that node's connections; this is not zero-downtime rollout.

The script pulls first, waits for container health, then saves the successful
image in `server.env`. It retains `server.env.previous` and appends to
`deployments.log`. A failed health check leaves the new container running
for inspection but does not save the failed image selection.

Redeploy a previous digest explicitly with `bash update.sh <previous-image>`.
There is no automatic rollback: old binaries may not understand data written
by new builds. Back up FoundationDB and S3 consistently before schema changes.
Restoring an image does not restore data. Preserve the node-data volume and
do not run `docker compose down -v` during updates.

References: [GHCR publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
and [Compose health waiting](https://docs.docker.com/reference/cli/docker/compose/up/).
