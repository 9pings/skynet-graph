# MODELISATION — skynet-graph "Neurosymbolic Reasoning Graph" (NRG) substrate

> **Where this sits.** This is the deep model of the **substrate** (Use 1) + the early roadmap. The two-uses
> framing and the current target system have since sharpened: **Use 1** = the substrate (a versionable, git-like
> reasoning orchestrator — [architecture.md](architecture.md)); **Use 2** = concept-graphs as composable methods
> with typed contracts + a durable executor ([concept-as-graph.md](concept-as-graph.md), the dryer current
> conception, which supersedes the "flagship / answer-loop" framing in the later sections here). Read this for the
> grounded model + the lens-convergence history; read concept-as-graph.md for the current target. The live roadmap
> is kept in the project's local R&D ledger. Since this model was written, much of it has shipped: the delivered
> combos now run C1–C9 (`Graph.factories.*` — C9 `createCriticalMind` is the external critical mind), the MCP surface
> carries the SOFT/HARD assistant lanes + `critique`, and the plan-loop bricks (`dag-decompose`, `context-project`
> with `stratComplete`, `givens`, `leaf-io`) realize the bounded-context workload at measured scale. What is
> measured — including the critical mind's decidability bound (a mechanical verdict only at count margin ≥ 3, or
> ≥ 2 on a certified perimeter) — is consolidated in [CAPABILITIES.md](CAPABILITIES.md).

