# reason-kernel

The shared **reasoning-kernel** foundation plugin for [skynet-graph](../../README.md) — the primitives that
reasoning-strategy plugins build on. It is **extracted from a measured client** ([critical-mind](../critical-mind/README.md)),
never speculated: each brick appears here only when a real client needs it.

## Bricks

| Namespace | What it is | Status |
|---|---|---|
| `Ledger::tally` / `Ledger::untally` | the generic append-only **ledger** primitive: `tally` pushes an entry's id into `ledger[side]` (a client-chosen side key); `untally` (the cleaner) appends to `ledger[side+'Retracted']` when the entry uncasts. The active count is `side.length − sideRetracted.length`, so a retraction is an APPEND — the ledger IS the audit trail and native cascade retraction falls out for free. | shipped |
| `Thought`, `Score`, Gate family (Threshold/Margin/Counter) | the generic reasoning concepts (design §9.3) | added as clients need them |

## Clients

- **critical-mind** — its `ProEntry`/`ConEntry` concepts tally into `ledger.pro`/`ledger.con` via `Ledger::tally`.
- **self-consistency** (planned) — its `Vote` concept tallies snapped answer-classes into `ledger.votes` via the same `Ledger::tally`, reusing the decidability margin — the cheapest proof the kernel subsumes.

## Use

Reason-kernel is a dependency of other plugins, not something a host wires directly. A dependent declares it
in `sg-plugin.json` `deps` and `require`s it (carrying it as an object); `resolvePlugins` flattens the graph.
See [`docs/plugins.md`](../../docs/plugins.md).
