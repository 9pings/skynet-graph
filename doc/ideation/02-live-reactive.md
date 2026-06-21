# Ideation 02 — The Live / Reactive / Incremental lens

**Engine:** skynet-graph "MOE Graph" reasoning substrate · **Branch:** `feat/moe-graph-v1-phase0`
**Lens:** treat the graph as a *self-adjusting computation* over expensive, effectful, non-deterministic
nodes (LLM/API calls). What does *live recompute of only the affected subpaths* uniquely buy, where does it
**not** pay, what mechanisms does this lens force, and how should the graph be modeled so the edge is real?

Grounded in the code actually on this branch:
- change-propagation hooks: `Entity.set` destabilizes followers (`Entity.js:322-331`), `getRef(...,follow)`
  installs watchers (`Entity.js:113-128`, `Graph.getRef` `Graph.js:450-526`), `ensure` retracts on premise
  fall (`Entity.js:19-27` `static_ensure`, cascade in `unCast` `Entity.js:192-246`).
- fixpoint loop: `_loopTF` / `stabilize.js`, snapshot-per-stabilize `_captureSnapshot` (`Graph.js:1833`),
  `rollbackTo` (`Graph.js:1909`), `diffRevisions` (`Graph.js:1876`).
- serialized memoization of effects: provider result → `pushMutation` graven as typed facts
  (`Concept.applyTo` `Concept.js:139-208`).
- the open synthesis problem: counter-gated reactive rollup (`inspector-design.md §4`), the post-pass
  workaround (`_lab/loop.js:108-123 synthesize`).
- prior art / honest limits: `doc/aspect-calcul-incremental.md` (read first; this doc extends it).

The prior study (`aspect-calcul-incremental.md`) already nailed the *mechanism* (Adapton/Salsa transposed to
LLM-cost nodes) and the *killer risks* (K1 memo fragmentation, K2 terminaison≠économie, K3 cache poisoning,
K4 churn overhead). **This document does not re-argue those.** It asks the next question: *given that
mechanism, what live/reactive products materialize, and exactly how must we change the modeling and the
engine so they work on real workloads.*

---

## TL;DR — ranked by leverage

| # | Idea | Kind | Leverage | Effort | Risk |
|---|------|------|----------|--------|------|
| 1 | **Fact freshness/TTL + epochs** (kill cache poisoning, enable live data) | engine | ★★★★★ | M | low |
| 2 | **Canonicalization barrier** (LLM prose → discrete typed facts) to make memo keys stable | modeling+provider | ★★★★★ | M | med |
| 3 | **Reactive synthesis via monotone CRDT counter** (solves the read-modify-write race) | engine+modeling | ★★★★☆ | S–M | low |
| 4 | **Incremental / delta budget** (pay only for the churned subpath, not the whole tree) | engine | ★★★★☆ | M | med |
| 5 | **Live "watched-fact" sources** (external streams as bagRefs with push invalidation) | engine+host | ★★★★☆ | M | med |
| 6 | **Dirty-set provenance + partial-invalidation trace** ("what will re-fire if X changes") | tooling | ★★★☆☆ | S | low |
| 7 | **Reactive verification concepts** (re-check on change, retract on contradiction) | modeling | ★★★☆☆ | S | low |
| 8 | **Two-tier nodes: cheap-reactive vs expensive-gated** (debounce/hysteresis on LLM nodes) | modeling | ★★★☆☆ | S | med |

Ideas 1–3 are the unlock. Without 1 the system poisons itself on live data; without 2 the incrementality
evaporates on prose; 3 removes the one thing currently blocking *reactive* (not post-pass) synthesis.

---

## 1. PROBLEMS / INNOVATIONS — what live+reactive uniquely enables

### 1.1 The defensible class: "standing computations over changing facts"

