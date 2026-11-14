# recover

Recover deleted at `/shippin/admin/recover`: an administrator brings back a deleted account or message while the server still keeps it (`shippin.tech_KEEP_DELETED_DAYS`, 30 by default, 0 keeps nothing).

The server side is `crates/common/src/shippin/recover.rs` for accounts, `crates/email/src/message/recover.rs` for messages and `crates/http/src/shippin/recover.rs` for `/api/recover`. A removed account's data stays in place until its destroy task comes due; restoring puts the registry object back and that task then does nothing. Closing a domain from the free-plan panel erases at once. Calls live in `ui/src/lib/shippin/recover/recover.ts`, pure helpers in `recover-call.ts`.

Kernel: `ui/src/lib/ai-runtime/admin/kernel/instruction.md`.
