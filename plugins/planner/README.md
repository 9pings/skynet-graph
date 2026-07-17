# planner (C7)

The plan-loop / graph-native context-projection capability as a [skynet-graph](../../README.md) plugin. A
task too big for one context window is seeded as a graph of segments; each part reads its **bounded**
neighbourhood from the structure and completes its own prompt, order emerging from the data-flow.

**The plugin now carries the GRAMMAR, the ENGINE and the FACTORY.** `lib/` holds the projection engine —
`context-project` (graph-native bounded-context projection), `dag-decompose` (typed needs/produces DAG),
`givens` / `leaf-io` (typed front door / leaf parsing), `rebalance` (defeasible rebalancing fixpoint),
`serve-leaf` / `higher-order` / `forest` / `slot-aware-serve` (dispatch+mount serving), `segment-proxy` /
`sound-invoke` (gated delegation), `negotiate` / `forge-fallback` / `split-serve` (bounded revision paths),
`support` (alternative-selection bracket) — moved here from `lib/authoring/` (owner: the specific goes into
its plugin). `factory.js` is the packaged `createPlanLoop` factory, reachable as `Graph.factories.createPlanLoop`.
`lib/authoring` keeps `loop.js` / `typed-loop.js` (shared with the learning family via `parametric.js`);
they load this plugin's grammar files.

The grammar sets, extracted from what used to be hard-coded literals in lib code
(owner rule: no grammar declared in code). Four sets:

- `concepts/planner/` — `Task` / `Step` / `Decompose`: the context-projection grammar, ex
  `lib/authoring/context-project.js` `CONCEPT_MAP`.
- `concepts/loop/` — `Task` / `EvalComplexity` / `Expand` / `Answer`: the "answer a (huge) prompt"
  decompose loop, ex `lib/authoring/loop.js` `loopConceptTree`.
- `concepts/loop-reactive/` — `ReportUp` / `Rollup`: the reactive bottom-up synthesis EXTENSION, composed
  over `loop` by deepmerge (the engine's `conceptSets` merge) to give `reactiveLoopConceptTree`.
- `concepts/support/` — `Propose` / `Adopt`: the support-grammar alternative-selection bracket, ex
  `lib/authoring/support.js`; `supportConceptTree` composes loop (minus `Answer`) + loop-reactive + this,
  and injects the PARAMETRIC `Select` (built from the host's criteria at call time — a generator is code,
  not a hard-coded grammar).

The `CtxProj::*` / `AI::*` / `Support::*` providers are **factory-built per run** (they close over the
host's injected content functions), so there is no static `providers.js` — the manifest reserves `CtxProj`
and `Support`. `AI` is NOT claimed: it is an ambient lib namespace shared by two alternative provider
families (`makeDecomposeProviders` here, `createReasonLoop` driving `concepts/_substrate`).

See [`docs/plugins.md`](../../docs/plugins.md) and the decomposition map
`WIP/2026-07-16-authoring-decomposition-map.md`.
