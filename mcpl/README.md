# MCPL v0 in this repository

Pre-release. MCPL is the owner's name for the framework all of the owner's app UIs are meant to share: screens that describe themselves, one event contract, and self-teaching lessons driven by real events. What the letters stand for is the owner's to define. This folder is one **variant** of it, `shippin-tech-mail` (SvelteKit 5 over a Rust engine), written so it can be compared with the variants in the owner's other apps.

v0 is a proposal, not a settled standard. It was built from what this repository already had: per-screen `component.json` files, the AI "kernel" instruction files, the signal contract in `ui/src/lib/portal/signal.ts`, and the Storybook "scripted events" demo. It joins those into one contract that a script can check.

## The six rules

1. **One door per area.** Each product area has one AI kernel, `ui/src/lib/ai-runtime/<area>/kernel/instruction.md`, listing its components. An agent starts there and does not invent a second path.
2. **Every screen describes itself.** Each component folder has `component.json` (schema: `schema/component.schema.json`) giving its name for agents (`a2ui`), its variants, the engine code that owns its data, the pages it appears on, and the events it emits. It also has an `instruction.md`.
3. **One event envelope.** Every event uses `schema/event.schema.json`. App events (`channel: "app"`) are named `<area>.<object>.<past-tense verb>`, for example `mail.message.sent`, and are emitted with `mcplEmit` only after the server confirmed the action. Payloads never hold passwords, keys, codes or message bodies.
4. **Lessons teach by watching.** A lesson (`schema/lesson.schema.json`) is a list of steps, each finished by one app event. Lessons never act for the person and never mark progress on their own. Scripted events from outside cannot pose as app events: the parser turns any outside `app` claim into `scripted`.
5. **Declared means real.** Every emitted event must be declared by exactly one component, and every declared event must actually be emitted somewhere. Nothing aspirational.
6. **Checked, and comparable.** `ui/scripts/check-mcpl.mjs` enforces rules 1 to 5 in CI and writes `variant.json` (schema: `schema/variant.schema.json`), a summary of this app's MCPL to diff against other apps.

## Layers and where they live here

| Layer | Here | Schema | Checked |
| --- | --- | --- | --- |
| Map | `ui/src/lib/ai-runtime/*/kernel/instruction.md` and every `instruction.md` link | — | every `Kernel:` and kernel-table link resolves |
| Components | `ui/src/lib/catalog/*/component.json` | `component.schema.json` | valid; id equals the folder; `variants.ts` matches; engine and kernel paths exist |
| Events | `ui/src/lib/mcpl/events.ts` (`mcplEmit`), envelope from `portal/signal.ts` | `event.schema.json` | emitted equals declared |
| Lessons | `ui/src/lib/mcpl/lessons/*.json`, runner `lessons.ts`, checklist `catalog/mcpl` | `lesson.schema.json` | valid; each step's event is declared |
| Conformance | `ui/scripts/check-mcpl.mjs`, run in the Check workflow | — | — |
| Variant | `mcpl/variant.json` (generated) | `variant.schema.json` | regenerated and compared on every check |

Proven in a real browser against the local server (`ui/e2e-live/free-plan.spec.ts`): the "Set up your domain" lesson shows on `/manage`, creating a mailbox finishes exactly its mailbox step, and a message sent from webmail finishes the send step, seen afterwards on `/manage`.

## Proposed extension: drive (agents act on the operator's screen)

A variant extension, offered for the owner to compare and standardise. It lets an AI agent
operate the product through MCP while the operator watches it happen in their own viewport and
learns from it. Nothing an agent does bypasses the screens.

1. **Actions are declared by the screen that does them.** A component's `component.json` lists
   `actions` (schema: `schema/action.schema.json`): an MCP tool name, title, description, the
   page it happens on, its input schema, whether it writes, whether it destroys, which
   arguments are secret, and the event it emits. The conformance check requires every declared
   action to be bound in code with a literal `onAction('<name>', …)`, nothing undeclared to be
   bound, its route to be one of the component's, and its event to be the component's. It
   writes `resources/product/actions.json`, which the server serves as the tool list.
2. **The screen carries out the call.** The MCP server (`/api/mcp`) does not act itself. It
   sends each call to the operator's open admin panel. The agent bar takes them to the page,
   shows what the agent is doing (secret arguments masked), fills the screen in first, asks
   before anything that writes, and then runs the same code the page's own controls use, so
   the page's event and the operator's lesson progress follow exactly as if they had done it.
   With no screen open, nothing happens and the agent is told why.
3. **Agents never hold keys.** No action takes a key or password: the person pastes those
   themselves (`KEYS.md`).
4. **Current MCP.** The server speaks MCP 2026-07-28 (stateless, `_meta` on every request, the
   Streamable HTTP headers checked against the body) and the initialize-based 2025-11-25,
   2025-06-18 and 2025-03-26. Tool annotations come from `writes` and `destructive`.

Proven in a real browser against the local server by `ui/e2e-live/mcp.spec.ts`. Code:
`crates/http/src/shippin/mcp.rs`, `ui/src/lib/shippin/agent/`. Open questions for the owner:
whether `actions` joins MCPL proper, whether reads should also be confirmable, and how a
variant without a live viewport (a phone app, a terminal) should carry out calls.

## Comparing variants

To compare this app with another one:

1. Copy `mcpl/schema/` into the other app unchanged and make its manifests, events and lessons validate. Whatever cannot be made to validate is a real difference between the two, not just a naming one.
2. Generate that app's `variant.json`, then diff the two files. `layers` shows what each implements, `events` shows naming, `components[].a2ui` shows component vocabulary, and `lessons` shows teaching flows.
3. Anything both variants already agree on becomes MCPL proper. Anything only one has stays a variant extension until the owner decides.

```sh
cd ui && npm run mcpl            # check
node scripts/check-mcpl.mjs --write   # refresh variant.json after a change
```

## Working rules for AI agents

This is the AI working system the pull-request freeze waits for. An agent changing this UI:

1. Starts at the area's kernel, reads the component's `instruction.md`, and keeps the split: components render, adapters in `ui/src/lib/adapter/` talk to the server, routes join them.
2. Adds or changes an event only together with the component's `emits`, and emits it only on the success path.
3. Runs `npm run mcpl`, `npm test`, `npm run check` and, for anything a person can do, a live browser test against the local stack. "Done" means proven against a server, not "it compiles".
4. Works on `main`, pre-release, with no pull requests (see `AGENTS.md`), and records what is still not true in `RELEASE.md` or `ui/AUDIT.md` rather than leaving it implied.

## Acceptance (what lifts the pull-request freeze)

- [x] Schemas for components, events, lessons and variants are published here.
- [x] The conformance check passes in CI on every push.
- [x] At least one lesson runs in the product on real events, proven in a browser.
- [x] `variant.json` is generated from the code.
- [ ] The owner has compared this variant with at least one other app's and recorded what MCPL proper keeps.
- [x] Lesson progress is kept on the server per account, not only in one browser (`/api/learn/progress`, proven by `ui/e2e-live/learn.spec.ts` and the free-plan journey).
- [ ] The owner removes `.github/workflows/freeze.yml`.

## Known v0 limits

- Lesson progress is kept on the server per account (`crates/http/src/shippin/learn.rs`); the browser keeps a copy and syncs at sign-in.
- There is one lesson. Events are not stored on the server.
- The `metrics`, `tracing` and `delivery` channels predate MCPL and carry data, not user actions. The dashboard reads our own `/api/stats` and live tracing our own `/api/trace/live`.
- v0 schemas may change. Every change bumps `mcpl` in the variant manifest.
