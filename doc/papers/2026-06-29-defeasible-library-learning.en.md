# Defeasible Library Learning: Typed Methods with Runtime Contracts that Un-learn on Drift

**Nathanael Braun** · skynet-graph · 2026-06-29

---

## Abstract

LLM agents reuse past work through *fuzzy* memory — retrieval (RAG), case-based reasoning (CBR), and prose skill
libraries — which recalls by surface similarity and has no notion of a premise becoming false. When the world
drifts in a way that does not alter the query itself, these stores keep serving a *stale* answer. We present
**defeasible library learning**: a learned library of typed, composable *methods*, each carrying a **defeasible
runtime contract**. A method is assumed at compose time, **asserted at run time**, and — when its induced
postcondition fails — **retracted with blame** (a JTMS un-learning), after which the library is surgically
revised rather than discarded. The same typed structure that makes a method canonicalizable also makes its reuse
*amortizable* and its composition *checkable on contracts alone*, with bounded per-call context. We evaluate the
claims on a real rule-driven, JTMS-coherent engine, isolating each mechanism (with a deterministic stub for the
model and one live-model confirmation). Findings: (E2) under an external mid-stream premise-invalidation,
recall-only memories (RAG / CBR / prose skill libraries) serve **stale** (0 of the drift cases), whereas *any* cache
equipped with an invalidation hook recovers — what a **declarative typed contract** adds over a hand-coded
invalidation callback is *selective, principled* eviction (re-assert the post; evict only what is violated), plus
generality (premise-agnostic) and composition-safety; all at bounded per-call context, confirmed on a live local
model. (E1) cross-problem **structural transfer** is sound and free on the held-out related instances while the
no-transform ablation is unsound — and call-count alone cannot tell them apart, only the soundness check can.
(E3) a box-closed composition check matches open-the-box reality on every evaluated pair (no false-admits), and
each of three soundness gates is load-bearing. (P4) amortization is a **gradient** in the canonicalizable
fraction, soundness holds at every coverage, and amortizing *beyond* that fraction is unsound by construction. No
mechanism here is new (each is prior art — JTMS, contracts-with-blame, library learning, separation-logic
footprints); the contribution is their **composition** into a learned method library that performs *principled,
selective un-learning on drift*, which recall-only agent memories do not — bounded by a measured K1 ceiling.

---

## 1. Introduction

An agent that solves many related problems should get cheaper and more reliable over time. The dominant way to
make that happen today is to remember and recall: store past solutions or skills, retrieve the nearest one for a
new case, and reuse or adapt it. Retrieval-augmented generation [Lewis et al. 2020], case-based reasoning, and
prose skill libraries such as Voyager [Wang et al. 2023] all share this shape, and all share a blind spot. They
recall by *surface* similarity, and they have no representation of a *premise that has become false*. When the
world changes in a way that does **not** change the query — a regulation is tightened, a fact is audited and found
wrong, a policy is revoked — the cached answer is still the nearest neighbour, and it is still served. The memory
is confidently stale.

Static libraries (learned programs, macro-operators, distilled skills [Ellis et al. 2021; Bowers et al. 2023])
have the opposite problem: they are sound when learned but cannot *un-learn*. There is no mechanism by which the
arrival of a contradicting fact retracts a previously-justified reuse.

We argue the missing ingredient is a **defeasible typed contract** attached to each reusable unit. Borrowing from
software contracts with blame [Findler & Felleisen 2002] and gradual verification [Bader, Aldrich & Tanter 2018],
a method declares what it reads, what it writes, what it requires, and what it guarantees — over a *typed* fact
alphabet. The guarantee for a *learned* method is an induced hypothesis, so it is **assumed** when composing,
**asserted** when running, and **retracted with blame** when violated. Retraction is a truth-maintenance operation
[Doyle 1979; de Kleer 1986]: the dependency closure of the falsified premise collapses and no wrong belief is
served; the library is then revised by *specializing* the failed precondition, not by deleting the method.

