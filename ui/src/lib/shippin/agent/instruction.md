# agent

The agent bar at the foot of the admin panel (MCPL's proposed "drive" extension). It opens the
operator's screen to AI agents that call the MCP server at `/api/mcp`
(`crates/http/src/shippin/mcp.rs`), and carries out their tool calls on that screen: it takes
the operator to the page, shows what the agent is doing with secret arguments masked, asks
before anything that writes, and runs the same code the page's own controls use. Each tool is
an action a component declares in its `component.json` and binds with a literal
`onAction('<name>', …)` (`agent.svelte.ts`); the conformance check holds the two together.

Agents never pass keys or passwords. The person pastes those into their fields themselves
(`KEYS.md`).

Kernel: `ui/src/lib/ai-runtime/admin/kernel/instruction.md`.
