# control-plane

This kernel is the only door for AI work on tenants, domains, and accounts.

Start here. Open one sub-thread. The control plane sets ceilings. A tenant keeps full mail and domain control inside that ceiling.

| Thread | Path |
| --- | --- |
| directory | threads/directory/instruction.md |
| domain | threads/domain/instruction.md |
| account | threads/account/instruction.md |
| scim | threads/scim/instruction.md |

Rust owners: `crates/directory`, `crates/jmap/src/registry`, `crates/scim`.
HTTP: `/api`, `/scim`, `/auth`.
A Go service may set ceilings later. It does not own these folders and it does not contain components.