The same typed structure buys two further properties. First, reuse **amortizes**: a method whose applicability
and effects are fully typed has a stable canonical key, so recurrent cases elide the model call. Second,
composition is **checkable without opening the box**: two methods compose soundly iff, on the typed keys one
writes and the other reads, the first's postcondition entails the second's precondition — a decidable check over a
finite alphabet [O'Hearn, Reynolds & Yang 2001; Reynolds 2002] that lets a supervisor carry *contracts*, not
bodies, keeping per-call context bounded.

This power is bounded by a single honest constraint we call **K1**: only typed, canonicalizable structure
amortizes; a decision component that is genuinely prose stays in the model. We measure the consequence rather than
hide it.

We use *library learning* in the established sense of DreamCoder and Stitch [Ellis et al. 2021; Bowers et al.
2023] — inducing reusable typed methods from traces by abstraction — not statistical parameter fitting; one could
equally call it *method induction*. The novelty here is **not** the induction (that is prior art) but the
**defeasible contract** that lets an induced method be *un-learned*. The change is a control-flow one: where a
similarity memory does `query → retrieve → reuse`, ours does
`query → retrieve-contract → assert → execute → verify → retract → specialize`. The verify-and-retract suffix —
absent from retrieval, CBR, and skill libraries — is the whole difference, and it is what the experiments isolate.

**Contributions.** (1) The framing of reusable agent methods as **two-faced typed non-terminals with a defeasible
runtime contract**, and the assume/assert/retract-blame/revise loop that un-learns on drift. (2) A reproducible,
mechanism-isolating evaluation on a real engine — recall-only memory cannot un-learn while a declarative typed
contract recovers drift *selectively, generally, and composition-safely* (E2, stub + live, with a fair
invalidating-cache baseline); sound structural transfer that call-count alone cannot certify (E1); no false-admits
on the evaluated compositions, with each of three soundness gates ablated (E3); and amortization as a
gradient in the canonicalizable fraction (P4). We are explicit about what each experiment does and does not
establish (small n, deterministic stub, single live model).

---

## 2. Approach

### 2.1 The object: a two-faced method

A **method** is, to its caller, a single black box with a typed contract; inside, it is one or more *productions*
that realize it (sequence, branch, map, fold). Formally it is a hyperedge-replacement non-terminal [Habel 1992;
Drewes, Kreowski & Habel 1997] with precondition-gated selection [Erol, Hendler & Nau 1994]. We keep two regimes
apart by *design intent* (we do not prove decidability in this paper): the **method grammar** (selection,
parameterization, composition) is *intended* to stay decidable via a well-founded mount-rank and a small set of
typing invariants — recursive HTN plan-existence is undecidable in general [Erol, Hendler & Nau 1996], which is
exactly why we restrict to the well-founded fragment — while **execution** over runtime-sized data is an explicitly
fuel-bounded, Turing-complete layer. The connection to monadic-second-order definability over typed structure
[Courcelle 1990] is offered as motivation for why grammar-level checks *can* be made tractable, not as a theorem
established here; a formal decidability result is left to future work.

### 2.2 The contract: a defeasible separation triple

A method declares a **read-footprint**, a **write-footprint**, a **precondition** over what it reads, a
**postcondition** over what it writes, and an **effect tag**. Composition under shared state is the frame problem
[McCarthy & Hayes 1969]; we discharge it with a separation-logic footprint discipline [O'Hearn, Reynolds & Yang
2001; Reynolds 2002] over the finite typed alphabet — the tractable, non-aliasing regime. For a *learned* method
the postcondition is an induced hypothesis: **assumed at compose time, asserted at settle time, retracted with
blame on violation** [Findler & Felleisen 2002; Bader, Aldrich & Tanter 2018]. The runtime monitor is the JTMS
[Doyle 1979], and the result is *eventual* (not static) soundness — which is exactly the un-learning the fuzzy
baselines lack.

### 2.3 The pipeline and the K1 floor

A human formulation is typed into a goal; a method is selected and composed on contracts; cases flow through it;
traces distil (anti-unify [Plotkin 1970]; MDL-gated as in DreamCoder/Stitch [Ellis et al. 2021; Bowers et al.
2023]) into new typed methods; drift retracts. The universal fallback is the **micro-task floor**: anything that
does not reduce to a cached typed method reduces to a micro-task a small model does easily. So a *missing* contract
costs a cheap model call (a graceful cost gradient), and a *wrong* contract is caught by the runtime assert — the
two failure modes degrade cost and trigger un-learning respectively, never silent error.

---

## 3. Implementation

All mechanisms are realized on an existing rule-driven, JTMS-coherent typed-fact graph engine with declarative
concepts and forward-chaining stabilization, with no changes to its core beyond one additive, backward-compatible
query option. The typed memo key is the engine's canonicalization digest; the defeasible-contract checker
(compose-time entailment over abstract domains, a runtime post-assertion, and three soundness gates) and the
structural-transfer transform (relativize-on-store / bind-on-replay) are host libraries over the engine. A case
executor that runs validated methods durably at scale is a known engineering artifact (a workflow net [van der
Aalst 1998] over a durable store, in the lineage of AWS Step Functions Distributed Map [AWS 2022], Prefect's
content cache, and DBOS [Skiadopoulos et al. 2022]); our belief view sits above it.

The defeasible lifecycle — **assume → assert → verify → retract → specialize** — is the whole mechanism, mapping
one-to-one onto the engine functions it calls:

```
select(goal):                                   # ASSUME (compose time)
    M ← library.match(goal.typed_facts)         #   typed key; a miss falls to the micro-task floor
    assume M.contract                           #   checkCompose: post(prev) ⊨ pre(M); escalate, never false-admit

apply(M, case):                                 # ASSERT + VERIFY (run time)
    key ← digest(case.typed_premise)            #   K1 canonical key
    if memo.has(key): return memo[key]          #   amortize a recurrent typed case
    out ← run(M, case)                          #   else derive (model call / sub-graph)
    if not assertPost(M.contract, out):         #   post holds? + G1 frame-completeness + G2 effect-oracle
        quarantine(case); blame(M.contract)     #   never commit a bad output
        return
    memo[key] ← out; return out

on ingest(fact):                                # RETRACT + SPECIALIZE (drift)
    for e in memo s.t. e depends on fact:        #   JTMS: re-assert each affected post against the new fact
        if not satisfies(e.contract.post, e.facts ∪ {fact}):
            retract(e); blame(e.contract)        #   un-learn: evict the invalidated entry + assign blame
    library.revise(blame): pre ← specialize(pre) #   reviseOnBlame (CEGIS): narrow the pre, do not delete
```

The verify-and-retract suffix is the only part absent from a similarity memory, and it is exactly the part the
experiments isolate.

---

## 4. Experiments

### 4.1 Setup

Experiments use the real engine's mechanisms, at two levels of fidelity that we state explicitly. E1 and E3
**instantiate the full engine** (`new Graph(...)` + stabilization + JTMS): E1 mounts structural methods and
transfers them via the engine's relativize/bind; E3 composes real concepts and compares the box-closed
`checkCompose` verdict to the engine's actual stabilization outcome. E2, P4, and E5 **isolate the relevant engine
functions** — the canonicalization key (`digest`), the contract re-assertion (`satisfies`), the canonicalization
barrier (`canonValue`) — driving them from a harness rather than the full stabilization loop, so that the
*mechanism* (typed key, defeasance, coverage) is measured without conflating it with the engine's scheduler. So
"on the real engine" means the real functions throughout, and the full reactive loop for E1/E3; we do not claim
E2 exercises the engine's native `_revs`/JTMS retraction (it re-implements that retraction over the same real
predicate). The model runs either as a **deterministic stub** (a perfect oracle of the *current* rule given only
what each arm's prompt reveals — so all staleness and cost come from each arm's mechanism, not model error) or as
a **live** local model (`qwen36-q2-vram`). A shared prompt builder makes
per-call context comparable across arms. Every comparative run is gated by a **harness self-test**: under the stub
the naive arm must be perfectly correct, else the instrumentation is broken and the run aborts — a direct response
to a prior bug in which an arm scored 0/24 while its call and wall-clock numbers looked fine. All stub results are
deterministic across re-runs. Seven arms share one interface: **Naive** (re-derive each record), **Long-context**
(re-derive with all history in the prompt), **RAG** (reuse nearest by surface key), **CBR** (reuse on the typed
key, no re-validation), **Skill** (a Voyager-style prose skill re-applied by the model), **Invalidating** (the
fair baseline: the typed-key cache *plus* a coarse hand-coded class-callback that drops a whole audited class on
the audit event — has an invalidation hook but no typed contract), and **Struct** (the typed library with the
defeasible contract — re-asserts the post per entry, evicting only what is violated). The Invalidating arm exists
specifically to separate "has an invalidation mechanism" from "has a *typed defeasible contract*."

