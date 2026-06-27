<h1 align="center">skynet-graph</h1>

<p align="center">
An R&D <b>neurosymbolic Reasoning Graph</b> — grammar-driven, with <b>git-like reasoning
control</b> and an architecture-level <b>Mixture of Reasoners</b>. Data is enriched by a
grammar of declarative "experts" that cast and un-cast themselves as the graph stabilizes
to a fixpoint.
</p>

> [!WARNING]
> **This is active R&D, not a product.** The engine is solid and heavily tested, but
> the *model* (and especially **the right way to organize concepts is still WIP** —
> see [Concept strategy](#concept-strategy-is-wip)). APIs may move. It ships as a
> **library** to embed, plus a `sg` CLI to run it standalone.

---

## What it is

Graph objects — **nodes**, **segments** (directed edges), documents — carry **typed
facts**. **Concepts** are declarative JSON rules: each *casts* a transformation onto an
object when its preconditions hold (adding facts + child segments, which cascade-trigger
more concepts), and *un-casts* when a premise later falls. A forward-chaining
**stabilization** loop runs to a fixpoint. **Providers** (geo, DB, and a generic
`LLM::complete`) do the effectful work behind the rules.

![the typed-fact model](doc/img/model.svg)

Underneath, it is a well-known trio wired together: a **forward-chaining production
system** + a **JTMS** (justification-based truth maintenance — reactive, cascading
retraction) + **demand-driven incremental compute** (Adapton/Salsa-style), over a
typed-fact hypergraph. The bet is that this is a good substrate for **long-horizon,
auditable AI reasoning** where coherence-under-change matters.

### Stabilization & retraction — the heart

![the stabilization loop](doc/img/stabilize.svg)

A mutation marks objects unstable; the loop matches applicable concepts and casts them,
which writes facts that trigger yet more concepts — repeat until nothing fires. When an
`ensure` premise later becomes false, the concept un-casts and its consequences un-cast
in cascade, with no hand-written rollback. State is revisioned, so you also get
`rollbackTo` / `diff` / `fork` / `merge` — "git for reasoning".

## Reasoning regimes — a Mixture of Reasoners

In clear, the engine is an **architecture-level Mixture of Reasoners** (single auditable
substrate + a deliberately-poor "narrow-waist" interface — snapped enums + a log-odds
channel; **not** a weight-level MoE). Four regimes ride the *same* forward-chaining machine,
parameterized by the certainty algebra, and are all **additive** over the deterministic core
(host opt-in providers — see [doc/API.md](doc/API.md)):

- **D** — the deterministic JTMS socle (above).
- **P** — probabilistic / log-linear: `Semiring::reduce` folds `{__push}`ed contributions under
  a chosen commutative semiring (`boolean`/`logodds`/`maxplus`/`probor`, or **`pareto`** — a
  multi-criteria skyline SELECT), plus `Stats::shrink` (hierarchical Beta-Binomial) and
  `Nogood::guard` (learned dead-ends).
- **C** — search / constraint: a `Solve::run` **fork** searches (backtracking / inject Z3/CP-SAT)
  and merges back only the snapped model.
- **M** — meta / blackboard: a better-model **supervisor** detects `Stuck`, hypothesizes a
  self-modification, and reverts if it doesn't help.

Verification (`Verify::check` + `Vote::tally`), cross-fork recombination
(`Merge::combine`), and tree-decomposition **tiling** (`forkPlan` derives the forks + their
frontier alphabets) round it out. The composite — deterministic structural retraction of
LLM-derived facts + a typed-fact-keyed memo + a bisectable belief state — is the bet.

## The problem-solving grammar — what's built

The flagship use is to **solve a problem (or answer an enormous prompt) without a
context-window blow-up**: the graph is the working memory, and **every** call sees only
bounded local context.

![the decompose → synthesize answer loop](doc/img/answer-loop.svg)

A problem is a **segment from a START state to a GOAL state**. Concepts apply *on* a segment
and **decompose or resolve** it using only its **local neighbourhood** — its endpoint states,
its parent step, and a bounded window of the previous resolved steps. The grammar is built and
*measured* (deterministic stub tests with negative controls + real-LLM verification), in
`examples/poc/problem-*.js`:

- **Decompose → best path.** `Plan` proposes alternative intermediate states, `Select` scores
  them and marks the winning sub-path; only the chosen path recurses, the losers stay inspectable.
- **Adjacency spine.** A `reached` hand-off forces resolution in path order and feeds each step
  its predecessor; a bounded **K-step window** (`trail`) gives a recent-history horizon at
  *constant* context size.
- **Backtrack / escalation.** A dead-ended step bubbles a `Stuck` signal to its deciding segment,
  which adopts the next-best untried alternative (re-using stored scores) or escalates to its own
  parent — AO\*-style search with nogood, composed from `{__push}` fan-in + the ensure-gated
  iterative-trial re-cast (no core change).
- **Typed-domain grounding.** A domain corpus types states by a discrete `kind` enum (a **DAG of
  kinds** — e.g. an online DB migration: downtime / expand-contract / blue-green routes), so an
  in-vocabulary problem is solved by the *same* engine at **0 LLM calls**; the model is spent only
  on genuine gaps (measured: +1 call per missing operator), and a feasibility wall (a zero-downtime
  SLA) makes the search backtrack to the right alternative route.
- **Delegation & parallelism.** A self-contained sub-problem is **delegated** to a forked sub-agent
  (its own concept pool under a distinct namespace; only the bounded plan crosses back, through a
  frontier-checked boundary) or to a real **worker thread** (the model `ask` proxied to the parent);
  **competitive rollout** elaborates N alternatives concurrently and selects by *realized* cost
  (it beats a greedy heuristic exactly when the static prior mis-ranks).

**Measured:** per-call context is **constant** as the problem grows, vs a naive carry-everything
baseline that grows linearly (engine O(N) total vs baseline O(N²)); on a small local model, an
8-step *legacy → PyPI package* plan and a *"p99 latency, cause unknown" → "root cause found + fix
deployed"* diagnostic each decompose into a coherent ordered chain, every call on bounded context.

On top of the core the R&D also built: a **canonicalization barrier** (typed facts, not prose, on
dependency edges — so the memo actually hits), **verification** concepts (coherence ≠ truth →
checkers + voting), **freshness/TTL** as facts, **declarative AI-authoring** (`addConcept` + a
validator + a CEGIS loop), and **safe live self-modification** (a meta-concept patches the rules
mid-run, bounded and reversible).

### An adaptive method, records as instances

Stepping back, the graph **builds a METHOD** — a structured, reusable, *live-modifiable*
representation of how to go from state A to state B (the AND/OR graph above: **AND** = parallel
sub-tasks + a join, **OR** = competing lenses that get pruned). External DB **records then flow
through that method as instances** — formally a *workflow net + its cases*. The method is
**adaptive**: it *crystallizes* recurrent, canonicalizable structure into named concepts and is
refined by the supervisor — it learns from the instances flowing through it.

A **derivation cache** (`providers/cache.js` — additive, zero-core) makes this affordable: a
provider's result is content-addressed on the **canonical justification** of the cast, so a
retract→re-derive (which would otherwise re-run the model) becomes a hash lookup, and a **second
identical instance runs at ~0 model calls** (measured: warm = 0 vs cold = 48 calls, while a
genuinely different instance correctly pays full price — it keys on the justification, never a
false replay). It is the fast/episodic half of a Complementary-Learning-Systems loop whose slow
half (`crystallize`) was already built. The full design + the blocking points are in
[doc/WIP/studies/2026-06-27-method-instance-workflow-cache-control.md](doc/WIP/studies/2026-06-27-method-instance-workflow-cache-control.md).

The honest line (from that study): the engine is a **reactive, retractable belief-view** over
snapshotted records — *not* a durable workflow executor. For real durability it sits **atop** one
(the cache is the idempotency key); at high volume it **compiles/crystallizes** the method while a
stream engine runs it. The defensible niche is *typed, defeasible, auditable, versioned* belief-
retraction over external records — what value-IVM systems (Materialize / DBSP) don't provide.

**The capstone — the master-graph supervisor.** Where this is all heading: a master graph that *is*
an LLM supervisor's bounded working context — it distils LLM knowledge into typed methods, switches
each between a live graph and a frozen workflow, retrieves a matching method when one exists (else
forges one), and **partial-collapses + re-forges** a method when its guaranteeing values drift. The
keystone that makes a method a re-mountable, transferable graph (cross-problem structural transfer,
sound) is built — `lib/authoring/abstract.js` (the F6 abstractivation, on the engine-native
`Graph#getMutationFromPath`). The full formalization, feasibility map, hard lines, and the next-build
PoC are the canonical capstone study:
[doc/WIP/studies/2026-06-27-master-graph-supervisor.md](doc/WIP/studies/2026-06-27-master-graph-supervisor.md).

## Run it distributed

Sub-graphs can stabilize in **separate worker processes**, and graph parts can be
dispatched to a pool of waiting workers. Nothing non-serializable crosses the boundary:
a worker rehydrates from a JSON concept-map + seed + its own provider directory, and the
one effect that can't be shipped — a parent-bound model `ask` — is **proxied** back.

![distributed sub-graphs + ask proxy](doc/img/distributed.svg)

## Observability

Every graph owns a leveled logger (`graph.logger`: `error > warn > log > info > verbose`, sinks,
`tail(n, {concept|applyId})`, a bounded ring buffer). Providers log with context via `scope.log` /
`concept.log(scope)` — apply-correlated, so you can pull *the logs a concept produced while applying*
without storing anything on the graph. The `sg` CLI (`run` and `studio`) prints a boot banner and a
live **status bar** (graph state, unstable node/segment counts, main-loop queue, rev, applies) over
scrolling colored logs, with `--log-level` / `--log-mode dashboard|plain` / `--log-file <.jsonl>`;
worker sub-graphs forward their logs to the parent. See [doc/API.md](doc/API.md#logging--diagnostics).

## Studio — the web workbench

`node bin/sg studio` opens a no-build (React-over-CDN) browser front-end for designing and
debugging grammars and their interactions: the **data canvas** (cast flags, a pulse on the
last apply, a **red flash on retraction**), a second **grammar graph** view (concept↔fact
flux — produced/consumed facts with **polarity**, cross-corpus links, silent fact-collisions,
the tiling overlay), the **fork tree** + **sub-graph split** (parent ↔ fork side by side, with
a checked merge preview), the **revision timeline** (rollback / diff), a **provider trace**, a
live **concept editor**, and **`.sgc` corpus import/export** (a portable bundle + derived
manifest — the provides/consumes alphabet, required providers). Embeddable via
`Graph.createStudioServer({ … })`. See [doc/usage.md](doc/usage.md#the-studio-sg-studio--the-web-inspector--console).

## Quick start

```bash
npm install            # no build step — pure CommonJS, runs natively on Node 18+
npm test               # 365 tests (node:test)

# run a graph standalone from plain folders (live status bar + colored logs on a TTY):
node bin/sg run --concepts ./concepts --builtins --seed ./my-seed.json
node bin/sg run --concepts ./concepts --builtins --log-level verbose --log-file run.jsonl
```

```js
const Graph = require('skynet-graph');

// boot from directories (concepts + providers), stabilize, read facts:
const g = Graph.fromDirs({
  concepts: './concepts',          // a folder of concept-set sub-dirs
  builtins: true,                  // wire the packaged Geo + LLM providers
  seed: { conceptMaps: [ /* nodes, segments, facts */ ] },
  conf: { onStabilize(graph) { console.log(graph.serialize().graph); } }
});

// or dispatch a sub-graph to a separate worker process:
const snapshot = await Graph.spawnGraph({ conceptMap, geo: true, seed });
```

The packaged `LLM::complete` provider is backend-agnostic: inject any async `ask`, or use the
bundled client (`LLM_API=anthropic` → `/v1/messages`, default; `LLM_API=openai` →
`/v1/chat/completions` for vLLM / llama.cpp / LM-Studio, with reasoning-model handling).

See **[doc/usage.md](doc/usage.md)** for the full guide (concept sets, providers, the CLI,
history/fork/rollback, `patchConcept`, the Studio, distributed execution).

## Concept strategy is WIP

The engine is the substrate; **how to organize concepts is the open research.** The
current bet is a semantically-meaningful, hierarchical corpus keyed on **human
vocabulary** (`Stuck`, `Supervisor`, …), with the *judgment* delegated to providers (a
better-model supervisor) while the rules handle *orchestration and coherence*. Treat the
shipped `concepts/common/` set as an illustrative example, **not** a recommended ontology.
Authoring-and-maintenance cost is the dominant risk; the validator + CEGIS authoring loop
exist to attack it. This part will change.

A second, **complementary** attack on the authoring cost is to **learn** concepts rather than
hand-write them: a concept is provably an MPNN layer (a hard cast = a quantized activation), so a
*population* of concept-units (each a gate-NN that decides whether to cast × an update-NN that
generates the value) run to a fixpoint is a quantized equilibrium GNN — trainable end-to-end by
**implicit differentiation (DEQ)**, growable by success, and **bakeable back into the real engine**
(train offline plastic, serve frozen). All host-side and zero-core. See
[doc/concept-learning.md](doc/concept-learning.md).

## Documentation

| Doc | What |
|---|---|
| [doc/architecture.md](doc/architecture.md) | How it works, in depth + the vision and honest limits |
| [doc/usage.md](doc/usage.md) | Practical guide — embedding, concept sets, providers, CLI, distributed exec |
| [doc/API.md](doc/API.md) | Public API reference (construction, lifecycle, history, fork/merge, patchConcept) |
| [doc/MODELISATION.md](doc/MODELISATION.md) | The model + the prioritized R&D roadmap |
| [doc/concept-learning.md](doc/concept-learning.md) | **Learned concepts** — training a population of concept-units at the fixpoint (DEQ), plasticity, serving them in the engine |
| [doc/doc.md](doc/doc.md) | Concept-schema & DSL specification (reference) |
| [doc/WIP/](doc/WIP/) | The R&D working trail — critical studies, ideation, plans, the live handoff ledger |

## Layout

```
lib/
  graph/        the engine (filesystem-free, portable core) — Graph, objects, tasks, expr
  providers/    packaged effectful providers — host opt-in: geo, llm, canonicalize, verify,
                semiring (incl. pareto/skyline), stats, nogood, merge-consistency, solver-fork, constat,
                cache (content-addressed derivation memo — additive, zero-core)
  authoring/    loader + validator + CEGIS author + supervise + decompose/forkPlan (tiling) +
                grammar-graph + corpus-pack (.sgc) + support (the support grammar) + ste + clock +
                LEARNED CONCEPTS: equilibrium (DEQ) + concept-net (population, train/evolve/bake/unroll)
                + lifecycle (plasticity) + memo-stability + abstraction + mine + crystallize
  studio/       the web workbench (http+ws server, session registry, no-build React UI)
  sg/           the `sg` CLI (`run` / `studio`) + trace inspector
  runtime/      distributed sub-graphs (worker_threads + ask-proxy)
  load.js       directory loaders ;  index.js  the package facade (Graph + fromDirs + statics)
concepts/       example concept sets — common, _substrate (universal spine), clinical, supply
examples/       runnable demos (run-basic / run-prompt / run-problem) + poc/ (the problem-solving
                grammar: problem-paths / -domain[-dag] / -delegate / -compete / -adjacency / -bounded /
                -worker, and cache-instances — the method/instance derivation cache)
bin/sg          CLI entry
```

## License

GNU AGPL v3 — see [LICENSE](./LICENSE).

Copyright 2026 Nathanael Braun &lt;pp9ping@gmail.com&gt;
