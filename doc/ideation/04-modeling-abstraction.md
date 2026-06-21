# 04 — The Right Model for the Reasoning Substrate

**Author:** Laurie (theory-meets-practice CS review)
**Scope:** name the formal object skynet-graph *is*, pick the cleanest model for "decompose huge
problem → bounded synthesis", and re-derive the 5 planned features from that model. Code-verified
against `App/Graph.js`, `App/objects/Concept.js`, `App/objects/Entity.js`, `App/tasks/stabilize.js`,
`App/expr.js`, `_lab/loop.js`, `_lab/run-prompt.js`, `concepts/common/*`.

> Standing directive respected: nothing below caps expressiveness. Every recommendation is *additive*
> (a discipline, a derived fact, a search policy) — none removes a capability of the engine.

---

## 0. TL;DR — the one-paragraph verdict

skynet-graph is **a demand-driven incremental-computation engine (Adapton/Salsa class) whose memo cells
are effectful LLM/API calls, running a forward-chaining production system with JTMS-style defeasance
(`ensure`/uncast) over a hypergraph of typed facts**. That is the *substrate*. The *flagship workload*
(decompose → synthesize) is a **second, distinct formal object running on top of it: an AND/OR graph
whose solution is a catamorphism (a bounded bottom-up fold)**. The two studies in `doc/aspect-*.md`
already pinned the substrate antecedents precisely (Adapton/Salsa/DBSP for incrementality; JTMS/Rete/
Datalog for the rule layer) — I agree with them and will not re-litigate. **My contribution is the
distinction the existing docs blur:** the engine is a *truth-maintenance / incremental-recompute*
machine, but the decompose-synthesize loop is *AND/OR search + a fold*, and **those want different
algorithms**. The current post-pass synthesis is *correct* and I'd keep it as the default; the "clean
reactive synthesis" everyone wants is achievable via **stratified completion counters (a monotone join
node)**, and budget/verification/memory/multi-world all have crisp, literature-backed forms once you
name the loop as AND/OR search.

---

## 1. NAME THE MODEL

### 1.1 The substrate (the engine)

Three lenses, all correct, in increasing precision:

**(a) A forward-chaining production system over a graph working memory.**
`require` = the LHS pattern (positive conditions), the provider/`applyMutations` = the RHS action,
`stabilize.js` = the inference engine's recognize-act cycle run to fixpoint (`_loopTF`,
`Graph.js:288`). The working memory is the set of typed facts on nodes/segments (`_etty._`). This is
literally OPS5/CLIPS/Rete shape — **but the match is a naive object sweep** (`stabilize.js:42` maps over
`_unstable`, each object re-tests its open concepts in `updateApplicableConcepts`), not a Rete
discrimination network. So: *production-system semantics, pre-Rete implementation.*

**(b) A JTMS (Doyle 1979) wired onto that planner.**
`ensure` installs watchers (`Entity.js:98-121`, `static_ensure` at `Entity.js:18-27`); when a premise
falls, `unCast` retracts the concept *and recursively its child concepts* (`Entity.js:219-221`) and runs
`cleaner`s. That is exactly justification-based truth maintenance: one belief per justification, **one
coherent world**, non-monotonic retraction by loss-of-support. `assert` (no watcher) vs `ensure` (watcher)
is the engine's distinction between a *static guard* and a *justification*. The `doc/aspect-modele`
study's "JTMS câblé sur un planificateur" is the exact right phrase.

**(c) A demand-driven incremental-computation graph (Adapton, Hammer PLDI 2014 / Salsa).**
A provider is a memo cell: it (re)fires only when a tracked dependency (`require`/`follow`/`ensure`)
changes; its result is graven as facts; same tracked inputs ⇒ no re-call. `refMap`/`_followersByConceptName`
are the trace edges; `stabilize` is change-propagation. The `doc/aspect-calcul-incremental` study nails
this and the killer caveat: the memo *key* is the set of tracked typed facts, which is clean for discrete
facts and **fragments catastrophically when an input is itself LLM prose** (K1).

**Precise classification.** Put the three together and the formal object is:

> **An incrementally-maintained, justification-based (single-context) production system over a directed
> hypergraph of typed facts, with effectful non-deterministic memo cells (providers) and replayable,
> revision-stamped mutations.**

"Hypergraph," not "graph": a single concept application (`applyMutations`) can create *several* segments
+ nodes atomically from one premise (see `expand` in `_lab/loop.js:63-86` emitting N child segments).
That is a hyperedge premise→{conclusions}. It matters for §2: an AND-node is exactly a hyperedge.

### 1.2 Where it sits vs the named antecedents — and what each *buys* us