*The definitive synthesis. Four R&D ideation lenses (agents/reasoning, live/reactive,
truth-maintenance/audit, modeling/abstraction) plus two prior critical studies and the
2026-06-21 inspector design spec (kept in the author's local R&D trail, outside this repo), merged into one
curated, prioritized model. Every mechanism claim below is grounded in the engine code; file/line pins reflect the 2026-06 revision and may have drifted a few lines.*

**Convention.** `[C×N]` = convergence: N of the four lenses independently arrived at this (= high
confidence). `[REAL]` / `[OVERHYPED]` / `[RISK]` keep the honesty discipline. Code refs are load-bearing.

---

## 1. Executive summary

**What it is.** skynet-graph is **an incrementally-maintained, justification-based (single-world)
production system over a directed hypergraph of typed facts, whose rule-actions are effectful,
non-deterministic LLM/API memo-cells, with replayable revision-stamped mutations** `[C×4 — all four
lenses converged on this exact composite]`. In one framing: **a JTMS wired to a forward-chaining
planner whose actions are LLM calls, where the graph is durable, addressable, *local* working memory
and every call sees only bounded context by construction.** The *flagship workload* (answer an enormous
prompt) is a **second, distinct object riding on that substrate: an AND/OR graph search whose synthesis
is a catamorphism — a bounded bottom-up fold**.

The single best one-line model: **a self-pruning, self-verifying, lesson-accumulating decomposition
DAG of typed facts, where the LLM is called only locally and only when a tracked fact changed.**

**The honest core of the value** is a *conjunction* no agent framework offers together: fine-grained
reactive retraction (defeasance, not coarse checkpoint rollback), dependency-keyed memoization of LLM
*effects* (re-fire on changed *fact*, not on prompt-hash), bounded-local-context-by-construction, and
mechanical structural provenance. The graph **materializes and maintains** judgment; it does **not
produce** it — judgment lives in the LLM. That boundary is the whole honesty story.

**The 5 highest-leverage moves** (full roadmap in §9):

1. **Typed-fact spine + canonicalization barrier** — every inter-concept dependency is a discrete
   typed fact; prose is terminal-only. The precondition for *everything else* working `[C×4]`.
2. **Completion-gating via grow-only `answeredBy` array + `ensure:["$answeredBy.length==$childCount"]`**
   — makes synthesis reactive and race-free with *zero* core change `[C×2, validated in code]`.
3. **Budget = AO\*/beam over the AND/OR graph, scores as facts, beam-by-retraction** — converts
   "terminates" into "affordable"; the actual barrier to enormous problems (K2) `[C×4]`.
4. **Confidence/freshness/verification as `ensure`-gated facts** — turns the coherence machinery into
   *truth-hygiene*; the cleanest dent in K3 `[C×4]`.
5. **Memory-on-retraction as a monotone nogood store with negative-only dependence**, reason anchored
   to the *mechanical trace*, feeding a search heuristic — cross-attempt learning within/across runs
   `[C×3]`.

---

## 2. The formal model (name it precisely)

The panel converged on a precise, layered naming. The two prior studies pinned the *substrate*
antecedents; the modeling lens added the missing *workload* name.

### 2.1 Substrate (the engine)

> **A demand-driven incremental-computation graph (Adapton/Salsa class) whose memo cells are effectful
> LLM/API calls, running a forward-chaining production system with JTMS-style defeasance (`ensure`/uncast)
> over a directed *hypergraph* of typed facts, with replayable revision-stamped mutations.**

Three lenses on the same object, all grounded in code:

| View | Mapping in the engine | Code |
|---|---|---|
| **Forward-chaining production system** (OPS5/CLIPS shape, **pre-Rete**) | `require` = LHS pattern; provider/`applyMutations` = RHS; `stabilize` loop to fixpoint = recognize-act cycle; working memory = typed facts `_etty._`. Match is a **naive object sweep** of `_unstable`, not a Rete β-network. | `stabilize.js`, `_loopTF` (Graph.js:288), `updateApplicableConcepts` (Entity.js:63) |
| **JTMS** (Doyle 1979 — single world) | `ensure` installs watchers (`static_ensure`); premise falls → `unCast` retracts the concept *and recursively its children* + runs `cleaner`s. `assert` (no watcher) = static guard; `ensure` (watcher) = justification. | Entity.js:19-27, 91-121, 192-246 |
| **Demand-driven incremental compute** (Adapton/Salsa) | Provider = memo cell; re-fires only when a tracked `require`/`follow`/`ensure` changes; result graven as facts; same tracked inputs ⇒ no re-call. Memo key = the *set of tracked typed facts*. | `refMap`, `_followersByConceptName`, `_watchers`; provider in Concept.applyTo |

"**Hypergraph**, not graph": one `applyMutations` creates several nodes+segments atomically from one
premise (`expand` emits N child segments, loop.js:63-86) — a hyperedge premise→{conclusions}. An
AND-node *is* a hyperedge.

### 2.2 Workload (the decompose→synthesize loop)

> **An AND/OR graph search (Nilsson 1980; AO\*) whose solution is a catamorphism (a bounded bottom-up
> fold; Meijer-Fokkinga-Paterson 1991).**

- **OR-node** = a sub-problem with alternative decompositions (solved if *any* child succeeds).
- **AND-node** = one chosen decomposition into sub-segments all of which must solve (`expandedInto`,
  loop.js:72) — the hyperedge.
- **Leaf** = an `Atomic` segment answered directly (`Answer`).
- **Synthesis = a fold** whose *carrier type is size-bounded*: `answer(P) = rollup(facts(P),
  [childAnswers])`, `|rollup| = O(1)` regardless of subtree size. That bound *is* the value proposition
  (bounded local context per LLM call), and stating it as "the fold's carrier is fixed-size" makes it a
  checkable, non-negotiable invariant.

Today the engine only materializes the **AND layer** (every `Expand` is taken, no competing
alternatives) → a degenerate AND/OR graph = an **AND-tree (a fold over a DAG)**. Real OR-nodes appear
the moment you add competing strategies (memory, verification voting), at which point the full machinery
becomes load-bearing.

### 2.3 What the naming *buys* (borrowable algorithms & guarantees)

| Name | Borrowable result | Buys us |
|---|---|---|
| **AND/OR + AO\*** (Nilsson; Martelli-Montanari 1978) | admissible best-first expansion `f=g+h` | budget/pruning as the *search policy*, not a bolt-on (§6) |
| **Beam search** | bounded open list | "huge ≠ ruinous"; deliberate exact-vs-bounded trade |
| **Catamorphism + fold laws** (banana-split) | two folds over one structure in one pass | compose verification into the synthesis pass |
| **k-of-n voting** (Wang 2022, self-consistency) | majority/judged-best + `confidence=agree/n` | verification as maintained facts (§6) |
| **CDCL nogood/clause learning** (GRASP 1996) | learn-from-failure + no-forget termination rule | memory-on-retraction termination story (§6) |
| **CEGIS** (Solar-Lezama 2006) | counterexample-guided synthesis; convergence | AI-authoring loop framing (§6) |
| **ATMS labels** (de Kleer 1986) | multiple worlds with shared sub-derivations | cheap in-graph compare-alternatives (§6, §7) |
| **Stratified Datalog / well-founded negation** (Apt-Blair-Walker 1988) | terminating negation | makes `ensure` (negation-as-retraction) provably non-oscillating (§5, §8) |
| **CRDT G-Set** (Shapiro 2011) | idempotent monotone union | the race-free completion gate (§5) |
| **DBSP / differential dataflow** (VLDB 2025) | minimal Z-set deltas | minimal reactive re-synthesis *if* rollup ever becomes an aggregate |

**Honest "where it's pre-Rete/naive":** the match is `O(objects × open-concepts)` per cycle (naive
sweep), not incremental join maintenance; the frontier drains FIFO-ish, not by priority; there is **no
aggregation/quantifier in `getRef`** (a scalar pointer-chase, Graph.js:450-526). These are the three
structural limits §5 and §8 address. Forward-chaining itself is *not novel* — Rete/Drools/Datalog
precede it by decades. **Novelty is the *target* (LLM-as-rule-action + truth maintenance +
bounded-local context), not the *technique*** `[C×3]`.

---

## 3. Unique capabilities (consolidated cross-lens)

What the system solves uniquely or better, one line each, honest. `[C×N]` marks cross-lens agreement.

| # | Capability | Verdict | Notes |
|---|---|---|---|
| U1 | **Enormous problems without context blowup** — bounded `answer` of capped `maxTokens` per node, regardless of subtree size; memory is the graph, reads are local | `[REAL] [C×4]` | The bound is the data model, not app code (vs LangGraph) or self-re-reading (vs bare model). **Caveat: termination ≠ economy** (K2) — boundedness solves *context*, not *cost*. |
| U2 | **Fine-grained reactive retraction (defeasance)** — premise falls → exactly its consequences uncast and cascade | `[REAL] [C×4]` | The single most differentiated capability. LangGraph = coarse checkpoint replay; bare model retracts nothing; TodoWrite never un-checks. (Entity.js:192-246) |
| U3 | **Dependency-keyed memo of LLM *effects*** — re-fires only if a tracked *fact* changed → native partial re-planning | `[REAL on discrete facts] [C×4]` | Finer than exact-prompt cache, cleaner than embedding-threshold (no false hits) — **only while inputs are discrete facts** (K1 below). |
| U4 | **Order-free async tool orchestration** — concept fires *when* its `require` facts exist; plan reorders itself when results arrive out of order | `[REAL] [C×2]` | Order recomputed each fixpoint (vs frozen edges). The right model for N parallel tools with unpredictable latency. |
| U5 | **Structural / mechanical provenance** — every fact is a revision-stamped atom; trace records concept, target, patch, *why it fired* (resolved `require` chain), prompt/reply/ms | `[REAL, monetizable] [C×3]` | "Why did it conclude X" = a derivation, not a transcript. Deliverable in regulated domains. (`onConceptApply`, `_computeWhy`) |
| U6 | **Git for reasoning** — `rollbackTo`/`getRevisions`/`getSnapshot`/`diffRevisions`; `git bisect` over belief state | `[REAL] [C×3]` | Bisect to the rev before a bad fact, read its `why`, find the premise or hallucinating call. |
| U7 | **Productive retraction (learning-from-failure)** — a dying branch's `cleaner` deposits a bounded lesson; future strategies read it | `[REAL, highest research value] [C×3]` | No compared system has cross-attempt residue. The differentiator. (§6) |
| U8 | **Self-modifying control structure in-run** — a meta-concept inside stabilization `patchConcept`/`addConcept`s strategy | `[REAL but highest-risk] [C×3]` | "DSPy where the AI authors the control structure." Gate last. (§6) |
| U9 | **Multi-world compare via fork** — `fork()` per alternative, `merge()` the bounded winner | `[REAL but blunt today] [C×3]` | Poor-man's ATMS at full per-fork cost; needs an ATMS-flavored layer (§6/§7). |
| U10 | **Serializable, shareable reasoning cache** — a solved sub-graph is a portable artifact (`serialize()`), not process-local | `[REAL, underexploited] [C×2]` | Seed a fork's memory; share learning across graphs/teams. |

**OVERHYPED — state plainly (all four lenses flag at least one):**

- **"Reasoning is in the data / in the rules, not the weights."** Half-true. *Orchestration* of
  judgment is in the rules; *judgment* (split? atomic? good answer?) is in the LLM provider `[C×4]`.
- **"MOE / mixture of experts" — the misnomer this project is renamed away from (→ Neurosymbolic Reasoning Graph).** It is an LLM-knowledge-source **blackboard** (Hearsay-II, 1980s) with
  state-conditioned activation. Added value over a classic blackboard = retraction + replay +
  provenance, **not** the routing `[C×2]`.
- **"Convergence = reproducibility."** Reproducible at the **trigger** level (do we re-call?), *not* the
  graven LLM **content** (non-hermetic) `[C×2]`.
- **Coherence ≠ truth (K3).** The mechanism's rigor can manufacture a *false sense of reliability* — a
  hallucinated-but-valid fact propagates and retracts cleanly. The engine maintains **coherence**, never
  **truth** `[C×4]`.
- **The engine/forward-chaining is not novel.** Rete/Drools/Datalog do it incrementally and formally.
  **Memoization controls *redundancy*, never *cost*** — different problem (K2) `[C×4]`.

---

## 4. Core modeling principles (the patterns the panel converged on)

These are the universal disciplines under everything in §5–§9.

### 4.1 Everything-is-a-fact, gated by `ensure`-defeasance — the ONE reused mechanism `[C×4]`

The deepest convergence: **`ensure`-driven reactive defeasance is the *single* mechanism reused for
confidence, freshness, budget, verdicts, memory, and contradiction.** The PLAN's "scoring = ordinary
fact, not an engine feature" generalizes to the whole system. Almost nothing needs new core. Because
`ensure` installs a watcher (Entity.js:91-121) and a falling premise auto-retracts dependents in
cascade, the same primitive expresses:

- **confidence gate**: `ensure:["$X:confidence > 0.7"]` → low-confidence facts retract themselves;
- **freshness gate**: `ensure:["$now - $X:producedAt < $X:ttl"]` → stale facts retract themselves;
- **budget gate**: `assert/ensure:["$budget:remaining > $thisConcept:cost"]` → over-budget branches retract (= pruning);
- **verdict gate**: `ensure:["$X:verified == true"]` → refuted facts retract their dependents;
- **completion gate**: `ensure:["$answeredBy.length == $childCount"]` → rollup fires exactly once (§5);
- **memory exclusion**: a strategy's `assert` excludes recorded failures → strictly-shrinking strategy set.

This is the strongest design statement in the whole synthesis: **truth-hygiene, search policy, learning,
and synthesis are all *facts + an `ensure`*, riding one engine superpower.**

### 4.2 The typed-fact spine + the canonicalization barrier (defeat K1) `[C×4]`

The dominant existential risk (K1) is memo-key fragmentation: when a concept depends on variable LLM
*prose*, two semantically-equal outputs differ textually → the memo key changes every run → permanent
miss → incrementality evaporates (and you still pay the watcher bookkeeping). The fix is **a modeling
rule, not a feature**:

- **A concept may depend (`require`/`ensure`) only on discrete, typed, low-cardinality facts** (enums,
  ids, numbers, booleans, short canonical strings) — never on a free-text field.
- **Prose is terminal-only**: allowed as a `answer`/`description` read by humans or a rollup prompt;
  **never a trigger**.
- **Canonicalization barrier**: every `LLM::complete` expert that feeds downstream experts returns
  `{ facts: {<typed discrete keys>}, prose }`. Only `facts` are written as *tracked* keys; `prose` goes
  to an *untracked* key. Numerics quantized to a declared grain; enums snapped to a closed vocabulary.
  **Prefer strict structured extraction (deterministic) over embedding-similarity** — the latter
  re-imports GPTCache-style false-hits which, in a cascade-invalidation graph, *propagate*.
- **Enforce at author time**: schema validation marks each key tracked/discrete vs prose/untracked, and
  rejects a `require`/`ensure` that targets a prose key *before* it fragments the graph.

This single discipline is what makes the memo edge, partial re-plan, exclusion-keyed memory, and
confidence-driven defeasance all actually work. Cheapest, highest-leverage, decisive — **decide it and
never break it.**

### 4.3 Bounded O(1) rollups everywhere context re-concentrates `[C×4]`

Synthesis, `merge` projections, and memory facts must all be O(1) in subtree size. A reactive system
re-runs these on change; any unbounded one re-concentrates the whole context into the root call and
rebuilds the blowup you set out to avoid. **The bound is the load-bearing invariant, not an
optimization** — assert it in code (`|rollup| ≤ B`, independent of subtree size).

---

## 5. The aggregation gap & the key primitive

### 5.1 The confirmed limitation `[C×4, code-verified]`

`getRef` (Graph.js:450-526) walks `:` / `.` as a **scalar pointer-chase** and returns a single value
at `exp.length == 1`. There is **no `forall` / `count` / quantifier over a set of children**. The only
aggregation expressible anywhere in the library is `.length` member access on a *single* array fact
(confirmed: `LongStay.json` uses `$TimePeriod.length`; `expr.js` `MemberExpression` supports it).
Consequence: **"all N children answered" is not expressible as a `require`.** This is the structural
reason synthesis needed a workaround.

### 5.2 The validated race-free fixes (built *on* `.length`) `[C×2 — found independently by lenses 02 & 04]`

The naive reactive design (spec §4) uses a scalar counter: each child does a provider-side
read-modify-write `AnsweredCount += 1` of the parent. **This is accidentally a concurrent accumulator.**
Providers are async (work in a `.then`); two children both read `k` before either's write mutation is
enqueued → both write `k+1` → one increment lost → the gate never fires. Even single-threaded JS, the
interleaving across `await` points is a lost-update hazard. **Do not ship `AnsweredCount += 1`.**

The fix removes the shared mutable counter — observe a **monotone set** instead:

- Each child, on becoming `Answered`, writes its **own id** into the parent's `answeredBy` as a **set
  union** (a G-Set: idempotent, commutative, associative — `answeredBy = answeredBy ∪ {childId}`). No
  read-modify-write; distinct/commutative writes → no lost update under any interleaving.
- The gate is the **monotone cardinality predicate**: `ensure:["$answeredBy.length == $childCount"]`.
  **This works in the *current* evaluator** (it already does `.length`), so the reactive synthesis fix
  is **zero core change**.
- (Equivalent CRDT encoding: a grow-only set of boolean `done_i` keys, gate = their AND, generated by
  `Expand`. Same race-freedom; the array+`.length` form is tighter.)

**Reactive bonus** — because each child `answer` is a tracked fact, if a leaf later changes (live data),
the child re-answers → its `answer` changes → the parent's `Rollup` (which must `follow` the children's
`answer` keys, not just the gate) re-rolls → cascades to root. **Synthesis becomes reactive for free**,
converting the engine from "answer once" to "standing computation" — the whole differentiator vs a
re-prompt agent. Keep the deterministic **post-order fold (loop.js:108-123) as the one-shot default**
(it's correct, race-free, O(V+E), and reactivity buys nothing when everything is cold); use the G-Set
gate for the live/reactive regime.

### 5.3 The ONE engine primitive worth adding

> **Stratified set-aggregation: a derived `count(setRef)` / `all(setRef, pred)` over a child set,
> evaluated at a stratum boundary.** `[C×2 — lenses 02 & 04 both land here]`

This single addition closes **completion-gating + k-of-n voting + beam-width** at once (all are
"aggregate over a set of children"). It computes the reduction over committed facts at a well-defined
phase, so it **keeps the no-read-modify-write property** (no provider racing on a counter). If you add
*one* engine feature, add this — not more ref-walk sugar. The G-Set `.length` gate (§5.2) is the
zero-core version to ship first; this is the proper generalization.

**Stratification caveat `[C×2]`:** `ensure` is negation-as-retraction; an aggregate gate is
non-monotone. Unrestricted negation in a forward-chaining loop has no well-founded semantics (can
oscillate A→retract→re-derive→retract). The principled guard is **stratified negation**: a concept whose
`ensure` depends negatively on fact F sits in a stratum strictly above F's producer; depth is the
natural stratum. **Lint for negative cycles among concepts at author time** (Tarjan SCC over the
concept-dependency graph, `ensure`-edges = negative; an SCC with a negative edge = unstratifiable →
reject/warn). Cheap static check; the principled answer to the oscillation both the memory-loop and
verification-loop risk.

---

## 6. The planned five, re-modeled (best model the panel arrived at)

For each planned improvement, the strongest concrete model, grounded.

### 6.1 Memory-on-retraction = a monotone nogood store feeding a search heuristic `[C×3]`

- **Shape**: a *nogood store* (de Kleer's ATMS nogoods / CDCL learned clauses). A retracted/failed branch's
  `cleaner` (the emit point — Entity.js:224-237; its nested `pushMutation` is *queued* by the
  `_mutationThreadRunning` guard, so it is re-entrancy-safe — validated) deposits a **bounded, discrete,
  append-only** record `{ctx, strategy, outcome:'failed', reason, atRev, confidence}` on a **survivor**
  free-node `{_id:'memory'}` or the nearest surviving ancestor (hierarchical, for bounded reads at scale).
- **Keying — the crux of *learning* vs *noise*** (this is K1 in new clothes): `ctx` must be a **bounded,
  canonical, typed descriptor of the sub-problem class** (`{taskType, depth-band, key-constraints}`),
  not a unique node id or raw label. Too-specific ⇒ never reused; too-generic ⇒ wrong lessons. Same
  strict-extraction discipline as §4.2. Exclusion uses flat boolean projection keys
  `failed::<ctxHash>::<strategy>` set atomically with the record (since `getRef` can't aggregate).
- **Termination (the inviolable property)**: **negative-only dependence** — memory *only disables /
  deprioritizes* a strategy, never re-enables one. Append-only + self-flag + strictly-shrinking strategy
  set per ctx ⇒ well-founded ⇒ terminates. This is exactly *finite nogood learning terminates* from
  CDCL; never GC a nogood currently excluding a live strategy (reopens the loop).
- **Reason anchored to the MECHANICAL TRACE, not an LLM story** `[C×2]`: tie `reason` to *which premise
  fell / which assert failed* (the trustworthy `why`), not an LLM's post-hoc "I think it failed
  because…" (which can encode a wrong lesson). This is the one place memory can lie; pin it to the trace.
- **Feeds the search as a heuristic**: in the AO\* model (§6.2) a recorded nogood gives the context
  `priority -= penalty` — memory is *online tuning of the admissible heuristic*, not a separate feature.
- **Reactive amendment** `[C×1, important]`: distinguish `cause: 'failed' | 'premise-changed' |
  'stale-ttl'`. A *failed* memory excludes the strategy; a *premise-changed* retraction (legitimate
  live re-plan, P2) must **not** exclude it (it may be valid again). Make exclusion **epoch-scoped**
  (`failed_<ctx>_<strat>@<inputEpoch>`): monotone *within* an epoch (preserves termination), eligible
  again *across* epochs (permits live re-exploration).

### 6.2 Budget/pruning = AO\* / beam over the AND/OR graph, scores as facts `[C×4]`

Once the loop is named AND/OR search, budget is the **search policy**, not a bolt-on, and it is what
converts "terminates" into "affordable" — co-equal with the loop itself (K2).

- **Admissible scores carried AS FACTS** (consistent with commit `53d19ea`, "scoring = ordinary
  facts"): each segment gets `estCost` (tokens/calls to solve the subtree) and `estValue`/`priority`,
  written by `EvalComplexity` or a cheap estimator. Admissible = never over-estimate value / under-estimate
  cost, so pruning can't discard the true best.
- **Expansion order = best-first** on a priority queue keyed by `f = g + h` (cost spent + admissible
  estimate). Replace the FIFO `_unstable` drain with a **lazy priority heap** keyed by the `priority`
  fact (push duplicates, skip stale on pop via a `dirtySeq` — the Dijkstra dodge; don't implement
  decrease-key, since reactive destabilization re-adds objects).
- **Beam = an `ensure` gate; pruning = retraction**: `Expand` is castable only while the node is in the
  top-k frontier *and* `remainingBudget > estCost`. When budget shrinks or a better sibling appears,
  lower-rank frontier nodes fall out of the beam and **retract** (the half-expanded subtree uncasts via
  cascade — JTMS gives this for free). **No framework prunes a search tree by truth-maintenance.**
- **Budget propagates DOWN as a local allowance**: a parent splits its allowance among children
  (`childAllowance = parentRemaining / estChildCount`), written as a fact each child reads. Decomposition
  can't explode because each node expands within its inherited allowance — *budget is local, matching the
  bounded-context philosophy.*
- **Charge only the dirty delta** `[C×1, reactive]`: re-stabilizing after a 1-fact edit must be budgeted
  against the **estimated cost of the dirty set only** (use a `whatDependsOn` estimate, §7), not
  re-budgeted as cold. **Memoized/skipped nodes are free and must not be charged** — else the beam
  prunes branches that would have cost nothing.
- **Per-concept cost annotation** + the trace's `ms`/token accounting feed *actual* cost back for the
  next estimate, closing the loop.

### 6.3 Verification = `ensure`-gated verdict facts + k-of-n vote nodes `[C×4]`

The structural answer to coherence ≠ truth (K3). TMS and verification become the *same* mechanism.

- **A verifier is a concept** that `require`s another concept's output and emits a **discrete sibling
  verdict fact** `{verdict:'pass'|'fail', confidence, reason-enum}` — **never overwrites** the checked
  fact (the graph is additive; experts don't fight over a prop), **never prose**.
- **Downstream gates on the verdict**: `ensure:["$Distance:verified == true"]` → a fact later refuted
  (verdict flips) **auto-retracts its dependents** via the `ensure` watcher. Refutation *is* defeasance —
  no new engine path.
- **Prefer DETERMINISTIC checkers** (units, ranges, arithmetic, schema, external lookup) over
  LLM-refuters: they convert K3 from "trust the LLM" to "the claim violates a checkable invariant." An
  LLM-refuter can pass another LLM's hallucination — still raises the bar, still auditable (its
  prompt/reply is in the trace), but weaker. Truth, not just coherence: check against *something
  external* and emit `verifiedAgainst:<source-id>` as provenance.
- **Independence discipline**: the refuter must not be the same call that produced the fact (don't ask
  the hallucination to grade itself) — different provider / adversarial framing / deterministic checker.
- **k-of-n voting (self-consistency)**: an OR-node with n sibling answer strategies; a `Vote` concept
  emits majority + `confidence = agree/n`. Disagreement is itself a fact that can trigger a forked
  compare or a self-mod. (Needs the §5.3 set-aggregation primitive to do cleanly; the scalar-counter
  quorum pattern works meanwhile.)
- **Co-model with budget** `[C×1]`: verification is not free. Risk-proportional `verifyDepth` (a fact)
  — high-stakes/low-confidence facts get more refuters; cheap/high-confidence get none. Confidence feeds
  the §6.2 priority. **Honest tension**: verify-more vs explore-more under fixed budget is a real
  trade; the model makes it *explicit and tunable* (all facts), it does **not** auto-optimize it (no
  reward signal). k-of-n over a biased model votes confidently wrong — treat confidence as heuristic,
  never proof.

### 6.4 Live self-modification = single-writer hypothesis-and-test, gated last `[C×3]`

Highest ceiling, highest risk (U8). Model it safe-by-construction using *already-built* machinery.

- **One meta-concept, single-writer, fires on a stable signal** — triggers on a `Stuck` fact (a subtree
  exhausted its strategies / blew budget), not continuous polling. Single-writer avoids two meta-concepts
  patching the same concept in one pass.
- **Hypothesis-and-test**: patch/add → stabilize a **bounded region** → if cost/uncertainty *worsened*,
  `rollbackTo`. Every self-mod is already a revision (auditable, revertible) — exploit it. This makes the
  riskiest tier safe using built rollback+trace.
- **Re-entrancy must be verified** (flagged open): patch/add called from inside a provider cb during
  stabilization. `patchConcept` currently does cast/uncast + `stabilize()` directly (not via the mutation
  queue) and **re-evals *every* object** (`Object.keys(this._objById)`, Graph.js:798-811) — a
  stop-the-world invalidation (K4 anti-pattern). **Two amendments**: (a) **scoped re-eval** — only
  objects where C is/was applicable (`_mapsByConcept[C._name]` ∪ `require`-root matches), turning
  O(graph) into O(affected); (b) **route `addConcept`/`patchConcept` issued *during* stabilization
  through a pending queue drained at the top of `_loopTF`** (alongside `_triggeredCast`), so a structural
  change applies at a quiescent boundary, never mid-apply.
- **Version the concept lib for rollback** `[C×1]`: `rollbackTo` restores facts but **not** concept-lib
  edits. Stamp each `patch`/`addConcept` with a rev and snapshot the concept schema alongside the state
  snapshot (`_captureSnapshot`), so "git for reasoning" covers **both** data and rules — else live
  self-mod breaks the revertibility guarantee.
- **Probationary experts**: an AI-authored concept's first outputs are verification-gated (§6.3) until it
  has cast successfully N times — a *reputation fact* on the concept, learned via the §6.1 memory machinery.
- **Stratification + meta-budget**: meta-edits are a strictly higher stratum (a meta-concept may not edit
  a concept currently mid-apply on the stack); cap max edits/run. Add a per-`(target, conceptName)`
  **apply-count ceiling** in the stabilize loop as the backstop against self-mod-induced oscillation,
  writing a `divergent` fact (itself a retraction trigger). Gate this whole tier behind §6.1–§6.3 + the
  guard being solid.

### 6.5 Declarative AI-authoring = typed-grammar program synthesis (CEGIS) `[C×4]`

The concept schema **is a typed grammar (an ADT / small DSL)**: `Concept ::= {require: Ref[], assert:
Expr[], ensure: Expr[], provider: ProviderRef, applyMutations: Template, cleaner, childConcepts}`;
`Expr ::= jsep grammar`; `Ref ::= ident (':'|'.' ident)*` (scalar walk, no quantifiers). The AI authors
**terms of this grammar**; the host owns the **primitives** (provider palette + ref alphabet).

- **Validate STRUCTURE, never the expression grammar** (standing directive). Three layers, cheapest first:
  1. *Structural* (JSON-schema): field names/types; `provider` ∈ **host-vetted palette**; **`_name`
     present** — make "writes its own self-flag name" a *validated invariant* (the #1 authoring footgun:
     loop.js:88-89; without it the concept re-fires forever).
  2. *Expression well-formedness*: `assert`/`ensure` parse under jsep at author time (catch syntax
     errors before stabilize); reject `constructor`/`__proto__`.
  3. *Ref soundness* (the valuable one): every `$ref` walk is a path over known concept names; **flag a
     `require` that attempts to aggregate** (ends in a collection) — catches the "all children answered"
     mistake *at authoring time* instead of as a silent never-fires bug.
  Crucially: validate that every `require`/`ensure` ref resolves to a **typed-fact-producing** concept,
  not a prose field — this is where §4.2 is enforced at author time.
- **Safety boundary = the vetted provider palette** `[C×3]`: the AI authors only declarative parts
  (`require`/`assert`/`ensure`/`prompt`/which-provider) and may reference only palette providers; it
  **never writes provider JS**. `LLM::complete` being universal means it rarely needs to — powerful AND
  safe. Reject any concept whose `provider`/`cleaner` names a non-palette entry.
- **Self-improvement loop = CEGIS** with the graph as verifier: the trace = positive/negative examples
  of "did this fire when it should"; memory-on-retraction = the counterexamples; AI patches
  (`patchConcept`) / adds (`addConcept`) and re-runs. Each counterexample strictly constrains the
  candidate space → convergence + monotonicity (same discipline as §6.1).
- **The authored unit is a concept↔prompt pair = a reusable, inspectable, retractable *skill*** carrying
  its trigger condition and provenance — a far better artifact than a pile of prompt strings. The real
  "skills as data" story. Every `addConcept`/`patchConcept` is a revision-stamped mutation → an
  AI-authored rule that causes a bad cascade is *bisectable* (U6) back to its authoring rev.

---

## 7. Newly-deduced mechanisms (beyond the planned five)

High-leverage mechanisms the lenses surfaced that are not in the planned five.

| # | Mechanism | What it fixes | Model | Lens |
|---|---|---|---|---|
| N1 | **Freshness / TTL / epochs as facts** | cache poisoning (K3): the first answer is graven and *never expires*; no notion of "stale though nothing in-graph changed" | Stamp provider facts `{atRev, atMs, ttlMs?, epoch?}`; a concept declares `freshness:{ttlMs}` or `freshness:{epochRef:"$clock:tick"}`; a lightweight reaper (interval or piggy-backed on `_loopTF`) **timed-destabilizes** stale facts → existing re-fire path runs → fresh fact. A global `clock` free-node experts `follow` invalidates *exactly* the time-bound concepts. **Reuses the whole re-fire machinery; near-zero new evaluation code.** | `[C×2]` (★★★★★ in lens 02) |
| N2 | **Dirty-set / `whatDependsOn` provenance** | dep edges are materialized but unqueryable | `whatDependsOn(objId,key)` walks `_followersByConceptName` transitively → "if I change this fact, these N concepts re-fire (est. cost/$/tokens)" = *predictive cost of an edit*. Emit `cfg.onInvalidate(fromKey,toIds,reason)` mirroring `onConceptApply` → the inspector shows the *dirty wave*, not just the apply. | `[C×1]` |
| N3 | **Confidence-gated propagation** | low-confidence facts silently drive downstream casting (K3) | `ensure:["$X:confidence > 0.7"]` → below-threshold facts auto-retract dependents. (Special case of §4.1; called out because it's the cheapest K3 dent.) | `[C×3]` |
| N4 | **Contradiction-as-event** | additive graph never surfaces nogoods | A `Contradiction` concept `require:["X","Y"], ensure:["$X:value != $Y:value"]` writes `contradiction:true` + the conflicting ids on a shared anchor (auto-clears on resolution). Optional one-line core: `graph.on('contradiction', …)` so a host/meta-concept reacts (pause / fork-to-explore / verify). **Surface, don't auto-resolve** (auto-resolution needs truth the JTMS lacks). | `[C×1]` |
| N5 | **ATMS-lite (assumption tags + fork/diffRevisions)** | JTMS is single-world (K5) | Tag assumption-rooted facts with an `assumption` id; dependents carry it forward as an ordinary key; "which conclusions rest on planA" = a fact query; retracting `asm:planA` cascades via `ensure`. Compare worlds via `diffRevisions(forkA, forkB)`. For many cheap structure-sharing alternatives (beam over strategies), **ATMS labels** are the right model (shared sub-derivations computed once); for few heavyweight isolated worlds, **fork** (what `f3a04fa` built). Opposite ends of the sharing/isolation axis — not competitors. **Honest: full ATMS label-arithmetic is worst-case exponential in #assumptions; bound it (= beam width k), label only the contested sub-DAG above the first OR-node. If you can't bound assumptions, don't do ATMS — fork.** | `[C×3]` |
| N6 | **Concept-library versioning** | rollback covers data but not rules (breaks revertibility under self-mod) | Snapshot the concept schema alongside `_captureSnapshot`; stamp each `patch`/`addConcept` with a rev. (Prereq for safe §6.4.) | `[C×1]` |
| N7 | **Per-key revision stamping** | `_computeWhy` is object-granular (spec §2.4), not per-key | Opt-in `_revByKey[key]=rev` in `Entity.set` → retract/re-derive on the *exact* fact, sharpens blame (U5) and tightens memo invalidation. Deferred in spec; do when the first audited use-case lands. | `[C×2]` |
| N8 | **Hysteresis/debounce on expensive nodes** | flapping live input re-fires an LLM node per flap | `debounceMs` and/or "only re-fire if the *canonical* projection crossed a grain boundary" — falls out of §4.2 for free (if the discrete key didn't change, don't destabilize the follower). | `[C×1]` |
| N9 | **Signed/tamper-evident rev log** | regulated audit needs "trace wasn't edited after the fact" | Host-side hash chain `H(prev, rev.tpl, rev.parent)` over the append-only `_revs`. Zero engine change; mandatory the day a compliance customer is real. | `[C×1]` |
| N10 | **Prospective / live / standing paths (terminal-type as a first-class device)** (user, 2026-06-21) | the graph is otherwise a finite "compute one answer & stop" — but "be attentive & solve problems" needs a *never-done* graph | Model a path's **terminal fact** as a type: `Speculative`/`MaybeUseful` (+confidence) = a low-priority **frontier node in the AO\*/beam** (§6.2), pursued only if budget/confidence allow; `LiveSource` = a node bound to a data source with **freshness/TTL** (N1) that re-destabilizes its path when the source changes; `ActiveProblem` = a sub-path spawned per detected problem. A **standing (non-terminating) agent** ("be attentive…") = one live path per info-source × sub-paths per active problem — the reactive regime. Needs N1 (freshness) + §6.2 (budget/beam) + the canonicalization barrier (§4.2). Adaptive concept-gen for new problem types is the hard, last-gated part; the rest composes from already-planned pieces. | `[C×1, user]` |

> **Correction (2026-06-21, code-verified):** the §5.2 reactive-synthesis "grow-only `answeredBy` array
> append, zero core change" is **WRONG** — `pushMutation` merges existing objects via `Entity.update→set`
> which **replaces** array values (Graph.js:1138/1168 → Entity.js `set`: `this._[key]=content`), so an
> append is a read-modify-write race (same bug as the counter). **Reactive completion-gating genuinely
> requires a small core primitive** (an append/`$push` mutation op, or stratified set-aggregation — §5.3).
> Until that deliberate core change, **synthesis stays the deterministic post-pass** (correct, race-free).
> Mechanisms that use only **distinct keys** (e.g. memory-on-retraction's `failed_<ctx>` flags, verdict
> keys) are unaffected by replace-semantics and remain zero-core.
> **Since shipped:** the `{__push}` append primitive in `Entity.set` closes exactly this — a race-free,
> grow-only array append in core (see API.md, the k-of-n voting pattern with
> `ensure:["$votes.length == $expected"]`). Reactive completion-gating is therefore available in core
> today; the deterministic post-pass remains a valid, simpler alternative.

---

## 8. Honest risks & non-goals

The risk ledger, carried forward intact (no hype). `[C×N]` = how many lenses independently flagged it.

| Risk | Severity | Why | Mitigation in this doc |
|---|---|---|---|
| **K1 — prose memo-fragmentation** | **EXISTENTIAL** `[C×4]` | a prose dependency fragments the key → permanent miss → incrementality nil, *worse* than nil (watcher overhead) | §4.2 typed-fact spine + canonicalization barrier, enforced at author time (§6.5). Without it, much of §3/§6 is aspirational. |
| **K2 — termination ≠ economy** | **HIGH** `[C×4]` | memoization bounds *redundancy*, never the *productive tree size*; a stable graph can legitimately fire 400 LLM calls | §6.2 budget/beam — the thing that makes "huge" affordable; co-equal with the loop, not polish. |
| **K3 — coherence ≠ truth** | **HIGH** `[C×4]` | a hallucinated-but-valid fact propagates & retracts cleanly; mechanism rigor → false sense of reliability | §6.3 verification (deterministic > LLM-refuters), §4.1/N3 confidence gates, N1 freshness, N4 contradiction. None makes facts *true*; they make unreliability **visible and non-propagating**. |
| **K4 — incremental non-payoff zones** | **MEDIUM** `[C×3]` | one-shot (all cold), high-churn/global-input change (invalidate everything per tick → pay tracking *on top of* full recompute), prose inputs, non-decomposable holistic judgment | §4.2 + §4.3 + N1; M3 "large stable core + thin live edge." For one-shot, skip the reactive machinery — use the bounded-context decomposition only. **Be honest: incremental only wins under small-delta-over-large-stable-state.** |
| **K5 — JTMS not ATMS (single world)** | **MEDIUM** `[C×3]` | comparing alternatives forces a coarse manual fork; no shared-derivation label sharing | N5 ATMS-lite for in-graph beam; fork for sandboxes; fork *only* at high-uncertainty decision points the verifier flags (each fork pays full cost). |
| **K6 — authoring/maintenance cost** | **MEDIUM** `[C×2]` | who writes & maintains hundreds of concept↔prompt pairs when domain/model changes? An unbounded, non-auto-optimized **specification debt** (vs DSPy) | §6.5 AI-authoring (concept↔prompt = reusable skill). **Honest: not demonstrated cheaper than imperative code; the difficulty moves from "fragile imperative code" to "ontology to maintain."** |
| **K7 — stratification / oscillation** | **MEDIUM** `[C×2]` | `ensure` aggregate gates + memory + self-mod are non-monotone → A→fail→B→fail→A | §5.3 stratification (depth strata + Tarjan-SCC negative-cycle lint); §6.1 negative-only dependence; §6.4 apply-count ceiling. |
| **K8 — self-mod re-entrancy / stop-the-world** | **MEDIUM** `[C×2]` | `patchConcept` re-evals every object & isn't queued mid-stabilize | §6.4 scoped re-eval + drain at `_loopTF` boundary; N6 concept-lib versioning. Gate the tier last. |

**Non-goals (do NOT claim):** the engine/forward-chaining is novel (Rete/Drools/Datalog precede it);
"reasoning is in the data" (orchestration is, judgment isn't); content reproducibility (only trigger-level);
ATMS (it's a JTMS); that memoization controls cost (it controls redundancy); deterministic replay of
*reasoning* (only of the resulting *fact graph*).

---

## 9. Prioritized roadmap (single ordered list, highest leverage first)

> **Note (2026-06-24).** This roadmap (#1–#12, N1–N10) is mechanically complete and STANDS. An **additive** track —
> *probabilistic/learning uses + the Mixture-of-Reasoners sub-graph architecture* — was opened and experimentally
> de-risked this session; its prioritized roadmap (Tier 0 bug → Tier 4 research) and the study trail are kept
> in the project's local R&D notes.

Merged across all lenses; dependencies noted. The shape: **canonicalization + the completion-gating
primitive unblock reactive synthesis + budget + verification; verification & memory need the trace, which
already exists.**

| # | Move | Why (leverage) | Cost | Depends on | Lens convergence |
|---|---|---|---|---|---|
| **0** | **Name the loop AND/OR search + catamorphism in the codebase; assert the bounded-carrier invariant `|rollup| ≤ B` as a test** | reframes budget/verification/multi-world as textbook results, not bespoke code; the bound *is* the product | ~0 | — | `[C×1, free]` |
| **1** | **Typed-fact spine + canonicalization barrier** (discrete tracked facts vs untracked prose; enforce at author-time validation) | precondition for the memo edge, partial re-plan, exclusion-keyed memory, confidence defeasance — *everything* | M (modeling) | — | `[C×4]` ★ do first, never break |
| **2** | **Reactive synthesis via grow-only `answeredBy` array + `ensure:["$answeredBy.length==$childCount"]`** (do NOT ship the `+= 1` counter) | converts "answer once" → "standing computation"; race-free; **zero core change** | S–M | #1 | `[C×2]` ★ |
| **3** | **Freshness/TTL/epochs as facts** (timed destabilize; `clock` free-node) | kills cache poisoning (K3); enables live data — without it the system is only safe on hermetic facts | M | — | `[C×2]` (★★★★★) |
| **4** | **Budget/pruning = AO\*/beam: scores as facts + lazy priority heap over `_unstable` + beam-by-retraction + downward allowance + charge only the dirty delta** | the actual barrier to enormous problems (K2); "huge ≠ ruinous"; co-equal with the loop | M | #1 (discrete cost facts), #2 (real cache hits to not over-charge) | `[C×4]` |
| **5** | **Confidence/freshness/verification as `ensure`-gates**: provider facts carry `confidence`; verifiers emit typed verdict facts; deterministic checkers preferred; downstream gates retract on refute | the cleanest dent in K3; makes coherence machinery serve *truth*-hygiene | S (modeling) | #1, the trace (exists), #3 | `[C×4]` |
| **6** | **Memory-on-retraction = monotone nogood store**: bounded discrete records via `cleaner`; canonical typed `ctx`; negative-only dependence; reason from the **mechanical trace**; epoch-scoped exclusion; feeds the §4 heuristic | cross-attempt learning within/across runs — the differentiator (U7) | M (modeling) | #1 (typed keys), #5 (judge "failed"), the trace (exists) | `[C×3]` |
| **7** | **Justification-graph inspector views** (`sg why`/`sg explain`/`sg whatif`) + N2 dirty-set/`whatDependsOn` + N4 contradiction event | makes auditability *usable* by a human; "PROVIDER-ASSERTED, unverified" annotation is itself a K3 safeguard; the dirty-wave view | S (host-side) | the trace (exists) | `[C×2]` |
| **8** | **The ONE engine primitive: stratified set-aggregation `count`/`all` over a child set** + Tarjan-SCC negative-cycle (stratification) lint | closes completion-gating + k-of-n voting + beam-width in one stroke; gives `ensure` well-founded semantics | M (core) | #2 (proves the need), #5/#4 (consumers) | `[C×2]` |
| **9** | **Fork as explicit multi-world compare gated by verifier uncertainty; N5 ATMS-lite for in-graph beam (bounded assumptions)** | ATMS-like alternative comparison without becoming an ATMS; spend forks sparingly | M | #5 (uncertainty signal), #4 (cost), #8 (label/aggregate) | `[C×3]` |
| **10** | **Declarative AI-authoring**: `addConcept` + validated concept schema (structure/expr/ref-soundness, self-flag invariant) from a vetted provider palette; CEGIS loop | "skills as data"; addresses K6 authoring cost | M–L | #1 (typed-fact validation), the trace + #6 (the CEGIS spec/counterexamples) | `[C×4]` |
| **11** | **Live self-modification = single-writer hypothesis-and-test**: meta-concept on `Stuck`; scoped re-eval; drain at `_loopTF` boundary; N6 concept-lib versioning; apply-count ceiling; probationary verification-gated experts | highest ceiling — gate **last** (highest risk) | L | #4, #5, #6, #10, #8 (all the instruments + guards) | `[C×3]` |
| **12** | **Audit-grade polish**: N7 per-key rev stamping; N9 signed/tamper-evident rev log | the difference between "auditable" and "defensible before a regulator" | S each | the trace, #1 | `[C×1]` do when a regulated customer lands |

**The dependency spine in prose:** #1 (typed-fact spine) is the keystone — it unblocks #2, #4, #5, #6,
#10. #2 (reactive synthesis) + #4 (budget) together make enormous problems both affordable and live. #5
(verification) + #6 (memory) both ride the *trace that already exists* and the typed-fact spine. #8 (the
one engine primitive) generalizes the #2 gate and is the consumer-driven core addition. #11 (self-mod) is
last on purpose: it needs every other instrument and guard in place.
