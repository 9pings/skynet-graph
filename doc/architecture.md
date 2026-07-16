# Architecture — how skynet-graph works (Use 1, the substrate)

> **R&D.** This explains the **substrate** (Use 1 — the standalone reactive engine; see the [README](../README.md)
> for the two uses). The engine is stable and tested; the *concept-organization strategy* is open research (see
> [§8](#8-status--whats-rd)). The high-level target system built on this substrate (Use 2 — concept-graphs as
> composable methods, the durable executor, the contract) is **[concept-as-graph.md](concept-as-graph.md)**. The
> authoritative model + roadmap is [MODELISATION.md](MODELISATION.md); the concept schema is [doc.md](doc.md); the
> public API is [API.md](API.md).

## 1. The substrate in one paragraph

skynet-graph is a **forward-chaining production system** + a **JTMS** (justification-based
truth maintenance — reactive, cascading retraction) + **demand-driven incremental
compute** (Adapton/Salsa-style), running over a **typed-fact hypergraph**. One mechanism
is reused everywhere: *everything is a fact, gated by `ensure`/`assert`*. The workload it
targets is AND/OR-graph search + bounded catamorphism (fold) — i.e. decompose a problem,
solve the leaves, roll the answer back up.

The two front doors over that one engine:

```
                  ┌───────────────────────────────────────────────┐
                  │                  one engine                   │
                  │   typed facts · concepts · stabilize · JTMS   │
                  └──────────┬─────────────────────┬──────────────┘
                             │                     │
              Use 1 — the substrate       Use 2 — the target system
           (standalone, no LLM needed)     (built ON Use 1, additive)
         declarative rules over your     concept-graphs as typed METHODS
           data, to a fixpoint           bounded context per piece (zoom)
         rollback / diff / fork /        forge · reuse · compose ·
           merge on the belief state       un-learn on drift
```

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
the on-engine experiments are kept in the project's local R&D notes.

## 4c. Two levels — ecosystems and the concept population

The system factors on **two orthogonal axes** (verified against the project's local two-level-coherence
review and grammar-induction study).

**Level 1 — ecosystems (worlds).** `fork`/`merge` are boundaries between interdependent sub-worlds: each fork is a
possible world with its own concept pool and a deliberately **narrow snapped *interface grammar*** (the separator
alphabet that crosses a cut). This is the sub-problem-delegation regime — one-shot scatter-gather over nested graph
frames under an assume-guarantee contract; treewidth bounds each ecosystem's internal inference (which is what keeps it
in **P**). Reserve the word "fork" for this level.

**Level 2 — the concept population (grammar).** Inside one ecosystem a **concept is a local neighbourhood operator**: it
reads typed facts on its reference segment, its neighbours, its parent and the path's endpoints, and writes relative
updates on the same surface. On the typed-fact (K1) fragment this is provably *the same object under three names* — a
bounded-context **graph-rewriting production** ≡ a **stratified-Datalog-with-aggregation rule** ≡ a **message-passing
(GNN) layer** — with the boolean **cast** as a hard (quantized) activation, trained, when learned, by a straight-through
estimator. The population **grows** (author a variant), **hybridizes** (compose two concepts into one — a reusable
abstract method, admitted only by an MDL/utility gate), and **consolidates**: every concept carries one **plasticity**
scalar `p∈[0,1]` — the unified creativity/learning knob for *both* a small-NN concept (noise/learning-rate) and an
LLM-calling concept (temperature) — `p=1` plastic/exploring, `p=0` frozen/deterministic, annealing toward 0 as its
reliability is proven (Complementary-Learning-Systems style: fast-plastic → slow-consolidated).

**The invariants that make it safe** (and that an implementer must not break): "accumulative" means *push to a list then
fold after quiescence by a commutative monoid*, never an in-stream read-modify-write; plasticity is **control-plane** (it
modulates a provider, it never *gates* applicability — a continuous gate would shatter the memo); **selection affects
ordering/latency, never the truth of a cast** (correctness comes from the deterministic gate + the verifier); structural
evolution must **preserve the interface** (a new/merged concept may not change which facts cross an ecosystem boundary —
a treewidth-non-regression check); and a learned/plastic output must be **snapped before any gate reads it** (the single
quiet failure is a plastic output leaking onto a typed gate, collapsing the incremental memo). The structure-learning
tooling for all of this lives in [`lib/authoring/core/`](../lib/authoring/core/) (`memo-stability`, `abstraction`,
`lifecycle`) and in the `learning` plugin ([`plugins/learning/lib/`](../plugins/learning/lib/) — `mine`,
`crystallize`, `adapt`), built and tested ZERO-CORE; it is R&D, the deterministic core is the foundation.

## 4d. Learned concepts — training the population at the fixpoint

Because a population of concept-units run to a fixpoint **is** a quantized equilibrium GNN (§4c), it can be **trained**,
not just authored. A concept-unit is a **gate-NN** (decides whether to cast) × an **update-NN** (generates the value it
writes). The training subsystem (host-side, ZERO-CORE) is a small, composable pipeline:

