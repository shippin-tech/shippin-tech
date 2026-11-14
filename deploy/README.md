# Pull-based test deployments

## Optional landing site (submodule)

The shippin.tech landing page lives in its own repo, `shippin-tech/landing`,
mounted at `landing/`. It is **off by default**: a normal clone or
`git submodule update --init` does not fetch it (`update = none` in
`.gitmodules`).

```sh
# Pull it in
git submodule update --init --checkout landing
# Leave it out again
git submodule deinit -f landing
```

See `landing/README.md` for the Astro site and the signup API.


For a local Docker test installation on this workstation, use
[the persistent local stack](local/README.md). It includes the mail server,
FoundationDB, object storage and NATS, initial account setup, and a real
SMTP/JMAP/IMAP verification script. Start it with `./deploy/local/start.ps1`
from the repository root. The server UI is at `http://127.0.0.1:28080/portal`.

> **Pre-release. Not production.** Nothing here is supported for real users' mail.
> Interfaces, data layouts and settings change without migration or notice, and data
> on test installs can be lost. Do not host anyone else's mail on it. The release gate
> is [RELEASE.md](RELEASE.md); pull requests are closed automatically until the AI
> working system in [mcpl/](mcpl/README.md) is accepted (see [AGENTS.md](AGENTS.md)).

## Install on one host

Needs: a Linux amd64 host, Docker Engine with the Compose plugin (2.20 or
later), util-linux (`flock`) and `curl`. The image is private, so first sign
Docker in to the registry with a GitHub token that has `read:packages`:

```sh
docker login ghcr.io -u YOUR_GITHUB_USER
curl -fsSL https://raw.githubusercontent.com/shippin-tech/shippin-tech/main/install.sh \
  | sudo bash -s -- --hostname mail.example.com
```

That is the only supported install. It creates `/srv/shippin-tech/mail` with
`compose.yaml`, the scripts and a generated `server.env`, then starts the mail
server together with FoundationDB, object storage and NATS on the same host
(`COMPOSE_PROFILES=bundled`), all with persistent Docker volumes. Add
`--no-start` to review `server.env` before the first start, and
`--auto-update` to install the release-channel timer described below.

### First sign-in

A new server has no administrator. It prints a one-time setup key, which
`update.sh` and `install.sh` repeat at the end of their output:

```
username: admin
key:      <24 characters>
```

Open `https://mail.example.com/login`, enter `admin`, then the key. The only
page you can reach is **Create your administrator**: choose your own address
and password. From then on you sign in with that address, and the key no
longer works. It also stops working 24 hours after it was made
(`SETUP_KEY_HOURS` in `server.env` changes that); restart the server then and a
new key is printed. Until then the key stays the same across restarts; it is
kept in `/var/lib/shippin.tech/setup-key` inside the data volume, readable by
root only:

```sh
cd /srv/shippin-tech/mail
docker compose --env-file server.env exec mail cat /var/lib/shippin.tech/setup-key
```

`RECOVERY_ADMIN=admin:<long password>` in `server.env` is an optional
break-glass login. When it is set, no setup key is printed and `admin` signs
in with that password instead. It is not needed for normal operation.

### Before people use it

1. **DNS:** an A record (and AAAA for IPv6) for the host name pointing at the
   server, and reverse DNS for the server's IP set to the same name at your
   hosting provider. Each mail domain's own records are listed in the portal and,
   for free-plan customers, on `/manage`.
2. **Firewall:** allow TCP 25, 465, 587, 993 and 443 in, and outbound TCP 25.
   Port 8080 stays on loopback.
3. **TLS certificate:** until one is issued, mail apps see the server's own
   certificate and warn. In the admin panel, open **Security → TLS certificates**
   (`/shippin/admin/tls`). Add an ACME provider (Let's Encrypt, challenge type
   TLS-ALPN-01, which needs public port 443 to reach the mail server directly),
   then edit the host name's domain and set its TLS certificate management to
   automatic with that provider. The panel also links to certificate imports and
   shows stored certificate validity dates. Reloading certificates does not request
   issuance or prove HTTPS trust. If the untrusted certificate prevents the UI from
   loading, access the loopback HTTP listener through an SSH tunnel for this initial
   setup; do not expose port 8080 publicly or disable certificate validation.
4. **Check:** `cd /srv/shippin-tech/mail && sudo bash verify-install.sh`
   confirms the settings are in the data volume, that you can sign in, and that
   both survive a restart.

## Connect Google Drive (optional)

