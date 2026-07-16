# critical-mind (C9)

An external, auditable critical mind for LLMs, packaged as a [skynet-graph](../../README.md) plugin. It
takes a question and a pool of statements, **establishes** declared viewpoints through a witness gate,
**generates** the missing theses anchored by witnesses (0-fabrication), keeps everything in a typed
**ledger**, and renders a **certification-aware verdict** — mechanical only at the measured decidability
margin, otherwise an honest `UNDECIDED` with the counts.

It ships **two faces with the same signature and result shape**, parity-enforced by
`tests/unit/critique-grammar-parity.test.js` (identical results, identical ask budgets, byte-identical
prompt sets on every scripted scenario):

- **the grammar face** (`factory-grammar.js` over `concepts/dialectic/`) — the debate runs as a
  concept set on the native engine emergence. The ledger IS the graph: one admission gate for declared
  AND generated theses, LIVE verdicts (a retraction re-decides natively, both directions), the single
  generative pass encoded as a null-guard, dialectic cross-refutation as pure annotation. A new debate
  move / verdict gate / argument scheme is a FILE you drop in the set, not a code edit.
- **the imperative face** (`factory.js`) — the measured reference pipeline, kept exported as the
  fallback.

## What's in the bundle

| File | Role |
|---|---|
| `concepts/dialectic/` | the full debate grammar: Statement · Viewpoint · Explore/Retry (witness leaves) · Established (+Pro/ConEntry tally, Contested) · Frame (Brainstorm/PoolReady/Split · Uncertain/Generate · NormProbe · Verdict Pro/Con/SettledNorm) — witness gate + append-only ledger + cascade retraction, native to the engine |
| `providers.js` | `createDialecticProviders({ ask, onStage })` — the `Dialectic::` LLM leaves (cite / brainstorm / split / propose / normProbe / attack), factory-built per run (they close over the host `ask`); prompts are the measured p0 forms, byte-identical to the imperative reference. The pure ledger tally lives in the `reason-kernel` dep (`Ledger::tally/untally`). |
| `factory-grammar.js` | `createCriticalMind({ ask })`, grammar face — seed (frame + ledger + pool + viewpoints) → settle → project the result off the structure |
| `factory.js` | `createCriticalMind({ ask })`, imperative reference (establish → anchored generation → ledger → margin verdict; re-root, dialectic cross-refutation) |
| `sg-plugin.json` | the plugin manifest (concepts, provider namespace `Dialectic`, both factory entrypoints) |

## Use

As a bundled foundation plugin, it is reached through the host facade — unchanged public API:

```js
const cm = require('skynet-graph').factories.createCriticalMind({ ask });          // imperative reference
const cg = require('skynet-graph').factories.createCriticalMindGrammar({ ask });   // grammar face (same API)
const r  = await cg.run({ topic: 'is X a good idea?', viewpoints: ['X helps A', 'X harms B'] });
```

The `sg mcp` `critique` tool runs the grammar face.

As a standalone package (once published), it is a normal requireable plugin object:

```js
const criticalMind = require('critical-mind');            // the plugin object (concepts + factories)
const cfg = require('skynet-graph').plugins.resolvePlugins([criticalMind]);
```

See [`doc/plugins.md`](../../doc/plugins.md) for the plugin contract and the two load paths.
