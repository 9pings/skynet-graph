# Ideation 03 — Truth Maintenance / Auditability / Learning-from-Failure

*R&D ideation through one lens: skynet-graph as a JTMS (justification-based truth-maintenance
system) wired onto a planner. What does **provable provenance + reactive defeasance + learning-
from-retraction** uniquely enable, where does it break, and how should truth/justification/learning
be **modeled** so the system is trustworthy AND self-improving?*

Grounding (code read): `App/objects/Entity.js` (`static_ensure` L18-27, `updateApplicableConcepts`
L63-182, `unCast`+`cleaner` L192-246), `App/objects/Concept.js` (`applyTo`+trace ctx L123-219,
`_computeWhy` L227-242, `isApplicableTo`/`require` L249-272, `patch` L92-96), `App/Graph.js`
(`pushMutation`+`_revs[revNum]`+`onConceptApply` L840-1257, `diffRevisions` L1876-1898,
`rollbackTo`/`_captureSnapshot`/`getSnapshot` L1808-1923, `fork`/`merge` L1938-1985, `traceProvider`
L1800-1803), `providers/llm.js`, the inspector spec (`docs/.../2026-06-21-moe-graph-inspector-design.md`),
the reliability study (`doc/aspect-modele-programmation-fiabilite.md`), and the PLAN's "scoring =
ordinary fact, no engine feature" decision (`doc/PLAN_DEV_V1_MOE_GRAPHE.md` L232-247).

