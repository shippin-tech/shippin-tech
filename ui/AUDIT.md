# Web UI audit (2026-11-11)

Pre-release. This records what each screen in `ui/` really does today, so work is
planned against facts. Statuses:

- **Real:** talks to the mail server, and an automated check proves it end to end.
- **Partial:** real calls, but only part of the job.
- **Placeholder:** a page with no working function.
- **Blocked:** built, but its data comes from ShippinTECH enterprise-licensed code.

## Screens

| Screen | Status | What it does | Evidence |
| --- | --- | --- | --- |
| `/login`, OAuth callback | Real | Password and two-factor sign-in through the server's OAuth flow; plain names such as `admin` allowed | `e2e-live/free-plan.spec.ts`, `first-run.spec.ts` |
| First-run "Create your administrator" (`/portal` gate) | Real | Turns the printed setup key into the real administrator | `e2e-live/first-run.spec.ts` on a fresh install |
| `/signup` | Real | Free-plan signup with DNS ownership proof | `deploy/local/verify_panel.py`, live browser suite |
| `/manage` | Real | Mailboxes, passwords, aliases, catch-all, live DNS status, closing the domain | `verify_panel.py` (51 checks), live browser suite |
| `/account` | Real | Password, two-factor, app passwords | `deploy/local/verify_account.py` (25 checks), live browser suite |
| `/mail`, `/mail/email`, `/mail/compose` | Real | Read, compose, reply, forward, drafts, attachments | live browser suite (send, receive, reply, attachment round trip) |
| `/shippin/admin/people` | Real | People and teams: add, edit and remove people, reset passwords, access, storage limits, teams with their own address and membership | `e2e-live/people.spec.ts` |
| `/shippin/admin/...` "All settings" | Partial | Schema-driven create, edit and delete of every server object (domains, accounts, groups, settings). It is ShippinTECH's admin model, not a product's "people and teams" view | `ui/scripts/prove-portal-records.mjs`, mocked browser tests |
| `/shippin/admin/security` | Real | Security baseline checkboxes over named server settings | `test/security-baseline.test.ts`, verified on the local server |
| `/shippin/admin` dashboard bar graphs | **Real** | Rebuilt as our own code with no licence check. Every tab, card and chart of the schema's dashboard definition (Overview, Network, Security, Delivery, Performance, Storage) plus an "All metrics" tab, drawn in Svelte from `GET /api/stats`. The server samples its open counters into hourly and daily totals every minute. Presets, custom ranges, one node or all, bars or lines. Proven on the local stack on 2026-11-10 by `ui/e2e-live/dashboard.spec.ts`: real failed sign-ins are stored by the sampler, served by `/api/stats` and shown on the page, with no request to the enterprise endpoints | `crates/common/src/shippin/stats.rs`, `crates/http/src/shippin/stats.rs`, `ui/src/lib/catalog/dashboard/` |
| Live tracing and stored traces | **Real** | Rebuilt as our own code: `GET /api/trace/token`, `GET /api/trace/live` and `GET /api/trace/history` stream and store the open event bus, with detail level, keyword and key filters and a searchable History view. Proven live on 2026-11-10 by `ui/e2e-live/tracing.spec.ts` | `crates/http/src/shippin/trace.rs`, `crates/common/src/shippin/trace_history.rs`, `ui/src/routes/(portal)/portal/LiveTracing.svelte` |
| `/shippin/admin/templates` | **Real** | Reword the invitation and reminder emails; a real invitation carries the new wording | `ui/e2e-live/calendar-templates.spec.ts` |
| `/shippin/admin/alerts` | **Real** | Our own rules on our own statistics, by email or webhook, with a cooldown | `ui/e2e-live/alerts.spec.ts` |
| SCIM provisioning | **Real** | Our own `/api/scim/v2`: an identity provider creates, changes, switches off and removes people and teams on one domain. Server administrators are out of its reach | `ui/e2e-live/scim.spec.ts` |
| Domain logos and sign-in | **Real** | Each domain's own logo on its sign-in page and for its people, and sign-in through its own OpenID Connect provider. Server administrators always use a password | `ui/e2e-live/brand.spec.ts`, `ui/e2e-live/sso.spec.ts` |
| `/shippin/admin/orgs` | **Real** | Our own organisations: domains under their own administrators, with limits on people and shared storage, kept apart from each other | `ui/e2e-live/org.spec.ts` |
| `/shippin/org` (organisation panel) | **Real** | An organisation's own menu and overview, people, teams, aliases, domains with live DNS status, logo, sign-in and SCIM. It sees only its own, and can never change a server administrator | `ui/e2e-live/org.spec.ts`, `brand.spec.ts`, `sso.spec.ts`, `scim.spec.ts` |
| `/shippin/admin/resources` | **Real** | The server's gauges and disk, and each organisation's people, storage used and storage held | `ui/e2e-live/resources.spec.ts` with real stored mail |
| `/shippin/admin/ai` and the assistant | **Partial** | A configurable AI provider, off by default. The assistant explains the product from its own guide and lessons, fitted to the person's role, and never acts for them | `ui/e2e-live/assistant.spec.ts`, against stand-in models only |
| `/shippin/admin/recover` | **Real** | Deleted messages and accounts kept for 30 days by default and restored by an administrator | `ui/e2e-live/recover.spec.ts` |
| `/mail/masked` | **Real** | Random addresses that deliver to a person's mailbox and refuse mail once switched off. Receiving only | `ui/e2e-live/masked.spec.ts` |
| Google Drive link (`/files?view=google`) | **Partial** | Connect, browse, copy both ways, export Google Docs, disconnect. Proven against a stand-in Google server; a real OAuth client is still needed. No continuous sync | `ui/e2e-live/google.spec.ts` |
| Delivery trace | Real | Traces one outbound delivery; not enterprise-gated | local proof on 2026-11-07 |
| `/files` (Drive) | Real | Folders, upload with progress, download, new folder, rename, move, delete, search, storage used, sharing as view or edit, Shared with me | `e2e-live/drive.spec.ts`, `e2e-live/drive-share.spec.ts` |
| `/calendar` | Real | Month and agenda views, several calendars, create, edit and delete, all-day and repeating events, guests invited by email, replies | `e2e-live/calendar.spec.ts` |
| `/contacts` | Real | Search, address books, create, edit and delete, one-click writing through webmail | `e2e-live/contacts.spec.ts` |
| `/docs`, `/docs/edit` | Real | Documents stored as files in Drive: rich text editor, autosave, reopen, HTML, Word and print export, conflict handling when two people save. No simultaneous editing | `e2e-live/docs.spec.ts` |
| `/platform` | Developer view | Read-only porting ledger and progress board. Not a product screen | `lib/platform/ledger.ts` |
| Storybook MCPL lab | Demo | Four buttons that push hard-coded "learning" events into an in-memory list | `src/storybook/MCPLScriptedEventsLab.svelte` |
| `lib/admin/ai`, `lib/admin/chat`, `lib/flow` | Unused | Not imported by any page | — |

