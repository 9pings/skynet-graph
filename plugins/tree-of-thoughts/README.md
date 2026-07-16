# tree-of-thoughts

Tree-of-Thoughts beam search as a [skynet-graph](../../README.md) plugin (Tier-1: a thin driver), the
design's **class-B** shape: **the state lives in the graph** — nodes, depth, parent edges, snapped
score bands, pruned flags: inspectable, serializable, cascade-retractable — and only the **selection
policy** (a cross-sibling top-k, which a per-object rule cannot and should not express) stays
imperative, ~40 lines.

The distinctive piece is the **native cascade prune**: `Node/Live` gates on `pruned == null` AND the
parent's own `Live` flag (a recursive hop-watcher). The driver writes `pruned:1` on the out-of-beam
siblings only; the engine retracts the whole subtree — zero traversal code, the same JTMS the C9
witness gate runs on. A pruned node never costs a `propose` call (the budget claim, test-asserted).

```js
const { createTreeOfThoughts } = require('tree-of-thoughts').factories;
const tot = createTreeOfThoughts({
  propose: async (node) => [...],   // the host generator (its model)
  score:   async (node) => 0.7,     // an EXTERNAL judge — the generator scoring itself is the refuted self-audit
  beamWidth: 2, branching: 3, maxDepth: 3,
});
const { best, path, expanded, pruned } = await tot.run('the seed problem');
```

Scores are snapped by the kernel's `Scored`/`Score::band` (gates key on the K1 band, never the raw
float). Deterministic by construction (sorted frontiers/rankings, positional ids, serial awaits).
Proven by `tests/unit/tree-of-thoughts.test.js` (0-model scripted: beam keeps top-k, the prune
cascade, the expansion budget, replay determinism). See [`doc/plugins.md`](../../doc/plugins.md).
