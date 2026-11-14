# Free plan v1: release gate

> **Pre-release. Not production.** Nothing here is supported for real users' mail.
> Interfaces, data layouts and settings change without migration or notice, and data
> on test installs can be lost. Do not host anyone else's mail on it. The release gate
> is this file; pull requests are closed automatically until the AI
> working system in [mcpl/](mcpl/README.md) is accepted (see [AGENTS.md](AGENTS.md)).

**Rule: no `v*` tag until every item below is Done, or Jesse has marked it Waived in this file.** A tag builds the image and moves the `release` channel; hosts running `auto-update.sh` take it within five minutes. Until then, work lands on `main` and is tested on the local Docker stack (`deploy/local/`).

Scope of v1: a hosted mail service where customers bring their own domain, prove it by DNS, and manage a capped number of mailboxes. Out of scope, and hidden from customers by the navigation: the platform port (C1 to C4), Drive (W2), Docs (W3) and full admin-portal parity (P2, P4, P5). Those stay in `ui/porting/work-packages.json`.

Branches, checked 2026-11-10: `shippin-tech/shippin-tech` and `shippin-tech/landing` each have one branch, `main`, fully pushed. A fresh clone fetches the landing submodule at the recorded commit.

## A. Blockers found by testing

| Id | Item | Done when | Status |
| --- | --- | --- | --- |
| A1 | **Account self-service.** Customers need to change their own password, create app passwords for mail apps, and turn two-factor sign-in on and off. Nothing in the new UI does this. | A free-plan mailbox does each in the browser. An IMAP client signs in with an app password. Sign-in asks for the code once two-factor is on. | Done: `deploy/local/verify_account.py` (25 checks, including web sign-in with and without a code and IMAP with an app password) and the browser suite |
| A2 | **Legacy `/admin` and `/account` are broken everywhere.** The server downloads them from a GitHub address that does not exist (`shippin.techlabs/webui`). | A fresh server logs no download error. `/admin` opens the portal and `/account` opens the A1 page. | Done: on build 808f12b `/account` and `/admin` are served by the built-in app and the server logs no download error after a restart |
| A3 | **Webmail cannot send.** It lists folders and reads messages only. | Compose, reply, forward and send to an internal and an external address. Drafts and Sent fill correctly. An attachment survives a round trip. | Done: the browser suite sends, receives and replies, checks Sent and Drafts, and round-trips an attachment byte for byte. Delivery to an outside address is proven by B4 on the host |
| A4 | **Owner password recovery.** An owner who forgets their password can only be helped by the operator. | Decision recorded here, then built: either a recovery address set at signup with an emailed reset link, or operator-assisted recovery documented for v1. | Needs Jesse's decision |
| A5 | **DNS status in `/manage`.** Owners see which records to publish but not whether they are live. | Each required record (MX, SPF, DKIM, DMARC) shows found or missing from a live lookup. | Done for missing records; the published case needs a real domain (B1) |
| A6 | **One admin model.** The deploy docs require a permanent `RECOVERY_ADMIN` and call the printed key a failure, `install.sh` relies on the printed key and the old wizard, and `/login` refuses `admin` because it has no `@`. Nothing makes the first key single-use. | A fresh server prints one setup key, kept across restarts. Signing in as `admin` with it forces creation of the real administrator, after which the key no longer works. `RECOVERY_ADMIN` is optional break-glass. `/login` accepts `admin`. | Done: on a fresh node built by `install.sh`, the browser test `e2e-live/first-run.spec.ts` signs in as `admin` with the key, is held on "Create your administrator", creates it, then the key is refused and the new administrator reaches the portal; the key was unchanged across a restart and deleted afterwards |
| A7 | **One install path that sets up a whole host.** `install.sh` downloads from GitHub Releases, which has none, so it fails for everyone. `deploy/` expects you to bring FoundationDB, object storage and NATS yourself. | One command on a clean Linux host installs Docker services for the mail server, FoundationDB, object storage and NATS with persistent data, prints the setup key, and lists the ports, DNS records and certificate it needs. | Done on this workstation: `install.sh` wrote the instance, `update.sh` started the bundled FoundationDB, object storage and NATS and the mail server, and printed the key. Certificate issuance is A10. A Linux host run is B3 |
| A8 | **Upgrade from any earlier layout, including v0.1.2 on VM 164.** v0.1.3 moved the settings into the data volume; replacing a container whose settings live elsewhere loses them, which is how the admin key reset happened. | `update.sh` copies the running server's own settings into the data volume before replacing it, has a dry run that reports what it found, and the steps from v0.1.2 are written down. | Done: a v0.1.2 node on the real v0.1.2 image, with an administrator, a mailbox and a delivered message, was upgraded by the README steps; the dry run named its settings file, the upgrade copied it into the volume, and afterwards the administrator, the mailbox and the message were all there, also after a restart (`verify-install.sh`, 7 checks) |
| A9 | **AI instructions.** `AGENTS.md` has no install or upgrade steps. | `AGENTS.md` gives the install, first sign-in and upgrade steps and points to `deploy/README.md`. | Done: `AGENTS.md` has install, first sign-in, upgrade and release rules |
| A10 | **TLS certificate at install.** The installer leaves the certificate as a portal step, so mail apps warn until an operator sets up ACME by hand. | `install.sh` or first-run setup requests a Let's Encrypt certificate for the host name, verified on a public host. | Open |

