# dashboard

The administrator's server dashboard at `/shippin/admin`. Our own code end to end; it needs no licence key.

- **Layout** comes from the schema's dashboard definition (`resources/schema/schema.json.gz`, emitted as `dashboards` in `ui/src/lib/portal/catalog.ts` by `ui/scripts/emit-portal.ts`): six tabs (Overview, Network, Security, Delivery, Performance, Storage), each with cards and charts naming their metrics, aggregation and number format. An extra "All metrics" tab charts any metric with recorded history.
- **Data** comes from `GET /api/stats?period=24h|7d|30d|90d` (`crates/http/src/shippin/stats.rs`), filled by the sampler in `crates/common/src/shippin/stats.rs`. Every minute each node stores counter and timing deltas from `trc::Collector` in hourly and daily buckets; memory and queue size are sampled every five minutes. Live cards (users, domains, queue, memory, connections) are read on request.
- **Options**: the last 24 hours, 7, 30 or 90 days, or any custom range within the last 400 days (hourly bars for up to two days, six-hour bars up to two weeks, daily bars beyond, all within what is kept); all nodes added up or one node; bars or lines; refresh every minute or on demand.
- **Rendering**: `DashboardPanel.svelte` lays out tabs, cards and charts; `BarChart.svelte` draws bars (stacked where the definition says so) or lines, with hover and arrow-key readouts, a legend for two or more series, and a table view. Pure helpers live in `ui/src/lib/shippin/dashboard/stats-call.ts`; the fetch is `shippin/dashboard/stats.ts`.
- The dashboard emits no app events. It publishes `metrics.stats.*` status signals on the `metrics` channel.
- Bars before the first stored bucket are zero, not missing data; `since` in the response says where history starts, and period-over-period deltas only show once history covers the previous period.

Kernel: `ui/src/lib/ai-runtime/admin/kernel/instruction.md`.