| Antecedent | What skynet-graph borrows | What we can still **steal** (not yet used) |
|---|---|---|
| **Rete (Forgy 1974) / Drools** | assert/retract forward-chaining, fixpoint | The β-network: **share partial matches** instead of re-sweeping every `_unstable` object. Turns the O(objects × open-concepts) sweep into incremental join maintenance. |
| **Adapton / Salsa** | demand-driven memo + dependency invalidation | **Demanded** recompute (only compute facts an active query needs) → natural beam/pruning (§3.1). Salsa's *durability/red-green* marking to skip re-verification of unchanged subtrees. |
| **Datalog + stratified negation** | the declarative `require`/`assert` rule shape | **Stratification theory** to make `ensure` (negation-as-retraction) provably terminating (§4.2). Semi-naive evaluation for the sweep. |
| **DBSP / differential dataflow (VLDB 2025)** | incremental view maintenance idea | **Z-set delta minimality** *if* you ever express the rollup as an aggregate — gives exact, minimal re-synthesis on a single child change (the holy grail of §2's reactive variant). |
| **JTMS (Doyle) / ATMS (de Kleer 1986)** | single-world defeasance | **ATMS assumption labels** for multi-world compare-alternatives without N forked graphs (§3.4). |
| **AND/OR graph search (Nilsson 1980; AO\*)** | — (not currently named!) | The *entire* decompose/synthesize loop is AND/OR search; AO\* gives admissible best-first expansion = your budget feature for free (§2, §3.1). |
| **Catamorphisms / structural recursion (Meijer-Fokkinga-Paterson 1991)** | the bottom-up `synthesize` walk | The fold *laws* (fusion, banana-split) → prove rollup boundedness and compose verification into the same pass (§2.3, §3.2). |

**The single most useful unnamed antecedent is AND/OR graph search.** The two prior studies framed the
engine as TMS + incremental compute (true) but neither named the *workload* as AND/OR search. That naming
is what unlocks budget, verification, and multi-world as textbook results rather than bespoke hacks.

---

## 2. THE BEST MODEL FOR "decompose huge problem → bounded synthesis"

### 2.1 It is an AND/OR graph, and synthesis is a catamorphism over it

Map the loop onto the classic objects (Nilsson, *Principles of AI*, 1980):

- **OR-node** = a (sub)problem/segment for which *several alternative decompositions* may exist
  ("solve step X by strategy A *or* B"). Solved if *any one* child solution succeeds.
- **AND-node** = one chosen decomposition: a segment expanded into an *ordered set of sub-segments* all
  of which must be solved (`expandedInto`, `_lab/loop.js:72`). This is the hyperedge of §1.1. Solved iff
  *all* children solved.
- **Leaf (terminal)** = an `Atomic` segment answered directly (`Answer` concept).
- **Solution graph** = a choice of one decomposition per OR-node whose AND-frontier is all leaves.

Today the engine only materializes the AND layer (every `Expand` is taken; no alternative
decompositions compete). That's a degenerate AND/OR graph = **an AND-tree (a fold over a DAG)**. The
moment you add competing strategies (memory-on-retraction, verification voting), you get real OR-nodes
and the full AND/OR machinery becomes load-bearing.

**Synthesis = a catamorphism (fold) over that AND-tree / solution graph.** Each non-leaf segment's
answer is `rollup(segFacts, [childAnswers])`; leaves are the base case (Meijer-Fokkinga-Paterson, *Functional
Programming with Bananas, Lenses, Envelopes and Barbed Wire*, FPCA 1991). The **bounded-output invariant**
— `|rollup(...)| = O(1)` regardless of subtree size — is precisely what makes the catamorphism the right
shape: it's the algebra carrier-type being fixed-size. This is the *whole* value proposition (bounded
local context per LLM call), and stating it as "the fold's carrier type is size-bounded" makes the
invariant checkable and the design non-negotiable.

> Algorithmic note: a fold over an AND/OR **graph** (shared sub-problems via memoized identical
> sub-segments) is a *catamorphism with memoization* = dynamic programming. If/when two branches
> decompose to the same sub-problem, memoize the answer by sub-problem key. This is the only place the
> incremental-compute substrate (§1.1c) and the fold meet productively: the fold's DP table IS Adapton's
> memo. Keep them the same structure.

### 2.2 Is the post-pass the right call? **Yes — keep it as default.** Here's the honest trade.

`_lab/loop.js:108` does synthesis as a deterministic post-order walk *after* stabilization, explicitly to
dodge the read-modify-write race on a reactive counter. **That is the correct engineering call and I'd
ship it.** Reasons, ranked:

1. **A topological fold is the textbook way to evaluate a DAG attribute.** Post-order = reverse
   topological order; each node read once, after all children. O(V+E), no races, trivially correct. You
   do not pay coordination cost for something that is inherently a batch reduction.