Each person can link their own Google Drive at `/files?view=google`. It is off until you create a Google OAuth client:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**.
2. Under **OAuth consent screen**, choose **Internal** if everyone is on your own Google Workspace; Google does not need to review that. Anyone outside your Workspace needs an **External** app, and Google requires a verification before strangers can connect.
3. Under **Credentials**, create an **OAuth client ID** of type **Web application**. Its authorized redirect URI is `https://<your mail host>/api/google/callback`.
4. Add these to `server.env` in the instance directory, then run `bash update.sh <image digest>`:

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_REDIRECT_URL=https://<your mail host>/api/google/callback
```

The client secret and each person's tokens stay on the server, and tokens are stored encrypted.

## Deleted mail and accounts

Deleted messages and removed accounts stay on the server for 30 days so an administrator
can restore them from **Recover deleted** in the admin panel. Set
`KEEP_DELETED_DAYS` in `server.env` to change that, or to `0` to keep nothing. The kept data
uses disk until it expires. Someone who closes their own domain from the free-plan panel
has it erased at once. `MASKED_LIMIT` in `server.env` caps how many masked addresses one
person can have (50 by default).

## Organisations, logos and domain sign-in

**Organisations** in the portal group domains under their own administrators, with limits
on people and shared storage. An organisation's administrators work at `/org` and reach
only its people.

A domain's manager can set its **logo** and an OpenID Connect **sign-in provider**. Register
`https://<mail host>/api/sso/callback` with the provider. People need an account here first,
and the server's administrators always sign in with a password. Provider addresses must be
https and must not resolve to a private network.

A domain's manager can also make a **SCIM token** so an identity provider such as Okta or
Microsoft Entra can manage that domain's people and teams. Point the provider at
`https://<mail host>/api/scim/v2` with the token as a bearer token. It is shown once, works
for that domain only, and cannot change the server's administrators.

## Upgrade an existing host

Always start with the dry run. It changes nothing and reports what it found:
the running image, where that server reads its settings, and what will happen
to them.

```sh
cd /srv/shippin-tech/mail          # the instance directory
bash update.sh --check
```

`update.sh` never replaces the server's settings. If the data volume does not
hold `/var/lib/shippin.tech/config.json` yet, it copies the settings file the
running server was started with into the volume first, whatever path an older
layout used, and saves your previous `./config.json` as
`config.json.before-upgrade`. Only when no server is running does it fall back
to `./config.json`. Accounts, mail and the administrator live in FoundationDB
and object storage and are untouched.

### From v0.1.2 (for example VM 164)

v0.1.2 mounted `./config.json` read-only into the container, had no data-volume
settings file and no setup key. To move it to the current layout:

```sh
cd /path/to/the/instance            # where server.env and update.sh are
cp server.env server.env.v0.1.2     # keep a copy of what you had
REF=main                            # or the release tag you are moving to
for f in compose.yaml update.sh auto-update.sh verify-install.sh; do
  curl -fsSL "https://raw.githubusercontent.com/shippin-tech/shippin-tech/$REF/deploy/$f" -o "$f"
done
bash update.sh --check              # should say the running server's
                                    # /etc/shippin.tech/config.json will be copied in
bash update.sh ghcr.io/shippin-tech/shippin-tech-scale@sha256:<digest>
sudo bash verify-install.sh
```

Your existing server keeps using FoundationDB, S3 and NATS as before; leave
`COMPOSE_PROFILES` unset, because those services are your own. Sign in with the
administrator you already have. If you never created one, the server prints a
setup key on this first start of the new version, as for a new install. Once the
check passes, `sudo bash auto-update.sh install` keeps the host on the release
channel.

### From v0.1.3 or later

`auto-update.sh` handles it: every update first refreshes `compose.yaml`,
`update.sh`, `auto-update.sh` and `verify-install.sh` from the new image. By
hand: `bash update.sh --check`, then `bash update.sh <image>`.

## Backups

On a node with the bundled services, `backup.sh` in the instance directory
takes a consistent FoundationDB snapshot (accounts, settings, mail index),
mirrors the object storage (message bodies and attachments) right after it, and
saves the settings file and `server.env`, all under `backups/<UTC time>`. It
keeps the newest seven (`KEEP=14 bash backup.sh` for more):

```sh
cd /srv/shippin-tech/mail
sudo bash backup.sh                 # take one now
sudo bash backup.sh list
```

Run it nightly with cron (`sudo crontab -e`):

```
15 3 * * * cd /srv/shippin-tech/mail && bash backup.sh >> backups/backup.log 2>&1
```