## B. Verification still owed

| Id | Item | Done when | Owner | Status |
| --- | --- | --- | --- | --- |
| B1 | Signup with a real domain and real DNS. The local stack skips the TXT check, so it has only unit tests. | A test domain is refused before its TXT record exists and accepted after. | Jesse publishes the record; Claude runs the check | Open |
| B2 | Browser tests of signup, sign-in, `/manage` and role-based navigation, with an accessibility scan. | Playwright suite passes headless against the local stack. | Claude | Done: 6 live browser tests, signup to domain closure, with accessibility scans on signup, `/manage`, `/account` and compose (`npm run test:live`) |
| B3 | Fresh install on a clean host from `deploy/README.md` alone, the path that produced the admin key reset. | `sudo bash verify-install.sh` in the instance directory passes: settings in the data volume, `RECOVERY_ADMIN` signs in, no setup wizard, all again after a restart. The script passes 7 checks on the local stack. | Jesse runs it on the host | Open |
| B4 | Deliverability from the mail host: reverse DNS for 206.109.207.24 names `mail.shippin.tech`, outbound port 25 open, not on blocklists, valid TLS for IMAP and SMTP, SPF, DKIM and DMARC pass at Gmail and Outlook. | A test message scores clean at a checker and lands in the inbox at both. | Jesse (host and provider) | Open |
| B5 | Backups: FoundationDB and object storage on a schedule, plus one restore drill. | A restored copy serves an existing mailbox. | Jesse | `deploy/backup.sh` built and rehearsed on this workstation: backup, damage, restore brought back a deleted message and removed a later account. Still owed: nightly cron and an off-host copy on the real host | Open (host) |
| B7 | Three operator-portal browser tests in `ui/e2e/search.spec.ts` have failed since the sign-in gate on `/portal` (2026-11-08): they visit the portal signed out and are redirected mid-test. Confirmed failing on the commit before this work. | They sign in with mocked responses and pass. | Claude | Done: all six mocked browser tests pass and now run in Check |
| B6 | Upgrade path: a host on v0.1.3 takes the candidate through `auto-update.sh` with data intact, and a deliberately failing image rolls back. The rollback logic has fake-docker tests in Check, and the local stack has run five successive builds on the same data with nothing lost. A real run of the Linux scripts needs a Linux machine logged in to the private image registry: this workstation's GitHub token cannot read packages and WSL is not reachable from here. | One upgrade observed on the host or a staging copy, then one forced rollback. | Jesse on the host, or Claude given such a machine | Done on this workstation with the real v0.1.2 image and the candidate (see A8), and the forced-rollback logic has fake-docker tests in Check. Still owed: the same upgrade on VM 164 itself, starting with `bash update.sh --check` | Open (host) |

## C. Decisions only Jesse can make

