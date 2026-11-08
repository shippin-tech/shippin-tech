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

Current working ownership:

| Behavior | Presentation | Route / transport |
| --- | --- | --- |
| Typed registry CRUD | `catalog/portal/RegistryEditor.svelte`, `SchemaField.svelte`, `ReferenceField.svelte` | `(portal)/portal/[...view]/+page.svelte`, `adapter/portal.ts` |
| Server actions and returned results | `catalog/portal/ActionPanel.svelte` | Same route, `adapter/actions.ts`, `adapter/action-call.ts` |
| Outbound delivery tracing | `catalog/portal/DeliveryRunner.svelte` | `(portal)/portal/Delivery.svelte`, `adapter/delivery.ts` |
| Shared schema contracts | `portal/schema.ts` | Active server `/api/schema`; generated navigation remains `portal/catalog.ts` |

Paths in this table are relative to `ui/src/lib` for library files and `ui/src/routes` for routes. Catalog components receive transport callbacks; adapters own engine requests.

Canonical signal foundation: portal dashboards, live tracing, delivery tracing and scripted AI events now emit a shared signal contract (`ui/src/lib/portal/signal.ts`) and publish through `ui/src/lib/adapter/signal.ts`. This keeps dashboards, observability panels, operator workflows and external webhook sinks on one event shape while C4/W3 continue.
P1 registry controls now use server-side query pagination/filter/sort with deep-link URL state (`q`, `sort`, `dir`, `lim`, `pos`) in `routes/(portal)/portal/[...view]/+page.svelte` and `catalog/portal/RegistryEditor.svelte`, so reload/return navigation preserves list position and query intent.
Platform control now has a Svelte ledger surface at `/platform` backed by `ui/porting/platform-disposition.csv`, including disposition/group filtering and deployable managed-service blueprint triggers for mail/workspace integrations.
The platform planner now supports managed vs self-host deployment requests using `deploy/control-plan.template.json` lanes, with generated project names, payload preview, and signal/webhook emission so operator and AI workflows share one deploy request contract.
The deployment planner also carries service-tier policy (`free`, `small-business`, `enterprise`) with explicit limits and pause/block behavior; free-tier requests enforce the capped model (2 Postgres, 5 GB storage, 5 active projects, workspace enabled) and emit blocked/pause signals when exceeded.
Workspace surfaces (`/mail`, `/files`, `/calendar`, `/contacts`, `/docs`) now expose direct deployment-trigger actions and signal feeds, so operators can queue managed/self-host rollout intent from the product area they are using and review emitted deployment events without leaving the UI.
Bootstrap setup now posts real `x:Bootstrap/set` updates through `ui/src/lib/adapter/bootstrap.ts` from both `/setup` and the portal gate, so setup completion and returned credentials are handled by the same Svelte workflow instead of a static placeholder result.
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

Remaining portal work includes query pagination and dynamic filters/sorting, item-action navigation, blob upload/download, Sievepad, OTP enrollment/recovery, specialized format editors, localized errors/translations, archived trace routing, active-schema navigation, the complete browser setup journey, edition/permission cases, responsive/accessibility parity and legacy `/admin`/`/account` cutover. Mail, Drive and Docs have their own unfinished workflows; no full-suite completion is claimed.

The control plane belongs to `platform/internal/servers` (hosts and tenant assignments) and `platform/internal/deployments` (target-bound desired generations and observed execution state). A mail-engine tenant, an installation and a deployment target are different identities. Dedicated placement needs an owned installation; shared placement needs tenant/domain/account provisioning on an existing installation; hybrid needs an explicit assignment per tenant. The tenant/installation binding, credentials, reconciliation, migration and failure handling are not connected. There are no working promotion, rollback or hybrid-placement controls in this mail portal. The earlier mappings of those labels to mail reload/update actions have been removed.
