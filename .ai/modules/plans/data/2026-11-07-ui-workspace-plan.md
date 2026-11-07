# Svelte portal and connected workspace: execution plan

Status: **draft; implementation and release are not complete.** The immediate priority is now [absorbing shippin-platform](2026-11-07-platform-absorption.md); resume the wider workspace sequence after its agreed gate. The JSON record beside this plan is the machine-readable index. Existing dated plans are historical evidence; an `implemented` status on one of them only means that plan's stated scope passed its recorded proof. It is not evidence of complete product behavior.

## Goal and completion

Replace the behavior of the original `assets/webui` portal with a maintainable SvelteKit application, then evolve the same application into a hosted mail, drive, and docs experience that can connect to the wider network. The target is functional parity and verified integration, not a literal conversion of minified build chunks into one-for-one Svelte files. Retain fonts, images, and actual mail HTML where appropriate; generated build output is not source.

The work is complete only when: (1) every original portal capability has a traced source, owner, implementation and passing behavioral proof or an explicit supported-edition limitation; (2) intended public routes and the images serve the Svelte build without breaking API or OAuth routes; (3) the agreed workspace journeys work against real services with tenant isolation; and (4) tests, accessibility, error states and upgrade/rollback proofs pass. Docs and network integration cannot be declared complete until their actual service contracts and ownership are established.

## Current evidence and overlap

| Area | Evidence now | Reuse and remaining work |
| --- | --- | --- |
| Original portal | `assets/webui` contains a compiled portal; `.ai/modules/plans/data/2026-11-04-portal-to-svelte.json` identifies its fixed screens and schema-driven administration. | Inventory behavior and endpoints from the bundle and server; do not copy its minified React runtime. |
| Serving | `crates/http/src/portal.rs` serves a Svelte static build on non-reserved paths; the three Dockerfiles build and install it. `/admin` and `/account` are reserved for the application bundle; defaults still contain an older download URL. | Keep the existing root serving mechanism. Plan and test the compatibility transition separately; do not claim the old bundle is replaced. |
| Identity | Svelte discovery, OAuth callback and login exist in `ui/src/lib/adapter` and `(account)` routes. | Verify the actual server route precedence, registration, state/PKCE, expiry, sign-out, and return navigation end to end. Avoid a second session implementation. |
| Administration | `portal/catalog.ts`, `PortalView`, record tables/forms, search, dashboard, trace and action surfaces exist. Forms are readonly; `WriteActions` does not perform writes; catalog includes generated static schema data. | Reuse components and adapters. Inspect the current schema endpoint and generator before choosing live schema, cached schema, and drift behavior. Do not build a second admin registry. |
| Setup and operations | Setup and portal layout contain a no-op finish; delivery runner is not connected; action variants needing parameters lack forms. Some metrics/tracing code exists. | Complete against server contracts, including nested typed variants and real success/error handling. Historical non-posting proof is not parity. |
| Workspace | Mail lists folders and messages and reads plain text; files, contacts and calendar list data; Docs declares editing unavailable. These lists currently have bounded query sizes and limited operations. | Extend these existing routes and adapters; keep a single JMAP session and shared catalog. No claims of composing, file management, or collaborative editing until proven. |
| Context | `ai-runtime/mail` and `ai-runtime/docs` contain kernels and threads; the docs kernel and `.cursor/rules/product-boundaries.mdc` defer editors and clients. | Reconcile the user's new direction before changing operating rules. Do not leave contradictory instructions or duplicate canonical contexts. |

The older `2026-11-04-ui-file-map` describes the webui bundle as absent and the older `portal-to-svelte` plan says the root build is not served. Both are historical statements, not current facts. The `portal-bootstrap`, `portal-writes`, `portal-delivery`, and `portal-actions` records deliberately accepted partial or non-posting behavior; retain their proof history but supersede their completion interpretation with the gates below. The current ActionPanel contains newer local changes; inspect them rather than reverting or rebuilding them.

## Context and folder ownership

This is a proposed target, not a command to move files now. Each domain has one canonical kernel and one feature thread; each runtime behavior has one source owner. Move existing files only with import, route, and behavioral proofs, and provide a temporary compatibility path when callers need one. No duplicate modules during the final state.

