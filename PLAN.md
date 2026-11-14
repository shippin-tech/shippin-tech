# Build plan

Pre-release. This is the order shippin.tech gets built in, from what the code does today
(2026-11-10). `RELEASE.md` is still the gate for tagging a release; this file is the route
to get there. `GET /api` (`resources/product/api.json`) says what is live right now.

**The product:** webmail, calendars, contacts, Drive and Docs on your own domain, a link to
Google Drive and Docs, MCPL lessons that teach people as they use it, and everything an
operator needs to run it for friends, family and small businesses, then a hosted cloud.

## First: the base (written 2026-11-13)

Before any new feature: the open-source product a person runs for their own domains, on their
own VM, bare metal, or Docker on a personal machine, installs cleanly, updates itself, and is
honest about its license. Everything still open in this file and in `RELEASE.md` is placed below.

### B0. The license (a decision only you can make, with a lawyer)

Checked 2026-11-13. These are facts, not legal advice:

- `LICENSE` says Business Source License 1.1, licensor "shippin.tech Labs LLC".


### B1. Install anywhere, with the right default name

| Where | Default name | Why | Mail reaches the internet? |
| --- | --- | --- | --- |
| Trying it on one computer (Docker Desktop on Windows, macOS, Linux) | `mail.localhost` for the web; mailboxes at `you@shippin.internal` | `*.localhost` always means this machine ([RFC 6761](https://www.rfc-editor.org/rfc/rfc6761)), and browsers treat it as secure. `.internal` is reserved for private use, permanently ([ICANN, 2024](https://www.icann.org/en/board-activities-and-meetings/materials/approved-resolutions-special-meeting-of-the-icann-board-29-07-2024-en)) | No: mail stays on the machine. Clear on screen |
| A home or office network | `mail.home.arpa` or a name under `.internal` | `home.arpa` is the standard for home networks ([RFC 8375](https://www.rfc-editor.org/rfc/rfc8375)) | No, until a real domain is added |
| Own domain on a VM, VPS or bare metal | `mail.<your domain>` | Real DNS, a real certificate | Yes, once DNS and port 25 check out |
| Own domain on a home connection | `mail.<your domain>` with a relay | Most home connections block port 25 out, many block it in | Through a relay (smarthost) for sending; inbound needs port 25 open or an inbound relay |

Never `shippintech.local`: `.local` belongs to multicast DNS ([RFC 6762](https://www.rfc-editor.org/rfc/rfc6762)),
and unicast names under it break on macOS, iOS and Linux machines that use mDNS.

| Stage | Work | Done when |
| --- | --- | --- |
| B1.1 | `install.sh --try` and a Docker Desktop compose file (`deploy/try/`): one command, `mail.localhost`, a local certificate, no real domain needed | A fresh Windows and a fresh macOS machine open `https://mail.localhost` and send mail between two local mailboxes |
| B1.2 | Home network mode with `home.arpa` / `.internal` | Another device on the LAN signs in |
| B1.3 | Own domain: the install checks public IP, ports 25, 80, 443 and reverse DNS, and says what is missing; a relay (smarthost) for sending is a setup step, not hand editing | Live test with stand-ins for a blocked port 25 and a relay |
| B1.4 | First sign-in leads through: install key, administrator, keys (K), domain and DNS (G1), certificate (`RELEASE.md` A10), relay | A fresh install reaches its first sent message without a terminal (`RELEASE.md` B3) |
| B1.5 | Updates that announce, drain and roll back (U1 to U5 below) | As in U |

### B2. Webmail, Drive and Docs that are fast by default

| Stage | Work | Done when |
| --- | --- | --- |
| B2.1 | Performance budgets in CI for every page: JavaScript sent, largest paint, layout shift, on a throttled mid-range phone | CI fails a page over budget |
| B2.2 | **Light**, the default: the fastest webmail the budget allows, no heavy effects | Within budget on the throttled phone |
| B2.3 | **Rich**, chosen by the person: visuals and interactions, with what it costs said where it is chosen | Opt-in, remembered per person, still usable on the phone |
| B2.4 | Mobile layouts made for the phone, not shrunk: mail, Drive, Docs, Google link | Live tests at phone size, touch targets per WCAG 2.2 |

### B3. Everything still open, in order

1. B0 license, then the release gate's decisions: `RELEASE.md` C1 to C5.
2. B1 install, with `RELEASE.md` A10 (certificate at install), B3 (fresh install), B5 (backups and a restore drill), D3 (monitoring).
3. K (keys) is done except the first-run live test on a fresh install; U1 to U5 (updates).
4. B2 webmail, Drive and Docs, fast by default; the real Google proof (C3).
5. M1 and G1, G3, G4: domain health and guided setup; then the real mail test below (`RELEASE.md` B1, B4, H2).
6. A (agents on the screen), M2 to M7, C, S, as written below; then `RELEASE.md` F9, F11, A4, M1.

### B4. shippin.tech, the site

`landing/` (a submodule) serves the public site. Its job: be found and be cited, by search
engines and by AI answer engines, as the AngryVibes LLC / WiredFRONT product suite. Standard
practice: one page per product and per question people ask, structured data
(schema.org `Organization` with its parent organization, `SoftwareApplication`, `FAQPage`),
a sitemap, an `llms.txt` index, fast pages, and the same names everywhere. Needs from you the
exact legal names and how the companies relate, before anything is published.

## Then: the platform plan

Written 2026-11-11. The goal: updates people can see and trust, and mail management,
connectors, SMS and guided setup brought up to what the best platforms do, built into what
exists, not beside it. It comes from five research passes against primary sources (linked
in each row) and a check of our own code on the same day. Anything not confirmed at its
source is listed at the end.

How to read the tables: **Standard** is what the industry does. **Today** is what our code
really does. **Stage** is where the gap gets closed.

### K. Keys: one key, one job

Rule: **one key is used for one purpose** ([NIST SP 800-57 Part 1 Rev. 5](https://doi.org/10.6028/NIST.SP.800-57pt1r5), §5.2).
Our own code broke it: the AI key, sign-in client secrets and Google tokens are all sealed with
the engine's OAuth token key (`crates/common/src/shippin/sso.rs` `secret_key`,
`crates/common/src/shippin/ai.rs` `oauth_key`, `crates/common/src/shippin/google.rs` `secret`).
The engine itself already follows it: OAuth, DKIM, certificates, stores, DNS providers, web
push and webhooks each carry their own secret, set as a value, an environment variable or a
file (`SecretKey` in `crates/registry/src/schema/structs.rs`).

**Three kinds of key, kept apart**

| Kind | Industry name | What it does, and nothing else | Lifetime |
| --- | --- | --- | --- |
| **Install key** | Bootstrap token ([Kubernetes](https://kubernetes.io/docs/reference/access-authn-authz/bootstrap-tokens/)), initial root token ([Vault](https://developer.hashicorp.com/vault/docs/concepts/tokens)), activation code (OWASP ASVS 5.0, 6.4.1) | Signs in once as `admin` to create the first administrator and reach the step where the service keys are authored | Ephemeral: ends at first use, or after a time limit |
| **Service keys** | Data-encryption keys, one per service, each a key set with one primary key ([Tink keysets](https://developers.google.com/tink/design/keysets)) | Each seals the secrets of one service only: `ai` (the AI provider key), `sso` (sign-in client secrets), `google` (Google tokens); later `webhooks` (C4), `sms` (S1), `microsoft` (C5) | Until replaced. A replaced key stays to open what it sealed, then is destroyed once everything is re-sealed (NIST key states: active, deactivated, destroyed) |
| **Key-wrapping key** | Key-encrypting key (NIST §5.2 lists key wrapping as a purpose of its own; PCI DSS 3.6.1.2) | Wraps the service keys the server generates and stores. Never touches data | Kept outside the database: a file in the data volume, made at random at install, or supplied by the operator as a file or environment variable |

Each service key is **authored** by the administrator: generated at random (the default, one
click for all), or set by hand as a value, an environment variable or a file, the same three
sources the engine offers. The engine's own keys stay where they are.

| Today | Gap | Stage |
| --- | --- | --- |
| Setup key: 24 random characters, kept owner-only in the data volume, deleted once the administrator exists (`crates/common/src/manager/setup_key.rs`) | No time limit; after the administrator, nothing leads on to authoring keys | K1 |
| AI key, client secrets and Google tokens sealed with AES-256-GCM-SIV under the OAuth key | One key for three services and the engine's tokens; it sits in the database it protects | K2, K3 |
| Nothing lists keys or lets anyone replace one | No authoring, no rotation, no view | K4 |
| Values already sealed under the OAuth key | Must keep working through the change | K5 |
| `KEYS.md`, the in-app notices and `/keys` describe the old arrangement | Say what is true after K2 | K6 |

| Stage | Work | Done when |
| --- | --- | --- |
| K1 (built; expiry unit-tested, the first-run live test needs a fresh install) | **Install key.** A time limit (`SETUP_KEY_HOURS`, default 24), printed with the key by `install.sh` and `update.sh`. After the administrator is created, setup continues to "Author your keys" | Unit test for expiry; first-run live test on a fresh install: the key works once, an expired key is refused, setup leads on to keys |
| K2 (done 2026-11-11, image `sha-444721b`) | **Service keys.** `crates/common/src/shippin/keys.rs` (store 55): a key set per service with ids, origin (generated or yours), source (stored, environment variable, file) and state. Sealed values name their service and key: `[version][service][key id][nonce][ciphertext]`, bound to their owner. `ai.rs`, `sso.rs` and `google.rs` call it and no longer touch the OAuth key. The free plan's domain proof gets its own key, `domain-proof` (`crates/http/src/shippin/panel.rs`) | Unit tests: a value opens only with its own service's key; a replaced key still opens old values; a destroyed key opens nothing; nothing in our code reads `oauth_key` (a test greps for it) |
| K3 (built; `deploy/backup.test.sh` passes) | **Key-wrapping key.** `/var/lib/shippin.tech/key-wrapping.key`, 32 bytes from a CSPRNG at first start unless `KEY_WRAPPING_KEY_FILE` names one. `backup.sh` leaves it out and says to keep a copy apart. Several nodes share one through the same file | Unit test: a database copy without the file opens nothing; `backup.sh` test |
| K4 (done 2026-11-11, `ui/e2e-live/keys.spec.ts`) | **Authoring and rotation.** `/shippin/admin/keys` and `/api/keys`: each service's keys, origin, created, state; "Generate" or "Set my own" (value, variable or file); replacing re-seals that service's values, then destroys the old key | Live test: author all keys, replace the AI key, the assistant still answers, the old key is destroyed |
| K5 (built: on first read, and a sweep a minute after start) | **Moving off the OAuth key.** On first read, a value sealed the old way is opened once and re-sealed under its service key; a sweep at start does the rest | Live test: settings saved by the previous image keep working after the update |
| K6 (done 2026-11-11) | **Telling people.** `KEYS.md`, the notices, `/keys`, a lesson "Author your keys" and the assistant's guide describe the three kinds of key | Unit test on the wording; live tests check the notices |

### A. Agents on the operator's screen (MCPL drive)

An AI agent operates the product through MCP, and every action happens on the operator's own
screen, so they watch, allow and learn (`mcpl/README.md`, "Proposed extension: drive"). It
follows MCP's own rule that a human can deny any tool call, and does it in the product rather
than in the agent's client.

| Stage | Work | Done when |
| --- | --- | --- |
| A1 (built) | `/api/mcp` on MCP 2026-07-28 and the initialize-based versions; the agent bar; actions declared per screen and checked; tools for the screen itself, Keys and AI settings | `ui/e2e-live/mcp.spec.ts` on an image |
| A2 | Every admin screen declares its actions: alerts, people and teams, organisations, recover, calendar emails, delivery check, tracing | Each action proven by a live test through `/api/mcp` |
| A3 | Sign-in for MCP clients by OAuth (protected resource metadata, RFC 9728, on the engine's own OAuth server) instead of a password or app password | A standard MCP client connects with no password typed into it |
| A4 | Progress shown to the agent while the operator decides (`notifications/progress` on the call's stream); the lesson for each step offered in the bar | Live test |
| A5 | Calls reach a screen open on any node (NATS), for more than one node | Two-node test |

### P1. Updates people can see, that stop and start cleanly

The pattern used by Home Assistant, Nextcloud, Mastodon, Discourse and Coolify, fitted to one
host running Docker:

1. The server learns of a new version from a small signed file for its channel.
2. Administrators see "Update available" with the notes. People see a banner before a planned update.
3. The update runs on the host. Nothing inside a container can control Docker.
4. The server drains: it stops taking new work, lets work in progress finish, then tells
   clients to come back shortly. Docker forces it to stop only after a grace period.
5. The new version must pass its checks, or the previous one comes back by itself.
6. The web app freezes behind "Updating, back in a moment", keeps what people typed, and
   reloads onto the new version.

| Standard | Source | Today | Stage |
| --- | --- | --- | --- |
| Drain before stopping: report not ready, finish work in progress, then refuse | [Kubernetes pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) | Every session is told to go at once and the server exits 1 second later (`crates/main/src/main.rs`) | U1 |
| SMTP refuses with `421 4.3.2` (planned shutdown) so senders retry | [RFC 5321 §3.8](https://www.rfc-editor.org/rfc/rfc5321), [RFC 3463](https://www.rfc-editor.org/rfc/rfc3463) | Sends `421 4.3.0` | U1 |
| IMAP sends `BYE`, POP3 sends `-ERR` | RFC 9051, [RFC 1939](https://www.rfc-editor.org/rfc/rfc1939) | IMAP is right. **POP3 sends the IMAP reply** (`crates/pop3/src/session.rs:122`) | U1 |
| Web and JMAP answer 503 with `Retry-After` while away | Nextcloud maintenance mode | Connections just drop | U1 |
| A grace period before a forced stop | Docker `stop_grace_period` | Not set, so Docker's 10 seconds | U1 |
| A version file per channel, its address set at build time so a fork follows its own | [Mastodon](https://docs.joinmastodon.org/admin/upgrading/), [Nextcloud updater](https://github.com/nextcloud/updater) | `auto-update.sh` follows a channel tag; the server and its admins are told nothing | U2 |
| Images signed, and the signature checked before deploying | [Docker: Content Trust retired, use Cosign or Notation](https://www.docker.com/blog/retiring-docker-content-trust/) | Pinned by digest, not signed | U2 |
| "Update available" for admins, with notes and urgency | [Home Assistant update entities](https://contributors.home-assistant.io/core/entities/update/), Mastodon | No `/api/version`, nothing shown | U2 |
| Admins choose off, notify, automatic for security fixes, or automatic; a maintenance window; a banner for people beforehand | Synology, Plex, Portainer, [GitLab maintenance mode](https://docs.gitlab.com/administration/maintenance_mode/) | A release installs within 5 minutes, with no notice | U3 |
| Only a host agent touches Docker; the app writes a narrow request | mailcow and Mail-in-a-Box use host scripts. Coolify and Portainer mount the Docker socket, which is root on the host | Host timer exists (`deploy/auto-update.sh`); the app cannot ask it anything | U3 |
| Pull and check before any downtime, back up, roll back by itself | Home Assistant Supervisor; [ShippinTECH: back up before upgrading](https://shippin.tech/docs/install/upgrade/) | Pull first and rollback exist; no backup step | U3 |
| The web app notices a new version and reloads; a "back soon" screen while the server is away | [SvelteKit `version`](https://svelte.dev/docs/kit/configuration), Nextcloud | Neither. Requests already queue under the server's limit (`ui/src/lib/adapter/gate.ts`) | U4 |

| Stage | Work | Done when |
| --- | --- | --- |
| U1 | **Drain.** On a stop signal: report not ready, stop accepting, let messages being received finish, then `421 4.3.2`, IMAP `BYE`, POP3 `-ERR`, HTTP 503 with `Retry-After`. Drain time is a setting (default 30 s); compose gives 60 s before a forced stop | Live test: a message sent while the server stops is refused for now, then arrives after restart. Each protocol's reply is tested |
| U2 | **Knowing about updates.** `/api/version` (version, commit, image digest, channel). CI publishes a version file per channel (`release`, `candidate`), signed by the workflow's own identity with Cosign. The server reads it every 6 hours with a random delay, sends nothing but its version, and can be switched off. The address comes from brand settings | Unit tests; a test build moves `candidate` and not `release` |
| U3 | **Updating from the admin panel.** `/shippin/admin/updates`: policy, window, how long before to warn people, "Update now". The app writes a request into the data volume. `auto-update.sh` reads it, checks the signature, backs up (`backup.sh`), announces, drains, updates, writes progress back, and rolls back on failure | `auto-update.test.sh` covers every path; live test on the local stack with a good image and a broken one |
| U4 | **The web app during an update.** Version name is the commit; it checks on focus and every 10 minutes and offers "Reload for the new version". While the server is away, an overlay freezes the page, keeps drafts, waits for `/healthz/ready`, and reloads | Live test: stop the server mid-compose; the overlay shows, the draft survives, the page returns on the new version |
| U5 | **The fork.** `brand/custom` sets the version-file address, channel names and image name | A build with a custom brand follows its own channel |

### P2. Mail management

| Standard | Source | Today | Stage |
| --- | --- | --- | --- |
| Every domain has SPF, DKIM (2048-bit) and aligned DMARC; the sending address has a matching PTR; TLS; spam complaints under 0.3% | [Google](https://support.google.com/a/answer/81126), [Yahoo](https://senders.yahooinc.com/best-practices/), [Outlook.com](https://techcommunity.microsoft.com/blog/microsoft-defender-for-office-365-blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730) | Records built and checked per domain; our own PTR is not checked | M1 |
| DMARC is now [RFC 9989](https://datatracker.ietf.org/doc/rfc9989/) (May 2026): `pct` removed; `t=`, `np=`, `psd=` added; existing records still work | RFC 9989 (confirmed) | The mail library already reads `psd`; the checker's advice needs reviewing against it | M1 |
| MTA-STS, TLS reporting, DANE | [RFC 8461](https://www.rfc-editor.org/rfc/rfc8461), [RFC 8460](https://www.rfc-editor.org/rfc/rfc8460), [RFC 7672](https://www.rfc-editor.org/rfc/rfc7672) | The engine has all three (no licence mark); not offered per organisation in our panels | M1 |
| Sent, received, bounced and complained, per organisation | Postmaster-style dashboards | Storage and people only (`/shippin/admin/resources`) | M1 |
| Limits per person and per organisation, lower for new organisations, with plain refusals | [Google sending limits](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace), [M3AAWG Sender BCP](https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-sender-best-common-practices-aug-27-2026--1-.pdf) | One limit for every signed-in sender (`PANEL_SENDS_PER_DAY`, 200 a day); no organisation limit | M2 |
| Bounces and complaints feed a suppression list per organisation | [RFC 3464](https://www.rfc-editor.org/rfc/rfc3464), M3AAWG Sender BCP | Bounces are generated and complaint reports are read in; no suppression list | M3 |
| Feedback loops and reputation: Yahoo CFL, Microsoft SNDS and JMRP, Google Postmaster Tools; blocklist watch of our own address | [Yahoo CFL](https://senders.yahooinc.com/complaint-feedback-loop/), [Postmaster Tools](https://support.google.com/mail/answer/16594218), [Spamhaus DQS](https://www.spamhaus.com/faqs/data-query-service/) | None | M3 |
| Outbound mail scanned; an account that suddenly sends spam or volume is held, its sessions and app passwords revoked, and both admins told | [Microsoft outbound spam protection](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-protection-about), M3AAWG Sender BCP | IP bans only; nothing watches an account's sending | M4 |
| `abuse@` and `postmaster@` on every domain, answered | [RFC 2142](https://www.rfc-editor.org/rfc/rfc2142) | Not created | M4 |
| ARC sealing and sender rewriting (SRS) wherever we pass mail on | [Google: forwarders should add ARC](https://support.google.com/a/answer/175365) | ARC checked on arrival; sealing switched off in code (`crates/common/src/config/smtp/auth.rs:98`); no SRS. This matters for the shared-domain route to Google | M5 |
| Quarantine with release; allow and block lists per organisation and person | [Google quarantine](https://knowledge.workspace.google.com/admin/gmail/advanced/manage-quarantined-messages), [Microsoft allow/block](https://learn.microsoft.com/en-us/defender-office-365/tenant-allow-block-list-about) | Quarantine only adds a header; IP lists only | M6 |
| An admin audit log nobody can edit | [Proton organisation monitor](https://proton.me/support/organization-monitor) | None | M6 |
| Require two-factor per organisation, sign out other sessions, passkeys, a DKIM key screen, export one person's mail | Google, Microsoft, Proton admin consoles | Authenticator-app codes per person; key rotation exists in the engine with no screen | M6 |
| Attachment scanning; warnings for unauthenticated, external and first-time senders in webmail | [Google advanced phishing protection](https://knowledge.workspace.google.com/admin/gmail/advanced/advanced-phishing-and-malware-protection) | A milter hook only; no warnings | M7 |
| AI help on uncertain spam (F9), through the configurable provider | Our design, under "AI models" below | Provider built and tested against stand-ins | M7 |

| Stage | Work | Done when |
| --- | --- | --- |
| M1 | **Domain health.** For each domain, every requirement above as Compliant, Needs work or No data, each linking to its fix. The server's own PTR, certificate days and port 25 (the Mail check from the real mail test). Keeps watching and alerts when something that worked breaks. Mail volume per organisation | Live test with stand-ins that pass and fail |
| M2 | **Sending limits** per person and per organisation, with a probation period for new organisations | Live test that hits each limit and reads the refusal |
| M3 | **Bounces, complaints, reputation.** Suppression list per organisation; complaint counts per organisation; our address checked against blocklists; a guide for the feedback-loop sign-ups | Live test with stand-in bounce and complaint reports |
| M4 | **Abuse.** Outbound scanning with the existing filter; automatic hold; `abuse@` and `postmaster@` into an admin queue with an automatic reply | Live test: a burst from one account is held and both admins are told |
| M5 | **Passing mail on.** SRS and ARC sealing on relayed mail | A relayed message passes at a stand-in receiver |
| M6 | **Admin tools.** Quarantine, lists, audit log, two-factor requirement, sessions, passkeys, DKIM screen, export. | Live test for each |
| M7 | **Inbound protection and AI spam.** ClamAV as an optional container through the milter hook; warnings in webmail; F9 | Live test with a test virus file and a stand-in model |

### P3. Guided setup

| Standard | Source | Today | Stage |
| --- | --- | --- | --- |
| One plain status per record ("MX not pointed here yet"), each linking to its fix | [Zoho](https://www.zoho.com/mail/help/adminconsole/add-domains.html) | Found, different or missing per record | G1 |
| Re-check by itself for 72 hours, a Recheck button, a notice when done | [Resend](https://resend.com/docs/dashboard/domains/manage-domains), [Fastmail](https://www.fastmail.help/hc/en-us/articles/1500000280261) | Checked when the page loads | G1 |
| "Send these records to whoever runs your DNS" | [Zoho](https://www.zoho.com/mail/help/adminconsole/domain-verification.html) | None | G1 |
| Do not switch MX until every person exists; lower the TTL first; offer a side-by-side path | [Microsoft](https://learn.microsoft.com/en-us/exchange/mailbox-migration/migrating-imap-mailboxes/optimizing-imap-migrations), [Proton](https://proton.me/support/custom-domain), [Google split delivery](https://support.google.com/a/answer/12971016) | Side-by-side exists (H1); no guard | G1 |
| Write DNS records automatically with a token limited to one zone, never a registrar password | [Cloudflare tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) | The engine supports about 70 DNS providers (`crates/common/src/network/dns/update.rs`), used for certificates, not offered in setup | G2 |
| Domain Connect (one click at GoDaddy, IONOS, Cloudflare and others) | Domain Connect, now an IETF draft | Absent. Providers require requests signed with a key on the product's own domain, so it suits the hosted cloud, later | G2, later |
| An organisation adds its own domains, proven by DNS | Google and Microsoft "add a domain" | Only server admins assign domains | G3 |
| One place for an owner | | `/manage` is separate from `/shippin/org` | G4 |
| Bring old mail in: consent screen, date range, folder preview, newest first, login deleted afterwards | [Proton Easy Switch](https://proton.me/support/easy-switch), Google and Microsoft migration | The engine can import mail; no screen | G5 |
| Help beside each step, not tours; wizards show their steps and can be resumed; empty states teach and link to the first action | [NN/g on tutorials](https://www.nngroup.com/articles/onboarding-tutorials/), [NN/g on wizards](https://www.nngroup.com/articles/wizards/) | Lessons finish on real events; empty states differ per screen | G6 |
| WCAG 2.2: focus never hidden (by the assistant panel either), help in the same place, nothing asked twice, paste allowed | [W3C, new in 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) | Axe checks serious and critical issues only | G6 |
| The assistant cites its sources and proposes; the person confirms in the normal screen; it is logged | [Microsoft 365 admin agent](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-for-microsoft-365-admin), [Intercom Fin](https://www.intercom.com/help/en/articles/11433030-conversational-fin-experience) | Answers from our guide; no citations; never acts | G7 |

| Stage | Work | Done when |
| --- | --- | --- |
| G1 | **Domain setup wizard** in the organisation panel: steps, record table with copy buttons, guides for the common DNS hosts, "send to your DNS person", re-checks, MX guard, side-by-side option | Live test from a new domain to all green, with a stand-in DNS server |
| G2 | **Automatic DNS** with a one-zone token, Cloudflare first, through the engine's providers | Live test against a stand-in provider API |
| G3 | **Organisations add their own domains**, within their domain limit, with the free plan's DNS proof | Live test: an owner adds a domain; another organisation cannot claim it |
| G4 | **`/manage` becomes part of the organisation panel**; a free-plan owner is an organisation of one | Free-plan tests pass on the new pages; old addresses redirect |
| G5 | **Import old mail** from any IMAP server, then Google and Microsoft over OAuth | Live test against a stand-in IMAP server |
| G6 | **Guidance everywhere:** one empty-state component, help beside each step, a lesson per new flow, the WCAG 2.2 points | Axe and keyboard checks in every live test |
| G7 | **Assistant:** sources shown with each answer, "do this" links that open the right screen, a real provider proven | Live test; then one real model you choose |

### P4. Connectors

| Standard | Source | Today | Stage |
| --- | --- | --- | --- |
| A catalogue: what each connector asks for and why, what it stores; admins allow or block per organisation, and blocking turns off existing connections; each connection shows active, failing, needs reconnecting or removed; a "Connected apps" page; audit | [Power Platform data policies](https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention), [Nango](https://nango.dev/docs/guides/auth/token-refreshing) | The Google link per person; nothing at organisation level | C1 |
| PKCE, exact return address, one-time state, and checking which provider answered (RFC 9207) | [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) | The Google link uses PKCE (the live test checks it). Domain sign-in checks the provider's identity when setting up, not on the way back | C2 |
| Ask for the least: Google `drive.file` with the Google Picker. Full `drive` is "restricted" and needs a yearly CASA security assessment once people outside your own Google organisation use it | [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [CASA](https://support.google.com/cloud/answer/13465431) | Asks for full `drive` (`crates/common/src/shippin/google.rs:68`), changeable with `GOOGLE_SCOPES` | C3 |
| Outgoing webhooks signed, retried with backoff, never sent to internal addresses | [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) | Alert webhooks are unsigned and accept any address (`crates/services/src/alerts.rs`) | C4 |
| Slack and Teams notices; Teams through Workflows, since Office 365 Connectors were retired in May 2026 | [Microsoft](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/) | None | C4 |
| Microsoft 365: sign-in with the tenant checked; IMAP import over OAuth | [Entra multi-tenant](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant), [IMAP with OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth) | Generic sign-in per domain | C5 |

| Stage | Work | Done when |
| --- | --- | --- |
| C1 | **Connector catalogue and policy**, and a Connected apps page, over the connectors we have | Live test: blocking the Google link for an organisation turns off its connections |
| C2 | **Sign-in hardening:** the RFC 9207 check, and expired logins shown as "reconnect" | Unit tests with a provider that answers for another |
| C3 | **Google proven for real**, with the permission you choose below | A real account on angrygaming.org through the live test |
| C4 | **Webhooks:** signed, retried, internal addresses refused; Slack and Teams formats | Live test with a stand-in receiver checking signatures |
| C5 | **Microsoft 365** sign-in and import | Live test with stand-ins, then a real tenant |

### P5. SMS

| Standard | Source | Today | Stage |
| --- | --- | --- | --- |
| One provider-neutral interface; Twilio first; consent and opt-out records kept by us; incoming webhooks verified | [CTIA messaging principles](https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf), [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security) | No SMS at all | S1 |
| Every country blocked until allowed; limits per number, address and account; a spend cap; mobiles only; the provider's fraud guard on | [Twilio toll fraud](https://www.twilio.com/docs/verify/preventing-toll-fraud), [AWS](https://docs.aws.amazon.com/sms-voice/latest/userguide/protect.html) | | S1 |
| US: a registered 10DLC brand and campaign, or a verified toll-free number (an EIN required since February 2026). Codes through a Verify service avoid 10DLC | [Twilio 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc), [toll-free](https://www.twilio.com/en-us/changelog/business-registration-numbers-required-for-toll-free-messaging-p) | | S1 |
| SMS is a "restricted" authenticator: offer passkeys first, then authenticator apps, SMS only as a fallback | [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) | Authenticator-app codes exist; passkeys in M6 | S2 |
| Good uses: alerts to administrators when mail is failing; security notices on a channel an attacker holding the mailbox cannot read; a recovery fallback. Maybe: an important-mail notice with sender and subject only | NIST SP 800-63B-4 §4.6 | Alerts go by email and webhook | S2 |
| Never: SMS as the only second factor, marketing, message bodies, forwarding other services' codes | CTIA, NIST | | |

| Stage | Work | Done when |
| --- | --- | --- |
| S1 | **SMS service** with the protections above, set by the server's administrators | Live test against a stand-in provider: send, STOP, HELP, a blocked country, the spend cap |
| S2 | **Uses:** SMS as an alert channel, security notices for people who opt in, a recovery fallback | Live test for each, then one real message to your phone |

### Where the open items from the panels work go

| Item | Stage |
| --- | --- |
| The assistant with a real AI provider | G7 |
| AI spam classification (F9) | M7 |
| An organisation adds its own domains | G3 |
| Mail volume per organisation | M1 |
| `/manage` joins the organisation panel | G4 |
| The real mail test | M1 builds its Mail check; the steps stay in "Next: find out if real mail works" below |
| Google proven with a real account | C3 |
| DNS for `lab.angrygaming.org` (H2) | After M1, as in "After it passes" below |
| The release checklist (`RELEASE.md`) | After U1 to U3, because a release is how hosts receive fixes |

### Order

1. **K1 to K6, keys.** One key, one job, before anything else stores a secret.
   **A1 to A5, agents on the screen**, run alongside: each new screen declares its actions as it is built.
2. **U1 to U5, updates.** Every later fix reaches your hosts this way, and no release should go out before stopping and starting are clean.
3. **M1, G1, G3, G4.** Prove real mail and guide setup, so friends and family can be added.
4. **M2 to M5.** Sending safety, before other organisations share your address.
5. **M6, M7, G5.** Admin tools, inbound protection, AI spam, bringing old mail in.
6. **C1 to C5.** Connectors.
7. **S1, S2.** SMS, once you have picked a provider.

G6 and G7 run through every stage: each new screen gets its help, its lesson and its place in
the assistant's guide. Every stage meets "What done means" below and is committed on its own.

### What only you can decide or do

| What | Why | Recommendation |
| --- | --- | --- |
| The default update policy for hosts you run for others | Today a release installs within 5 minutes, with no notice | Security fixes install by themselves in a night-time window. Other releases are announced, then install in the window after 7 days unless postponed |
| Google permission for the hosted cloud | Full Drive needs a yearly paid assessment once outside people connect | `drive.file` with the Picker for the cloud. Your own installs can keep full Drive with an Internal OAuth client |
| SMS provider and US registration | Needs a business identity (an EIN) and monthly fees | Twilio, with its Verify service for codes. Decide before S1 |
| Sign-ups only you can make | Yahoo CFL, Microsoft SNDS and JMRP, Google Postmaster Tools, a free Spamhaus DQS key | When M3 starts |
| An AI provider key | To prove the assistant with a real model | Any time |
| The Felware PTR email | Blocks the real mail test | Now |

### Not confirmed at the source

The 10DLC fees; the FCC opt-out words rule (FCC 26-67, said to take effect 25 November
2026); Microsoft's June 2026 JMRP change; when Google retires Postmaster Tools v1; Telnyx's
webhook signatures; EU sender-ID rules. None blocks a stage. Each is checked again when its
stage starts.

## Done: Shippin admin and organisation panels

Decided and finished 2026-11-11. What it left open is placed in the platform plan above.

**Where things go**

| What | Where |
| --- | --- |
| Screens and their calls, one folder per area | `ui/src/lib/shippin/<area>/` |
| Pages | `/shippin/admin/...` for the server's administrators, `/shippin/org/...` for an organisation |
| Old addresses | `/portal/...` and `/org` redirect to the new ones |
| Server code (stage 4) | `crates/http/src/shippin/`, `crates/common/src/shippin/` |

Each folder in `ui/src/lib/shippin/` is an MCPL component, checked in CI like `ui/src/lib/catalog/`.

**Stages, each tested and committed on its own**

| Stage | Work | Done when |
| --- | --- | --- |
| 1 (done) | Move the dashboard, admin, people, alerts, recover, calendar emails and organisation code into `shippin/`. Give the admin panel our own menu, with the schema's screens under "All settings" | Full live suite passes on the new addresses, and old addresses redirect |
| 2 (done) | **Resources** at `/shippin/admin/resources`: the server, and each organisation's real storage used, people and limits | Live test with two organisations and real stored mail |
| 3 (done) | **Organisation panel** at `/shippin/org`: its own menu and overview, people, teams, domains with live DNS status, logo, sign-in and SCIM | Live test: two organisations, each sees only its own |
| 4 (done) | **API layout:** our server code into its `shippin` folders, and every route in one table that `GET /api` reports | Route table test passes and `GET /api` matches it |
| 5 (done) | **AI settings and the assistant:** the configurable provider described below, and a chat that answers from the product's own instructions and lessons. It explains and never acts for the person | Live test against a stand-in model, off by default |
| 6 (done) | **MCPL:** a lesson for each new panel, and the `shippin` areas in the admin kernel | `check-mcpl` passes and lessons finish on real events |

**Proven 2026-11-11.** The whole live suite passes on the local stack: 30 tests, with server
image `sha-6b4f214` and the web app at `e7d1d43`. The first-run test is skipped, because it
needs a fresh install. The assistant is proven against stand-in models only; no real
provider has been tried yet.

That run found one real fault. Pages started more requests at once than the server allows
each person (4 by default), so one failed at random. The web app now queues its requests
under the limit the server advertises, and resends one refused only for that reason
(`ui/src/lib/adapter/gate.ts`).

**Not done yet in these panels**

- An organisation cannot add its own domains; the server's administrators assign them.
- Resources shows storage and people for each organisation, not its mail volume.
- A free-plan owner's `/manage` page is still separate from the organisation panel.

## Next: find out if real mail works

Written 2026-11-11 after checking the code,
the live host from outside it, public DNS and the providers' own documentation.

**The test is passed when:** a message from your own address on your own server reaches your
Gmail, Gmail's "Show original" says SPF, DKIM and DMARC all PASS, and your reply from Gmail
arrives in webmail.

### What is true today

Everything here was checked from outside the host on 2026-11-11.

| What | Found | What it means |
| --- | --- | --- |
| Code on the host | `/api/panel/plan` and `/api/setup` return 404, and the free plan is not in `v0.1.3` | The host runs `v0.1.3` or older. Nothing built since has reached it: 67 commits at the time of writing |
| Reverse DNS | 206.109.207.24 points to `24-207-109-206.msn1.felware.net`, and that name has no A record | **Blocker.** Google requires a PTR name that resolves back to the sending IP. Only Felware can change it |
| Ports | 25, 465, 993 and 443 answer. 587 is refused | Mail apps use 465 until 587 is explained |
| Certificate | Let's Encrypt, valid to 2027-02-07, on 443, 993 and STARTTLS on 25 | Good. Renewal has not been seen happening yet |
| Blocklists | Barracuda, SpamCop and PSBL are clean. Spamhaus cannot be asked through public DNS | Check Spamhaus by hand at check.spamhaus.org |
| Outbound port 25 from the host | Unknown from outside | Settled by the first send |
| `shippin.tech` DNS | MX, SPF, DMARC `p=reject`, MTA-STS and TLS-RPT are published | Ready, apart from DKIM, whose selector names only the server knows |
| `lab.angrygaming.org` | Does not exist | Needs records at Namecheap, for the second test only |
| `mail.angrygaming.org` | Already a CNAME to `ghs.googlehosted.com` | `deploy/HYBRID-GOOGLE-WORKSPACE.md` is wrong to use it. Use `mail.shippin.tech` as the MX instead |
| `angrygaming.org` mail auth | SPF does not list Google, no DMARC, no `google._domainkey` | Your existing Google mail may be failing authentication. Separate from this test, and it must be fixed before phase 1 |

### What the tests so far do not prove

All 27 live tests ran on the local Docker stack, where several real-world things are replaced:

- No message has been delivered to or from a real outside mail system.
- No outside receiver has checked our DKIM, SPF or DMARC.
- Mail ports were tested without real certificates.
- Pages were served by a separate nginx container, while the real image serves them itself.
- Google, the identity provider, the SCIM client and the shared-domain relay are stand-ins.

### Two mistakes to fix first

1. `deploy/README.md` tells you to set `shippin.tech_KEEP_DELETED_DAYS` and
   `shippin.tech_MASKED_LIMIT`, but `deploy/compose.yaml` does not pass them to the server, so
   on a real install they do nothing and the defaults apply.
2. The Google hybrid guide installs on `mail.angrygaming.org`, which Google already uses.

### The steps

**Claude, none of this touches the host**

| Step | Work | Done when |
| --- | --- | --- |
| 1 | Pass `KEEP_DELETED_DAYS` and `MASKED_LIMIT` through `compose.yaml` and `server.env.example`, and correct the README. `SSO_ALLOW_PRIVATE` stays out of the host's compose on purpose | `docker compose config` shows both values reaching the server |
| 2 | Run the whole live suite against the mail container's own web server, without nginx | Same result as through nginx. Anything that differs is fixed |
| 3 | (Part of U2.) Add a `candidate` image tag that only a manual test build moves. `SHIPPIN_CHANNEL` already exists. `release` is untouched | `auto-update.test.sh` covers it, and a test build moves `candidate` and not `release` |
| 4 | (Part of M1.) Build **Mail check** at `/shippin/admin/mail-check`: host name, PTR resolves back, certificate days left, outbound 25, each domain's MX, SPF, DKIM and DMARC, a "send a test message" button, and the authentication results of the last message received. Each line says pass or fail and what to do | Live test, with stand-ins for pass and fail |
| 5 | Correct the hybrid guide to use `mail.shippin.tech` as the MX for `lab.angrygaming.org` | Reviewed against live DNS |
| 6 | Build the candidate image and run the full suite on it | All pass |

**You, three things**

| Step | What | Why |
| --- | --- | --- |
| 7 | Email `support@felware.net`: "Please set reverse DNS for 206.109.207.24 to mail.shippin.tech." | The blocker. Felware holds the address block, per ARIN |
| 8 | Say whether anything on that server must be kept | Decides how careful step 9 has to be. A backup runs either way |
| 9 | Paste one block on the host, which Claude writes after step 6: back up, switch to the `candidate` channel, report status | The only host command. After it, every fix arrives by itself within five minutes, with rollback if the health check fails |

**The test, in order**

| # | Do | Pass looks like | If it fails |
| --- | --- | --- | --- |
| 1 | Open `https://mail.shippin.tech`, sign in | Portal opens on the new version | Upgrade problem: read `auto-update.sh status` |
| 2 | Run Mail check | Every line passes | Each line says what to fix |
| 3 | Create `you@shippin.tech` and publish the DKIM records it lists, in Cloudflare | DKIM line passes | DNS not published or not yet visible |
| 4 | Send from webmail to your Gmail | Arrives, inbox or spam | Mail check and the delivery trace show the exact refusal. No connection means outbound 25 is blocked: ask Felware |
| 5 | In Gmail, "Show original" | SPF, DKIM and DMARC all PASS | Names which one failed and why |
| 6 | Reply from Gmail | Arrives in webmail | Inbound problem: stored traces show why |
| 7 | Add the account to a phone or mail app on 993 and 465 | Reads and sends with no certificate warning | Certificate or port problem |
| 8 | Send to an Outlook.com address | Arrives | Microsoft has its own block list for new addresses |

A new IP address has no reputation, so a first message landing in spam is not a failure of
this test as long as step 5 passes. Mark it "not spam" and keep volume low.

### After it passes

1. **Second domain, no Google changes (H2):** `lab.angrygaming.org` with its MX at `mail.shippin.tech`.
2. **Same domain as Google (phase 1):** first fix `angrygaming.org`'s SPF and DKIM, and check that your
   Admin console actually shows Default routing, because Google's documents do not confirm
   it for the legacy free edition.
3. **Certificates at install (A10):** Let's Encrypt lifetimes shorten to 64 days in February 2027
   and 45 days in February 2028, so renewal must be automatic and watched.
4. **AI, configurable (F9):** see below.

### AI models: configurable, off by default

Set in the portal by the server's administrators.

- **Provider:** any OpenAI-compatible address, or Anthropic's own API. The first covers a
  self-hosted Ollama at `http://<host>:11434/v1` and hosted services alike. Model name and key
  are settings, and the key is stored encrypted.
- **What is sent, chosen per domain:** nothing, subject and sender only, or subject and the first part of
  the body. A self-hosted model keeps mail on your own machines.
- **When it runs:** only on messages the normal filter is unsure about, inside a score range you set.
- **If the model is slow or down:** mail carries on under the normal filter.
- **Our own code:** beside the licence-marked `llm.rs` and `llm_prompt.rs`, not calling them.
- **Proof:** a stand-in first, then a real model you choose.

### Assumptions still open

| Assumption | Settled by |
| --- | --- |
| Felware will set the PTR | Step 7 |
| The host can send out on port 25 | Test 4 |
| Why 587 is refused | Checked after step 9, because the new compose file publishes it |
| The upgrade from `v0.1.3` keeps its data (B6, never run on a real host) | Backup first, then step 9 |
| Certificate renewal works unattended | Mail check shows days left. Watch one renewal |
| Spamhaus does not list the address | check.spamhaus.org, by hand |
| Legacy free Google Workspace offers Default routing | Your Admin console, before phase 1 |
| SCIM and domain sign-in work with real providers | A real Okta or Entra test, when you want one |

Scaling stores (F11) stay parked until one host is not enough.

## What "done" means for every item

An item is done only when all of these are true:

1. It is written as our own code. SEL-marked files are not edited, copied or called.
2. Unit tests pass (Rust and vitest), and `npm run mcpl`, `npm run check` and the Check workflow are green.
3. A live browser test in `ui/e2e-live/` passes against an image built from that commit.
4. Screens follow MCPL: a `component.json`, events emitted only after the server confirms, and a lesson when it is something a person learns.
5. `GET /api`, `ui/AUDIT.md` and `RELEASE.md` say what is now true.
6. It is committed to `main` as its own feature.

## Order of work

| # | Item | Tracks | What it delivers | Needs from Jesse |
| --- | --- | --- | --- | --- |
| 1 | **Drive** (done) | U3 | Browse folders, upload (button and drag and drop), download, new folder, rename, move, delete, search, storage used, a "Use your Drive" lesson. The server's file API already does all of this; the browser does not | Nothing |
| 2 | **Drive sharing** (done) | U3 | Share a file or folder with people on the server, see what is shared with you, change or remove access | Nothing |
| 3 | **Calendar and contacts** (done) | AUDIT 7 | Month and agenda views, create, edit and delete events, invitations and replies; create, edit and delete contacts and address books | Nothing |
| 4 | **Docs** (done) | U3 | Create and edit documents in the browser, saved as files in Drive, with autosave, export and a lesson | Nothing |
| 5 | **Google Drive and Docs link** (built; proven against a stand-in) | U3 | Each person connects their Google account, browses Drive next to their own, moves and syncs files, opens and exports Google Docs. Built and tested against a stand-in Google server first | A Google Cloud OAuth client on angrygaming.org, to prove it for real |
| 6 | **People and teams** (done) | U1 | A product view of people, teams, roles and storage limits over the registry | Nothing |
| 7 | **Sharing a domain with Google** (H1 done; H2 needs DNS) | H1, H2 | Self-hosted people can mail Google-hosted colleagues at the same domain, without loops | DNS for `lab.angrygaming.org` |
| 8 | **Trace history and alerts** (done) | F1, F2 | Stored traces to search after the fact; alerts on our statistics by email or webhook | Nothing |
| 9 | **Undelete and masked addresses** (done) | F3, F4 | Restore deleted mail and accounts; disposable addresses in webmail | Nothing |
| 10 | **Tenants** (done) | F5, F6, F7 | Separate customers on one server: their own administrators, domains, limits, sign-in and logo. The base for the hosted cloud | Nothing |
| 11 | **Remaining operator features** (F8 and F10 done) | F8 to F11 | Calendar message templates, AI models and spam classification, SCIM provisioning, scaling stores | An AI provider key, to prove F9 for real |
| 12 | **Release gate** | A, B, C, D | TLS at install (A10), the host checks, and the decisions only Jesse can make | B1, B3 to B6, C1 to C5, D3 |

Items 1 to 4 come first because they are the product people touch and need nothing from
anyone else. Item 5 follows Drive because it syncs into it. Tenants wait until the
single-domain product is whole, because they change how every screen above scopes its data.

## MCPL runs through all of it

Each product item adds its events to its `component.json` and a lesson that finishes on
those real events. Progress is already kept on the server per person. Comparing this variant
with another app's and lifting the pull-request freeze stay with Jesse (`RELEASE.md`, M1).

## Decisions already made

- One branch, `main`. No pull requests. No release tag until `RELEASE.md` is closed.
- Google stays the mail entry point for `angrygaming.org` until the release gate is closed.
- Docs are our own documents stored in Drive. Google Docs stay editable in Google and are listed, opened and exported from here.