2. **The reactive version buys you nothing on a one-shot answer.** Everything is cold; there is no "small
   delta" to exploit. Incrementality only pays under *re-runs on partially-changed state* (the
   `aspect-calcul-incremental` study's condition 3). For the flagship single-prompt workload, reactive
   synthesis is pure complexity with no ROI.
3. **The race is real and nasty if done naively.** A counter-gated reactive rollup with async providers
   is a concurrent accumulator: `read AnsweredCount → +1 → write` from N async callbacks. Even
   single-threaded JS, the *interleaving across `await` points* of N provider callbacks makes "fire
   rollup exactly when the last child lands" a lost-update / double-fire hazard.

**BUT** — for the *live-data* regime (a child's input changes; re-synthesize only the affected
spine root→leaf path), you do want a reactive formulation. There is a clean one that dodges the race.

### 2.3 The clean reactive synthesis: a **stratified monotone completion counter** (a "join node")

The race exists only because the gate (`AnsweredCount == childCount`) is read-modify-write on *mutable*
state. Remove the mutability two ways; both are standard:

**Option A — Monotone completion via a grow-only set (CRDT-style), gate by cardinality.**
- Each child, when it produces `Answered`, writes its *own id* into the parent's `answeredBy` as a
  **set union** (idempotent, commutative, associative — a G-Set, Shapiro et al. 2011). `answeredBy =
  answeredBy ∪ {childId}`.
- Set-union is **idempotent**, so a double-fire or replay is harmless (no lost update — the defining
  property that kills the counter race). No `+=`; no read-modify-write that can interleave wrongly.
- The rollup gate is the derived, *monotone* predicate `|answeredBy| == childCount`. Monotone ⇒ once
  true it stays true ⇒ it can fire exactly once guarded by the `Rollup` self-flag.
- This needs **one engine affordance the current `getRef` lacks**: a *count* over a set-valued fact.
  That is a single scalar derivation (`answeredBy.length`), expressible *today* because `expr.js`
  already evaluates `.length` member access on an array (confirmed: `LongStay.json` uses
  `$TimePeriod.length`). So `ensure:["$answeredBy.length == $childCount"]` **works in the current
  evaluator** — provided the child writes `answeredBy` as an array union, not a counter. *This is the
  fix: replace the scalar counter with a grow-only array and gate on its length.* It sidesteps the
  read-modify-write entirely because union is the only mutation and it's idempotent.

**Option B — Derive completion as a stratified Datalog-style fact (a true "join node").**
- Treat `complete(parent)` as a *derived* relation: `complete(P) :- expandedInto(P, Kids),
  forall k in Kids: answered(k)`. The "forall over children" is the aggregation the engine can't express
  in a `require` walk (the established gap). So compute it as a **fold during a stratum boundary**, not as
  a per-fact watcher.
- Stratification: answers form stratum *s* = depth; `complete`/`rollup` at depth *d* belongs to a stratum
  strictly above all `answered` facts at depth *d+1*. Evaluate strata bottom-up. Within a stratum
  everything is monotone; negation/retraction only crosses strata downward. This is **stratified negation**
  (Apt-Blair-Walker 1988) and it gives you termination *and* a deterministic "fire once when complete"
  with no race, because the join is evaluated at a well-defined phase, not opportunistically.

**Recommendation.** Default = the **post-order fold** (§2.2) for one-shot — it's right, keep it. For the
live/reactive regime, use **Option A (grow-only `answeredBy` array + length gate via `ensure`)** because
it needs *zero core changes* (the evaluator already does `.length`), it is provably race-free (idempotent
union), and it is the smallest possible delta. Option B is the "do it properly with strata" answer worth
adopting if/when you generalize aggregation across the engine (it's also what makes negation safe — §4.2),
but it's a bigger lift. **Do NOT ship the mutable `AnsweredCount += 1` counter** — it is the one design in
the spec (`§4` of the inspector doc) that is accidentally a concurrent accumulator; swap it for the
grow-only set before it bites.

### 2.4 The algorithm (clean statement)

```
DECOMPOSE  (forward-chaining, reactive — the substrate does this):
  seed root segment (prompt) as an OR-node
  fixpoint:
    Task            : every Segment is a sub-problem            (require Segment)
    EvalComplexity  : classify Atomic | NeedsSplit              (depth floor ⇒ Atomic)   [OR-node resolved to a leaf or an AND-edge]
    Expand          : NeedsSplit ⇒ emit ordered child segments  (one AND-hyperedge)
    Answer          : Atomic     ⇒ leaf answer + Answered

SYNTHESIZE (catamorphism over the AND-tree):
  one-shot  : post-order(root): answer(P) = rollup(facts(P), [answer(c) for c in children(P)])   // O(V+E), race-free, BOUNDED carrier
  reactive  : on child c Answered: c writes itself into parent.answeredBy (G-Set union);
              when |answeredBy| == childCount  ⇒  Rollup fires once (self-flag), recurses up only the changed spine
ANSWER = answer(root)
```

Invariant to assert in code (it is the product): `len(rollup(...)) ≤ B` for a fixed budget B,
**independent of subtree size**. Without it, synthesis re-concentrates the whole problem into the root
call and you've rebuilt the context blowup you set out to avoid (the inspector doc's own risk note).

