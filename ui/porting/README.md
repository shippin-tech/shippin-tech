# Original webui port

The port is incomplete. [webui-files.json](webui-files.json) accounts for all 57 original files, including 34 JavaScript chunks, with source hashes, current Svelte owners and specific remaining work. Runtime replacement and retained fonts are not functional-parity claims. The copied React control panel under `platform/web` is still reference code.

The canonical remaining-work queue is [work-packages.json](work-packages.json). Each package has existing code owners, named workflow batches, prerequisites and acceptance checks. Every original file links to its packages. The older dated plans retain history; this queue governs grouping and dependencies for the remaining work.

| Group | Packages and sequence | Completion boundary |
| --- | --- | --- |
| Original portal | P1 shared registry/navigation → P2 editors/blobs/Sievepad; P3 identity/MFA/setup → P4 actions/traces/metrics; P5 final visual/localization/accessibility parity | Original portal workflows and supported-edition behavior verified, beyond representative CRUD |
| Platform absorption and instance control | C1 integrate baseline and enumerate source routes → C2 tenant/installation/target binding → C3 dedicated, shared, hybrid and lifecycle batches → C4 source feature families ported to Svelte | Bound instance controls and runtime read-back; every imported platform route accounted for |
| Connected workspace | W1 mail/calendar/contacts → W2 Drive → W3 Docs/network | Real service journeys, persistent content, sharing and isolation |
| Release | R1 after P5, C4 and W3 | Compatibility, packaging, upgrade/rollback and final cutover |

Platform absorption remains the current priority: **C1 is the next platform package**. **P1 is the next original-portal package** and does not need to wait for the entire platform port. Workspace expansion follows the platform gate. P3 can proceed independently; C2 needs its identity boundary. C4 also needs P1, and P4 needs P1/P3. The JSON records all dependency edges, rather than implying every group is a single linear chain.

Complete one named workflow batch across its route, adapter and presentation before the full test/build/Docker loop. Use earlier targeted diagnostics only for a concrete blocker. Then verify the real journey, record evidence, commit and push that batch. A package is done only after all its batches and acceptance checks pass. Accessibility and error behavior apply during each batch; P5 is the final audit. Shared chunks link to multiple packages without creating duplicate implementations. A file count or a passing inventory check is not a completion threshold.

**What is real today is recorded in [../AUDIT.md](../AUDIT.md).** On 2026-11-10 the deployment panels, the deployment planner and service tiers, and the blueprint triggers on `/platform` were removed: they only produced in-browser signals and deployed nothing. `/platform` is now a read-only porting ledger. The signal contract (`portal/signal.ts`) and the Storybook MCPL lab remain and are being folded into MCPL (`mcpl/README.md`).

Current working ownership:

| Behavior | Presentation | Route / transport |
| --- | --- | --- |
| Typed registry CRUD | `shippin/admin/RegistryEditor.svelte`, `SchemaField.svelte`, `ReferenceField.svelte` | `shippin/admin/[...view]/+page.svelte`, `adapter/portal.ts` |
| Server actions and returned results | `shippin/admin/ActionPanel.svelte` | Same route, `adapter/actions.ts`, `adapter/action-call.ts` |
| Outbound delivery tracing | `shippin/admin/DeliveryRunner.svelte` | `shippin/admin/Delivery.svelte`, `adapter/delivery.ts` |
| Shared schema contracts | `portal/schema.ts` | Active server `/api/schema`; generated navigation remains `portal/catalog.ts` |

Paths in this table are relative to `ui/src/lib` for library files and `ui/src/routes` for routes. Catalog components receive transport callbacks; adapters own engine requests.

