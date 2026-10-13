# Traffic timeline and existing statistics

Existing counters remain authoritative: `client_entities.up/down/all_time`, `client_node_traffics`, and `nodes.up/down/all_time` are not reset or replaced by the timeline migration. The modal displays these accumulated counters independently from the volume inside the selected time range.

Migration 0070 snapshots the existing accumulated values into `traffic_history_origins`. This volume has no reliable timestamp distribution: the old per-client/per-node table only has one `updated_at` per cumulative row. It must never be rendered as a burst at the migration time.

New client history uses the same accepted upload/download deltas that accounting saves, including quota clipping. The history rows and counters are committed in the same PostgreSQL transaction. Per-node deltas are apportioned to these accepted bytes; unassigned volume remains explicitly unattributed. The original cumulative per-node counters retain their existing raw-counter semantics and are displayed separately.

Writes coalesce minute and UTC-day buckets and use bulk upserts, with no per-client polling history rows for idle clients. Collection coverage is global for client accounting and per-node for worker accounting. Gaps are distinct from zero volume. Queries aggregate in PostgreSQL and return bounded series: minute points for short ranges, 2-minute points for 24 hours, hourly points for 7 days, and day points for 30/90 days.

Automatic deletion is disabled until a retention period is explicitly selected. Minute samples, coverage, daily totals, and old accumulated snapshots are retained. The minute retention helper supports pruning detail later without removing day totals or origins. Panel restarts do not erase history. Manual counter resets keep the physical consumption timeline; the current counter and historical consumption are deliberately labelled as different periods.

Rollback to a binary predating migration 0070 requires removing only its `schema_migrations` compatibility marker; keep all timeline tables and their data. Otherwise the older binary rejects the newer schema version. The deployment backup includes a rollback script for this case.

Relative presets keep the full requested axis window. Absolute `from`/`to` timestamps use local browser date inputs and a fixed range of up to 366 days. Absolute query edges use minute detail, even when the display groups into hourly or daily points. A minute is the smallest stored interval; unavailable history stays a gap.