---

## 3. ADAPT THE PLANNED 5 TO THIS MODEL

### 3.1 Budget / pruning = **resource-bounded best-first search over the AND/OR graph (AO\*-style)**

Once decompose/synthesize is named AND/OR search, budget is not a bolt-on — it's the *search policy*.

- **Score each node with an admissible heuristic carried AS FACTS.** Add `estCost` (estimated tokens/calls
  to solve this subtree) and `estValue`/`priority` facts on each segment, written by a cheap estimator
  concept (or the `EvalComplexity` provider, which is already looking at the node). Admissible = never
  *over*-estimates value / never *under*-estimates cost, so pruning a branch can't discard the true best
  (Hart-Nilsson-Raphael 1968; AO\*, Martelli-Montanari 1978; Nilsson 1980).
- **Expansion order = best-first on a priority queue** keyed by `f = g + h` (g = cost spent on the branch,
  h = admissible estimate to completion). At AND-nodes, cost sums over children; at OR-nodes, take the
  min-cost child. This is exactly AO\*.
- **Beam = cap the OR-node frontier to width k**: keep the k best competing decompositions, drop the rest.
  Beam search is AO\* with a bounded open list — *inadmissible* (can miss optimum) but bounded, which is
  the whole point of "huge ≠ ruinous." Document it as the deliberate exact-vs-bounded trade.
- **Implementation in-engine:** the stabilization loop currently drains `_unstable` FIFO-ish. Replace the
  drain order with a **priority queue keyed by the `priority` fact** (the engine already owns
  `_unstable`; sort it / use a binary heap). A per-concept `cost` field + a global `budget` fact that each
  apply decrements gives you a hard stop: when `budget ≤ 0`, the `Expand` concept's `assert` fails ⇒ no
  more expansion ⇒ remaining OR-nodes resolve to "best-effort leaf." **This is admissible pruning encoded
  as ordinary facts + asserts — no new engine feature**, consistent with the project's "scoring = ordinary
  facts" decision (commit `53d19ea`).

> Pitfall: a binary heap over `_unstable` interacts with reactive destabilization (an object can be
> re-added). Use a *lazy* heap (push duplicates, skip stale on pop by checking a per-object `dirtySeq`),
> the standard Dijkstra-with-decrease-key dodge. Don't implement decrease-key.

### 3.2 Verification = **adversarial/k-of-n voting nodes folded into the same catamorphism**

Verification is a *fold algebra* over the same AND/OR graph, so compose it with synthesis (banana-split
law: two folds over one structure run in one pass).

- **k-of-n voting (self-consistency, Wang et al. 2022).** Make an OR-node with n *sibling* answer
  strategies (n samples / n prompts / n providers). A `Vote` concept reads the n child answers and emits
  the majority (or a judged-best) + a `confidence = agree/n` fact. n children all required = an AND-edge
  feeding a reduction = same machinery as rollup.
- **Adversarial sampling (verifier vs generator).** A `Verify` concept is a provider that takes a
  produced answer + its source facts and returns `{valid: bool, reason}`. Model it as a **justification on
  the answer**: `ensure:["$Verified"]` on the *parent's* consumption of the answer ⇒ if verification
  fails, JTMS retraction defeats the answer and (with §3.3 memory) records why. Truth-maintenance and
  verification become the *same* mechanism: a fact survives iff its verifier-justification holds. This is
  the cleanest possible fit — it's literally what `ensure` is for.
- **Confidence as an admissible-search input.** `confidence`/`valid` facts feed the §3.1 priority, so the
  search prefers verified high-agreement branches. Verification and budget compose.

