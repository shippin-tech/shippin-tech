# Original webui port

The port is incomplete. [webui-files.json](webui-files.json) accounts for all 57 original files, including 34 JavaScript chunks, with source hashes, current Svelte owners and specific remaining work. Runtime replacement and retained fonts are not functional-parity claims. The copied React control panel under `platform/web` is still reference code.

Current working ownership:

| Behavior | Presentation | Route / transport |
| --- | --- | --- |
| Typed registry CRUD | `catalog/portal/RegistryEditor.svelte`, `SchemaField.svelte`, `ReferenceField.svelte` | `(portal)/portal/[...view]/+page.svelte`, `adapter/portal.ts` |
| Server actions and returned results | `catalog/portal/ActionPanel.svelte` | Same route, `adapter/actions.ts`, `adapter/action-call.ts` |
| Outbound delivery tracing | `catalog/portal/DeliveryRunner.svelte` | `(portal)/portal/Delivery.svelte`, `adapter/delivery.ts` |
| Shared schema contracts | `portal/schema.ts` | Active server `/api/schema`; generated navigation remains `portal/catalog.ts` |

Paths in this table are relative to `ui/src/lib` for library files and `ui/src/routes` for routes. Catalog components receive transport callbacks; adapters own engine requests.

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
