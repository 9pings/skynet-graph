# Concept-as-graph — the target system (Use 2)

> **Audience:** a reader who knows the substrate (Use 1 — a rule-driven graph that stabilizes typed-fact concepts
> to a fixpoint, with JTMS retraction and git-like revisions; see [architecture.md](architecture.md)) and wants
> the high-level goal built on top of it. Everything here is **host-side and ZERO-CORE** — it does not touch
> `lib/graph/`, and it is **additive**: Use 1 needs none of it. The canonical, specialist-confronted design and
> the build LOGs are kept in the project's local R&D notes. This doc is the durable summary.

## 0. The thesis, in one paragraph

A hard problem blows up an LLM's context window. The fix here: a learned **concept-graph is a method** — a
reusable sub-graph that goes from a parameterized state **A** to a parameterized state **B**. To its *user* it is
a single black box with a **typed contract**; to its *author* it is a body of productions. A supervisor goes from
a human formulation to executed cases by **composing / forging / refining** methods, and **the bounded context is
the abstraction barrier** — you carry the *contract*, not the *body*, opening a box only to refine it. Bounded
throughout by **K1**: only recurrent, typed, canonicalizable structure amortizes; genuinely novel reasoning stays
in the model.

![the two uses](img/two-uses.svg)

## 1. The core object — a two-faced method

![a concept-graph is a two-faced method](img/concept-as-graph.svg)

A concept-graph is a **two-faced** object (formally an HRG non-terminal — Habel 1992; Drewes-Kreowski-Habel 1997):