- **The math — `equilibrium.js`.** The stabilization is a Picard iteration `z_{t+1}=F(z_t,θ)` to a fixpoint `z*=F(z*,θ)`.
  We get `dL/dθ` **without unrolling** by differentiating the fixpoint condition (Deep Equilibrium Models / implicit
  differentiation): solve the adjoint `(I−J_z)^T u = ∇_z L` at `z*`, then `dL/dθ = J_θ^T u`. Well-posed iff the iteration
  contracts (`ρ(J_z)<1`); the engine's apply-cap is the analogue of the Neumann truncation depth; the hard cast is bridged
  by a straight-through estimator (hard forward, smooth backward).
- **The substrate — `concept-net.js`.** Builds a population (`ring`/`chain`/`wide`), `train`s it end-to-end, `evolve`s its
  **form** by success (grow a unit only if it beats a utility/MDL margin), and `bakePopulation` **serves a frozen result as
  real engine concepts** (train offline plastic → freeze → bake → cascade in stabilization). A cyclic population is served
  by `unrollPopulation` (unroll the fixpoint to depth N — a direct cyclic bake would deadlock).
- **The knob — `lifecycle.js`.** One plasticity scalar `p∈[0,1]` per concept switches train↔serve (plastic→soft/explore,
  frozen→hard/deterministic) and modulates the actual provider (LLM temperature / NN noise).

