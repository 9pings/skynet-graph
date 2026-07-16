# planner (C7)

The plan-loop / graph-native context-projection capability as a [skynet-graph](../../README.md) plugin. A
task too big for one context window is seeded as a graph of segments; each part reads its **bounded**
neighbourhood from the structure and completes its own prompt, order emerging from the data-flow.

**This tranche ships the GRAMMAR only**, extracted from what used to be hard-coded literals in lib code
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

The projection **engine** (`context-project.js` + its cluster `serve-leaf` / `givens` / `dag-decompose` /
`rebalance` / …) is entangled across group-4 authoring and moves into this plugin in a following tranche;
until then it loads these grammars from here.

The `CtxProj::*` / `AI::*` / `Support::*` providers are **factory-built per run** (they close over the
host's injected content functions), so there is no static `providers.js` — the manifest reserves `CtxProj`
and `Support`. `AI` is NOT claimed: it is an ambient lib namespace shared by two alternative provider
families (`makeDecomposeProviders` here, `createReasonLoop` driving `concepts/_substrate`).

See [`doc/plugins.md`](../../doc/plugins.md) and the decomposition map
`WIP/2026-07-16-authoring-decomposition-map.md`.
