# account

A signed-in person's own security: password, two-factor sign-in, app passwords. Engine: `crates/jmap/src/registry/mapping/account.rs` (`x:AccountPassword`, `x:AppPassword`). Route: `/account`. This folder does not fetch; `ui/src/lib/adapter/account.ts` does.

Kernel: `ui/src/lib/ai-runtime/account/kernel/instruction.md`.
