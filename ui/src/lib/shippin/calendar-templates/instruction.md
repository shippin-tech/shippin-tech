# calendar-templates

Calendar emails at `/shippin/admin/templates`: an administrator rewords the invitation and reminder emails. A saved template replaces the built-in one, and resetting goes back to it.

The server side is `crates/common/src/shippin/calendar_templates.rs`, read by `crates/services/src/task_manager/imip.rs` and `alarm.rs`, and `crates/http/src/shippin/calendar_templates.rs` for `/api/calendar-templates`. The email bodies stay HTML because mail clients render HTML. Calls live in `ui/src/lib/shippin/calendar-templates/calendar-templates.ts`, pure helpers in `calendar-templates-call.ts`.

Kernel: `ui/src/lib/ai-runtime/admin/kernel/instruction.md`.
