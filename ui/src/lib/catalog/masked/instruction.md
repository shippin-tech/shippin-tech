# masked

Masked addresses at `/mail/masked`: a person makes random addresses on their own domain, gives them out, and switches them off when they get abused. Mail to one lands in their mailbox; a switched-off one is refused during the SMTP conversation.

The server side is `crates/common/src/shippin/masks.rs`, consulted in `crates/smtp/src/inbound/rcpt.rs`, and `crates/http/src/shippin/masked.rs` for `/api/masked`. `shippin.tech_MASKED_LIMIT` sets the limit per person. Calls live in `ui/src/lib/adapter/masked.ts`, pure helpers in `masked-call.ts`.

Kernel: `ui/src/lib/ai-runtime/mail/kernel/instruction.md`.