| Id | Decision | Why it blocks | Status |
| --- | --- | --- | --- |
| C1 | **Licensing.** This server is derived from ShippinTECH. Most source files had their license headers removed, and 172 sections marked with ShippinTECH's enterprise license are compiled in by default. Options: restore the upstream notices and comply with them (including source for hosted users), build without the `enterprise` feature, or license it from ShippinTECH. | A public hosted service distributes this code to every customer. | Open |
| C2 | Terms of service, privacy policy, acceptable use policy, and working `abuse@` and `postmaster@` addresses, linked from `/signup`. | Free mail services are abuse targets and need published rules to act on. | Open |
| C3 | Launch numbers: 5 mailboxes, 20 aliases, 1 GB each, 200 sent messages a day, 100 domains on the server. | They go into the host's `server.env`. | Open |
| C5 | Forwarding mail to outside addresses. Wanted by some owners, but on a free plan it is a common spam relay route and breaks SPF for the forwarded mail unless the server rewrites senders (SRS). | Decide: leave out of v1, allow only for paid plans, or build with SRS and a daily cap. | Open |
| C4 | Bot protection on signup beyond the DNS proof and the per-IP limit, for example a CAPTCHA. | Optional; the DNS proof already stops throwaway signups. | Open |

## D. Wanted before launch, can be waived

| Id | Item | Status |
| --- | --- | --- |
| D1 | Catch-all address in `/manage` (forwarding is decision C5). | Done: catch-all delivery proven in `verify_panel.py` |
| D2 | Owners can close their domain and export their mail. | Done: closure proven by `verify_panel.py` and the browser suite; export is any IMAP mail app, which `/manage` says before closing |
| D3 | Monitoring: health, disk, queue size, with an alert. Needs a decision on where alerts go (an outside uptime service, a chat webhook, or email through another provider): a mail server that is down cannot report itself by mail. | Needs Jesse's choice of alert channel |

## E. Owner's domain, UI realignment and MCPL (not gating v1 unless Jesse says so)

| Id | Item | Done when | Owner | Status |
| --- | --- | --- | --- | --- |
| H1 | **Split-domain relaying.** For a domain shared with Google Workspace, accept unknown addresses only from signed-in senders and relay them to Google; refuse them from the internet. Today a self-hosted user cannot mail a Google-hosted colleague at the same domain. See `deploy/HYBRID-GOOGLE-WORKSPACE.md`. | A local test domain proves: signed-in send to an unknown address goes to the relay route; the same address from outside is refused; no loop. | Claude | Done 2026-11-10 (image `sha-4bd24b2`, `ui/e2e-live/split-domain.spec.ts` against a stand-in relay) |
| H2 | **angrygaming.org phase 0.** Run the server on `lab.angrygaming.org` with its own MX, no Google changes. | Mail in and out of `lab.angrygaming.org` passes SPF, DKIM and DMARC at Gmail. | Jesse (DNS), Claude (checks) | Open |
| U1 | **People and teams** view over accounts, groups, roles and quotas, on MCPL. | Browser test: create a team, add people, set a quota; lesson for administrators. | Claude | Done 2026-11-10 (`ui/e2e-live/people.spec.ts`) |
| U2 | **Graphs on our own metrics.** Dashboard rebuilt on our own sampler and `GET /api/stats` (`crates/common/src/shippin/stats.rs`), replacing the enterprise-gated feed. All six dashboard tabs from the schema, plus every recorded metric. | Bar graphs show real delivery and sign-in counts on a server without a license; `ui/e2e-live/dashboard.spec.ts` passes on the local stack. | Claude | Done 2026-11-10: image `sha-01e9504`, live test passed |
| U3 | **Drive, then the Google link, then Docs**, in the order in `PLAN.md`. | Each step proven by a browser test against a server; the Google link first with an "Internal" OAuth app on angrygaming.org. | Claude | Drive, sharing and Docs done 2026-11-10 (`ui/e2e-live/`); the Google link passes against a stand-in Google server 2026-11-10 (`ui/e2e-live/google.spec.ts`) and copies one file at a time; it still needs Jesse's OAuth client to prove for real |
| M1 | **MCPL acceptance** (`mcpl/README.md`): compare with another app's variant, lesson progress kept on the server, then lift the pull-request freeze. | All acceptance boxes ticked and `.github/workflows/freeze.yml` removed by Jesse. | Jesse, Claude | Server-side progress done 2026-11-10 (`/api/learn`, `ui/e2e-live/learn.spec.ts`); variant comparison and the freeze are Jesse's |