```text
.ai/modules/plans/data/                     cross-domain plan and historical records
ui/src/routes/                             SvelteKit routes; compose features, own page state
  (account)/                              sign-in, OAuth callback, account entry
  (portal)/portal/                        server administration and diagnostics
  (mail)/mail/                            inbox, message, compose and mail settings
  (calendar)/calendar/  (contacts)/contacts/
  (files)/files/  (docs)/docs/            workspace entry points
ui/src/lib/adapter/                        only engine/service transport boundary
  account/ portal/ mail/ calendar/ contacts/ files/ docs/
ui/src/lib/catalog/                        reusable presentation components, no fetch
ui/src/lib/token/                          shared visual, motion and interaction tokens
ui/src/lib/flow/                           optional graph views over catalog data
ui/src/lib/ai-runtime/
  portal/kernel/ + threads/<feature>/     admin domain context (proposed)
  mail/kernel/ + threads/<feature>/       mail domain context
  docs/kernel/ + threads/<feature>/       document domain context
  files/kernel/ + threads/<feature>/      file domain context (proposed)
  calendar/kernel/ + threads/<feature>/   calendar context (proposed)
  contacts/kernel/ + threads/<feature>/   contacts context (proposed)
ui/test/ and ui/e2e/                       contract/unit and browser journey proofs
```

The proposed adapter subfolders are a future migration from today's flat `adapter/*.ts`, not existing paths. Separate identity from portal management; one domain owns a cross-domain primitive and others import it. Move existing mail threads for calendar, contacts, and files only after their replacement kernels exist, then update their links and remove or redirect the old instructions. `docs/threads/file` must refer to the file owner rather than copy its storage contract. Each kernel names purpose, authoritative code and protocol, owned threads, allowed dependencies, and non-goals. Each thread names route, adapter, component, tests, service contract and last verified state. Component manifests remain under `catalog/<component>/` with their existing discovery convention. `flow` is an optional explanation surface, never a replacement for the functional feature. The control plane remains separately owned; verify branch and service boundaries before connecting it.

## Work packages and dependencies

Each package ends with the named acceptance proof before dependent work is marked complete. Do not make changes to a live server for tests; use a disposable instance and explicitly scoped test accounts.

1. **Inventory and decisions (no dependency).** Build a capability matrix from original bundle chunks, server schemas/routes, and Svelte routes. Record source screen, interactions, API/permissions, current owner, state (`verified`, `partial`, `missing`, or `edition-limited`), and proof. Identify every original fixed screen including login, callback, bootstrap, dashboard, actions, delivery, tracing, TOTP and Sievepad; enumerate schema-driven object and settings classes without inventing missing screens. Reconcile old phase bans with the current suite direction in product rules and context kernels; document decisions about hosted ownership, scope and rollout. **Gate:** reviewed matrix has no unowned original capability, and every claim links to source and evidence.

2. **Shared foundations and context (after 1).** Define the canonical folder ownership above, update stale kernel links and component instructions, then incrementally organize flat adapters without breaking imports. Keep shared session, API errors, capability detection and tokens singular; retain the existing route groups. Add a check for missing/broken context links and forbidden catalog-to-adapter imports. **Gate:** whole-tree context/import checker, Svelte checks and existing routes pass; no abandoned duplicate thread remains.

3. **Identity and route compatibility (after 1; foundation work can run with 2).** Exercise discovery, client registration, authorization and PKCE callback, server session/account selection, MFA, expiration, sign-out and return-to-route. Trace actual `/login`, `/device`, `/calendar/rsvp`, `/admin`, `/account`, `/portal` and API dispatch. Specify mapping/redirects, deep links, static fallback and any OAuth redirect URI migrations before replacing legacy mounts. **Gate:** real disposable-server browser journeys for normal and MFA sign-in, restart/refresh, failure, sign-out and old deep links; API and auth routes remain correct.

