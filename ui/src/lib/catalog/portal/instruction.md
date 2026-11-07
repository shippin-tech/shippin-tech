# portal

The ShippinTECH portal migration. Navigation and list columns come from `resources/schema/schema.json.gz` through `ui/scripts/emit-portal.ts`. Editable record fields, defaults and variants come from the active server's `/api/schema` response.

The bootstrap wizard is the same component. It uses bits-ui for the checkboxes and the variant selects. The portal layout shows it only when `x:Bootstrap/get` returns a record. A server that is already configured stays on the portal. `/setup` renders the same wizard without posting `x:Bootstrap/set`.

`RegistryEditor` owns schema record editing. `SchemaField` renders nested discriminated objects, membership-map sets, keyed object lists, maps, enums, numbers, booleans and text without flattening values. Keep existing object-list keys stable. `ReferenceField` obtains domain/account/etc. choices through the route callback; it does not own a transport. Server-set fields remain disabled; immutable fields are editable only at creation. Settings views resolve their underlying singleton and explicitly request the `singleton` ID. Account views resolve User/Group schemas and preserve their static query filters. The route owns read/write callbacks, reloads after confirmed mutations and displays method-level failures with affected properties. Updates send changed properties only and use the last get state when available. `RecordForm` is historical read-only fallback scaffolding; active writes use `RegistryEditor`. Search links to `/portal/<view>`. A signed-out view links to `/login`.

The mail portal does not implement dedicated-stack, shared-cluster or hybrid
orchestration. Those require platform deployment ownership and target bindings.
Do not represent reload, cache invalidation or web-bundle updates as instance
promotion, rollback or recovery.

The action panel renders the active schema's `x:Action` variants. The route passes `executeAction` from `adapter/actions.ts`; payload construction belongs to `adapter/action-call.ts`. Parameterized forms use mutable schema fields and render server-confirmed results. Schema-less actions execute after confirmation. Only actions defined by the mail engine belong here.

Delivery owns `routes/(portal)/portal/Delivery.svelte`, `adapter/delivery.ts`, and `DeliveryRunner.svelte`. The adapter requests `/api/token/delivery`, consumes `/api/live/delivery/<target>` events, preserves stage details, closes at completion, and stops on cancellation, navigation, failure or the 120-second timeout. Trace completion is not a claim of successful delivery.