P1 registry controls now use server-side query pagination/filter/sort with deep-link URL state (`q`, `sort`, `dir`, `lim`, `pos`) in `routes/(shippin)/shippin/admin/[...view]/+page.svelte` and `shippin/admin/RegistryEditor.svelte`, so reload/return navigation preserves list position and query intent.
Bootstrap setup now posts real `x:Bootstrap/set` updates through `ui/src/lib/adapter/bootstrap.ts` from both `/setup` and the portal gate, so setup completion and returned credentials are handled by the same Svelte workflow instead of a static placeholder result.
Session handling now enforces protected-route auth gates (`/shippin/admin`, `/platform`, `/mail`, `/files`, `/docs`, `/calendar`, `/contacts`), preserves return navigation through OAuth callback, and exposes explicit sign-out in the shared layout using `ui/src/lib/adapter/session.ts`.
The portal has a security baseline surface at `/shippin/admin/security` (`routes/(shippin)/shippin/admin/security`, `shippin/admin/SecurityBaseline.svelte`, `portal/baseline.ts`, `adapter/baseline.ts`). Each landing-page rule is one checkbox over named singleton properties (`x:Security`, `x:Imap`, `x:Http`, `x:SenderAuth`, `x:MtaStageAuth`), with the current value, the value written and its effect listed before the operator ticks it. "Require MFA for all accounts" is shown as unavailable because this server build has no account-wide MFA setting; it is not faked. Apply/restore of the transport and brute-force rules was verified against the local Docker server on 2026-11-09 (`test/security-baseline.test.ts` holds the unit coverage).
The self-service free plan lives at `/signup` and `/manage` (`routes/(account)/signup`, `routes/(manage)/manage`, `catalog/panel/`, `panel/model.ts`, `adapter/panel.ts`) over the server routes in `crates/http/src/shippin/panel.rs`. Customers prove domain ownership with a TXT record before the domain exists; owners then manage mailboxes, passwords and aliases within the limits in `server.env`. Navigation follows the account (`adapter/home.ts`): operators keep the portal and preview areas, customers see their domain and mail. See `deploy/README.md` for the plan settings.
Account self-service replaces the retired legacy `/account` bundle at `/account` (`routes/(account)/account`, `catalog/account/AccountSecurity.svelte`, `adapter/account.ts`, `account/totp.ts`): password change, two-factor sign-in with a browser-made authenticator secret checked before it is stored, and app passwords. `/admin` now opens the portal. Webmail sends (`routes/(mail)/mail/compose`, `catalog/email/Compose.svelte`, `adapter/send.ts`, `mail/compose.ts`): compose, reply, reply all, forward, drafts and attachments, with the message moved from Drafts to Sent on submission. `e2e-live/` drives these journeys in Chromium against the local Docker stack (`npm run test:live`); `e2e/` runs mocked in Check. The free plan release gate is `RELEASE.md` at the repository root.
The brand lockup is a pixel wordmark generated from `brand/pixel-font.json` by `scripts/brand-sync.mjs` (`brand.wordmarkSvg`, `ui/static/logo.svg`, landing header); no webfont is downloaded, and forks override glyphs in `brand/custom/pixel-font.json`.
The platform control page now includes a live WebUI absorption board (`PortingBoard.svelte`) built from `ui/porting/webui-files.json` and `ui/porting/work-packages.json`, giving grouped remaining-work visibility by package/status directly inside the Svelte control surface.

Observed against the local Docker installation on 2026-11-07: OAuth login; domain create/edit/delete through reloads; membership-map aliases; settings-view singleton save/reload/restore; Group variant creation, domain choice, numeric quota map and keyed email aliases; User/Group static filtering; group deletion; spam-classification input and real result score/tags; delivery token and real event stream completing with DNS failure for a reserved `.invalid` domain. Trace completion does not mean delivery succeeded. These representative checks do not certify every object or action.

Run from `ui/`:

```powershell
node scripts/check-webui-inventory.mjs
npm run check
npm test
node scripts/prove-portal-records.mjs
```

The last command uses ignored local credentials and the running Docker stack. It creates disposable domains/groups, removes them, and restores the tested singleton setting. Screenshots go to `target/portal-port-proof/`.

Remaining portal work includes item-action navigation hardening, blob upload/download, Sievepad, OTP enrollment/recovery, specialized format editors, localized errors/translations, archived trace routing, active-schema navigation, the complete browser setup journey, edition/permission cases, responsive/accessibility parity and legacy `/admin`/`/account` cutover. Mail, Drive and Docs have their own unfinished workflows; no full-suite completion is claimed.

The control plane belongs to `platform/internal/servers` (hosts and tenant assignments) and `platform/internal/deployments` (target-bound desired generations and observed execution state). A mail-engine tenant, an installation and a deployment target are different identities. Dedicated placement needs an owned installation; shared placement needs tenant/domain/account provisioning on an existing installation; hybrid needs an explicit assignment per tenant. The tenant/installation binding, credentials, reconciliation, migration and failure handling are not connected. There are no working promotion, rollback or hybrid-placement controls in this mail portal. The earlier mappings of those labels to mail reload/update actions have been removed.
