# panel

This kernel is the only door for AI work on the self-service free plan: signup, a domain owner's page, and the lessons that teach it.

| Component | Path |
| --- | --- |
| panel | ../../../catalog/panel/instruction.md |
| mcpl | ../../../catalog/mcpl/instruction.md |

Rust owner: `crates/http/src/shippin/panel.rs` (`/api/panel/*`). Adapter: `ui/src/lib/adapter/panel.ts`. Lessons: `ui/src/lib/mcpl/lessons/`.
A domain is created only after its DNS ownership proof. Plan limits are enforced on the server, never only in the page.
