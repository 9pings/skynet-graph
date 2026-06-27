<h1 align="center">skynet-graph</h1>

<p align="center">
A neurosymbolic <b>reasoning graph</b>: a structured, reactive <b>working memory</b> so an LLM can reason over
large problems in <b>bounded local steps</b> — the graph keeps the global state, the dependencies and the
justifications, while each call sees only a small neighbourhood.
</p>

<p align="center"><i>Active R&D, not a product · a CommonJS library to embed + an <code>sg</code> CLI · AGPL-3.0</i></p>

---

## What it is

Nodes and segments (directed edges) carry **typed facts**. **Concepts** are declarative JSON rules: each
*casts* facts onto an object when its preconditions hold — and **un-casts, cascading, when a premise later
falls** (truth maintenance, no hand-written rollback). A forward-chaining loop **stabilizes** the graph to a
fixpoint, and every revision is snapshotted. **Providers** (geo, a DB, a generic `LLM::complete`) do the
effectful work behind the rules.

![the typed-fact model](doc/img/model.svg)

## The point — bounded context, measured

Hard problems blow up an LLM's context window. Here the **graph is the working memory**: a problem is a path
from a start state to a goal, each step is decomposed or resolved from its *local* neighbourhood, and the best
path is summarised — so every model call sees bounded context. Measured on a real local model
(`examples/poc/bounded-context.js`), recovering one code planted in each of N document sections:

|                              | recall            | max tokens / call                       |
|------------------------------|-------------------|------------------------------------------|
| **engine**                   | **100 %** (10/10) | **894** — one shard, independent of size |
| baseline (carry-everything)  | 50 % (5/10)       | 4 286 — truncates, can't see past it     |

Per-call context stays **constant** as the problem grows — engine **O(N)** total vs a naive **O(N²)**.
*(The bound is proven by token accounting + a fair-window baseline, not by overflowing the model.)*

## Git for reasoning — reversible & auditable

Reasoning here isn't a one-shot prompt. Because every stabilization snapshots the belief state, the reasoning
itself is version-controlled — **built and tested**, not aspirational ([the V1 API](doc/API.md)):

- **`rollbackTo(rev)`** — rewind to any past revision, **concept rules included** (a rolled-back self-edit stays gone).
- **`diffRevisions(a, b)`** — see exactly which beliefs changed between two points, and pinpoint where a conclusion went wrong.
- **`fork` / `merge`** — branch a sub-agent into its own world and merge back only a snapped interface (assume-guarantee).
- **automatic retraction** — a falsified premise un-casts itself *and its consequences*, in cascade (the JTMS), with no rollback code.

So the belief state is reversible, branchable, diffable, and self-correcting — the kind of control you have over
code, applied to reasoning.

## Two ways to use it

**1 · Author a grammar by hand — the base library, no LLM.** Model a domain in declarative concept rules
(JSONC), wire deterministic providers, and let stabilization + retraction keep the belief state coherent as
data changes. Fully supported on its own. → **[doc/usage.md](doc/usage.md)** · schema **[doc/doc.md](doc/doc.md)**

**2 · The master-graph supervisor — the R&D target, built on (1).** An LLM *forges* sub-graph methods,
*crystallizes* the recurrent ones into concepts, reuses them, and **partial-collapses + re-forges** them when a
premise drifts — a bounded, auditable memory that amortises a recurrent stream, survives restarts, and ships
between deployments. → **[doc/supervisor.md](doc/supervisor.md)**

On the same core, opt-in providers add probabilistic / search-constraint / meta regimes (an architecture-level
*Mixture of Reasoners*), sub-graphs can run in worker processes, and `sg studio` is a web workbench for designing
and debugging grammars. None of it is required for use 1. → **[doc/architecture.md](doc/architecture.md)**

## Quick start

```bash
npm install        # no build step — pure CommonJS, Node 18+
npm test           # 413 tests

node bin/sg run --concepts ./concepts --builtins --seed ./seed.json
```

```js
const Graph = require('skynet-graph');

// boot from folders of concept rules + providers, stabilize, read facts:
const g = Graph.fromDirs({
  concepts: './concepts',
  builtins: true,                                  // wire the packaged geo + LLM providers
  seed: { conceptMaps: [
    { _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },
    { _id: 'b', Node: true, Position: { lat: 1.35,  lng: 103.8 } },
    { _id: 's', Segment: true, originNode: 'a', targetNode: 'b' },
  ]},
  conf: { onStabilize: g => console.log(g.serialize().graph) },   // s now carries Distance { inKm: 10728 }
});
```

The `LLM::complete` provider is backend-agnostic: inject any async `ask`, or use the bundled client
(`LLM_API=anthropic`, default; `LLM_API=openai` for vLLM / llama.cpp / LM-Studio).

## Docs

| | |
|---|---|
| [doc/usage.md](doc/usage.md) | Practical guide — concept sets, providers, the CLI, fork/rollback, distributed exec |
| [doc/architecture.md](doc/architecture.md) | How it works in depth + the vision and the honest limits |
| [doc/API.md](doc/API.md) | Public API reference |
| [doc/supervisor.md](doc/supervisor.md) | The master-graph supervisor & method library (use 2) |
| [doc/doc.md](doc/doc.md) · [doc/MODELISATION.md](doc/MODELISATION.md) | Concept-schema reference · the model + R&D roadmap |
| [doc/concept-learning.md](doc/concept-learning.md) | Learned concepts — training concept-populations at the fixpoint |
| [doc/WIP/](doc/WIP/) | The R&D trail — studies, plans, the live handoff ledger |

> **Heads-up.** Active R&D — APIs may move, and **how best to organize concepts is still open** (treat the
> shipped `concepts/` sets as illustrative, not a recommended ontology). The `concepts/` folder is the worked
> example library; `examples/poc/` holds the runnable problem-solving and supervisor demos.

## License

GNU AGPL-3.0-or-later — see [LICENSE](./LICENSE). © 2026 Nathanael Braun &lt;pp9ping@gmail.com&gt;