**The one-sentence honest frame** (from K3, the study's sharpest point): *the JTMS guarantees
coherence of the graph, never truth of provider-produced facts.* A hallucinated-but-syntactically-
valid fact propagates cleanly and retracts cleanly — the mechanism's rigor can manufacture a **false
sense of reliability**. Everything below is designed to either exploit the real win (coherence +
provenance + defeasance + learning) or to directly attack that gap (verification, confidence-gating,
contradiction detection). I never claim the engine makes facts *true*; I claim it can make
*unreliability visible and bounded*.

---

## PART 1 — Problems & innovations this lens uniquely enables

### 1.1 The defensible core (what no compared system has, restated for this lens)

Three properties compose into something rare:

- **Provenance is mechanical, not reconstructed.** Every fact carries the rev that produced it
  (`_revs[revNum] = {id,parent,bagRefs,tpl}`), the concept that fired it, and — via `_computeWhy`
  — the `require` premises that made the concept applicable, plus (for LLM facts) the exact
  prompt/reply (`traceProvider`). "Why does the system believe X" resolves to a **dependency chain
  ending in either a base input or a named provider call**, not a transcript to re-read.
- **Defeasance is a first-class primitive.** `ensure` is a justification; when a premise falls, the
  watcher fires `static_ensure` → `unCast` retracts the concept AND its dependent children in
  cascade, running `cleaner` hooks. Belief revision is structural, fine-grained, deterministic — the
  exact opposite of LangGraph's coarse whole-node rollback and of a bare LLM that can assert A at
  turn 3 and ¬A at turn 9 with no retraction of A's consequences.
- **Reasoning is replayable and forkable.** `rollbackTo`/`getRevisions`/`getSnapshot`/`diffRevisions`
  = "Git for reasoning"; `fork`/`merge` = sub-agent sub-graphs that reintegrate via `pushMutation`.

### 1.2 Where this WINS uniquely (ranked by defensibility)

**P1 — Regulated / audited derivation (finance, health, legal, compliance). HIGHEST leverage.**
The deliverable in these domains is not the answer but **the derivation**: "show why this claim was
denied / this dosage flagged / this transaction held." A JTMS gives a *machine-checkable
justification graph* per conclusion, and `ensure`-driven defeasance gives the regulator's favorite
question a mechanical answer: *"if input P had been different, exactly which conclusions change?"* —
answerable by flipping P and reading the cascade, or by `diffRevisions` across a counterfactual fork.
No LLM-as-judge and no LangGraph checkpoint trail offers per-fact, per-premise traceability with
automatic invalidation. **Honest caveat:** auditability of the *derivation* is real; it does not
certify the *base facts* a provider produced — which is exactly why P5 (verification) is the
companion, not optional.

**P2 — Debuggable / accountable agents.** The single hardest thing about agent failures is "why did
it do that, and what was it relying on?" Here the apply-trace + `why` + `diffRevisions` turn a
post-mortem into a query. Combined with `rollbackTo`, you get *bisection over reasoning*: roll to the
rev before the bad fact, inspect its `why`, find the premise or the hallucinating provider call. This
is `git bisect` for an agent's belief state — a debugging modality that simply does not exist for
opaque-transcript agents.

**P3 — Reproducible reasoning under change (collaborative / live-data).** Because triggering is
deterministic (forward-chaining to fixpoint on tracked deps) even though *outputs* aren't, the
*trajectory of what-fired-and-why* is reproducible and inspectable. When an upstream fact changes,
only the dependent sub-DAG re-fires and the rest is provably untouched — and you can *prove* it from
the dep edges. Valuable wherever multiple actors / live feeds mutate shared state.

**P4 — Cumulative learning across runs (the differentiator nobody else has).** A JTMS normally
*forgets* on retraction — LangGraph rolls back leaving no residue, a bare LLM has no cross-attempt
memory. The planned **memory-on-retraction** (§3.1) makes retraction *productive*: a failed path's
`cleaner` deposits a bounded `{strategy, outcome, reason}` memory on a survivor node, and future
strategy concepts read it to avoid repeats and adapt. This is *learning-from-failure as a structural
consequence of defeasance* — the trace already supplies "what was tried and why," so the learning
signal is free. I rank this the single most novel research contribution of the system.

### 1.3 The two honesty bounds (must be stated everywhere)

- **Coherence ≠ truth (K3).** Repeated because it is *the* failure mode. Mitigations are all in this
  doc: confidence/freshness gating (§2.1), verification-as-refutation (§3.2), contradiction detection
  (§2.4). None makes facts true; they make *un-verified* and *contradicted* facts **visible and
  non-propagating**.
- **JTMS = single world; no native ATMS (K5).** The graph maintains ONE coherent state. Comparing
  alternative assumptions ("plan A vs plan B") needs a manual `fork`, which is coarse (whole-graph
  copy) and loses the shared-derivation sharing an ATMS label set would give. §2.2 proposes a
  middle path. Be honest: today this is a real expressiveness gap, not a solved problem.

---

## PART 2 — Deduced improvements (new, ranked by leverage)

> Design rule inherited from the PLAN (L232-247) and the standing directive: **prefer ordinary facts
> + declarative concepts over engine machinery; validate STRUCTURE, never cap the expression grammar.**
> Most proposals below are *modeling patterns* that need zero or near-zero core change. I flag the
> few that genuinely need engine support and keep them minimal.

### 2.1 Confidence + freshness as first-class fact metadata that GATES propagation — **[ordinary fact, ~0 core]**  ★ top leverage

The PLAN already decided confidence is an ordinary fact, not engine scoring machinery. The truth-
maintenance *innovation* on top of that decision: **make confidence/freshness a precondition, so low-
confidence or stale facts cannot silently drive downstream casting.** This directly attacks K3 without
any conflict-resolution engine.

Modeling:
- Providers write `confidence` (and, for time-sensitive provider facts, `producedAt` / `ttl`) as
  ordinary facts alongside their result — `providers/llm.js` already merges arbitrary JSON keys, so a
  prompt that asks for `{value, confidence}` writes both with no code change.
- A downstream concept *gates on them declaratively*:
  `require:["X"], ensure:["$X:confidence > 0.7", "$now - $X:producedAt < $X:ttl"]`.
  Because `ensure` installs a watcher (Entity.js L98-121), a fact that later drops below threshold or
  goes stale **auto-retracts the dependents in cascade** — freshness becomes defeasance for free.
- This solves the study's K3 (`aspect-calcul-incremental.md`): the *cache-poisoning-by-stale-fact*
  risk becomes a modeled, self-healing condition rather than a silent frozen truth.
- Minimal core touch: a `$now` reference / clock-tick free-node so time-based `ensure` can re-fire
  (a periodic `pushMutation({$$_id:'clock', now: Date.now()})` from the host is enough — no engine
  change at all; the host owns the clock).

Why top leverage: it converts the engine's strongest mechanism (reactive defeasance) into a *truth-
hygiene* mechanism, costs almost nothing, and is the cheapest available answer to "rigorous mechanism,
false sense of reliability."

### 2.2 Assumption-tagged facts: a thin ATMS-lite over the JTMS — **[mostly modeling; one optional core hook]**

Full ATMS (de Kleer 1986: every belief labeled with the minimal assumption sets supporting it,
multiple worlds simultaneously) is a big build. But the *audit value* — "under which assumptions does
this hold?" — is reachable cheaply:

- **Modeling layer (zero core):** tag assumption-rooted facts with an `assumption` id (e.g. a free-
  node `{_id:'asm:planA', assumed:true}`), and have dependent concepts carry the assumption forward
  as an ordinary fact key on what they produce (provider copies `scope`'s `assumption`). Then "which
  conclusions rest on assumption planA" is a query over facts, and retracting `asm:planA`
  (`pushMutation({$_id:'asm:planA', assumed:null})`) cascades via `ensure` to exactly its dependents.
- **Compare-alternatives:** keep `fork` for genuine parallel worlds (the honest, coarse tool today),
  but use `diffRevisions(forkA_snap, forkB_snap)` to produce a *fact-level diff of two assumption
  worlds* — a usable "A vs B" report without building label arithmetic.
- **Optional core hook (small):** a `getRef`-time helper that, given a fact, walks the `_followers`/
  `_watchers` dep edges to return its transitive assumption set — turning the manual tag into a
  computed label. This is the only part that touches the engine and it can stay read-only.

Honest ranking: this is *ATMS-flavored auditability*, not an ATMS. It gives "show the assumptions"
and "diff two worlds." It does NOT give shared-subderivation reuse across worlds (the real ATMS win).
Ship the modeling layer; treat the label-arithmetic ATMS as a research stretch (P-low).

### 2.3 The Justification-Graph view in the inspector — **[host-side; reuses built trace]**  ★ high leverage, low cost

The trace records `{rev, concept, target, patch, why:[{require,value,producedAtRev}], prompt, reply}`
per apply. That is **already a justification graph in edge-list form** — it just isn't rendered as
one. Build, in the `sg` CLI / a viewer:

- `sg why <factId>` — walk backward: this fact ← the apply (concept+rev) that wrote it ← that apply's
  `why` requires ← the revs that produced *those* ← … to base inputs or provider calls. This is the
  JTMS's defining query and it's currently latent.
- `sg explain <conclusion>` — the full proof tree (DAG) for a conclusion, with provider calls as
  leaves clearly marked "PROVIDER-ASSERTED (not derived)" so a reader sees where trust enters.
- `sg whatif <factId>` — show the retraction cascade that *would* fire if that fact fell (compute
  from `ensure` watchers without mutating), i.e. the counterfactual blast radius.

Cost: pure consumer of data already emitted. Leverage: this is what makes P1/P2 *usable by a human
auditor* rather than a JSON dump. The "PROVIDER-ASSERTED" annotation is itself a partial answer to
K3 — it visually separates derived-coherent from asserted-unverified.

### 2.4 Contradiction detection as a first-class outcome — **[modeling + tiny core: a contradiction event]**

A JTMS's other classic job (beyond justification) is **detecting nogoods** — sets of beliefs that
can't co-hold. skynet-graph is additive (experts grow branches, don't fight over a prop — PLAN L232),
so contradictions aren't auto-surfaced. Model them as ordinary concepts:

- A `Contradiction` concept: `require:["X","Y"], ensure:["$X:value != $Y:value"]` (or a refuter
  provider) that, when it casts, writes a `contradiction:true` fact onto a shared anchor and lists the
  conflicting fact ids + their `producedAtRev`. Because it's `ensure`-gated, it auto-retracts when the
  conflict is resolved.
- Optional minimal core: emit a `graph.on('contradiction', …)` event when such a concept casts, so a
  host/meta-concept can react (pause, fork to explore both, or invoke verification). This is one event
  emission, no belief-revision algorithm — the *resolution* is left to concepts/host (honest: we
  surface, we don't auto-resolve, because auto-resolution needs the truth the JTMS doesn't have).

This gives "the system noticed it believes two incompatible things" — invaluable in audited domains
and as a learning trigger.

### 2.5 Per-key provenance precision — **[small core, already scoped as deferred]**

`_computeWhy` is object-granular (the `_rev` of the last mutation touching the object, not the
specific key — Concept.js L222-238, inspector spec §2.4 / §6). For audit-grade provenance, opt-in
**per-key rev stamping in `Entity.set`** (stamp `_revByKey[key]=rev` on write). Then `why` and the
justification view attribute each premise to the exact mutation that set *that key*. Deferred in the
spec; from the audit lens it is the difference between "this object changed around here" and "this
specific premise was set by rev N (provider P, prompt …)". Rank: medium — do it when the first real
audited use-case lands.

### 2.6 Signed / tamper-evident revision log — **[host-side; matters only for adversarial audit]**

For *regulated* use, "the trace is mechanical" must also mean "the trace wasn't edited after the
fact." `_revs` is an append-only list already; add a host-side hash chain (`hash(rev) = H(prev_hash,
rev.tpl, rev.parent)`) so the reasoning log is tamper-evident. Pure host concern, zero engine change,
but it's what turns "auditable" into "auditable *and* defensible in front of a regulator." Rank:
low now, becomes mandatory the day a compliance customer is real.

---

## PART 3 — Adapting the planned 5 (concrete modeling)

### 3.1 Memory-on-retraction → durable cross-run LEARNING (the headline)  ★★ highest research value

The spec (§4b) already validated the *mechanism* (zero core changes; `cleaner` is the emit point;
queued nested `pushMutation`; free-node anchor; exclusion via flat boolean keys; monotonic append).
This section deepens the **modeling** so it becomes real cross-run learning, not just within-run loop
avoidance.

**Memory fact schema (bounded, discrete — never transcripts):**
```jsonc
// on free-node {_id:'memory'} — append-only list + flat projection keys
{ _id:'memory',
  memory: [ { ctx, strategy, outcome:'failed', reason, atRev, conceptId, confidence } ],
  // flat exclusion projections, set ATOMICALLY with the record (assert can't aggregate a list):
  "failed::<ctxHash>::<strategy>": true
}
```
- **`ctx` (scoping) — the crux of *learning* vs *noise*.** Memory must be keyed to a *generalizable*
  context, not a unique node id, or nothing ever matches across runs. Model `ctx` as a **bounded,
  canonical descriptor of the sub-problem class** (e.g. a typed signature: `{taskType, depth-band,
  key-constraints}`), produced by the same expert that chose the strategy. This is the §K1 memo-key-
  fragmentation problem from `aspect-calcul-incremental.md` *reappearing as the learning-transfer
  problem*: too-specific ctx ⇒ never reused (no learning); too-generic ⇒ wrong lessons applied. The
  honest engineering ask is **structured-extraction discipline on `ctx`** (strict JSON-schema, small
  enum'd fields), the same fix K1 needs. Get this right and learning transfers; get it wrong and it's
  a junk drawer.
- **Dedup + monotonicity:** memory is append-only; the exclusion key `failed::<ctx>::<strategy>` is
  set in the *same* mutation as the record (single-threaded stabilization makes this atomic — spec
  §4b). A strategy concept's `assert` includes `!$memory:failed::<ctx>::<thisStrategy>` so a known-
  failed strategy is *excluded*, never re-enabled. **Negative-only dependence** (memory disables, never
  re-enables a strategy) + self-flag + strictly-shrinking strategy-set-per-ctx ⇒ well-founded ⇒
  terminates. This is the search-discipline "dedup-vs-seen / loop-until-dry" invariant; state it as a
  proof obligation, test it.
- **How it feeds strategy selection (the learning loop closes here):**
  1. Strategy expert reads `getEtty('memory')._.memory` (bounded list) + the flat exclusion keys.
  2. Its `assert` excludes failed `(ctx,strategy)` pairs → tries an *unseen* strategy.
  3. On failure, its sub-path retracts → `cleaner` appends a new `{ctx,strategy,failed,reason}`.
  4. Next run / next sibling at the same `ctx` skips it. Over runs, the strategy set per ctx shrinks
     toward what works — **cumulative learning with no model retraining**, persisted via `serialize()`.
- **Confidence weighting (ties to §2.1):** record a `confidence` on each memory so a later expert can
  *prefer* (not just exclude) — "this strategy failed once at low confidence" is weaker evidence than
  "failed three times." Keeps it a fact; no engine machinery.
- **Cross-run persistence:** because the `memory` free-node serializes with the graph, learning
  survives process restarts and can be *shared between graphs* (seed a fork's memory node) — a
  team-of-agents that learns collectively. This is the part that makes it "learning across runs," not
  just "loop avoidance within a run."
- **Honest risk it does NOT solve:** memory records *that* a strategy failed and a bounded *reason*;
  it does not guarantee the reason is correct (the `reason` is itself provider/trace-derived). So
  learning can *encode a wrong lesson*. Mitigation: keep `reason` tied to the *mechanical* trace
  (which premise fell / which assert failed), not to an LLM's narrative — the trace's `why` is the
  trustworthy part; an LLM post-hoc "I think it failed because…" is not. **Prefer mechanical reasons.**

### 3.2 Verification concepts → adversarial refutation that GATES downstream — **[modeling; aligns with K3]**  ★ second-highest value

This is the direct structural answer to coherence≠truth. Model a **refuter** as a concept whose job
is to attack another concept's fact and, on success, *prevent or retract* its propagation.

**Attachment (how a refuter binds to a fact):**
```jsonc
"Verify_Distance": {
  "require": ["Distance"],                 // fires once the fact to check exists
  "provider": ["LLM::complete"],           // or a deterministic checker provider
  "prompt": { "system":"You are a refuter. Try to DISPROVE the claim.",
              "user":"Claim: distance=${Distance:inKm}km between ${a} and ${b}. Refute or PASS.",
              "json": true, "as": "VerifyDistance" }   // -> {refuted:bool, reason, confidence}
}
```
**Voting / gating (the load-bearing modeling choice):** do NOT let a refuter *overwrite* the checked
fact (the graph is additive; experts don't fight over props — PLAN L232). Instead, the refuter writes
a *sibling verdict fact* (`verified:true|false`, `verifiedConfidence`), and **downstream concepts gate
on the verdict** exactly like §2.1:
`require:["Distance"], ensure:["$Distance:verified == true"]`.
Consequences fall out for free:
- A fact that is later refuted (verdict flips to false) **auto-retracts its dependents** via the
  `ensure` watcher — refutation IS defeasance. No new engine path.
- Multiple refuters = multiple sibling verdicts; a downstream `ensure` can require quorum
  (`$verifiedCount >= 2` via the same scalar-counter pattern the Rollup design uses, spec §4
  Constraint 1). "Voting" is just an aggregated fact + a counter, not engine code.
- Unverified ≠ refuted: a fact with *no* verdict yet is gated OUT of high-assurance downstream paths
  but may still be visible — the inspector marks it "PROVIDER-ASSERTED, unverified" (§2.3).

**Independence discipline (so verification means something):** a refuter must not be the same call
that produced the fact (or you're asking the hallucination to grade itself). Model this by giving the
refuter a *different provider / different prompt framing (adversarial) / ideally a deterministic
checker* where one exists (units, ranges, arithmetic, schema, external lookup). The highest-value
refuters are the *deterministic* ones — they convert K3 from "trust the LLM" to "the claim violates a
checkable invariant." LLM-refuters are weaker (a hallucination can pass another LLM) but still raise
the bar and are auditable (their prompt/reply is in the trace).

### 3.3 How budget/pruning interacts with verification depth — **[modeling + the budget concept set]**

Verification is not free — every refuter is another provider call (cost K2). So budget and
verification must be *co-modeled*:
- **Risk-proportional verification:** model a `verifyDepth` budget fact per path; high-stakes / low-
  confidence facts (from §2.1) get more refuters, cheap/high-confidence ones get none. The strategy
  expert sets `verifyDepth` as an ordinary fact from `confidence` + a host policy. So budget *targets*
  verification where K3 risk is highest instead of spraying it everywhere.
- **Budget is itself a gating fact, not engine machinery:** a concept's `assert` includes
  `$budget:remaining > $thisConcept:cost` (PLAN already treats cost/score as facts). Pruning = a
  branch whose budget `ensure` fails simply retracts (defeasance again) and — critically — its
  `cleaner` deposits a §3.1 memory `{ctx, strategy:'pruned', reason:'budget'}` so the *next* run
  doesn't re-explore the same expensive dead branch. **Budget exhaustion becomes a learning signal.**
- **Beam + verification:** rank surviving branches by aggregated `confidence × verified` along the
  path (the `PathMap.getAllPropsInPath` aggregation the PLAN cites L243), keep top-k, retract the
  rest (each retraction → memory). Verification depth is spent on the beam, not the discarded tail.
- Honest tension: there's a real trade between *verify more* (lower K3) and *explore more* (better
  answer) under a fixed budget. The model makes the trade *explicit and tunable* (it's all facts), it
  doesn't auto-optimize it (that would need a reward signal the system doesn't have — be honest).

### 3.4 Safety of AI-authored concepts — **[validate structure, vetted provider palette]**

From the audit/trust lens, AI-authored concepts are a *governance* problem: an AI writing the control
structure can write an unsafe or unauditable expert. Modeling for safety (per spec §4c, sharpened):
- **Validate STRUCTURE, never grammar (standing directive):** a JSON-schema for a concept def — field
  names/types present, `require`/`assert`/`ensure` parse under `expr.js` (compile them in a sandbox at
  author time; reject on parse error *before* they can break stabilization), `childConcepts` shape
  valid, no unknown top-level keys. This catches malformed experts without capping expressiveness.
- **Vetted provider palette is the real safety boundary:** the AI may only reference providers from a
  host-approved allow-list (`LLM::complete`, named deterministic checkers, geo). It may NOT author
  arbitrary provider JS. Because `LLM::complete` is universal (a complete expert = pure JSON: trigger
  + prompt + provider name), the AI almost never *needs* custom JS — powerful AND safe. **Enforce:
  reject any concept whose `provider`/`cleaner` names an entry not in the palette.**
- **Provenance of authorship (audit closes the loop):** every `addConcept`/`patchConcept` is itself a
  revision-stamped mutation; record *which meta-concept/run authored or patched a concept and why*
  (read from the trace). So "why does this expert exist / why was its assert changed" has the same
  mechanical answer as any other fact. An AI-authored rule that later causes a bad cascade is
  bisectable (P2) back to its authoring rev. This is what makes live self-modification *auditable*
  rather than terrifying.
- **Gate self-modification behind the instruments:** spec §4b/§4c already say gate the self-modifying
  tier behind trace+memory+budget being solid. From this lens, add: gate it behind **verification**
  too — an AI-authored concept's first outputs should be verification-gated (§3.2) before they're
  trusted downstream. New experts are "probationary" (their facts require a verdict) until they've
  cast successfully N times — a *reputation fact* on the concept, learned via the same memory machinery.

### 3.5 Declarative AI-authorable concepts (spec §4c) + live self-modification (spec §4c LIVE)

Covered by 3.4 for safety. The *truth-maintenance* addition: the self-improvement loop
(author → run → trace → memory → patch) is exactly a **learning JTMS** — the trace is the justification
signal, memory-on-retraction is the failure signal, `patchConcept`/`addConcept` are the adaptation
levers. Model the meta-concept's decisions as ordinary gated facts so the *self-modification itself*
is defeasible and auditable (a patch that makes things worse can be rolled back by rev, and its
failure recorded so the meta-concept won't re-apply it — §3.1 applied to the meta level).

---

## PART 4 — Best modeling for a trustworthy AND self-improving system (ranked synthesis)

The unifying modeling principle: **truth, justification, and learning are all ORDINARY FACTS, and the
engine's one superpower — `ensure`-driven reactive defeasance — is reused as the universal mechanism
for hygiene (gating), refutation, contradiction, freshness, budget, and learning.** Almost nothing
needs new core. The PLAN's "scoring is a fact, not a feature" decision generalizes to *everything in
this lens*.

Ranked by leverage (impact ÷ cost, honesty included):

1. **Confidence/freshness as propagation gates (§2.1)** — cheapest, highest hygiene return; turns
   defeasance into truth-hygiene; directly dents K3. ~0 core. **Do first.**
2. **Memory-on-retraction as cumulative cross-run learning (§3.1)** — the headline differentiator;
   mechanism already validated; the work is *modeling `ctx` correctly* (the K1 problem in new
   clothes). Highest research value. ~0 core.
3. **Verification-as-refutation, gated not overwriting (§3.2)** — the structural answer to coherence≠
   truth; reuses defeasance; deterministic checkers >> LLM-refuters. ~0 core (modeling).
4. **Justification-graph view in the inspector (§2.3)** — makes auditability *usable* by humans;
   pure consumer of already-emitted trace; the "PROVIDER-ASSERTED" annotation is itself a K3
   safeguard. Host-side.
5. **Budget × verification co-modeling (§3.3)** — keeps "huge" from being "ruinous" *and* targets
   verification at risk; budget exhaustion feeds learning. Pairs with the planned budget set.
6. **Contradiction detection as a surfaced event (§2.4)** — high audit value; tiny core (one event);
   we surface, don't auto-resolve (honest about not having truth).
7. **Per-key provenance (§2.5)** + **signed rev log (§2.6)** — audit-grade polish; do when a real
   regulated customer lands.
8. **Assumption-tagged ATMS-lite (§2.2)** — real but partial; modeling layer is cheap, true ATMS
   label-arithmetic is a research stretch (low priority — `fork`+`diffRevisions` covers the 80%).

**The three honesty statements to keep on every slide:**
- Coherence ≠ truth. The mechanism makes unreliability *visible and non-propagating* (via gating +
  verification + contradiction), it never makes a fact *true*.
- It's a JTMS, not an ATMS. Multi-world comparison is a coarse `fork`, not native label sharing.
- Learning can encode a *wrong* lesson; tie memory's `reason` to the **mechanical trace** (which
  premise fell), not to an LLM's narrative, to keep the learning signal trustworthy.

**Net:** the system's defensible identity for this lens is *"an auditable, defeasible, learning truth-
maintenance substrate where every belief carries its justification, every failure leaves a lesson, and
every unverified fact is visibly fenced off from the verified derivation."* That is a combination no
compared system (LangGraph, bare LLM, Drools/Datalog, DSPy) offers — and it's reachable almost
entirely by modeling on top of mechanisms already built, which is the strongest possible position.
