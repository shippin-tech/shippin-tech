# org

Organisations: domains grouped under their own administrators and limits, on one server. `/shippin/admin/orgs` is where the server's administrators create them. `/shippin/org` is where an organisation's own administrator manages its people, and only its people.

The server side is `crates/common/src/shippin/orgs.rs` and `crates/http/src/shippin/org.rs` (`/api/orgs`, `/api/org`). Every `/api/org` write first checks the person is on one of the organisation's domains, then runs through the normal management handlers. Calls live in `ui/src/lib/shippin/org/orgs.ts`, pure helpers in `orgs-call.ts`.

The folder also holds the per-domain editors for logos (`crates/common/src/shippin/brand.rs`, `/api/brand`) and sign-in through a domain's identity provider (`crates/common/src/shippin/sso.rs`, `/api/sso`). Server administrators always sign in with a password; that rule is in `crates/http/src/shippin/sso.rs` and must stay. SCIM provisioning (`crates/common/src/shippin/provisioning.rs`, `crates/http/src/shippin/provisioning.rs`, `/api/scim`) is written from RFC 7643 and 7644, not from the licence-marked `crates/scim`, and it also leaves server administrators alone.

Kernel: `ui/src/lib/ai-runtime/admin/kernel/instruction.md`.
