# alerts

Alerts at `/shippin/admin/alerts`: an administrator's own rules on the server's own statistics. A rule watches one metric over the last hour or day and sends an email, calls a webhook, or both when it crosses a threshold, then waits out a cooldown.

The server side is `crates/services/src/alerts.rs`, checked every five minutes by the scheduler, and `crates/http/src/shippin/alerts.rs` for `/api/alerts`. Calls live in `ui/src/lib/shippin/alerts/alerts.ts`, pure helpers in `alerts-call.ts`. The server validates every rule again, so the form's checks are only there to answer sooner.

Kernel: `ui/src/lib/ai-runtime/admin/kernel/instruction.md`.