### 4.2 E2 — defeasance on drift (the decisive test)

A typed approval domain (N = 80, two audited classes; the live run uses N = 48, one audited class) with an
*external* mid-stream premise-invalidation: a compliance audit marks a class non-compliant, flipping its
previously-approved cases to reject. The audit is **not a record field** — it is exogenous — so a recall-only
cache retrieves the same unchanged record and serves its cached pre-audit answer. Stub results:

| arm | calls | overall acc | **drift acc** | max per-call ctx |
|---|---|---|---|---|
| **Struct** (typed contract) | **26** | **1.00** | **1.00** | **290** |
| Invalidating (hook, no contract) | 28 | 1.00 | 1.00 | 290 |
| Naive | 80 | 1.00 | 1.00 | 290 |
| Long-context | 80 | 1.00 | 1.00 | 2062 |
| RAG | 48 | 0.95 | 0.00 | 290 |
| CBR (typed key, no re-validation) | 24 | 0.95 | 0.00 | 290 |
| Skill (prose) | 80 | 0.95 | 0.00 | 297 |

The reading is three-fold. **Recall-only memories (RAG / CBR / Skill) serve stale** — recall alone
cannot recover, because the audit never enters their reuse path. **Recovery requires an invalidation mechanism**,
and *both* the Invalidating cache and Struct have one, so both reach drift-acc 1.00. What the **typed defeasible
contract adds over the hand-coded class-callback** is (i) **selectivity** — Struct re-asserts the post per entry
(`satisfies`) and evicts only the 2 *violated* (approve) classes, where the callback coarsely drops whole classes
(4 entries) and pays the extra re-derivations (26 vs 28 calls); (ii) **generality** — the same `assertPost` handles
any premise/contract, where the callback is per-event hand-coded; and (iii) **composition-safety** (§4.4). The
live run (`qwen36-q2-vram`, N = 48) reproduces this exactly: RAG/CBR/Skill drift-acc 0.00; Invalidating 14 calls /
drift 1.00; Struct 13 calls / 2.8 s / drift 1.00 / ctx 278 vs Long-context 1304 — recall-only stale, both
invalidating arms recover, Struct selective. So E2's defensible claim is not "only Struct recovers" but
"recall-only memory cannot un-learn, and a *declarative typed contract* provides the recovery selectively,
generally, and composition-safely."