> Honest caveat (the studies' K3): verification raises *coherence* confidence, not *ground truth*. k-of-n
> over a biased model votes confidently wrong. Treat confidence as a heuristic, never a proof.

### 3.3 Memory-on-retraction = **a monotone learned heuristic feeding the search**

The inspector doc §4b already designed this well (cleaner emits a bounded `{strategy, outcome, reason}`
fact to a survivor free-node, append-only, exclusion-keyed). Re-stated in this model, it is exactly:

- **A nogood store (de Kleer's ATMS nogoods) + a learned heuristic.** A retracted/failed branch deposits a
  *nogood* ("strategy S on context C ⇒ failed because R"). This is the dual of clause learning in CDCL SAT
  solvers (Marques-Silva & Sakallah, GRASP 1996): *learn from the failed assignment so you never re-derive
  it.* The memory is the learned-clause database.
- **Feeds §3.1 as a heuristic adjustment**: a context with a recorded nogood gets `priority -= penalty`
  (or strategy S's `assert` excludes contexts in the nogood set). So memory is not a separate feature —
  it is *online tuning of the admissible heuristic*, the AND/OR-search analogue of restart+learning.
- **Termination requires the nogood store be monotone (append-only) and used negatively-only** (memory can
  only *disable*/deprioritize a strategy, never re-enable one). The inspector doc's "strictly shrinking
  strategy set per context ⇒ well-founded" is the correct termination argument — it's exactly *finite
  nogood learning terminates* from CDCL. Keep it.

> Pitfall (named in the doc, worth elevating): without the strict monotonic+exclusionary discipline you
> get A→fail→B→fail→A oscillation. This is the SAT "no learned-clause forgetting on the critical path"
> rule. If you ever *garbage-collect* memory for boundedness, never GC a nogood that is currently
> excluding a live strategy — or you reopen the loop.

### 3.4 Multi-world (compare alternatives) = **ATMS labels for cheap compare; fork for true isolation**

This is the one place I'll push back on "just fork." The choice is not either/or — it's a **size cutoff**:

- **ATMS (de Kleer 1986): label each fact with the *set of assumption-sets* under which it holds.**
  An "assumption" = a choice at an OR-node (strategy A vs B; plane vs train). A fact's *label* is the
  minimal set of choice-combinations that support it. One graph holds *all* worlds simultaneously;
  comparing alternatives = comparing labels, no re-computation, **shared sub-derivations across worlds**
  (the win: facts common to A and B are computed once). This is the right model when alternatives share
  most of their structure and you compare many of them (beam over strategies, §3.1).
- **Fork (built: `Graph.fork`/`merge`) = a full isolated world.** Right when worlds *diverge hard* (truly
  different concept sets / sandboxed sub-agents / different providers), when you want crash-isolation, or
  when N is small. Cost: O(N × graph) memory, no sharing.

**Recommendation:** **ATMS-labels for in-graph beam/compare** (many cheap, structure-sharing alternatives
at OR-nodes — this is the common case for the reasoning loop and pairs perfectly with §3.1/§3.2);
**fork for sub-agent sandboxes** (few, heavyweight, isolated — the case `fork` was actually built for,
commit `f3a04fa`). They are not competitors; they sit at opposite ends of the sharing/isolation axis.

> Honest cost: ATMS is the heaviest thing here. Full label maintenance is worst-case exponential in the
> number of assumptions (label sets can blow up). **Mitigation:** bound the number of live assumptions
> (= beam width k), and only label the *contested* sub-DAG (facts above the first OR-node), keeping the
> shared base unlabeled (single-world). This is "ATMS only where worlds actually differ" — the practical
> form. If you can't bound assumptions, don't do ATMS; fork. Be disciplined or it eats you.

### 3.5 AI-authored concepts = **program synthesis over a typed grammar (the concept schema as a DSL)**

The inspector doc §4c already frames this as "DSPy but the AI authors the control structure." Sharpen the
*formal* part:

- **The concept schema IS a typed grammar (an algebraic data type / a small DSL).** A concept is a term:
  ```
  Concept ::= { _id: Id, _name: Name,
                require?:  Ref[],            // single-ref path walks  (NO quantifiers — established gap)
                assert?:   Expr[],           // jsep expressions, evaluated by expr.js  (static guard)
                ensure?:   Expr[],           // jsep expressions       (justification → installs watchers)
                provider?: ProviderRef,      // "Ns::fn" from a HOST-VETTED palette
                applyMutations?: Template,   // hyperedge RHS
                cleaner?:  ProviderRef,
                childConcepts?: { Name: Concept } }
  Expr    ::= jsep grammar  (App/expr.js: members/calls/ternary/operators; NO constructor/__proto__)
  Ref     ::= ident (':' ident | '.' ident)*           // a:b:c walk; scalar only
  Template::= the $-prefixed mutation DSL (Graph.js header)
  ```
- **AI authors *terms of this grammar*; the host owns the *primitives*** (the provider palette + the ref
  alphabet). This is the safety boundary: synthesis ranges over declarative structure, never over arbitrary
  JS (the `LLM::complete` universal provider makes that boundary cheap — most experts need no new code).
- **Validation = type-checking the term, in three layers (cheapest first):**
  1. *Structural* (JSON-schema): field names/types, `provider` ∈ palette, `_name` present (the engine
     *requires* a self-flag name or the concept re-fires forever — `Entity.js:130`,
     `Concept.applyTo:185-207`; **make "writes its own `_name`" a validated invariant**, it's the #1
     authoring footgun).
  2. *Expression well-formedness*: `assert`/`ensure` parse under jsep (`compileExpression` throws on
     syntax error — catch it at author time, not stabilize time). Reject `constructor`/`__proto__`
     (expr.js already blocks them at eval; reject at validation for a clean error).
  3. *Ref soundness* (static analysis, the valuable one): every `$ref` walk is a path over known concept
     names; flag a `require` that tries to aggregate (e.g. ends in a collection) since the engine can't —
     this catches the "all children answered" mistake *at authoring time* instead of as a silent
     never-fires bug.
- **Self-improvement loop = inductive program synthesis with the trace+memory as the spec.** The trace
  (built) = positive/negative examples of "did this concept fire when it should"; memory-on-retraction
  (§3.3) = the counterexamples. AI patches the term (`patchConcept`, built) or adds one (`addConcept`,
  to build) and re-runs. This is CEGIS (counterexample-guided inductive synthesis, Solar-Lezama 2006) with
  the graph as the verifier. **Frame it exactly as CEGIS** — it gives you the termination/convergence
  story (each counterexample strictly constrains the candidate space) and the same monotonicity discipline
  as §3.3.

> Pitfall: live self-modification (a meta-concept calling `addConcept`/`patchConcept` mid-stabilize) is
> the riskiest tier. It is **non-monotonic in the rule set itself** — you're mutating the program while it
> runs. Termination of the *base* loop no longer implies termination of the *meta* loop. Gate it behind a
> meta-budget (max edits/run) and the same stratification (meta-edits are a strictly higher stratum than
> the rules they edit; a meta-concept may not edit a concept that is currently mid-apply on the stack).
> The re-entrancy concern the doc flags is real; the stratum rule is the principled answer.

---

## 4. COMPLEXITY / PITFALLS (the sharp edges)

### 4.1 Termination

- **Base decompose loop terminates** iff (a) the depth floor is a hard base case (it is —
  `_lab/loop.js:56`), and (b) every concept self-flags (`Entity.js:130`; un-self-flagged ⇒ infinite
  re-fire). The fixpoint exists because, *with self-flags*, the set of derivable facts is finite and the
  loop is monotone-until-retraction. **Make self-flagging a validated invariant (§3.5), not a convention.**
- **With `ensure` (retraction), the loop is non-monotonic** ⇒ termination is NOT automatic. A→retract→
  re-derive→retract is a live oscillation. The guarantee you want is **local stratification** (§4.2).
- **Cost ≠ termination** (the calcul-incrémental study's K2, worth repeating): a *terminating* graph can
  legitimately fire 400 LLM calls. Memoization bounds *redundant* work, never *exploration*. Only the
  §3.1 budget/beam bounds exploration. These are different guarantees — don't conflate "it stabilizes"
  with "it's affordable."

### 4.2 Stratification & negation in `ensure`

`ensure` is negation-as-retraction: "this belief holds only while premise P holds." Unrestricted negation
in a forward-chaining loop has no well-founded semantics (can oscillate). The fix is **stratified negation**
(Apt-Blair-Walker 1988; Van Gelder well-founded semantics 1991):

- Assign each concept a **stratum**; a concept whose `ensure` depends *negatively* on fact F must be in a
  stratum strictly above F's producer. Evaluate strata in order. Within a stratum: monotone (terminates).
  Negation only crosses strata downward (no cycle through negation ⇒ no oscillation).
- **For this engine concretely:** depth is a natural stratum (children below parents). The dangerous case
  is a *sideways* `ensure` (concept X on a segment depends on a sibling's fact that X can also retract).
  **Lint for negative cycles among concepts at authoring time** (a Tarjan SCC over the
  concept-dependency graph where `ensure`-edges are "negative"; an SCC containing a negative edge =
  unstratifiable = reject or warn). This is a cheap static check and it's the principled guard against the
  oscillation the memory-loop and verification-loop both risk.

### 4.3 The aggregation gap (the real structural limitation)

Confirmed in code: `getRef` (`Graph.js:450-526`) walks `:`/`.` as a **scalar pointer chase**; there is no
fold/quantifier/`forall`/count over a *set* of children. So "all children answered" is **not expressible as
a `require`**. The whole library confirms it — the only "aggregation" anywhere is `.length` member access on
a single array fact (`LongStay.json`). Consequences:

- Any "join over children" must be done by (i) a scalar counter (racy — avoid, §2.3), (ii) a **grow-only
  array + `.length` gate** (the recommended fix, works in the current evaluator), or (iii) a provider-side
  read of `expandedInto` (works but pulls children imperatively, outside the reactive net).
- **The clean general fix** is to add *one* stratified aggregation primitive: a derived `count(setRef)` /
  `all(setRef, pred)` evaluated at stratum boundaries (Option B, §2.3). That single addition closes the
  gap for completion-gating, k-of-n voting, beam frontier size — all of which are "aggregate over a
  set of children." If you add one engine feature this decade, add stratified set-aggregation, not more
  ref-walk sugar.

### 4.4 Cache / memo soundness (the K1/K3 cluster — the existential risk)

- **K1 — memo-key fragmentation on prose.** The memo key is the tracked typed facts. Discrete facts
  (depth, ids, budgets, dates) ⇒ clean exact-match, stable, better than prompt-hash caching. **LLM prose
  as a tracked input ⇒ the key fragments (semantic near-dups) ⇒ permanent cache miss ⇒ incrementality
  evaporates.** Discipline (the only real defense): providers emit *typed, discrete, canonicalized* facts
  (strict JSON-schema extraction, quantized scores, enums), never raw prose, into anything another concept
  `require`s. This is the single most important *modeling* rule for the substrate to pay off. The
  catamorphism's `answer` strings are fine to carry *as data*, but must not become *memo keys* — keep them
  off the `require`/`ensure` dependency paths.
- **K3 — hallucinated facts propagate cleanly.** JTMS guarantees *coherence*, not *truth* (both studies,
  correctly). A syntactically-valid hallucination is graven as truth, casts/retracts cleanly, and the
  *rigor of the mechanism gives a false sense of reliability.* Verification concepts (§3.2) are the
  mitigation but only raise coherence-confidence. **Add fact provenance + a freshness/expiry on
  provider-graven facts** (the calcul-incrémental study's K3: no implicit TTL today, unlike prompt
  caching). A graven fact should carry `producedAtRev` (the trace already computes this) and optionally a
  TTL so stale API results don't fossilize.
- **Non-hermetic memo (Bazel lens).** Providers are non-deterministic + networked ⇒ you can guarantee
  deterministic *triggering* (do we re-call?) but not reproducible *content* (what got graven). The first
  answer becomes "truth." Be explicit that the replay/rollback gives *trajectory* reproducibility, not
  *content* reproducibility. Don't oversell `serialize`+`rollbackTo` as deterministic replay of reasoning;
  it's deterministic replay of the *fact graph that resulted*.

### 4.5 Where it blows up (complexity)

| Concern | Current | Risk | Fix |
|---|---|---|---|
| Match | naive sweep of `_unstable` × open concepts | O(objects × concepts) per cycle; quadratic-ish on big graphs | Rete β-network *or* index `_mapsByConcept` (partly there) for selective retest |
| Synthesis | post-order fold | O(V+E), fine | keep; memoize shared sub-problems (DP) |
| Search frontier | FIFO drain | unbounded exploration (K2) | priority queue + budget/beam (§3.1) |
| Multi-world | fork = O(N × graph) | memory blowup at large N | ATMS labels with bounded assumptions (§3.4) — but label-size is itself worst-case exponential; bound k |
| `ensure` cycles | none enforced | non-termination/oscillation | stratification lint (§4.2) |
| Memo key | tracked facts | prose fragmentation (K1) | canonicalize provider outputs to discrete facts |
| Deep recursion | recursive `unCast` / `synthesize` | JS stack overflow on deep DAGs | explicit-stack the post-order walk and the uncast cascade (same gotcha as iterative Tarjan) |

---

## 5. RECOMMENDATION (ranked, what to actually do)

1. **Name the loop AND/OR search + catamorphism in the codebase.** It reframes budget, verification, and
   multi-world as textbook results, not bespoke code. This is the highest-leverage, zero-code change.
2. **Keep post-order synthesis as default; assert the bounded-carrier invariant** (`|rollup| ≤ B`) as a
   test. It is the product. (Built — just guard it.)
3. **Replace the mutable completion counter with a grow-only `answeredBy` array + `$answeredBy.length ==
   $childCount` `ensure` gate** for the reactive regime. Race-free (idempotent union), zero core change
   (`expr.js` already does `.length`). **Do not ship `AnsweredCount += 1`.**
4. **Budget/beam = priority queue over `_unstable` keyed by a `priority` fact + per-apply budget
   decrement.** Admissible scoring as ordinary facts (consistent with commit `53d19ea`). Lazy heap to
   survive reactive re-destabilization.
5. **Verification = `ensure`-justified answers + k-of-n vote OR-nodes**, confidence feeding the priority.
   TMS and verification become one mechanism.
6. **Memory-on-retraction = monotone nogood store feeding the heuristic; frame as CDCL clause learning +
   CEGIS.** Append-only, negative-only, exclusion-keyed (the doc's discipline is right). Lint for the
   oscillation trap.
7. **Add ONE engine primitive when ready: stratified set-aggregation** (`count`/`all` over a child set,
   evaluated at stratum boundaries). Closes the aggregation gap for completion, voting, and beam size in
   one stroke, and gives `ensure` a well-founded semantics.
8. **Multi-world: ATMS labels for in-graph beam (bounded assumptions), fork for sandboxed sub-agents.**
   Opposite ends of the sharing/isolation axis; not competitors.
9. **AI-authored concepts = typed-grammar program synthesis (CEGIS).** Validate structure (not grammar):
   self-flag present, providers in palette, asserts parse, ref-walks sound (flag attempted aggregation).
10. **Static safety nets:** Tarjan-SCC negative-cycle lint for `ensure` stratification; explicit-stack the
    deep recursions; canonicalize provider outputs to discrete facts (kills K1); provenance+TTL on graven
    facts (mitigates K3).

---

## 6. REFERENCES (worth borrowing from)

- **AND/OR graphs & AO\*** — Nilsson, *Principles of Artificial Intelligence*, 1980; Martelli & Montanari,
  *Optimizing decision trees through heuristically guided search*, CACM 1978. → budget/pruning (§3.1).
- **A\*** — Hart, Nilsson, Raphael, *A Formal Basis for the Heuristic Determination of Minimum Cost Paths*,
  IEEE TSSC 1968. → admissible scoring.
- **Catamorphisms** — Meijer, Fokkinga, Paterson, *Functional Programming with Bananas, Lenses, Envelopes
  and Barbed Wire*, FPCA 1991. → bounded bottom-up synthesis as a fold (§2).
- **JTMS / ATMS** — Doyle, *A Truth Maintenance System*, AIJ 1979; de Kleer, *An Assumption-Based TMS*,
  AIJ 1986. → defeasance (built) and multi-world labels (§3.4).
- **Rete** — Forgy, *Rete: A Fast Algorithm for the Many Pattern/Many Object Pattern Match Problem*, AIJ
  1982. → replace the naive sweep with shared partial-match maintenance (§4.5).
- **Stratified / well-founded negation** — Apt, Blair, Walker, *Towards a Theory of Declarative
  Knowledge*, 1988; Van Gelder, Ross, Schlipf, *The Well-Founded Semantics for General Logic Programs*,
  JACM 1991. → terminating `ensure` (§4.2).
- **Incremental computation** — Acar, *Self-Adjusting Computation*, CMU thesis 2005; Hammer et al.,
  *Adapton*, PLDI 2014; Salsa (rust-analyzer query system). → the substrate (already in `doc/aspect-*`).
- **Incremental view maintenance / deltas** — *DBSP*, VLDB Journal 2025; differential dataflow. → minimal
  reactive re-synthesis if rollup is ever an aggregate (§2.3 Option B).
- **CRDTs (G-Set)** — Shapiro, Preguiça, Baquero, Zawirski, *Conflict-Free Replicated Data Types*, 2011.
  → race-free completion counter as monotone union (§2.3 Option A).
- **CDCL clause learning** — Marques-Silva & Sakallah, *GRASP*, 1996. → nogood/memory learning + the
  no-forget termination discipline (§3.3).
- **CEGIS** — Solar-Lezama et al., *Combinatorial Sketching for Finite Programs*, ASPLOS 2006. → AI-authored
  concept self-improvement loop (§3.5).
- **Self-consistency / voting** — Wang et al., *Self-Consistency Improves Chain of Thought Reasoning*, 2022.
  → k-of-n verification (§3.2).
- **In-repo studies (already excellent, build on them):** `doc/aspect-calcul-incremental.md` (Adapton/
  Salsa/DBSP/Bazel framing + K1–K4), `doc/aspect-modele-programmation-fiabilite.md` (JTMS/Rete/Datalog
  framing + K1–K5), `docs/superpowers/specs/2026-06-21-moe-graph-inspector-design.md` (§4 rollup, §4b
  memory-on-retraction, §4c AI-authoring — designs this doc formalizes).

---

*Code read: `App/Graph.js` (getRef L450-526, pushMutation L840-1260, stabilize/_loopTF L288-310,
fork/merge L1938-1985, rollback/diff L1833-1923, getPaths/getChildPath), `App/objects/Concept.js`
(isApplicableTo/applyTo/_compileAssert/patch), `App/objects/Entity.js` (updateApplicableConcepts/unCast/
static_ensure/set/get/follow), `App/tasks/stabilize.js`, `App/expr.js` (jsep evaluator — confirms `.length`
member access works, no quantifiers), `_lab/loop.js` + `_lab/run-prompt.js` (the decompose→synthesize loop),
`concepts/common/*` (confirms single-ref requires, scalar-only aggregation).*
