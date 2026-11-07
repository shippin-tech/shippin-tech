# portal

The absorbed ShippinTECH portal. Navigation, list columns, and form sections come from `resources/schema/schema.json.gz` through `ui/scripts/emit-portal.ts`.

The bootstrap wizard is the same component. It uses bits-ui for the checkboxes and the variant selects. The portal layout shows it only when `x:Bootstrap/get` returns a record. A server that is already configured stays on the portal. `/setup` renders the same wizard without posting `x:Bootstrap/set`.

The dashboard, the list, and the form are separate components. A form field carries its schema type and format and still renders as a readonly value. A non-empty form value has Copy. Success says Copied. A blocked clipboard says to select the value and copy it manually. Search pages, fields, and settings from this catalog. Ctrl K or Cmd K opens the search. A result links to `/portal/<view>`. This folder does not fetch and does not import Svelte Flow. The dashboard and Delivery tests routes mount the graphs. The route at `ui/src/routes/(portal)/portal/[...view]` calls `loadRegistry` in `ui/src/lib/adapter/portal.ts` and passes the rows in. Registry objects use `x:Object/get` with ids omitted. Mailbox, Calendar, AddressBook, and SieveScript send their JMAP capability. A signed-out view links to `/login`. An empty list says No results found.

The dashboard also renders an enterprise control plan panel that shows the
supported deployment lanes (`dedicated_stack_per_client`,
`shared_cluster_multi_tenant`, `hybrid`) and the scripted event IDs that
operations automation can call.

The action panel posts `x:Action/set` through `ui/src/lib/adapter/action-call.ts`.
Schema-less actions execute directly after confirmation. Scripted event buttons
map to action names and execute through the same path.