### 4.3 E1 — amortization and structural transfer

A structural-decomposition domain (a method that *creates* a sub-graph with object ids), on the **full engine**.
Split: train, **held-out related** (same typed transitions, fresh id-spaces), and **held-out novel**. This is an
existence-and-soundness check on a small set (2 held-out related, 1 novel), not a population rate: with the
relativize/bind transform, *all* held-out related instances transfer at 0 calls and **sound**, the novel
transition pays (no false replay), and totals are 3 calls vs the no-cache baseline's 5. The no-transform ablation
(a flat content cache) "hits" the related instances but replays the *wrong id-space* — **unsound**. The point is
qualitative and is the most interesting finding in the paper: a call-count-only metric ranks the flat cache equal
to the transform (both elide), so **only the soundness check distinguishes sound reuse from a wrong-id-space
replay**. (Scaling this to a transfer *rate* over many methods is future work; §6.)

### 4.4 E3 — composition soundness

Composing method pairs purely on their typed contracts (box closed) and comparing to the open-the-box engine
outcome (on the **full engine**), the box-closed decision **matches reality on every evaluated pair, with no
false-admits** — the checker never false-accepts; under-determined or out-of-fragment pairs *escalate* (to a
micro-task) rather than admit. This is demonstrated on a small, hand-constructed set (3 composition pairs spanning
sound / unsound / escalate; a 4th adds the oracle case), so it is an existence demonstration of soundness, not a
population false-admit *rate*. Each of three gates is shown load-bearing on a dedicated example: removing
frame-completeness misses an undeclared write; removing the effect-tag gate silently admits an unverified external
effect; removing footprint-cycle detection admits a coupled-retractable cycle. The decision reads only the shared
footprint, never the body. (A larger, non-hand-picked method corpus is future work; §6.) We note the checker
itself — per-key abstract-domain entailment, sound-but-incomplete, escalate-on-doubt — is the most developed
formal artifact and is, if anything, under-evaluated here.

