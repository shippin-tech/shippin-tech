# admin

This kernel is the only door for AI work on operating the server: the schema-driven portal, first-run setup, security baselines and delivery traces.

| Component | Path |
| --- | --- |
| admin | ../../../shippin/admin/instruction.md |
| dashboard | ../../../shippin/dashboard/instruction.md |
| people | ../../../shippin/people/instruction.md |
| resources | ../../../shippin/resources/instruction.md |
| assistant | ../../../shippin/assistant/instruction.md |
| alerts | ../../../shippin/alerts/instruction.md |
| recover | ../../../shippin/recover/instruction.md |
| org | ../../../shippin/org/instruction.md |
| calendar-templates | ../../../shippin/calendar-templates/instruction.md |

Rust owners: `crates/jmap/src/registry` (every `x:` object), `crates/http/src/setup.rs`, `crates/common/src/shippin/stats.rs` and `crates/http/src/shippin/stats.rs` (dashboard statistics). Adapters: `ui/src/lib/adapter/portal.ts`, `ui/src/lib/adapter/setup.ts`, `ui/src/lib/adapter/baseline.ts`.
The dashboard runs on our own statistics (`/api/stats`). Live tracing streams from our own `/api/trace/live` (`crates/http/src/shippin/trace.rs`). Features still being rebuilt are listed in `RELEASE.md`, section F.
