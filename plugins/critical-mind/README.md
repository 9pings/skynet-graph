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
| `brief.js` | the **judgment layer**: `buildCritiqueBrief(result)` → the bounded judgment dossier · `renderJudgePrompt(brief)` → the self-contained prompt the HOST model runs to judge (pure projection of the result — the debate machinery and its parity are untouched) |
| `sg-plugin.json` | the plugin manifest (concepts, provider namespace `Dialectic`, both factory entrypoints + the brief/judge projections) |

## Use

As a bundled foundation plugin, it is reached through the host facade — unchanged public API:

```js
const cm = require('skynet-graph').factories.createCriticalMind({ ask });            // the DEFAULT = the grammar face
const ci = require('skynet-graph').factories.createCriticalMindImperative({ ask });  // the measured reference (one release)
const r  = await cm.run({ topic: 'is X a good idea?', viewpoints: ['X helps A', 'X harms B'] });
```

The `sg mcp` `critique` tool runs the grammar face. The default flipped to the grammar face after the
GPU parity re-measure (live Q2: results, ask budgets and prompt sets byte-identical to the imperative
reference across FREE/dialectic/FR topics; grammar replay bit-identical).

## The judgment layer — the graph guarantees the arguments, the LLM weighs

Counting how many points each side scored is trivial, and a margin below the measured bound is a **stop
signal, not a proof** — weighing arguments is inherently the LLM's job. So the result projects into a
**judgment brief** for a final judge (the host's own model — with `sg mcp`, the model calling the tool):

```js
const { buildCritiqueBrief, renderJudgePrompt } = require('skynet-graph').factories;
const brief = buildCritiqueBrief(r);      // theses + verbatim witnesses + attacks/standing (KP-history)
                                          // + open/withdrawn + unused evidence + structural facts. Bounded,
                                          // deterministic, quote-faithful (nothing not verbatim in the pool).
const prompt = renderJudgePrompt(brief);  // self-contained: trust rules + the brief + a typed output format —
                                          // DECISION (incl. CONDITIONAL per dimension) · WHY citing ids ·
                                          // CERTAINTY grounded in the brief's cited structural facts · NEXT
```

Nothing here self-scores (the low-quant self-audit is refuted): the brief carries **structural facts
only**, and the certainty note is *stated by the judge, grounded in facts it must cite*. Two typed exits
keep the loop honest: `brief.iteration.addEvidence` (gather real statements for the OPEN points, re-call
with `statements`) and `brief.iteration.splitDimensions` (a **plan change**: re-call with per-dimension
`viewpoints`, forwarding `brief.carry.statements` so the same evidence **re-gates under the new frame** —
what does not survive the new perimeter is dropped by the witness gate, the cross-call analog of the
JTMS retraction). Tests: `tests/unit/critique-brief.test.js` (projection, quote fidelity, forward
round-trip, bounded output, negative controls).

As a standalone package (once published), it is a normal requireable plugin object:

```js
const criticalMind = require('critical-mind');            // the plugin object (concepts + factories)
const cfg = require('skynet-graph').plugins.resolvePlugins([criticalMind]);
```

See [`docs/plugins.md`](../../docs/plugins.md) for the plugin contract and the two load paths.