### 4.5 P4 — the K1-coverage ceiling

On a mixed workload (fraction *p* fully typed; the rest carrying a prose component that overrides the typed rule),
with K1-membership decided by the **real** canonicalization barrier, amortization is a **gradient in coverage**
(approval: 0 → 19 → 44 → 69 → 94% elided at p = 0/.25/.5/.75/1; triage: 0 → 22 → 47 → 72 → 97%). Struct's accuracy
is **1.00 at every coverage** — the non-typed fraction is a micro-task *cost*, never a soundness *cliff*. A greedy
variant that memoizes prose-bearing records on their typed key drops to an accuracy equal to the clean fraction:
**amortizing beyond the canonicalizable fraction is unsound**, so the K1 ceiling is a *soundness boundary*, not a
missed optimization. The result holds on both domains and is deterministic. We are explicit that this is a
**constructed illustration**, not a measurement of a real workload: we *set* the typed fraction *p*, and the
prose-bearing records are defined to override the typed rule, so "amortizing past K1 is unsound" follows by
construction rather than by surprise. What it establishes is the *shape* (amortization is proportional to
coverage, not a constant win) and that soundness is preserved at every level; the canonicalizable fraction of a
real corpus is domain-dependent and not measured here (§6).

### 4.6 E5 — scale and per-mechanism cost

A bookkeeping-cost check, not a claim about scaling the hard part: over a 200-class typed space with one mid-stream
audit, as the stream length N grows 1 320 → 20 320 (the *class set* is fixed; no new methods, no model):

| N | Struct calls | calls / N | Naive calls | library (memo) | evicted on drift |
|---|---|---|---|---|---|
| 1 320 | 202 | 0.153 | 1 320 | 200 | 2 |
| 5 320 | 202 | 0.038 | 5 320 | 200 | 2 |
| 20 320 | 202 | 0.010 | 20 320 | 200 | 2 |

Struct's call count stays **constant** (the bounded number of distinct classes plus the drift re-derivations), so
the per-record call rate falls toward zero while Naive stays at one; the library size is bounded by the class
count (trivially — it is a map keyed on a bounded class set); and a drift event **retracts only the invalidated
classes** (O(invalidated): 2 evictions over a 200-entry library, not O(library)). Per-operation costs are small:
canonicalization is ≈ 0.5–3.5 µs/call (the spread is JIT warmup — ~3.5 µs cold at N = 1 320, settling to ~0.5 µs at
N = 20 320), and a single drift's eviction pass is ≈ 0.5 ms over the whole library. What E5 establishes is
narrow: the typed bookkeeping (key, memo, selective eviction) does not become the bottleneck as the stream grows.
It does **not** test scaling in the dimension that matters — a growing library of *distinct* methods, a real
corpus, or a live model across all arms — which we leave to future work (§6).

---

## 5. Related Work

**Retrieval and case memory.** RAG [Lewis et al. 2020] and CBR recall by surface/embedding similarity and
reuse-or-adapt; they cannot represent a *premise becoming invalid*, so an exogenous change that leaves the query
unchanged leaves the cached answer retrievable and stale (E2). Skill libraries such as Voyager [Wang et al. 2023]
store reusable *prose* skills with no typed, defeasible premise, so a stale skill stays applicable and must be
re-applied by the model — cost without correctness (our Skill arm). Our typed premise lives in the belief, so when
it falls the derivation retracts (JTMS) and the library narrows the method.

**LLM agent memory.** Recent agent-memory systems manage *what to keep and recall* far more cleverly than vanilla
RAG — MemGPT/Letta's tiered virtual context [Packer et al. 2023], Reflexion's episodic verbal-reflection buffer
[Shinn et al. 2023], and graph-structured retrieval such as GraphRAG [Edge et al. 2024]. But they recall and reuse
by relevance, recency, or similarity and, to our knowledge, none represent a *typed premise whose falsification
retracts a prior reuse*. They are complementary rather than competing: a defeasible contract could sit beneath any
of them as the retraction layer. A tuned head-to-head against these systems is the clearest next evaluation (§6).