Copy `backups/` off the host as well (rsync, restic, your provider's snapshots):
a backup on the same disk does not survive losing the disk. To restore, which
replaces every account, setting and message with the backup:

```sh
sudo bash backup.sh restore backups/20261110T031500Z --yes
```

It stops the mail server, restores FoundationDB and the object storage, and
starts it again. A restore of an upgraded node was rehearsed: a message deleted
after the backup came back, and an account created after it was gone. Nodes on
your own FoundationDB and S3 back those up with their own tools
(`fdbbackup`, bucket replication).

## Your own FoundationDB, object storage and NATS

Leave `COMPOSE_PROFILES` empty in `server.env`, set `S3_*` and `NATS_ADDRESS`
to your services, and put the cluster's `fdb.cluster` next to `compose.yaml`
(readable by UID 2000). `update.sh` copies it into the shared volume on every
run. Nodes in one cluster share FoundationDB, S3 and NATS and need unique
`MAIL_HOSTNAME` and `COMPOSE_PROJECT_NAME`. S3/NATS settings seed empty
registry singletons on first boot; editing them later does not overwrite
existing registry settings. Do not use `resources/scale/docker-compose.yml` for
persistent servers: it keeps FoundationDB and MinIO data in memory.

The image name is always lowercase (`ghcr.io/shippin-tech/shippin-tech-scale`).
`update.sh` takes an `@sha256:` digest or a `:sha-<full-40-character-commit>`
tag; moving tags such as `release` are refused. Use the same image on all
servers. Health checks measure process liveness, so verify mail delivery,
shared mailbox access and tenant isolation before promoting a build.

## Automatic updates from the release channel

Pushing a version tag (`git tag v0.1.2; git push origin v0.1.2`) builds the
image and tags it `:sha-<commit>`, `:v0.1.2` and `:release`. A host that runs
`auto-update.sh` follows `:release` and needs no further commands. Install it
once, as root, from the instance directory (the one holding `update.sh`,
`compose.yaml` and `server.env`):

```sh
curl -fsSLO https://raw.githubusercontent.com/shippin-tech/shippin-tech/main/deploy/auto-update.sh
sudo bash auto-update.sh install
```

Every five minutes a systemd timer pulls `:release`, resolves it to an
immutable `@sha256` digest and, only if that digest differs from the running
one, runs `update.sh` with it. `server.env` and `deployments.log` therefore
always name the exact image that is live, never a moving tag. If the new
image fails its health check the script redeploys the previous image, logs
`FAILED <digest>` in `deployments.log` and writes the digest to
`.update-skip` so the timer does not retry it. Fix the build, push a new
version tag, and the next check picks it up.

The three commands you might ever need, all run in the instance directory:

```sh
bash auto-update.sh status     # running image, channel, timer, last deployments
sudo bash auto-update.sh check # check right now instead of waiting
bash auto-update.sh retry      # allow a digest that failed earlier to be tried again
```

`SHIPPIN_CHANNEL=beta` in `server.env` follows a different tag. Manual
`bash update.sh <digest>` still works and the timer respects whatever it
finds in `server.env` afterwards. `sudo bash auto-update.sh uninstall`
removes the timer without touching the running node.

## Free plan: self-service signup

Do not open signups or tag a release until [RELEASE.md](../RELEASE.md) is complete.

Set `PANEL_SIGNUP=open` in `server.env` and rerun the update to let people
sign up at `https://MAIL_HOSTNAME/signup`. It works like any hosted mail panel:

1. The customer enters a domain they own. The server shows one TXT record,
   `_shippin-verify.<domain>`, whose value is derived from this server's
   secret.
2. Once that record is published, they choose an address and password. The
   server looks the record up in DNS, then creates the domain with automatic
   DKIM keys and an owner mailbox. No record, no domain: without this proof
   anyone could claim a domain such as `gmail.com` and receive mail your other
   users send to it.
3. The owner signs in and lands on `/manage`. There they add mailboxes,
   reset passwords, add and remove aliases, see storage used, and copy the
   MX, SPF, DKIM and DMARC records to publish.

The limits are per domain and apply only to self-service domains:

| Setting | Default | Meaning |
| --- | --- | --- |
| `PANEL_MAILBOXES` | 5 | Mailboxes per domain, owner included |
| `PANEL_ALIASES` | 20 | Aliases per domain |
| `PANEL_MAILBOX_MB` | 1024 | Storage per mailbox |
| `PANEL_MAX_DOMAINS` | 100 | Domains on the whole server, yours included; signup stops at this number |
| `PANEL_SIGNUPS_PER_HOUR` | 10 | Signup attempts per IP address |
| `PANEL_SENDS_PER_DAY` | 200 | Messages each signed-in sender may send per day |

The sending cap is an inbound throttle named "Free plan: messages per
signed-in sender per day", created on the first signup. It counts only
authenticated senders, so mail arriving from the internet is not affected.
It covers every signed-in account, operators included; change or disable it
in the portal. Owners carry the "Self-service domain owner" role. Grant or
remove it in the portal to transfer a domain. Changes to the limits apply to
new actions; existing mailboxes keep the storage they were created with.

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
`update.sh` itself never rolls back; only the `auto-update.sh` timer redeploys
the previous image after a failed health check. Old binaries may not
understand data written by new builds. Back up FoundationDB and S3 consistently before schema changes.
Restoring an image does not restore data. Preserve the node-data volume and
do not run `docker compose down -v` during updates.

References: [GHCR publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
and [Compose health waiting](https://docs.docker.com/reference/cli/docker/compose/up/).