The unique shape here is **a long-lived reasoning artifact that you mutate small and it re-reasons small**,
*and* every recompute is explainable and revertible. That combination — incremental LLM recompute + JTMS
retraction + git-style history (`rollbackTo`/`diffRevisions`/`fork`) — does not exist as a single primitive
in differential-dataflow, Salsa, or a re-prompt-everything agent. Five products fall out of it:

**P1 — Live-data dashboards that *re-reason*, not just re-render.** A BI/ops dashboard today re-renders when
numbers change; it does not re-derive the *narrative*. Model each derived insight as a fact produced by an
`LLM::complete` expert whose `require`/`follow` point at the metric facts. When a metric crosses a threshold,
only the insights that *transitively depend on that metric* re-fire (`Entity.set` → followers destabilized →
`_loopTF`). Everything else is graven and skipped. Edge vs a re-prompt agent: the agent pays the full prompt
every refresh; here you pay only the delta, *and* you can show the user the diff of which conclusions changed
(`diffRevisions`).

**P2 — Re-planning on changed constraints (the engine's native sweet spot).** A plan is a tree of segments;
a constraint (budget, deadline, a now-unavailable resource) is a fact. Flip the fact → `ensure` retracts
exactly the sub-plan that depended on it and re-expands only that branch. This is *structural* partial
re-planning, not "regenerate the plan." LangGraph rolls back to a checkpoint and re-runs forward with no
residue; here the unaffected 90% of the plan is untouched and the retracted branch can leave a **memory**
(planned §4b) so the re-plan avoids the dead end. **This is the single most over-determined fit** — the
original travel domain *is* this.

**P3 — IDE-like incremental analysis of large corpora / codebases.** This is literally what Salsa is for,
but with LLM queries as the expensive nodes. A repo = nodes (files/symbols) + segments (calls/imports);
experts derive summaries, vulnerabilities, doc. Edit one file → only the summaries that `follow` that file
(and their rollups) re-run. The graph is the on-disk derived-knowledge cache (`serialize()` is the
artifact). Edge vs Salsa: Salsa nodes are pure/cheap; here a node avoided is a $0.03–$3 LLM call avoided,
so the *same* mechanism has 100–1000× the ROI — exactly the argument in §aspect-calcul-incremental.

**P4 — Streaming / event-driven monitoring with explanation.** Events arrive as `pushMutation` (or
`pushAtomicUpdates`) onto an entity; experts that watch those keys fire; a verification/alert expert casts
when a contradiction holds and **retracts itself** when the situation clears (`ensure`). The standing
"alarm" is a cast concept; its presence/absence *is* the monitor state, and the `why`/trace explains it.
This is a JTMS as a monitor — it tells you not just *that* it's alarming but the chain of facts that justify
it, and it self-clears.

**P5 — Collaborative / multi-agent reasoning on shared working memory.** The master/client sync
(`pushAtomicUpdates`, `cfg.pushToMaster`, `serialize`) means several agents (or humans) mutate one graph;
each mutation incrementally re-stabilizes for everyone. `fork`/`merge` lets a sub-agent explore in a sandbox
and reintegrate a *bounded projection* (`merge(child, targetId, project)`), not a transcript. The reactive
layer is what makes the shared memory *converge* instead of needing a full re-run per participant.

### 1.2 The honest unique edge (one sentence each)

- **vs differential-dataflow / Materialize / DBSP:** they guarantee a *minimal* delta but require a closed
  relational algebra; an LLM provider emits an *arbitrary* sub-graph, so we trade minimal-delta for
  arbitrary-transform expressiveness. We are "IVM for non-algebraic, effectful nodes." We must *not* claim
  delta-minimality (the prior study is right: our invalidation is correct-but-coarse).
- **vs Salsa / Adapton:** same demand-driven mechanism, but our nodes are expensive+effectful, so
  incrementality has economic (not just latency) value — *and* we add retraction-with-residue and revision
  history that Salsa doesn't have.
- **vs a re-prompt-everything agent + prompt-caching:** orthogonal and complementary. Prompt-caching lowers
  the cost of an *appel qui a quand même lieu*; we decide *whether the call happens at all*. Stacked, they
  multiply. Our extra: the agent has no notion of "this conclusion still holds, don't re-derive it."

### 1.3 Where incrementality does NOT pay (be honest)

1. **One-shot questions.** Everything is cold; tracking overhead is pure loss. For "answer this once," a
   straight decompose→answer is better; skip the reactive machinery (just use it for the bounded-context
   decomposition, not for re-use).
2. **High-churn / global-input changes.** If a top-level fact that *everything* depends on changes every
   tick, you invalidate the whole graph each tick → you pay tracking overhead on top of a full recompute
   (K4). Incremental only wins under **small delta over large stable state**.
3. **Prose-keyed nodes (the dominant trap, K1).** If a node's tracked input is variable LLM prose, the memo
   key changes every run, the cache never hits, incrementality is *nil* — and worse than nil because you
   still pay the watcher bookkeeping. Idea 2 (canonicalization) is the precondition; without it, several of
   the products above are aspirational.
4. **Non-decomposable reasoning.** If the problem genuinely doesn't factor into locally-stabilizable facts
   (true holistic judgment), there are no independent subpaths to re-use; the graph is a flat star and you
   gain nothing structurally.

---

## 2. DEDUCED IMPROVEMENTS — mechanisms this lens forces

### 2.1 Fact freshness / TTL / epochs (★★★★★ — fixes K3, enables live data)

**Problem.** The first provider answer is graven as truth and reused until a *tracked* dependency changes
(`Concept.js:168` writes the result; it never expires). For deterministic geo this is fine; for an LLM
hallucination or a flight price it's **poison frozen into the cache with no TTL** (K3), and for genuinely
live data ("current load", "today's price") there is no notion that the fact is *stale even though nothing
in-graph changed*.

**Mechanism (small, additive).** Stamp provider-produced facts with provenance the engine already half-has
(`_rev` per object) plus time/epoch:
- On every concept-apply mutation, also stamp the target with `_factMeta[conceptName] = { atRev, atMs,
  ttlMs?, epoch? }`. The trace record (`onConceptApply`, `Graph.js:1226-1246`) already carries `rev`/`ms`;
  reuse it.
- A concept may declare `freshness: { ttlMs }` or `freshness: { epochRef: "$clock:tick" }`.
- A lightweight reaper (a single interval, or piggy-backed on `_loopTF`) walks facts whose `atMs + ttlMs <
  now` and **destabilizes** their owning object (`toggleGraphObjectState(id, "unstable")`) so the concept
  re-evaluates → the provider re-fires → fresh fact. This is just a *timed destabilize*; it reuses the whole
  existing re-fire path. No new evaluation machinery.
- Epoch variant: bind a global `clock` free-node; `freshness.epochRef` adds it to the concept's `follow`
  set, so bumping `clock.tick` invalidates exactly the time-sensitive concepts (not the whole graph).

**Why it's the #1 unlock.** Without TTL/epochs the system is only safe on *hermetic* facts; the prior study
flagged this as the gap vs prompt-caching's automatic 5-min/1-h expiry. TTL is what turns "graven snapshot"
into "live cache." It also gives a clean knob for the cost/freshness trade (cheap facts → short TTL; $3
facts → long TTL + explicit invalidation only).

### 2.2 Canonicalization barrier — discrete-fact projection (★★★★★ — fixes K1)

**Problem (the dominant one).** Incrementality dies the moment a node's tracked input is variable prose.
Two semantically-equal LLM outputs differ textually → memo key changes → permanent miss (K1).

**Mechanism.** Make a *modeling discipline enforced by a provider wrapper*: every `LLM::complete` expert
that feeds *downstream experts* must emit a **canonical, typed, low-cardinality projection**, separate from
its prose. Two layers:
- **Schema-constrained extraction:** the provider returns `{ facts: {<typed discrete keys>}, prose }`. Only
  `facts` are written as *tracked* keys (the ones other concepts `require`/`follow`); `prose` is written to
  an *untracked* key (read by humans / final synthesis, never a memo input). This is the structural fix:
  **downstream dependencies must point only at discrete facts, never at prose.**
- **Quantization / normalization:** numeric facts rounded to a declared grain; enums snapped to a closed
  vocabulary; ids normalized. So "≈$1,203.40" and "$1203" both become `priceBucket: "1.2k"` if that's the
  grain the downstream actually needs. The grain is a per-edge declaration.
- Optional **content digest** of `facts` as the explicit memo key, so identical projections short-circuit
  even across re-prose.

**Honest caveat (from K1).** Any *semantic* canonicalization (embedding+threshold) re-imports GPTCache-style
false-hits, which in a cascade-invalidation graph **propagate** (a false-hit grave a false fact that
triggers/inhibits other concepts). So: prefer **strict structured extraction with a closed vocabulary**
(deterministic canonicalization) over embedding-similarity. Reserve fuzzy matching for the final
human-facing layer where a false-hit doesn't poison derivations. This is a modeling rule first, a provider
helper second; the engine doesn't need to change, but `addConcept`/schema validation (planned §4c) should be
able to *mark* a key as "tracked/discrete" vs "prose/untracked" so the discipline is checkable.

### 2.3 Reactive synthesis without the counter race (★★★★☆ — solves the open problem)

This is the explicitly-open design problem. Solved below in §5 (it deserves its own section).

### 2.4 Partial-invalidation tracing / dirty-set provenance (★★★☆☆)

The dependency edges are *materialized* (`_followersByConceptName`, `_watchers`, `refMap`) but nobody can
*query* them. Two cheap tools the reactive lens demands:
- **`whatDependsOn(objId, key)`** — walk `_followersByConceptName[key]` transitively → "if I change this
  fact, these N concepts re-fire (est. cost $X, Y tokens)." This is *predictive cost of an edit* — the thing
  P1/P3 users actually want before they touch live data.
- **Invalidation trace**: when a `set` destabilizes followers, emit a `cfg.onInvalidate(fromKey, toIds,
  reason)` event (mirror `onConceptApply`). Then the inspector can show *the dirty wave*, not just the
  apply. Combined with the existing `diffRevisions`, you get "what changed and *why the recompute cascade
  took the shape it did*" — the cache-traceability edge (A3 in the prior study) made real.

### 2.5 Hysteresis / debounce on expensive nodes (★★★☆☆)

Under live data, a flapping input re-fires an LLM node every flap. The lens forces a **commit/settle gate**
on expensive concepts: `debounceMs` (don't re-fire until the input has been stable for N ms) and/or
`threshold` (only re-fire if the discrete projection actually crossed a grain boundary — falls out of 2.2
for free: if the canonical fact didn't change, don't destabilize the follower). The second is the *real*
fix: canonicalization makes most flaps invisible because the discrete key is unchanged.

---

## 3. ADAPT THE PLANNED 5 for live/reactive

The five planned improvements were designed largely for the *one-shot decompose→answer* loop. Each needs a
reactive amendment so it composes with *re-fire on change* rather than fighting it.

### 3.1 Memory-on-retraction × re-firing

Planned (§4b): a retracted (failed) path deposits a bounded memory fact via `cleaner`, anchored on a
survivor (`memory` free-node), and strategy concepts read it to avoid repeats; correctness rests on
**append-only / negative-only dependence** so the strategy set strictly shrinks (well-founded).

**Reactive amendment.** Under *live re-firing*, a path can be retracted not because it *failed* but because
its **premise legitimately changed** (P2 re-planning). Those are different and must not be conflated:
- Tag the memory with `cause: 'failed' | 'premise-changed' | 'stale-ttl'` (the engine knows which: a
  `cleaner` triggered by `ensure`-fall on a *constraint* fact is `premise-changed`; one triggered by a
  verification retraction is `failed`; one by the §2.1 reaper is `stale-ttl`).
- **Exclusion must be epoch-scoped.** A `failed` memory should exclude that strategy *until inputs change*;
  a `premise-changed` retraction should NOT exclude the strategy (it may be valid again when the premise
  flips back). Otherwise live re-planning permanently bans strategies that were only situationally wrong.
  Concretely: exclusion key = `failed_<ctx>_<strat>@<inputEpoch>`; when the input epoch advances, the old
  exclusion no longer matches the assert → the strategy is eligible again. This *preserves* the well-founded
  termination *within* an epoch (the §4b guarantee) while *permitting* re-exploration *across* epochs (the
  live requirement). This is the key adaptation: **monotonic within epoch, reset across epoch.**

### 3.2 Budget / pruning → *incremental* budget (pay only for the delta)

Planned (§0.3): per-concept cost + beam so "huge" isn't "ruinous." As specified it's a *global* budget over
a from-scratch expansion.

**Reactive amendment — the budget must be charged against the dirty set, not the whole graph.**
- Maintain a running `spent` per *revision-wave*. When a `set` destabilizes a sub-region, the budget for
  *this re-stabilization* should be sized to the **estimated cost of the dirty set only** (use §2.4
  `whatDependsOn` to estimate), not re-budgeted as if cold. Re-stabilizing after a 1-fact edit must not
  re-spend the cold budget.
- **Memoized nodes are free and must not be charged.** A node skipped because its discrete key is unchanged
  costs nothing; budget accounting must subtract graven/skip-hits, else the beam prunes branches that
  wouldn't actually have cost anything. (This is exactly where canonicalization §2.2 pays off twice: stable
  keys → real cache hits → real budget savings.)
- Beam under live data should prefer **keeping already-graven branches** over re-exploring (an incremental
  bias): a branch with cached facts is cheaper to keep than a fresh alternative is to open.

### 3.3 Live self-modification × incremental recompute

Planned (§4c-live): a meta-concept calls `addConcept`/`patchConcept` mid-run; `patchConcept` already
re-evaluates every live object and re-stabilizes.

**Reactive concern — `patchConcept` is currently *global* (re-evals **every** object, `Graph.js:798-809`).**
Under a live, churning graph that's a stop-the-world invalidation — exactly the K4 anti-pattern. Amendments:
- **Scoped re-eval.** A patch to concept C only needs to re-evaluate objects where C is/was applicable —
  i.e. objects in `_mapsByConcept[C._name]` ∪ those matching C's `require` roots — not all of `_objById`.
  This is a direct optimization to `patchConcept` (filter the `Object.keys(this._objById)` loop by
  candidacy). Turns self-modification from O(graph) to O(affected) per patch.
- **Re-entrancy (flagged open in §4c-live).** The meta-concept *is* a provider; calling `patchConcept` from
  inside its callback during stabilization. The `_mutationThreadRunning` guard (`Graph.js:903-908`) queues
  nested *mutations*, but `patchConcept` does cast/uncast + `stabilize()` directly, not via that queue.
  **Recommendation:** route `addConcept`/`patchConcept` issued *during* stabilization through a pending
  queue drained at the *top of `_loopTF`* (alongside `_triggeredCast`), so a structural change is applied at
  a quiescent loop boundary, never mid-apply. This makes live self-modification compose with the loop the
  same way `_triggeredCast` already does. (Same discipline class as the §4b mid-uncast write.)
- **Version the concept lib for rollback.** `rollbackTo` restores object facts but not concept-lib edits. If
  a meta-concept patched an expert, a rollback should also restore the *expert* version. Stamp each
  `patchConcept`/`addConcept` with a rev and snapshot the concept schema alongside the state snapshot
  (`_captureSnapshot`), so "git for reasoning" covers *both* the data and the rules. Without this, live
  self-modification breaks the revertibility guarantee.

### 3.4 Verification concepts × re-run on change

Planned (§0.5): verification concepts (truth ≠ coherence).

**Reactive amendment — verification must be a *standing* concept, not a one-shot gate.** Model a verifier
as: `require` the fact(s) it checks, `ensure` the contradiction predicate, `provider` the check. Because it
uses `ensure` (the WATCHED gate — `Entity.js:98-121`), it **re-runs automatically when a checked fact
changes** and **retracts itself when the situation is resolved** (P4). Two refinements:
- A *failed* verification should not silently sit; it should retract the *verified-dependent* facts
  (cascade) and deposit a `failed` memory (§3.1) so the producer expert re-tries differently. This makes
  verification a live feedback loop, not a final assert.
- **TTL on verifications** (§2.1): a "checked OK" fact for live data should expire so the verifier re-runs
  even if nothing in-graph changed (the source-of-truth may have drifted).

### 3.5 Cross-cutting: the five only pay off *together with* 2.1+2.2

The reactive amendments above all assume (a) facts can go stale (TTL) and (b) memo keys are discrete. If
canonicalization isn't enforced, re-firing is constant (no cache hits), budget can't be charged
incrementally (everything's always dirty), and verification re-runs forever. **2.1 + 2.2 are load-bearing
for the whole reactive story**, which is why they top the ranking.

---

## 4. BEST MODELING — so the incremental edge actually materializes

The mechanism is sound; whether it *pays* is entirely a modeling question (this is the prior study's central
honest point). Concrete rules, in priority order:

**M1 — Separate tracked facts from prose, always.** Every expert writes two kinds of keys: *discrete typed
facts* (low cardinality, the only things other experts may `require`/`follow`) and *prose* (untracked, human
/ final-synthesis only). Downstream dependencies point **exclusively** at discrete facts. This single rule
is what makes memo keys stable (defeats K1) and what makes invalidation *narrow* (a prose change doesn't
ripple). Enforce it in the concept schema (§2.2): a `provider` declares its `produces: {factKey: type}`
contract; `addConcept` validation rejects a `require` that targets a non-discrete key.

**M2 — Granularity tuned to the *invalidation* unit, not the *semantic* unit.** Concepts should be fine
enough that a realistic change dirties a *small* sub-region (the prior study's success-condition #2). If one
mega-expert produces 20 facts, any input change re-runs all 20. Split it so each expensive call owns the
narrowest fact set. Conversely, don't over-shard cheap deterministic nodes (tracking overhead, K4). Rule of
thumb: **one expensive (LLM/API) call per concept; bundle cheap deterministic derivations.**

**M3 — Make the "what's stable" boundary explicit (large stable core + small live edge).** The incremental
win exists only as small-delta-over-large-stable-state (K4). Model the durable knowledge (corpus, plan
skeleton, domain facts) as the stable core and the live inputs (metrics, prices, events) as a *thin,
clearly-marked* set of `bagRef`/epoch-bound facts (§2.1, §5-idea-5). If "live" is diffuse across the whole
graph, you're in the high-churn regime where incremental loses — restructure or accept it.

**M4 — Bounded rollups everywhere context re-concentrates.** Synthesis (§5), `merge` projections, and memory
facts must all be O(1) in subtree size (the inspector-design invariant). A reactive system re-runs these on
change; if any of them is unbounded, every live update re-concentrates the whole context and you've lost the
"graph as working memory" property. **The bound is not an optimization, it's the load-bearing invariant.**

**M5 — Epoch/clock as a first-class free-node.** Time-sensitivity is a dependency, not an ambient. A global
`clock` free-node that experts `follow` (via `freshness.epochRef`) turns "is this stale?" into the same
change-propagation the engine already does well, instead of a side-channel. Bumping the clock invalidates
*exactly* the time-bound concepts.

**M6 — Idempotent, self-flagging providers (already a known rule, restate for reactive).** Every provider
must set its own concept name in the result (`loop.js:88-92` comment) so it doesn't re-fire forever. Under
*reactive* re-firing this is doubly critical: a provider that re-fires must reach the *same* fixpoint, so its
output must be a pure function of its (canonical) inputs. Non-idempotent providers + re-firing = oscillation.

---

## 5. SOLVING the reactive-synthesis race

### 5.1 What the race actually is (from the code)

The post-pass `synthesize` (`_lab/loop.js:108-123`) is a deterministic post-order walk — race-free but **not
reactive** (it runs once after stabilize; a later leaf change does NOT re-roll its ancestors). The reactive
design (`inspector-design.md §4`) wants a `Rollup` concept gated by `ensure:["$AnsweredCount==$childCount"]`,
where each child, on becoming `Answered`, does a provider-side **read-modify-write `+1`** of the parent's
`AnsweredCount`.

The race: providers are **async** (`Concept.js:158-174` — the provider gets a `cb`, work happens in a
`.then`). Two children C1, C2 of the same parent both finish. Each does, inside its async callback:
`read parent.AnsweredCount (=k) → write k+1 via pushMutation`. Although `pushMutation` itself is serialized
by `_mutationThreadRunning` (`Graph.js:903-908`), the **read** happens in the provider callback *before* the
write mutation is enqueued. So both read `k`, both write `k+1` → one increment is **lost** → `AnsweredCount`
never reaches `childCount` → the `ensure` gate never fires → the parent never rolls up. It's a classic lost
update from interleaving read-compute-write across an async boundary, even on a single thread.

### 5.2 The fix: don't count, *observe a monotone set* (CRDT-style, no read-modify-write)

The root cause is shared-counter increment. Remove it. Each child writes a **fact about itself**, and the
parent's completion is computed from the *children's own facts* — which the engine can already observe
reactively without any aggregation-in-getRef.

**Mechanism (zero shared mutable counter):**

1. **Child writes only its own answer** when it finishes: `{ $$_id: childId, Answered: true, answer: <bounded> }`.
   No touch of the parent. (Idempotent, race-free: each child writes a disjoint key on a disjoint object.)

2. **Parent gets a tiny reactive "all-children-done" concept** whose `ensure` predicate is true iff every
   declared child is answered. The blocker the design hit was *"`require`/`getRef` can't aggregate a list."*
   Resolve it **without** aggregation by having `Expand` install, on the parent, one **boolean mirror key per
   child**, and the gate is the AND of those mirrors:
   - `Expand` already writes `expandedInto: [c0,c1,...]`. Also have it install, for each child, a watcher so
     that when `c_i.Answered` becomes true, the parent's `child_i_done` flag is set. The cleanest way that
     uses existing machinery: each child's `Answer`/`Rollup-leaf` mutation **also writes a flag on the parent
     keyed by its own slot**: `{ $$_id: parentId, ["done_"+slot]: true }`. This is a **write to a distinct
     key per child** — *no read, no increment, commutative* → no lost update regardless of async
     interleaving. (It's a grow-only set encoded as boolean keys; a CRDT G-set.)
   - The `Rollup` concept's gate is `ensure:["$done_0 && $done_1 && ... && $done_{n-1}"]`, generated by
     `Expand` from `childCount` at expand time and written into a per-parent assert (or, simpler, a single
     `ensure` that the provider re-checks: "all keys matching `done_*` are true and their count == childCount"
     — but to stay within the no-aggregation constraint, generate the explicit conjunction). Because `ensure`
     installs watchers on each `done_i` (`Entity.js:98-121`), the parent re-tests **every time any child
     completes**, and fires **exactly once** when the last one lands.

3. **Idempotent fire + self-flag.** `Rollup` sets `Rollup:true` on cast so it doesn't re-fire; reads
   children's answers **bounded and direct** (`expandedInto.map(getEtty(id)._.answer)` — never `getPaths`),
   writes the bounded summary. Termination by induction (a parent can't complete before its children) +
   depth-floor base case — same as the design, but the **gate is now race-free by construction** because
   nothing is incremented.

**Why this is correct under async.** The only writes are (a) each child to its own object, and (b) each child
to a *distinct* `done_i` key on the parent. Distinct-key writes commute; the serialized `pushMutation`
applies them in some order but the *set of true `done_i`* is order-independent (G-set / CRDT). The `ensure`
conjunction becomes true exactly when the set is complete, observed via the existing watcher mechanism. No
read-modify-write anywhere ⇒ no lost update ⇒ no race.

**Reactive bonus (the whole point).** Because each `done_i` and each child `answer` is a *tracked fact*, if a
leaf later changes (live data, P1/P3), the child re-answers → its `answer` key changes → the parent's
`Rollup` concept (which `follow`s the children's `answer` keys) destabilizes → re-rolls → cascades to the
root. **Synthesis becomes reactive for free**, because we expressed it as concepts over tracked facts
instead of a post-pass walk. To get this, the `Rollup` provider must additionally `follow` the children's
`answer` keys (not just the `done_i` gate), so an *answer change* (not just first-completion) re-fires it.

**Caveat to engineer.** Re-roll on leaf change must converge: the rollup provider must be **idempotent in its
inputs** (M6) and **bounded** (M4), and there must be a re-roll **debounce** (§2.5) so a burst of leaf
changes doesn't re-roll the root once per leaf — coalesce within a stabilize wave. The `_loopTF` already
batches: if all `done_i`/`answer` changes in one wave land before the loop re-tests the parent, the parent
rolls once. The risk is cross-wave thrash under live churn — that's where §2.5 debounce + §2.2 discrete-key
suppression (don't destabilize if the child's *bounded* answer is unchanged after canonicalization) earn
their keep.

### 5.3 Smaller alternative if engine change is acceptable

If we're willing to add one engine primitive: a **`reduceRef("done_*", "&&")`** in `getRef`/`expr.js` that
folds all keys matching a glob with a boolean/numeric reducer. That removes the need for `Expand` to generate
an n-ary conjunction string and makes the gate `ensure:["$$allDone"]` where `allDone` is a derived
reduction. It's a clean, general aggregation primitive (also useful for scores, counts, any fan-in) and it
*keeps the no-read-modify-write property* because the reduction is computed by the engine over committed
facts, not by a provider racing on a counter. **This is the better long-term fix** — it makes fan-in
first-class. The G-set encoding (§5.2) is the zero-engine-change version to ship first.

---

## 6. Honest summary of what's real vs aspirational

**Real today (mechanism present, just needs the modeling discipline):** demand-driven re-fire on tracked
change (P2 re-planning, P3 incremental analysis on *discrete*-fact graphs), retraction cascade, revision
history/diff, fork/merge. These are the defensible core.

**Real after small engine additions (1–3 ranked):** live data (needs TTL/epochs §2.1), prose-tolerant
incrementality (needs canonicalization discipline §2.2 — mostly modeling, not engine), reactive synthesis
(needs the G-set gate §5.2, zero core change, or `reduceRef` §5.3, one primitive).

**Aspirational / risky (gate behind the above being solid):** live self-modification at scale (needs scoped
re-eval §3.3 or it's stop-the-world), semantic canonicalization (re-imports false-hits — prefer strict
extraction), beam over a huge live graph (needs incremental budget §3.2 *and* real cache hits, which need
§2.2).

**The one-line verdict:** the live/reactive edge is real and largely *under-exploited* by the current
one-shot framing — but it materializes **only** on graphs modeled as *large stable core + thin live edge +
discrete tracked facts + bounded rollups*, with TTL to stay honest about freshness. The biggest single win
is making synthesis reactive (§5) because it converts the engine from "answer once" to "standing
computation" — which is the whole differentiator vs a re-prompt agent.