**Long context.** Carrying full history per call is correct but O(N) in per-call context (E2: 2062 vs 290) with no
structural reuse.

**Library learning / EBL.** DreamCoder [Ellis et al. 2021] and Stitch [Bowers et al. 2023] grow a library by
abstraction (anti-unification / MDL [Plotkin 1970]); EBG specializes from a single proof. These learn *what* to
reuse but attach no defeasible runtime contract that un-learns on drift; we add that contract and its blame-driven
revision.

**Contracts, blame, gradual verification.** Higher-order contracts with blame [Findler & Felleisen 2002] and
gradual/hybrid verification [Bader, Aldrich & Tanter 2018] are the lineage of our assume/assert/retract-blame
discipline; we apply it to *learned* methods, routing blame into a library revision rather than an error.

**Composition: graph grammars, HTN, separation logic.** A method is a two-faced HRG non-terminal [Habel 1992;
Drewes, Kreowski & Habel 1997; Courcelle 1990] with HTN precondition-gated selection [Erol, Hendler & Nau 1994];
recursive HTN plan-existence is undecidable [Erol, Hendler & Nau 1996], so the grammar is kept decidable by a
well-founded mount-rank while execution is explicitly fuel-bounded. Sound composition under shared state is the
frame problem [McCarthy & Hayes 1969], discharged by a separation-logic footprint discipline [O'Hearn, Reynolds &
Yang 2001; Reynolds 2002] over a finite typed alphabet (E3).

**Theory revision and belief revision (the nearest neighbor).** `reviseOnBlame` — specialize a learned
precondition from a counterexample rather than delete the method — is, squarely, **theory revision / refinement**
of a *learned* rule base: EITHER [Ourston & Mooney 1994] and FORTE [Richards & Mooney 1995] revise Horn-clause
theories on contradicting examples, exactly our blame→specialize step. At the logical level the contraction/
revision of a belief set on a new fact is **AGM belief revision** [Alchourrón, Gärdenfors & Makinson 1985], and
the runtime monitor sits in the **defeasible/non-monotonic reasoning** tradition. We do not claim a new revision
operator; our contribution relative to this line is operational — attaching the revision to a *typed, composable,
canonicalizable method library* with a runtime contract, so amortization, composition-checking, and un-learning
share one representation. A reviewer from this community will rightly read the work as theory revision wrapped in a
typed-contract, amortizing library; we agree, and position it as such.

**Truth maintenance.** The un-learn mechanism is a JTMS [Doyle 1979; de Kleer 1986]: a retracted premise cascades
to its dependency closure, serving no wrong belief — the defeasance the baselines lack.

**Durable execution and workflow nets.** A case is an uncoloured 1-safe marking over a workflow net [van der Aalst
1998]; the durable executor that runs validated methods at scale is a known artifact [AWS 2022; Prefect;
Skiadopoulos et al. 2022]. Our belief view sits atop such a layer; we do not reinvent the plumbing.

**Incremental view maintenance and cache invalidation.** DBSP [Budiu et al. 2023] / Materialize maintain *values*
incrementally, and production caches invalidate on source change — both are, in effect, the "invalidation hook" our
fair baseline models, and we do not claim novelty over them for *recovering* on drift. The difference we claim
is narrow: our object is a typed, *defeasible*, auditable belief whose invalidation
is **derived from a declarative contract** (re-assert the post; blame; specialize the precondition), rather than a
hand-specified view or a per-source invalidation rule — so it generalizes across premises and feeds library
revision, not just value recomputation.

---

## 6. Threats to Validity

**Stub vs. live model.** The deterministic stub removes model error to isolate each arm's *mechanism* — the very
thing we claim about. It makes the comparison reproducible, and the **live** E2 run confirms the same ordering
with a real model, where staleness is actually produced by the model following stale prose or a cache hit. The
stub is not claimed to predict absolute live accuracy; running more arms live (E1/E3/P4 are engine-mechanism
experiments and use the model as a call counter) is future work.

**K1-coverage is parameterized.** P4 *sets* the typed fraction and *measures* it via the real barrier; the
non-circular claims are the **shape** (a gradient), the **universality of soundness** (1.0 at every coverage), and
the **soundness boundary** (greedy amortization is unsound). The absolute canonicalizable fraction of any given
production workload is domain-dependent and not claimed to be high everywhere.