| Id | Feature (what the SEL code locks today) | Done when | Owner | Status |
| --- | --- | --- | --- | --- |
| F0 | **Dashboard and metrics history** (`x:Metric`, `x:MetricsStore`, `/api/token/metrics`). | See U2. | Claude | Done 2026-11-10 (U2) |
| F1 | **Live tracing and trace history** (`x:Trace`, `x:TracingStore`, `/api/token/tracing`, trace retention, search over traces). | The portal's Live Tracing screen streams real server events with filters and shows stored traces, proven by a live browser test. | Claude | Done 2026-11-10 (image `sha-4bd24b2`, `ui/e2e-live/tracing.spec.ts` covers the live stream and stored traces) |
| F2 | **Alerts** (`x:Alert`): conditions on metrics that send email or a webhook. | An alert on our own statistics fires on a real event and delivers its message. | Claude | Done 2026-11-10 (image `sha-4bd24b2`, `ui/e2e-live/alerts.spec.ts`: real webhook and real mailbox) |
| F3 | **Undelete** (`x:ArchivedItem`, keep deleted mail and accounts for a set time). | A deleted message and a deleted account are restored from the portal. | Claude | Done 2026-11-10 (image `sha-4bd24b2`, `ui/e2e-live/recover.spec.ts`). Files, calendars and contacts deleted on their own are not kept |
| F4 | **Masked addresses** (`x:MaskedEmail`, per-user limit). | A user creates a masked address in webmail, mail to it arrives, and disabling it refuses mail. | Claude | Done 2026-11-10 (image `sha-4bd24b2`, `ui/e2e-live/masked.spec.ts`). Receiving only |
| F5 | **Tenants** (`x:Tenant`, tenant administrators, tenant quotas, tenant-owned domains, DKIM, directories and reports). The base for hosting other people's domains later. | Two tenants on one server cannot see each other's accounts or domains; a tenant admin manages only theirs; quotas hold. | Claude | Done 2026-11-10 (image `sha-bf19d86`, `ui/e2e-live/org.spec.ts`) as our own organisations. The server's administrators assign domains; DKIM, directories and reports stay with them |
| F6 | **Per-domain directories and sign-in** (`Domain.directoryId`, per-domain OIDC or LDAP). | Users of one domain sign in through that domain's directory. | Claude | Done for OpenID Connect 2026-11-10 (image `sha-41755c5`, `ui/e2e-live/sso.spec.ts` against a stand-in provider). Accounts must already exist; per-domain LDAP is not built |
| F7 | **Branding per domain** (`Domain.logo`, `/logo`). | Each domain's sign-in and webmail show its own logo. | Claude | Done 2026-11-10 (image `sha-41755c5`, `ui/e2e-live/brand.spec.ts`). PNG, JPEG or WebP only |
| F8 | **Calendar message templates** (alarm email, scheduling email and RSVP page). | Templates are editable in the portal and used for real invitations. | Claude | Done 2026-11-10 for the invitation and reminder emails (image `sha-3dd21d6`, `ui/e2e-live/calendar-templates.spec.ts`: a real invitation carries the new wording). The RSVP page is our own Svelte page, changed in code |
| F9 | **AI models** (`x:AiModel`, `x:SpamLlm`, the Sieve prompt plugin). | A configured model classifies spam and answers a Sieve prompt in a test. | Claude | Open. The configurable provider is built and proven against stand-ins (`/api/ai/settings`, `ui/e2e-live/assistant.spec.ts`, 2026-11-11); spam classification and the Sieve prompt still use it next |
| F10 | **SCIM provisioning** (the `scim` crates, `allowScimProvisioning`, `externalId`). | An identity provider creates, updates and removes users and groups through our own SCIM endpoint. | Claude | Done 2026-11-10 (image `sha-0360927`, `ui/e2e-live/scim.spec.ts` acting as the provider) as our own endpoint at `/api/scim/v2`. Not yet tried against a real Okta or Entra tenant. `eq` filters only, no bulk |
| F11 | **Scaling stores** (SQL read replicas, sharded blob and in-memory stores). | A test install reads from a replica and spreads blobs across shards. | Claude | Open |

## Order of work

Claude, in order, each batch tested and pushed to `main`: A2, A1, A3, A5, B2, D1, B6, then A4 once decided. Jesse, in parallel: C1, C2, C3, then B1, B3, B4 and B5 on the host. Release only when every row is Done or Waived:

```powershell
git tag -a v1.0.0 -m "Free plan v1"; if ($?) { git push origin v1.0.0 }
```