4. **Portal parity (after 1–3).** Finish typed, nested schema forms, server validation errors, create/update/delete, concurrency and permission/enterprise states; do not flatten nested values to strings. Implement bootstrap with complete variant-specific fields and server-confirmed credentials, without dropping defaults or exposing secrets. Complete parameterized actions, delivery execution and cancellation, trace/metrics lifecycles, and Sievepad against actual server contracts. Keep generated catalog and live schema synchronized using the decision from 1. **Gate:** authenticated browser tests perform representative real reads/writes against disposable data, verify rejection and cleanup, and show enterprise-disabled behavior; fixed-screen and schema capability matrix is fully accounted for. No mock-only test is a parity claim.

5. **Mail and groupware (after identity; portal completion is the migration release gate).** Extend existing mail with pagination/search, message bodies and attachments, safe HTML rendering, compose/reply/forward, drafts, submission, folder management, unread state and recovery. Verify actual JMAP capabilities and account-specific IDs. Complete calendar and contacts interactions and permissions using existing engine protocols. **Gate:** disposable-server journey creates, sends, receives, opens and searches mail; handles attachment, empty, offline/error and cross-account cases; calendar/contact create and edit persist; responsive and accessibility checks pass.

6. **Drive and documents (after identity, storage contract and ownership decisions).** Specify file hierarchy, upload/download, metadata, quota, move/delete, sharing, conflict and pagination against supported FileNode/blob APIs; do not equate a file list with Drive. Discover or select the document editing service, storage model, editor format, permissions and collaboration protocol before implementing Docs. Use one file owner and one editor owner, with explicit identity and tenant mapping. **Gate:** uploaded file survives reload, permissions and quota are enforced, sharing is scoped; document create/edit/reopen and conflict/collaboration behavior are proven against the actual selected service. If no editor exists, keep Docs honestly unavailable.

7. **Network integration and hosted operations (depends on service inventory, identity and packages 4–6 as applicable).** Inventory the wider network's actual repositories, endpoints, events, trust boundaries, deployment owners and contracts; map each integration to a canonical service and adapter. Define authentication, authorization, tenancy, storage quotas, provisioning, observability, upgrades, failures and rollback. Avoid prescribing APIs, MCP, control-plane behavior or external products without evidence. **Gate:** cross-service test with at least two tenants proves intended sharing and denial, lifecycle and recovery, and deploy/rollback from a versioned artifact. Keep unknown contracts explicitly blocked rather than simulate them.

8. **Cutover and de-duplication (after agreed parity and hosted gates).** Build reproducible artifacts, verify deployment mounts and compatibility aliases, migrate configuration and existing registry records deliberately, preserve rollback, then retire obsolete bundle/code and duplicate contexts only after parity is demonstrated. **Gate:** clean build, full automated suites, accessibility and responsive checks, real supported-release smoke, old-path and upgrade checks, and a documented rollback; no user data lost. Do not change a configured deployment merely to make a local test pass.

## Verification strategy

- Fast checks from `ui/`: `npm run check`, `npm test`, `npm run build`, and `npm run test:browser`. Add tests for behaviors, not just generated text. Record exact results and fixture versions for each package.
- Whole-tree checks: `py -3.11 .ai/machine/organize.py --check`, a new context/import checker from package 2, and a capability-matrix coverage check from package 1. The latter must fail for an unowned, unproven original capability. The two new checks are planned deliverables and do not exist yet.
- Contract and integration checks: authenticated JMAP/API calls against a disposable server, including method-level errors and permissions; browser tests must cover success, failure, empty and signed-out states. Existing mock tests prove client behavior only.
- Release checks: built-image route and asset smoke, legacy routes, OAuth redirect compatibility, tenant isolation, accessibility, responsive widths, supported-edition behavior, and rollback. Record server revision, configuration, services, and observed outcomes.

## Decisions and external dependencies

The user has authorized planning for a modern hosted suite; the repository's current rule defers those clients. Reconcile the rule and phase order explicitly as part of package 1 rather than silently implementing conflicting instructions. The actual wider-network inventory, editor service, tenant identity authority, and production deployment topology have not been established in this repository evidence. Discover them from the user's available project sources; ask for the missing contract only when discovery cannot resolve it. No host, editor, API, license, or service integration is presumed by this plan.

Preserve existing uncommitted changes and the original portal until parity and cutover are proven. The Rust engine remains the mail engine. User instructions prohibit creating issues, pull requests, or LLM-generated security reports to maintainers; this plan does not propose any.