**Baseline strength.** RAG/CBR/Skill are our implementations; the **Invalidating** baseline isolates "has an
invalidation hook" from "has a typed contract," so the claim is precise: recall-only memory cannot recover, while a
*declarative typed contract* recovers selectively (post-violated only), generally (any premise), and
composition-safely. A *tuned* event-invalidating RAG/CBR is essentially the Invalidating arm and is expected to
match Struct on drift-accuracy, differing only on selectivity/generality — a head-to-head we name as future work.

**Novelty / positioning.** No mechanism is new; the work is a *composition* of JTMS, contracts-with-blame, library
learning, and separation-logic footprints, and `reviseOnBlame` is theory revision (EITHER/FORTE). We position the
contribution as the operational unification — typed amortizable library + composition-checking + un-learning in
one representation — not as a new learning or revision algorithm.

**Scale and breadth.** The mechanism experiments (E2–E4) use modest N (≤ 80 per E2 run) over two synthetic domains
with known ground truth; E5 extends the *deterministic* measurements to N ≈ 20 k and a 200-method library (showing
amortization, bounded growth, and selective retraction hold with cheap per-op costs). What remains future work is
scale with a *live* model and a *real* corpus on a durable executor, and a **tuned head-to-head against modern
agent-memory systems** (MemGPT/Letta, Reflexion, GraphRAG) rather than the in-paper baselines.

**Soundness is eventual, not static.** Applicability of a learned method is undecidable in general (Rice), so the
guarantee is eventual soundness via a load-bearing runtime monitor over a sound-but-incomplete compose-time gate.
The monitor must run; its absence reintroduces false-admits, as E3's ablations show.

**Single engine / single author.** All results are on one implementation; independent reproduction on a different
substrate would strengthen the structural claims.

---

## 7. Conclusion

Recall-only agent memory cannot un-learn; static libraries are sound but frozen. A learned library of typed
methods with a **defeasible runtime contract** gets both: it amortizes and composes on typed structure, and when a
premise drifts it *retracts with blame and revises* — recovering correctness where retrieval, CBR, and skill
libraries serve stale. Our experiments isolate this: recall alone cannot recover; an invalidation hook
can; and a *declarative typed contract* provides that recovery selectively, generally, and composition-safely, at
bounded per-call context, on a real engine and confirmed on a live model — bounded by a canonicalizable fraction
that is itself a soundness boundary. Every mechanism is prior art (JTMS, contracts-with-blame, theory revision,
library learning, separation logic); the contribution is their composition into a single typed representation in
which amortization, composition-checking, and un-learning coincide. It is, deliberately, an engineering synthesis
with a testable emergent property — principled, selective un-learning — rather than a new algorithm; we think that
property is worth naming and measuring.

---

## References

