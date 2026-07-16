# critical-mind (C9)

An external, auditable critical mind for LLMs, packaged as a [skynet-graph](../../README.md) plugin. It
takes a question and a pool of statements, **establishes** declared viewpoints through a witness gate,
**generates** the missing theses anchored by witnesses (0-fabrication), keeps everything in a typed
**ledger**, and renders a **certification-aware verdict** — mechanical only at the measured decidability
margin, otherwise an honest `UNDECIDED` with the counts.

## What's in the bundle

| File | Role |
|---|---|
| `concepts/dialectic/` | the grammar ledger-core (Statement · Viewpoint · Explore/Retry · Established Pro/ConEntry · Frame · Verdict) — witness gate + append-only ledger, cascade retraction native to the engine |
| `providers.js` | `Dialectic::tally` / `untally` — the pure (0-LLM) ledger side of the grammar |
| `factory.js` | `createCriticalMind({ ask })` — the imperative combo that drives the measured full pipeline (establish → anchored generation → ledger → margin verdict; re-root, dialectic cross-refutation) |
| `sg-plugin.json` | the plugin manifest (concepts, provider namespace `Dialectic`, entrypoints) |

## Use

As a bundled foundation plugin, it is reached through the host facade — unchanged public API:

```js
const cm = require('skynet-graph').combos.createCriticalMind({ ask });
const r  = await cm.run({ topic: 'is X a good idea?', viewpoints: ['X helps A', 'X harms B'] });
```

As a standalone package (once published), it is a normal requireable plugin object:

```js
const criticalMind = require('critical-mind');            // the plugin object (concepts + providers + combo)
const cfg = require('skynet-graph').plugins.resolvePlugins([criticalMind]);
```

See [`doc/plugins.md`](../../doc/plugins.md) for the plugin contract and the two load paths.
