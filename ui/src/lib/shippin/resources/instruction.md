# resources

Resources at `/shippin/admin/resources`: the server's disk, memory and mail queue, and each organisation's people and real storage against its limits, with whatever needs attention first.

The server side is `crates/http/src/shippin/resources.rs` (`GET /api/resources`) and `crates/common/src/shippin/resources.rs`. Storage used is what people have actually stored, not what has been set aside for them. Mail volume per organisation is not counted yet.

Kernel: `ui/src/lib/ai-runtime/admin/kernel/instruction.md`.