## Removed on 2026-11-10 because they pretended

- **"Queue … deployment" panels** on Mail, Drive, Docs, Calendar, Contacts and Setup. They only added an entry to a list in the browser; nothing was deployed or sent anywhere.
- **The deployment planner and "service tiers"** (`lib/platform/control-plan.ts`, `DeploymentPlanner.svelte`), which produced requests no server received.
- **"Deployable service blueprints"** on `/platform`, including a "Google Drive Connector" card with no connector behind it.

## What changes, in order

These are the next work packages. Each one is done only when an automated end-to-end check proves it against a real server.

1. **MCPL v0 as the frame for every screen** (`mcpl/`): every screen declares the events it emits, and guided lessons ("self-teaching UI") advance on those real events. All later screens are built inside it.
2. **People and teams.** A product view over the registry: people, teams (groups), roles, quotas and per-person usage. The generic registry editor stays as the expert view.
3. **Graphs without the enterprise code.** Done: our own sampler stores the server's open counters, timings and gauges every minute (`crates/common/src/shippin/stats.rs`), `GET /api/stats` serves them to administrators, and the Svelte dashboard renders the schema's full dashboard definition from them. Proven live on 2026-11-10.
4. **Drive.** Upload, download, folders and quota on `FileNode`, then sharing.
5. **Google Workspace link.** Per-user Google sign-in (OAuth), then Drive and Docs listing and two-way sync with `drive.<domain>`. Domain-wide access for an organisation's admin comes after. See `deploy/HYBRID-GOOGLE-WORKSPACE.md`.
6. **Docs.** Only after Drive and the Google link exist: open and edit documents stored in Drive, or hand off to Google Docs for Google-hosted files.
7. **Calendar and contacts writes.**

Nothing on this list is a production commitment. The release gate stays `RELEASE.md`.
