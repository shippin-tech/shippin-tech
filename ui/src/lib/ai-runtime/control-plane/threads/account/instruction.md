# account

Rust: `crates/jmap/src/registry/mapping` account records, `AccountCache` in `crates/common/src/auth`
HTTP: `POST /api/auth` for the sign-in page, registry methods on `/api`
Catalog: `login`
Route: `ui/src/routes/(account)/login`
Kernel: `../../kernel/instruction.md`

The account `maxDiskQuota` is the storage ceiling under the tenant ceiling. The free preset is 2 GB.
