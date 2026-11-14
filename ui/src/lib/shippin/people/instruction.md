# people

People and teams at `/shippin/admin/people`, the administrator's product view over the registry: add, edit and remove people, reset passwords, choose administrator or member, set storage limits, make teams with their own address and manage who is on them. The generic registry editor stays as the expert view.

The server side is the `x:Account` registry object (`crates/jmap/src/registry`); a team is a `Group` account. Calls live in `ui/src/lib/shippin/people/team.ts`, pure helpers in `team-call.ts`. Updates send only what changed, so settings this form does not show are left alone. The form hides the access choice for custom roles rather than overwrite them.

Kernel: `ui/src/lib/ai-runtime/admin/kernel/instruction.md`.
