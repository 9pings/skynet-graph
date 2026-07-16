# planner (C7)

The plan-loop / graph-native context-projection capability as a [skynet-graph](../../README.md) plugin. A
task too big for one context window is seeded as a graph of segments; each part reads its **bounded**
neighbourhood from the structure and completes its own prompt, order emerging from the data-flow.

**This tranche ships the GRAMMAR only** (`concepts/planner/` — `Task` / `Step` / `Decompose`), extracted
from what used to be a hard-coded `CONCEPT_MAP` inside `lib/authoring/context-project.js` (owner rule: no
grammar declared in code). The projection **engine** (`context-project.js` + its cluster `serve-leaf` /
`givens` / `dag-decompose` / `rebalance` / …) is entangled across group-4 authoring and moves into this
plugin in a following tranche; until then it loads this grammar from here.

The `CtxProj::step` / `CtxProj::decompose` providers are **factory-built per run** (they close over the
host's injected `serve`), so there is no static `providers.js` — `createContextProjection` supplies them and
the manifest only reserves the `CtxProj` namespace.

See [`doc/plugins.md`](../../doc/plugins.md) and the decomposition map
`WIP/2026-07-16-authoring-decomposition-map.md`.
