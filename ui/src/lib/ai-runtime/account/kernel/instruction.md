# account

This kernel is the only door for AI work on signing in and a person's own security.

| Component | Path |
| --- | --- |
| login | ../../../catalog/login/instruction.md |
| account | ../../../catalog/account/instruction.md |

Rust owners: `crates/http/src/auth` (sign-in, OAuth), `crates/jmap/src/registry/mapping/account.rs` (password, two-factor, app passwords), `crates/http/src/setup.rs` (first-run administrator).
Adapters: `ui/src/lib/adapter/auth.ts`, `ui/src/lib/adapter/account.ts`, `ui/src/lib/adapter/session.ts`.
Events: see each component's `component.json` "emits". Never put a password, key or code in an event payload.
