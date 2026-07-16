# durable (C2)

The durable-execution capability of [skynet-graph](../../README.md), as a plugin — a workflow survives a
process kill and resumes exactly where it stopped, on the graph's own determinism.

`lib/` holds the executor, moved here from `lib/durable/` (owner: the specific goes into its plugin):
`checkpoint-store` (durable marking + content-memo + rollback, fencing lease; memory or SQLite backend —
`node:sqlite` loads only inside the sqlite factory), `xlate` (C-xlate `compileMethod`), `interpreter`
(Layer B `runFlow`), `fold` (the fold-back JOIN's monoid algebra `foldSiblings`), `audit` (the trail).
`factory.js` is the packaged `createDurableRunner` (compile/run/resume/audit), reachable as
`Graph.factories.createDurableRunner` and what `sg flow run <module.js>` executes.

The host facade consumes it lazily: `Graph.durable` (the full namespace) and
`Graph.createCheckpointStore({file})` (file → SQLite, none → memory).

No concept sets and no static providers (Tier-1 JS machinery). MEASURE GATE (2026-06-29): STRUCT 6 vs
RAG 24 — the structural checkpoint replays cheaper than a transcript replay.

See [`doc/plugins.md`](../../doc/plugins.md).