- C. E. Alchourrón, P. Gärdenfors, D. Makinson. *On the Logic of Theory Change: Partial Meet Contraction and Revision Functions.* Journal of Symbolic Logic 50(2):510–530, 1985.
- AWS. *Step Functions Distributed Map — A Serverless Solution for Large-Scale Parallel Data Processing.* AWS, 2022.
- J. Bader, J. Aldrich, É. Tanter. *Gradual Program Verification.* VMCAI 2018, LNCS 10747, pp. 25–46.
- M. Bowers, T. X. Olausson, L. Wong, G. Grand, J. B. Tenenbaum, K. Ellis, A. Solar-Lezama. *Top-Down Synthesis for Library Learning.* POPL 2023; Proc. ACM Program. Lang. 7(POPL).
- M. Budiu, T. Chajed, F. McSherry, L. Ryzhyk, V. Tannen. *DBSP: Automatic Incremental View Maintenance for Rich Query Languages.* PVLDB 16(7):1601–1614, 2023.
- B. Courcelle. *The Monadic Second-Order Logic of Graphs I: Recognizable Sets of Finite Graphs.* Information and Computation 85(1):12–75, 1990.
- J. de Kleer. *An Assumption-based TMS.* Artificial Intelligence 28(2):127–162, 1986.
- J. Doyle. *A Truth Maintenance System.* Artificial Intelligence 12(3):231–272, 1979.
- D. Edge, H. Trinh, N. Cheng, J. Bradley, A. Chao, A. Mody, S. Truitt, J. Larson. *From Local to Global: A Graph RAG Approach to Query-Focused Summarization.* arXiv:2404.16130, 2024.
- F. Drewes, H.-J. Kreowski, A. Habel. *Hyperedge Replacement Graph Grammars.* In Handbook of Graph Grammars and Computing by Graph Transformation, Vol. 1 (G. Rozenberg, ed.), World Scientific, pp. 95–162, 1997.
- K. Ellis, C. Wong, M. Nye, M. Sablé-Meyer, L. Morales, L. Hewitt, L. Cary, A. Solar-Lezama, J. B. Tenenbaum. *DreamCoder: Bootstrapping Inductive Program Synthesis with Wake-Sleep Library Learning.* PLDI 2021.
- K. Erol, J. Hendler, D. S. Nau. *UMCP: A Sound and Complete Procedure for Hierarchical Task-Network Planning.* AIPS 1994.
- K. Erol, J. Hendler, D. S. Nau. *Complexity Results for HTN Planning.* Annals of Mathematics and Artificial Intelligence 18:69–93, 1996.
- R. B. Findler, M. Felleisen. *Contracts for Higher-Order Functions.* ICFP 2002, pp. 48–59.
- A. Habel. *Hyperedge Replacement: Grammars and Languages.* LNCS 643, Springer, 1992.
- P. Lewis, E. Perez, A. Piktus, F. Petroni, V. Karpukhin, N. Goyal, H. Küttler, M. Lewis, W. Yih, T. Rocktäschel, S. Riedel, D. Kiela. *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.* NeurIPS 2020.
- J. McCarthy, P. J. Hayes. *Some Philosophical Problems from the Standpoint of Artificial Intelligence.* Machine Intelligence 4, 1969.
- P. W. O'Hearn, J. C. Reynolds, H. Yang. *Local Reasoning about Programs that Alter Data Structures.* CSL 2001, LNCS 2142, pp. 1–19.
- D. Ourston, R. J. Mooney. *Theory Refinement Combining Analytical and Empirical Methods.* Artificial Intelligence 66(2):273–309, 1994.
- C. Packer, S. Wooders, K. Lin, V. Fang, S. G. Patil, I. Stoica, J. E. Gonzalez. *MemGPT: Towards LLMs as Operating Systems.* arXiv:2310.08560, 2023.
- G. D. Plotkin. *A Note on Inductive Generalization.* Machine Intelligence 5:153–163, 1970.
- Prefect. *Caching* (result/task caching by cache key). Prefect 3 documentation.
- J. C. Reynolds. *Separation Logic: A Logic for Shared Mutable Data Structures.* LICS 2002, pp. 55–74.
- B. L. Richards, R. J. Mooney. *Automated Refinement of First-Order Horn-Clause Domain Theories.* Machine Learning 19(2):95–131, 1995.
- N. Shinn, F. Cassano, A. Gopinath, K. Narasimhan, S. Yao. *Reflexion: Language Agents with Verbal Reinforcement Learning.* NeurIPS 2023.
- A. Skiadopoulos, et al. *DBOS: A DBMS-oriented Operating System.* PVLDB 15(1):21–30, 2022.
- W. M. P. van der Aalst. *The Application of Petri Nets to Workflow Management.* J. Circuits, Systems and Computers 8(1):21–66, 1998.
- G. Wang, Y. Xie, Y. Jiang, A. Mandlekar, C. Xiao, Y. Zhu, L. Fan, A. Anandkumar. *Voyager: An Open-Ended Embodied Agent with Large Language Models.* arXiv:2305.16291, 2023.

---

*Code & reproducibility: the engine and the self-contained experiment artifact are public at
`github.com/9pings/skynet-graph` — `artifact/paper-dll/` (workload.js, arms.js, harness.js, e1-transfer.js,
e3-compose.js, p4-coverage.js, scale.js, measure-e2-live.js, F6-transfer.js) with the deterministic suite
`tests/integration/paper-{harness,e1-transfer,e3-compose,p4-coverage,scale}.test.js` (`npm test`). The live E2
uses a local OpenAI-compatible endpoint (`qwen36-q2-vram`). Licensed AGPL-3.0-or-later.*