- **Outer face — a method with a defeasible typed contract.** A *separation triple* (O'Hearn-Reynolds-Yang 2001):
  a **read-footprint**, a **write-footprint**, a **precondition** over the reads, a **postcondition** over the
  writes, and an **effect** tag. This is the black box a caller composes on. It is **defeasible**: for a *learned*
  method the post is an induced hypothesis — sound on observed cases, possibly wrong on the next — so the contract
  gives **eventual soundness** (assume-at-compose, **assert-at-runtime**, retract-and-blame), not static soundness.
- **Inner face — productions.** The concrete ways to realize A → B: `for` / `while` / `map` / `fold`. The grammar
  over these productions is decidable; their *execution* over runtime-sized data is a fuel-bounded executor
  (Turing-complete, totalized by a step budget). **Two regimes, never one badge.**

### Parameterization — typed named slots
A method is parameterized by other sub-graphs (the loop *body*, a predicate, an accumulator). This is
**higher-order in power, first-order in mechanics**: we never *infer* a body (undecidable — Huet 1975), the engine
*supplies* it by name → substitution. Four invariants keep it decidable and are **checked** by a lint
(`lib/authoring/method.js#lintMethod`): every slot is **(a) named (b) K1-typed (c) bound-by-ref, never solved-for
(d) tentacle-fixed**. The role of a slot — a **param** (typed, part of the contract + memo key) vs a **`coll`**
(the cases iterated over, *excluded* from the key) — is assigned by the method, not intrinsic to a field. Building
blocks: `applySubgraphArg` / `mapTemplate` (apply a sub-graph param, fan a body per element with fresh ids),
`selectCluster` (case-parameterized selection by typed gates).

The frontier itself is **declared, not inferred**, and **reified** as a first-class `FrontierSignature` on the
crystallized schema (`schema.frontier`, a sibling of `schema.contract` — it serializes with the tree and round-trips
through rollback): `{ params:[{name, sort, field, role, requiredFacts}], summaryFacts, appConditions }`. A param's
**`sort ∈ node-ref | method-ref | predicate-ref`** makes an endpoint and a *behavioral* param (a sub-method body, a
stop predicate) the **same** relativize/instantiate hole differing only by `sort` — so the library becomes an algebra
of combinators, dispatch is keyed on the canonical interface, and an untyped behavioral param is rejected at author
time (`lintFrontier`, reusing the lint above). `summaryFacts` (the sound post the abstraction barrier carries) and
`appConditions` (the parent NACs) are the index's discriminants.

## 2. Bounded context = the abstraction barrier

Composing abstract method-faces means **carrying the typed contract, not the body** — so the method library and
the bounded-context engine are *the same mechanism*. This is **by discipline, not automatic**: a bounded
projection at every join (`bounded-merge.js#boundedProject` crosses only the declared separator alphabet Σ_sep,
not the whole child), digests-not-bodies in the supervisor's context, and it is **only as strong as the
contracts** — an incomplete contract forces opening the box, and the bound is gone. The one principled bridge from
human prose into a typed goal (domain-recognize → decompose to start/goal → snap to vocabulary → out-of-vocab
gate) is the system's **soundness boundary** (still open — see §8).

## 3. Forge · reuse · compose — tools-from-tools

The library grows by a **wake/sleep** loop (DreamCoder, Ellis 2021; EBG, Mitchell 1986):

- **WAKE** — the supervisor selects + composes existing methods (path-search / HTN, gated by the typed contracts).
  0 model calls in-vocabulary; +1 bridge call per genuine gap.
- **SLEEP** — real **case traces** → **anti-unification / LGG** (Plotkin 1970; Stitch, Bowers 2023) → a typed
  parameterized method → the library. Admission is **MDL-gated in model-call currency** (`abstraction.evaluate`
  scores model calls, not `applies`), **memo-surface-preserving** (`memo-stability.js`, fail-closed), and
  **non-overlap / priority-ordered** (a distilled method's pre must be disjoint from incumbents, or it creates a
  critical pair that breaks composition-confluence — Plump 1993).
- **The multiplier — tools-from-tools.** The human capacity is to forge a composite tool (a non-terminal that
  isn't a primitive), then compose tools into bigger tools. That recursion lets a **K1-bounded** library punch
  above its ceiling: few typed composites → a huge combinatorial space, no single combination novel.
- **The micro-task floor.** Everything decomposes until each leaf is **either a cached/typed method OR a micro-task
  a small fast LLM does easily**. A *missing* contract is not a failure — drop a small-LLM micro-task in its place.
  So contract coverage is a **cost/coverage gradient**, not a soundness cliff (the runtime assert still guards).

The abstractivation tooling (`abstract.js`): `relativize` / `instantiate` (created ids → holes, frontier refs
bound at the call site), `antiUnify` (the Plotkin LGG soundness check), `emitMethodAsSubgraph` (serialize a
derived sub-graph into a re-mountable parameterized method via the engine-native `Graph#getMutationFromPath` — the
generalization of travel-path mounting). This is what makes cross-problem **structural** transfer sound + non-zero
(it was zero with a flat cache — the absolute ids didn't transfer).

The crystallizer's frontier is **declared, not inferred** (`mine.js#declaredCtx` reads each endpoint off its declared
field rather than scanning the literal-id surface gated on `knownIds`) — fixing the `$`-ref-endpoint and k-ary cases
the scan missed, and reifying the `FrontierSignature` (§1). Declaring re-opens an id-space hazard the `knownIds` scan
closed by construction, so a **soundness gate** refuses any method whose parameterized form would leak a learning id at
replay: an **un-holed** segment endpoint (an endpoint the declaration missed), a **base-prefix phantom** (an external
id colliding with `<base>_…` that `relativize` mis-folds into the base id-space — `hasHoles` cannot see it), or two
endpoints that **collapse** to one hole by value-coincidence. Each refusal was adversarial-review-reproduced; together
they restore *every created segment endpoint is base-derived or a bound, distinct frontier hole*.

## 4. Build / execute — the graph designs the method, a durable engine runs it

![build / execute separation](img/build-execute.svg)

- **The graph BUILDS + TESTS the method** (the belief-view: decidable, traceable, defeasible). In-graph
  "execution" is *validation* of the algorithm on cases — concepts advanced by the one stabilization loop.
- **A separate durable WORKFLOW ENGINE EXECUTES** a compiled translation of the validated method (durable,
  crash-resumable, at scale). This is the **belief / durable boundary**: the belief-view is a reactive view over
  case *progress*; durable effects + exactly-once + crash-resume live in the executor underneath.

The durable executor (`lib/durable/`, ZERO-CORE, two backends — in-memory + `node:sqlite`):

| Piece | Role |
|---|---|
| **`checkpoint-store.js`** (Layer A) | the durable **marking** — tokens(runId, recordId, placeId, status, …) walked through a workflow-net; the content-addressed **memo** (key = FactsDigest, the durable sibling of `cache.js`); the createdRefs rollback set. Crash-safety = lease-expiry + `rollbackInflight`, with a **fencing token** (a monotonic persisted leaseId) so a re-claimed lease can't be corrupted by a zombie worker. |
| **`xlate.js`** (C-xlate) | `compileMethod(spec) → net` — a method spec → a workflow-net `{select, task, map, join, fold}`; `validateNet` is a structural lint. |
| **`interpreter.js`** (Layer B) | `runFlow(store, runId, net, …)` drains case records as tokens: typed `select` routing (via `expr.js`), content-memoized `task` micro-tasks, `map` fan-out, the fold-back **JOIN** (the cardinality fan-in), per-case determinism, fuel-bounded termination. |
| **`fold.js`** | the JOIN's monoid algebra (via `semiring.js`) — a commutative monoid fold is **order-independent** (non-deterministic throughput, deterministic belief); `concat`/`merge` are element-index-sorted. |
| **`audit.js`** (C-audit) | read-only inspection — the **derivation forest** per record, the verdict (done/failed/pending), the **blame** traceable to the exact step, run totals. The audit trail no surface-similarity store can give. |

**Soundness in the executor:** a **map ∘ reduce** equals the open-the-box computation; the JOIN is crash-resumable
at every cut; a failed shard **fail-fasts** its group (never a silent partial fold); a per-step **contract guard**
asserts the post *before* commit (a wrong learned post is quarantined, never committed downstream). Measured: a
recurrent 24-case stream costs **6 model calls vs 24** for retrieve-and-adapt, **12/12 correct on a mid-stream
drift vs 0/12** (stale), replaying across a process restart at **0 calls**.

## 5. Soundness under composition — C-contract & the un-learn moat

`lib/authoring/contract.js` is the defeasible separation-triple checker — the "central hole" of the conception,
built behind a specialist confrontation (theory / engine / adversary):

- **Assume at compose-time.** `checkCompose(M1, M2)` checks `post(M1) ⊨ pre(M2)` over every shared fact, by
  **per-key abstract-domain entailment** (interval + finite-domain — Cousot-Cousot 1977; **not** atom-by-atom, so
  `x>3 ∧ x<5 ⊨ x==4` and `x≥5 ⊭ x≥7` are both decided right). It **never false-accepts**: anything out of the
  monadic, ground fragment (disjunction, two-key relations, non-ground footprints, an under-determined post) →
  **`escalate`** (open the box / a micro-LLM), never a silent pass.
- **Assert at runtime.** `assertPost` is the runtime monitor — in the executor (assert-before-commit) and in the
  belief-view (the post realized as an `ensure`). Plus the gates the entailment structurally can't do: **G1**
  frame-completeness (the keys the body *actually touched* ⊆ the declared write), **G2** the effect-tag (an
  `external` post must be confirmed by a ground-truth oracle, not the internal fact), **G3** footprint-cycle
  rejection (Tarjan-SCC — no JTMS oscillation).
- **Retract + blame + revise = the moat.** On a violation the **JTMS retracts** the method (belief-view) or the
  executor **quarantines** the token (blame reason), and `reviseOnBlame` **specializes the precondition** with the
  counterexample's discriminating atom (CEGIS — not method removal). `satisfies` then excludes the failing case
  from selection while still admitting the valid ones. **This is principled UN-learning** — the differentiator no
  prose memory / RAG / skill-library has: a stale skill in a vector store stays retrievable; here the typed
  premise is *in* the belief, so when it falls the derivation retracts and the library narrows the method's claim.

The whole loop — **assume-compose / assert-settle / retract-blame / revise** — spans the build, execute, **and**
belief layers, on the real engine (`examples/poc/contract-compose.js`, `durable-contract.js`, `contract-unlearn.js`).

## 6. The supervisor control loop & the library

`authoring/master-loop.js` — a standing controller that climbs a **value-of-computation ladder** per problem and
takes the first arm that resolves at acceptable cost:

```
  MATCH    exact cache hit on the K1 signature              → 0 model calls
  RETRIEVE fuzzy recall → typed VERIFY                      → 0 (full) or partial cost
  FORGE    fork + LLM + crystallize into the library        → full cost; warms the library
  ESCALATE a method deopted K times → always re-forge / LLM → full cost, never cached (the floor)
```

| Module | Role |
|---|---|
| **`recall.js`** | FUZZY-RECALL → TYPED-VERIFY. Recall orders (embedding/similarity); verify admits (`full`/`partial`/`reject`). A high-similarity but structurally-different method is **rejected**, never falsely replayed — *fuzziness in recall, exactness in truth*. |
| **`mount.js`** | the 3-regime MOUNT policy: **instance** (fork-per-case, the safe default) / **inline** (`addConcept`, read-only frontier only) / **frozen** (warm-cache replay + deopt-guard) / **escalate** (the K1 floor), with hysteresis + a well-founded deopt-rank (termination). |
| **`../providers/cache.js`** | the derivation cache — content-addressed memo over a provider, keyed on the canonical justification of a cast (the fast/episodic half of CLS; the durable sibling lives in the executor's memo). |
| **`crystallize.js` · `mine.js` · `abstraction.js` · `memo-stability.js`** | FORGE → library (§3): mine producer→consumer chains, compose, MDL-gate, install fail-closed. |
| **`reaggregate.js`** | defeasible RE-AGGREGATION — a cleaner-on-retract un-pushes a contribution + re-folds, so a derived *summary* (not just the belief) updates on drift. |
| **`library.js`** | the **O(1) dispatch index** (consume `libraryKey`): given a target `FrontierSignature` (the abstract mechanism), a bucket lookup → refine by application-conditions over the call-site → **ranked** candidates (weighted). A *lookup*, **never a corpus search** (HRG-parsing is NP-complete — Lange-Welzl 1987). This is the structuring↔concept-DLL juncture. |
| **`combinator.js`** | the dispatch→**MOUNT** bridge: a higher-order concept fills its behavioral hole with a dispatched fragment via require-resolution + `applySubgraphArg` — so a concept **reuses another's** learned method when their signatures match (recombination at 0 calls). The re-fire guard is a distinct durable fact, **not** the self-flag (the `_name` marker uncasts on de-apply). |
| **`adapt.js`** | `adaptOrForge` — the retrieve-or-forge drive *over* the dispatch: RETRIEVE (a template for this signature = a hit, 0 calls) / FORGE-or-ADAPT (the model builds it, reusing dispatched neighbours = structural reuse + content forge) / VERIFIER-GATE (a sound contract) / index-back (**amortise**: the next encounter hits). The structure-mapping realization of the ladder above. |

**The two grammars are one, in two levels.** The supervisor's abstract mechanism is the *structuring* grammar (abstract
productions with non-terminal holes); the library is the *concept-DLL* grammar (learned terminals). They are not rivals
to reconcile (that implies a costly translator) but **two levels of one graph-grammar**; their juncture is a
**K1-canonical interface alphabet** — the `FrontierSignature` + app-conditions, a *snapped separator* (the impedance is
at the entrance: a prose scaffold needs C0; a typed scaffold couples cleanly). Formally this is **structure-mapping**
(Gentner 1983: the abstract mechanism = the relational structure, library methods = source domains, a dispatch = the
analogy) and **conceptual blending** (`antiUnify` = generalize-and-rebind). The result is **combinational + exploratory
creativity** (Boden 1990) over a learned grammar — *verifier-gated search*, with the genuinely-novel primitive deferred
to the model (K1) and a slow *transformational* loop alongside (crystallization invents new non-terminals).

**Persistence & portability** (`store.js` · `method-pack.js`): the warm library survives a restart (a write-through
`store` re-loads + replays at 0 calls) and **ships between deployments** as a `.sgc` **method package** (the sibling
of the authored-grammar `corpus-pack`). The version gate covers **both** replay paths (a stale-version method never
replays verbatim); the typed verify re-gates on the receiver, so a structurally-foreign method is rejected.

## 7. The two decidability regimes (keep them honest)

1. **A decidable method GRAMMAR** above (composition / parameterization — first-order named slots, a well-founded
   mount-rank). **2. A fuel-bounded EXECUTOR** at the case layer (while / fold over runtime-sized data =
   Turing-complete, totalized by a step budget; exhaustion is a *cutoff*, not a fixpoint). Determinism of
   *triggering* gives **confluence**, not termination, not decidability of plan-existence (recursive-HTN
   plan-existence is undecidable — Erol-Hendler-Nau 1996). Never one badge for both regimes.

## 8. Status & honest lines

**Built + measured (2026-06-30, ZERO-CORE throughout, 669 tests):** the middle spine (Bricks 1–3:
applySubgraphArg / lintMethod / selectCluster), the abstractivation slice (F6), the durable executor (Layer A +
B + the fold-back JOIN + fail-fast / fold-survivors / nested-fold + C-fail retry/escalate + audit), C-xlate,
C-contract (the checker · the §11.6 composition-soundness probe · the executor guard · the belief-view un-learn loop
· the **standing autonomous** revise loop, `relearn.js`), **C0 prose-intake** (the soundness front-door, `intake.js`),
the crystallization **structural miner** + the **declared-frontier** crystallizer with its reified `FrontierSignature`
(§1, §3), the supervisor loop + recall / mount / cache / reaggregate, and the **creative loop** (library **dispatch** +
combinator **mount** + `adaptOrForge`, §6), persistence + `.sgc` packs. The §11 stream gate **passes** on a live local
model (call-elision + wall-clock + durability + drift-soundness).

**Still genuinely open (gated):** a **real-model streaming `adaptOrForge`** measurement (calls × correct-under-drift,
like the paper's STRUCT arm but structure-mapping-driven); the **antiUnify content-forge** adapt built *into* the
controller (today the host's forge labels adapt vs fresh); the **EAGER in-core `SubGraph`/`ZoomSegment` object**
(fold/zoom/residency — orthogonal to recombination, higher-risk; FILED, gated on a measured residency need — the seam
map is in the R&D notes); and the deferred **performance** work (fork deep-copies the whole graph per case →
bounded-seed; Stitch corpus-global MDL > greedy mining).

**Hold these lines.** *Eventual*, not static, soundness for learned methods — via a load-bearing runtime monitor
over a **sound-but-incomplete** compose gate (deciding fragment-membership is undecidable — Rice; so "compose
without opening the box" is never an unconditional claim). A reactive **belief-view atop a durable executor** (not
itself one). Bounded by **K1**: amortization of recurrent typed methods, **not** capability extension — the win is
LLM-call/token **elision + drift-robustness + auditability**, not CPU speed. Bounded context is by **discipline**
(the fold-digest window), as strong as the contracts.
