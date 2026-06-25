# Architecture — how skynet-graph works

> **R&D.** This explains the model as it stands. The engine is stable and tested; the
> *concept-organization strategy* is open research (see [§6](#6-status--whats-r--d)).
> The authoritative model + roadmap is [MODELISATION.md](MODELISATION.md); the concept
> schema reference is [doc.md](doc.md); the public API is [API.md](API.md).

## 1. The substrate in one paragraph

skynet-graph is a **forward-chaining production system** + a **JTMS** (justification-based
truth maintenance — reactive, cascading retraction) + **demand-driven incremental
compute** (Adapton/Salsa-style), running over a **typed-fact hypergraph**. One mechanism
is reused everywhere: *everything is a fact, gated by `ensure`/`assert`*. The workload it
targets is AND/OR-graph search + bounded catamorphism (fold) — i.e. decompose a problem,
solve the leaves, roll the answer back up.

## 2. Objects and facts

Every graph object wraps an **Entity** (`obj._etty`; its raw serialized data is
`_etty._`). Three object kinds:

- **Node** — a vertex; tracks `_incoming` / `_outgoing` segments.
- **Segment** — a directed edge (`originNode → targetNode`). Most reasoning lives on
  segments (a segment is "a relation that can be enriched").
- **Document / free-node** — standalone fact carriers (e.g. a `clock`, a `budget`).

Objects carry **typed facts**: enums, ids, numbers, booleans, small structured values.
The discipline that everything keys on *discrete, typed* facts — never free prose — is
load-bearing (it is what makes the incremental memo actually hit; see [§5](#5-honest-limits)).

![the typed-fact model](img/model.svg)

## 3. Concepts — rules as data

A **concept** is a declarative JSON rule (JSONC — `//` comments allowed). Concepts form a
hierarchy via `childConcepts`; `Vertice.json` and `Edge.json` are the entry points for
nodes and segments. The schema fields (handled in `lib/graph/objects/Concept.js`):

| Field | Meaning |
|---|---|
| `require` | preconditions that must *resolve* before the concept is even considered; an unresolved require installs a watcher so the object is retested when the value appears |
| `assert` / `ensure` | boolean expressions (`&&`-joined) deciding applicability once requires hold. **`ensure` is defeasant** (installs watchers and *retracts* the concept when a premise falls); **`assert` is a one-time gate** (no watcher, no retraction) |
| `provider` | `"Namespace::fn"` (or `["ns::fn", ...args]`) — effectful work, looked up in `Graph._providers`. Signature `(graph, concept, scope, argz, cb)`, `cb(err, mutationTemplate)` |
| `applyMutations` | a mutation template applied when the concept casts |
| `type:"enum"`, `defaultValue`, `autoCast:false`, … | casting controls |

Because rules are **data**, you can add/patch/version a capability without touching the
engine, ship different concept *sets* per context (`cfg.conceptSets`), and even author
concepts at runtime (`addConcept` / `patchConcept`).

Expressions are compiled by **`lib/graph/expr.js`** — a safe `jsep`-based evaluator (no
`new Function`/`eval`; `constructor`/`__proto__`/`prototype` access blocked). `$ref`
tokens resolve via `scope.getRef(...)`. Two embedded DSLs share the `$`-syntax: reference
paths (`a:b:c` walks across linked objects; `$$x` is a global-node ref) and query/assert
expressions.

## 4. Stabilization — the loop

Mutations create/update objects and mark them **unstable**. A loop keeps applying
applicable concepts to the unstable set until nothing more can fire (the **fixpoint**),
then fires the `stabilize` event / `cfg.onStabilize`.

![the stabilization loop](img/stabilize.svg)

- **Casting** adds facts + child segments → which destabilizes followers → which triggers
  more concepts. Convergence rests on the determinism of *triggering* (forward-chaining to
  a fixpoint), not on the LLM's output being deterministic.
- **Retraction (defeasance).** When an `ensure` premise becomes false, the concept
  un-casts and its `childConcepts` un-cast in cascade; `cleaner` hooks run. This is the
  JTMS core — coherence-under-change as a *structural property*, not rollback code you
  write by hand.
- **Revisions.** Each mutation is a revision-stamped atom; `serialize()` snapshots state.
  This yields `rollbackTo(rev)` / `getRevisions()` / `getSnapshot(rev)` / `diffRevisions`
  and `fork`/`merge` — "git for reasoning" (over **data and rules**: a rollback restores
  the concept library too).

The loop is a small task sequencer (`lib/graph/tasks/taskflow.js`, a vendored zero-dep
scheduler) driving `lib/graph/tasks/stabilize.js`. Self-modification issued *mid-stabilize*
(a meta-concept patching rules) defers to the next quiescent boundary, and a runaway
re-cast loop is bounded by an apply-ceiling backstop and flagged `divergent`.

## 4b. Reasoning regimes — a Mixture of Reasoners

The same forward-chaining machine, **parameterized by the certainty algebra**, expresses four
regimes — an **architecture-level Mixture of Reasoners** over one auditable substrate, with a
deliberately-poor "narrow-waist" interface (snapped enums + a log-odds channel = a tree-
decomposition separator = an assume-guarantee contract). **Not** a weight-level MoE; everything
below is **additive** over the deterministic core and ships as host-opt-in providers:

- **D — deterministic JTMS socle** (§3–§4): the foundation.
- **P — probabilistic / log-linear**: `Semiring::reduce` folds `{__push}`ed contributions under a
  commutative semiring — `boolean` (D's "any holds"), `logodds` (certainty, readout σ), `maxplus`
  (best-path), `probor` (noisy-OR), or **`pareto`** (a multi-criteria **skyline SELECT** — keep the
  non-dominated trade-offs, no forced weighting). Order-independent ⟺ the combine is a commutative
  monoid (the coherence theorem). Plus `Stats::shrink` (hierarchical Beta-Binomial) and
  `Nogood::guard` (learned dead-ends, sound-skip).
- **C — search / constraint**: a `Solve::run` **fork** searches (a dependency-free backtracking CSP
  by default; inject Z3 / CP-SAT in prod) and merges back **only** the snapped model — search
  internals stay in the fork (barrier preserved).
- **M — meta / blackboard**: a better-model **supervisor** detects `Stuck`, hypothesizes a
  self-modification, evaluates it, and reverts cleanly if worse.

Cross-fork recombination (`Merge::combine` — sheaf-style agree/borderline/conflict bands) and
**tree-decomposition tiling** (`forkPlan` derives the candidate forks + each fork's frontier
alphabet straight off the concept-dependency graph) close the loop. D & P are literally *one fold
parameterized by a semiring* (provenance semirings, Green-Tannen 2007); the full study trail and
the on-engine experiments are in [WIP/](WIP/).

## 5. What we want to build with it

The flagship: **answer an enormous prompt without a context-window blow-up.** The graph is
the working memory; each LLM call sees only bounded local context.

![decompose → synthesize](img/answer-loop.svg)

Root segment (prompt) → **decompose** into sub-problem segments → stabilize → **synthesize**
bottom-up (bounded rollup) → answer. Built on top, as instrumented R&D rungs:

- **Canonicalization barrier (K1).** An `LLM::complete` concept writes only *canonicalized*
  (enum-snapped / grain-rounded) keys as tracked facts, the reply text on an *untracked*
  `prose` key, plus a stable digest — so two equivalent runs produce the same memo key.
- **Verification (K3, coherence ≠ truth).** `Verify::check` emits a distinct verdict fact
  (never overwrites the target); `Vote::tally` does k-of-n consensus. Verdicts gate
  downstream via `ensure`, so a refutation retracts in cascade.
- **Freshness / TTL (N1).** Time enters as a fact on a `clock` node; `ensure` invariants
  auto-retract stale facts (cache-poisoning fix).
- **Declarative AI-authoring.** `addConcept` + an author-time validator (rejects prose on
  dependency edges, missing self-flags, unparseable exprs, unknown refs) + a CEGIS loop
  (`lib/authoring/author.js`) that proposes → validates → installs → tests → refines.
- **Safe live self-modification.** A supervised loop can hypothesize a self-mod, evaluate
  it with a better-model judge, and `rollbackTo` cleanly if it's worse — re-entrancy-safe,
  backstopped, and reversible (rules included).
- **The support grammar** (`lib/authoring/support.js`). The thesis made runnable: *structure
  and search are reified in the graph, not held in the model's context*. A problem decomposes;
  each bounded atomic segment **proposes K candidate answers**; a `pareto` SELECT keeps the
  non-dominated front and picks one; a segment that stays below the quality bar (`Stuck`)
  **escalates** to a better tier; the parent synthesizes bottom-up. So a *small* local model
  need only be locally competent on a bounded sub-problem.

Two front-ends drive all of this: the **`sg` CLI** (`run` / `studio`) and the **Studio** — a
no-build web workbench (graph canvas with retraction flash, a concept↔fact **grammar graph**
with polarity + cross-corpus links + the tiling overlay, fork/split + merge-preview, timeline,
provider trace, live concept editor, and **`.sgc` corpus import/export** with a derived manifest).

## 5b. Distributed execution

Sub-graphs stabilize in **separate worker processes**; graph parts dispatch to a pool of
waiting workers. The master/client sync boundary is already plain JSON, so nothing
non-serializable crosses: a worker rehydrates from a JSON concept-map + seed + its own
provider directory, and a parent-bound model `ask` is **proxied** back over the channel —
the "a model call is a generic, templated request, dispatchable anywhere" path.

![distributed sub-graphs + ask proxy](img/distributed.svg)

## 5. Honest limits

| Limit | Mitigation built |
|---|---|
| **K1 — prose memo-fragmentation** (an LLM output feeding a dependency edge re-keys every run → cache never hits) | the typed-fact spine + canonicalization barrier |
| **K2 — terminize ≠ economy** (the fixpoint bounds *redundant* work, not the *size* of the productive tree / exploration cost) | assert-gated **budget cap**; beam/AO\* still only a cap |
| **K3 — coherence ≠ truth** (a hallucinated-but-valid fact propagates and retracts *cleanly* — rigor can give false confidence) | verification concepts + freshness/TTL |
| **K5 — one world (JTMS, not ATMS)** (compares plans only by forking) | `fork`/`merge` sub-graphs |
| **Authoring cost** (who writes/maintains the concept corpus?) | the validator + CEGIS author; **and this is the open problem — see below** |

## 6. Status & what's R&D

The **engine** is mechanically complete and heavily tested (declarative AI-authoring + safe
live self-modification included), and the **additive Mixture-of-Reasoners layer** (the P / C / M
regime providers, verification, tiling), the **support grammar**, the **Studio**, and the
`.sgc` corpus exchange are all shipped (284 tests). What remains is **open research**, and the
biggest piece is **how to organize concepts** — the current bet is a semantically-meaningful hierarchical
corpus keyed on *human vocabulary*, with judgment delegated to a better-model supervisor
while the rules handle orchestration + coherence. The shipped `concepts/common/` set is an
*illustration*, not a recommended ontology. The detailed, evolving roadmap and the critical
self-studies live in [doc/WIP/](WIP/) (start with `WIP/HANDOFF.md` and `MODELISATION.md`).