This converges (a student recovers a teacher's fixpoint map), scales (2→6 units), evolves its form, and round-trips to the
real engine — all measured. **Honest limits:** it is a differentiable *mirror* + a serving bridge (the engine itself does
not train); a *chain* topology collapses in depth (use width); cyclic serving is unrolled (N× the concepts); and
non-differentiable concepts (LLM/rules) stay frozen / off-gradient (a Mixture of Reasoners, not a uniform net). Full
walk-through: **[concept-learning.md](concept-learning.md)**.

## 5. What the substrate is for — and the building blocks Use 2 leans on

The substrate's job is to be **bounded, structured, reversible working memory** so that reasoning over a large
problem happens in **bounded local steps** — the graph holds the global state, the dependencies and the
justifications, while each step sees only a small neighbourhood. The high-level system that turns this into
*composable methods with typed contracts + a durable executor* is **Use 2 → [concept-as-graph.md](concept-as-graph.md)**.
The substrate ships the pieces that make Use 2 possible, each usable **à nu**:

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
  (`lib/authoring/core/author.js`) that proposes → validates → installs → tests → refines.
- **Safe live self-modification.** A supervised loop can hypothesize a self-mod, evaluate
  it with a better-model judge, and `rollbackTo` cleanly if it's worse — re-entrancy-safe,
  backstopped, and reversible (rules included).
- **The zoom bricks (F2).** `plugins/planner/lib/dag-decompose.js` (the typed cutter prompt + archetype
  router — pieces bind through `needs`/`produces`, never free prose), `context-project.js` (the bounded
  per-piece projection; `stratComplete` is the stratified CONTEXT/DONE/ROADMAP rendering that held on
  the compound "monster" tasks), `givens.js` (the typed base-fact front door + the measured CELLS
  labelling rule), `leaf-io.js` (typed leaf value or a typed refusal — never carried garbage).
- **The support grammar** (`plugins/planner/lib/support.js`). *Structure and search are reified in the graph, not held
  in the model's context*: a problem decomposes; each bounded atomic segment **proposes K candidate answers**; a
  `pareto` SELECT keeps the non-dominated front; a `Stuck` segment **escalates** to a better tier; the parent
  synthesizes bottom-up. So a *small* local model need only be locally competent on a bounded sub-problem. This is
  the seed of Use 2's forge/compose loop.

Two front-ends drive all of this: the **`sg` CLI** (`run` / `studio`) and the **Studio** — a
no-build web workbench (graph canvas with retraction flash, a concept↔fact **grammar graph**
with polarity + cross-corpus links + the tiling overlay, fork/split + merge-preview, timeline,
provider trace, live concept editor, and **`.sgc` corpus import/export** with a derived manifest).

Above the bricks sit the delivered **capabilities** (C1–C9 — appliance, durable runner, learning
library, reactive KG, self-mod, proxy cache, plan loop, mixture serve, and **C9 `createCriticalMind`**,
the external critical mind), most of them packaged as **plugins** (§5b) whose factories are re-exported
on the flat `Graph.factories.*` catalog, and the **serving surfaces**: `sg serve` (an
OpenAI-compatible endpoint) and `sg mcp` (MCP tools, including the SOFT/HARD assistant lanes —
`hint` / `state_recall` / `state_note` / `plan_sync` vs the gate-tested `propose` — and the `critique` tool).
Per-capability maturity, the measured numbers (including the critical mind's measured decidability
bound), and the limits are consolidated in **[CAPABILITIES.md](CAPABILITIES.md)**.

## 5b. The code layout — a minimal core, capabilities as plugins

The 2026-07 decomposition split the former monolith into a small core and droppable capability plugins:

```
lib/graph/        the engine core (filesystem-free): typed facts · concepts · stabilize · JTMS · revisions
lib/authoring/    the toolkit that stays in lib — core/ (27 modules: contract, validate, author,
                  supervise, method, abstract, corpus-pack, …) + lattice/ (5: registry, glossary,
                  granularity, lattice-pack, lattice-morphism)
lib/providers/    packaged providers (geo, llm + local host, canonicalize, verify, semiring, …)
lib/plugins/      the plugin subsystem — resolvePlugins / loadPlugin / loadPlugins / definePlugin /
                  lintPluginDeps (flatten carried deps → dedup → topo-sort → semver → namespace claims)
lib/factories/       the flat factory catalog (Graph.factories.*): the assemblies still in lib (C1 appliance,
                  C4 reactive-KG preset, C5 self-mod, C6 proxy cache) + re-exports of the plugins' factories
lib/sg/ · lib/studio/ · lib/runtime/    the surfaces: CLI + serve + MCP · the web Studio · distributed workers
plugins/          the nine shipped capability plugins (reason-kernel · critical-mind · self-consistency ·
                  refinement · planner · learning · forge · durable · mixture-serve)
concepts/         the illustrative concept sets (common, _substrate, …) — not a recommended ontology
```

A **plugin** is a self-contained bundle `{ sg-plugin.json manifest, concepts/<set>/ grammar-in-files,
optional providers.js, optional packaged factory, index.js auto-export }` — and an npm package: its
`index.js` exports the plugin object via `Graph.definePlugin(__dirname, [deps carried as objects])`, so
npm + `require` do all fetching and resolution (the resolver never touches the network). Two trust
tiers: **Tier-0** (grammar + `.sgc` only, no JS — safe by construction) and **Tier-1** (JS providers —
trust required). The rule that makes the split real: **grammar lives in files, never hard-coded in JS**,
and every dependent keys on the fact names its dependency produces — the alphabet *is* the API. The
practical contract (manifest schema, dependency-cycle rule, `sg plugin list|validate|scaffold`) is
**[plugins.md](plugins.md)**; every bundled plugin validates at zero errors, enforced by the suite.

## 6. Distributed execution

Sub-graphs stabilize in **separate worker processes**; graph parts dispatch to a pool of
waiting workers. The master/client sync boundary is already plain JSON, so nothing
non-serializable crosses: a worker rehydrates from a JSON concept-map + seed + its own
provider directory, and a parent-bound model `ask` is **proxied** back over the channel —
the "a model call is a generic, templated request, dispatchable anywhere" path.

![distributed sub-graphs + ask proxy](img/distributed.svg)

## 7. Honest limits

| Limit | Mitigation built |
|---|---|
| **K1 — prose memo-fragmentation** (an LLM output feeding a dependency edge re-keys every run → cache never hits) | the typed-fact spine + canonicalization barrier |
| **K2 — terminize ≠ economy** (the fixpoint bounds *redundant* work, not the *size* of the productive tree / exploration cost) | assert-gated **budget cap**; beam/AO\* still only a cap |
| **K3 — coherence ≠ truth** (a hallucinated-but-valid fact propagates and retracts *cleanly* — rigor can give false confidence) | verification concepts + freshness/TTL |
| **K4 — incremental non-payoff zones** (numbering follows MODELISATION §8: some workloads never amortize) | STAGE-0 compose gate — measure *does the workload compose?* before investing |
| **K5 — one world (JTMS, not ATMS)** (compares plans only by forking) | `fork`/`merge` sub-graphs |
| **Authoring cost** (who writes/maintains the concept corpus?) | the validator + CEGIS author; **and this is the open problem — see below** |

## 8. Status & what's R&D

The **engine** is mechanically complete and heavily tested (declarative AI-authoring + safe
live self-modification included), and the **additive Mixture-of-Reasoners layer** (the P / C / M
regime providers, verification, tiling), the **support grammar**, the **Studio**, and the
`.sgc` corpus exchange are all shipped. The **Use-2 target system** built on top — concept-graphs as
composable methods, the durable executor, the C-contract / un-learn loop, and the **creative loop** (a library
**dispatch** over reified `FrontierSignature`s → combinator **mount** → `adaptOrForge`, so one method recombines
another's learned method by structure-mapping) — is documented in **[concept-as-graph.md](concept-as-graph.md)**
(part of the repo's 1350-test suite). What remains is **open research** + the deferred
performance work, and the biggest research piece is **how to organize concepts** — the current bet is a
semantically-meaningful hierarchical corpus keyed on *human vocabulary*, with judgment delegated to a
better-model supervisor while the rules handle orchestration + coherence. The shipped `concepts/common/` set is an
*illustration*, not a recommended ontology. The four capabilities run assembled in the shipped
**integrated demo** — `node examples/integrated-demo/run.js --replay` re-verifies its 7 checks
deterministically, no model, no GPU. The grounded model + historical roadmap is
[MODELISATION.md](MODELISATION.md); the live roadmap and the critical self-studies are kept in the
project's local R&D trail, outside this repo.
