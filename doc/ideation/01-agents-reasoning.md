# Ideation — MOE Graph through the LLM-agent / reasoning-systems lens

*R&D ideation, not a spec. Lens: long-horizon agents, context/memory limits, plan decomposition,
tool-use orchestration, multi-agent coordination, self-consistency/verification, exploration vs
exploitation, replanning. Honesty discipline: every claim is marked **REAL** (defensible edge),
**OVERHYPED** (true but already-better-elsewhere or oversold), or **RISK** (a sharp edge to engineer
around). Where I recommend, I rank by leverage.*

Read against: `docs/superpowers/specs/2026-06-21-moe-graph-inspector-design.md` (loop + roadmap),
`doc/aspect-modele-programmation-fiabilite.md` + `doc/aspect-calcul-incremental.md` (critical studies),
`App/objects/Concept.js`, `App/objects/Entity.js`, `App/Graph.js`, `_lab/loop.js`, `_lab/run-problem.js`.

---

## 0. The one-sentence thesis

skynet-graph is **a JTMS wired to a forward-chaining planner whose rule-actions are LLM calls, where the
graph is durable working memory and every call sees only bounded local context.** The defensible, *unique*
agentic value is not "graph of experts" (blackboard systems did that in the 1980s, LangGraph does
orchestration today). It is the **conjunction of four things no agent framework offers together**: (1)
**reactive fine-grained retraction** (a premise falls → exactly its consequences uncast and cascade —
JTMS defeasance, not gross-grain rollback), (2) **dependency-tracked memoization of LLM effects** (a call
re-fires only if a *tracked fact* changed, not on prompt-hash), (3) **bounded local context per call by
construction** (the graph holds state, not the prompt), and (4) **structural provenance** (every fact is a
revision-stamped atom traceable to the concept and the `require` chain that fired it). Everything below is
about what that conjunction structurally enables, and how to model an agent to exploit it.

---

## 1. PROBLEMS / INNOVATIONS — what this solves uniquely or better

### 1.1 The headline: enormous problems without context blowup — **REAL, with one caveat**

The decompose → stabilize → bounded-rollup loop (`_lab/loop.js`) is genuinely structural, not a prompt
trick. Each LLM call's input is the *local segment's facts + its direct children's bounded answers*
(`scope._.expandedInto.map(... ._.answer)`), never the transcript. A bare reasoning model's context grows
with the problem; LangGraph's state object grows unless you hand-write trimming; here the **invariant is
enforced by the model** — the rollup writes one `answer` of capped `maxTokens` regardless of subtree size
(spec §4). That O(1)-per-node answer size *is* the value proposition.

- **Better than LangGraph:** LangGraph passes a state blob between nodes; bounding it is application code.
  Here boundedness is the data model.
- **Better than a bare reasoning model:** the model has no externalized, addressable working memory; it
  re-reads its own context. Here memory is the graph and reads are local.
- **CAVEAT / RISK (K2 from the incremental study):** *termination ≠ economy.* The loop converges, but a
  legitimately huge decomposition can fan out to hundreds of calls. Boundedness solves context, not cost.
  This is exactly why budget/beam (planned #4) is load-bearing, not optional — see §3.4.

### 1.2 Defeasible replanning — **REAL, and genuinely unique**

When a premise becomes false, `ensure` triggers `unCast` (`Entity.js:192-246`), which recursively uncasts
child concepts and runs `cleaner`s. **An agent can declare "this sub-plan is valid ONLY WHILE hypothesis H
holds" and get automatic, precise invalidation for free.** No framework does this:

- LangGraph "time-travel" is checkpoint replay — coarse, whole-node, you rewind and re-run.
- A reasoning model can assert A at turn 3 and ¬A at turn 9 with *zero* retraction of A's consequences.
- TodoWrite-style task lists never un-check themselves.

This is the single most differentiated agentic capability. Concrete use: a long-horizon coding/research
agent where a discovered fact ("the API is deprecated") should *automatically retract* every downstream
sub-task that assumed it — and only those — then re-stabilize. That is structurally impossible to get wrong
here and structurally hard to get right anywhere else.

### 1.3 Order-free, async-native tool orchestration — **REAL**

A concept fires *when* its `require` facts exist, not "after step X" (`Concept.isApplicableTo`,
`Entity.updateApplicableConcepts`). Unresolved requires install a `follow` watcher and the concept retests
when the fact appears. **The plan reorders itself when tool results arrive out of order** — the normal case
in real async tool-use. LangGraph freezes order in edges; here order is recomputed each fixpoint. For an
agent firing N parallel tools with unpredictable latency, this is the right execution model.

### 1.4 Dependency-keyed memo of LLM *effects* — **REAL on discrete facts, RISK on prose**

The memo key is "the set of tracked `require`/`follow` facts," not the prompt text (incremental study A1).
Strictly finer than LangChain's exact-prompt cache, cleaner than GPTCache's embedding-threshold (no false
hits) — *as long as inputs are discrete typed facts.* Edit one constraint (budget, date) and only the
transitively-dependent calls re-fire: **native partial re-planning.**

- **RISK K1 (dominant):** if a node's input is itself variable LLM prose, the key fragments and the cache
  never hits. This is *the* failure mode for free-text reasoning. Mitigation is a modeling discipline, not
  a feature — see §4: **concepts must emit typed discrete facts, never raw prose, as the things other
  concepts depend on.**

### 1.5 Structural provenance / audit — **REAL, monetizable**

Every fact is a revision-stamped atom (`_revs[revNum] = {id, parent, bagRefs, tpl}`); the trace
(`cfg.onConceptApply`) records concept, target, patch, **why it fired** (resolved `require` chain), prompt,
reply, ms. "Why did the agent conclude X?" has a *mechanical* answer — the derivation, not a transcript to
re-read. For regulated/auditable agents (compliance, finance, health, legal) this is a deliverable, not a
nicety. No bare-model or LangGraph trace gives you "premise → concept → fact" as first-class data.

### 1.6 Non-obvious capabilities the model STRUCTURALLY enables

These fall out of the mechanics and are, to my knowledge, novel in combination:

- **N1 — Provenance-driven blame & targeted repair.** Because retraction is precise and the trace records
  the `require` chain, when a leaf answer is later judged wrong you can retract *exactly its dependents* and
  re-derive only them. An agent that "finds a bug in its own earlier reasoning" repairs surgically instead
  of restarting. **REAL** — structurally enabled, not yet built.
- **N2 — The retraction event is a signal, not just cleanup.** A dying sub-plan can deposit a bounded
  memory of *what failed and why* via its `cleaner` (planned #1). This makes JTMS retraction *productive* —
  failed branches teach instead of vanishing. No compared system has this (LangGraph rolls back leaving no
  residue; a bare model has no cross-attempt memory). **REAL, and the highest-leverage adaptation** — §3.1.
- **N3 — Self-modifying control structure in the loop.** `patchConcept`/`addConcept` let a meta-concept
  *running inside stabilization* change strategy mid-run (planned #2/#3). This is "DSPy where the AI authors
  the control structure, not just tunes prompts." **REAL but highest-risk** — gate it (§3.3).
- **N4 — Multi-world reasoning via fork as first-class compare-alternatives.** JTMS is single-world; to
  compare "fly vs train" you `fork()` (a child Graph) per alternative and `merge()` the winner back. The
  fork mechanism already exists (`Graph.fork`/`merge`, lines 1938-1985). **REAL** but currently a
  blunt instrument — needs an ATMS-flavored modeling layer (§3.5, §4 #2).
- **N5 — A "reasoning cache" that is serializable and shareable.** State + bagRefs serialize
  (`serialize()`), so a solved sub-graph is a *portable artifact* — a team or a later run can mount a
  previously-derived sub-answer instead of re-deriving it. Not process-local like LangChain's cache.
  **REAL**, underexploited.
- **N6 — Convergence/idempotence as a property.** Same inputs → same stable fact set (the fixpoint). Rare
  and precious for an agent; a free LLM loop has no convergence guarantee. **REAL** (but only at the
  *trigger* level — the LLM output gravé is not reproducible; do not oversell as content reproducibility).

### Honest comparison

| Capability | skynet-graph | LangGraph | bare reasoning model | DSPy |
|---|---|---|---|---|
| Fine-grained reactive retraction | **Yes (primitive)** | No (coarse checkpoint) | No | No |
| Bounded local context by construction | **Yes (data model)** | App code | No (context grows) | N/A |
| Dependency-keyed LLM-effect memo | **Yes (discrete facts)** | No | No | No |
| Order-free async firing | **Yes (emergent)** | No (coded edges) | Implicit/opaque | No |
| Structural provenance | **Yes (native)** | Traces | Transcript | Module traces |
| Self-modifying control in-run | **Yes (patch/addConcept)** | No | No | Offline optimize |
| Multi-world compare | Fork (manual) | Manual branches | Sampling | No |
| Produces the fuzzy judgment | **No (delegates to LLM)** | No | **Yes** | Optimizes prompt |
| Maturity / ecosystem | Prototype | Production | Production | Growing |
| Capability-authoring cost | **High (concepts)** | Medium | Low (prompt) | Medium |

**OVERHYPED, stated plainly:**
- "The reasoning lives in the rules, not the weights." Half-true. The *orchestration* of judgment lives in
  rules; the *judgment* (split? atomic? good answer?) lives in the LLM provider. The graph materializes and
  maintains the judgment; it does not produce it. Selling this as "reasoning is in the data" is a gadget.
- "MOE / mixture of experts." It is an LLM-knowledge-source blackboard with state-conditioned activation —
  closer to Hearsay-II (1980s) than to weight-level MoE. The added value over a classic blackboard is the
  retraction + replay + provenance, **not** the routing. Keep the honest framing.
- Forward-chaining itself is redundant with Rete/Drools/Datalog (mature, incremental, formal). Don't claim
  the *engine* is novel; claim the *target* (LLM-as-rule-action with truth maintenance) is.

---

## 2. DEDUCED IMPROVEMENTS — high-leverage mechanisms this lens reveals (not yet planned)

Ranked by leverage.

### D1 — Typed-fact discipline as a first-class authoring contract (highest leverage, lowest cost)
The dominant risk (K1) is memo fragmentation when a dependency is LLM prose. The fix is not a feature but a
**modeling rule enforced by the schema validator** (planned #2): *a concept may depend (`require`/`ensure`)
only on discrete typed facts (enums, ids, numbers, booleans, short canonical strings), never on a free-text
field.* Prose is allowed as a *terminal* `answer`/`description` (read by humans / a rollup prompt) but is
**never a trigger**. This single discipline is what makes the memo edge, the partial-replan edge, and the
exclusion-keys for memory (§3.1) all actually work. Cheap, structural, decisive. **Do this first.**

### D2 — Confidence / freshness as ordinary facts → defeasance you can drive
Hallucinated facts propagate cleanly (K3); the engine maintains coherence, not truth. Make **confidence and
freshness ordinary typed facts** on every provider-produced fact (`{answer, confidence: 0.x, derivedAtRev,
ttlRev?}`). Then a generic concept can `ensure: ["$confidence > 0.6"]` — *low-confidence facts retract
themselves and cascade*, turning the JTMS into a defeasance engine driven by the LLM's own (or a verifier's)
confidence. Freshness lets provider facts expire (the missing TTL the incremental study flags as K3). Zero
core change — it is just facts + an `ensure`. **High leverage; pairs with verification (§3.5).**

### D3 — Stigmergic frontier facts (exploration coordination without a planner)
Borrow ant-trail stigmergy: an `Expand` writes a bounded `frontier` fact on the *anchor* node describing
open sub-problems and their estimated value; strategy concepts read the frontier to decide *where to spend
next*, and `cleaner`s/retraction update it. Exploration becomes coordinated by *facts on the graph* rather
than by an external scheduler — fully in keeping with "the sharing is the protocol." This is the structural
substrate for beam search (§3.4) and for multiple strategy concepts competing without stepping on each
other. **REAL novelty; medium build cost.**

### D4 — Per-key revision stamping (precision for blame & memo)
Today `why`/provenance is object-granular (`_computeWhy`, the `_rev` of the object, not the key — spec §2.4
documents this limitation). For N1 (targeted repair) and for tight memo invalidation, opt-in per-key
stamping in `Entity.set` (stamp `_revByKey[key] = currentRev`) lets you retract/re-derive on the *exact*
fact that changed, not the whole object. Deferred in the spec; this lens says it is worth more than it looks
because it sharpens both blame and incremental re-fire. **Medium leverage, small change.**

### D5 — Cost & uncertainty propagation as graph facts (the substrate for budgeting)
Make `cost` (tokens/$/latency) and `uncertainty` **roll up the same way answers do** — a parent's cost is
Σ children's cost; a parent's uncertainty is an aggregation of children's. With cost-as-fact, a budget
concept can `ensure` a node stays expandable only while remaining budget > estimated cost, and *prune by
retraction* (the most expensive low-value frontier nodes uncast themselves). This makes budgeting a
*structural property* rather than an external counter. **High leverage; it is how #4 should actually be
built — see §3.4.**

### D6 — A verification concept *layer* with quorum (self-consistency, structurally)
Instead of one verifier, model self-consistency as **k sibling verification concepts** (or k forks, §3.5)
whose boolean verdicts are discrete facts; a `Consensus` concept `ensure`s on agreement count. This turns
"self-consistency / majority vote" — which a bare model fakes by sampling — into *maintained facts*: if a
later retraction flips one verdict, consensus re-evaluates and can cascade. **Medium leverage; this is the
right shape for #5 — see §3.5.**

### D7 — Loop/oscillation guard as an engine invariant (termination safety)
Self-modification (#3) + memory-driven strategy (#1) introduce real oscillation risk
(try-A→fail→try-B→fail→try-A). The spec's answer is append-only memory + exclusion keys + self-flags. Make
this a *general engine-level guard*: a per-(target, conceptName) **apply-count ceiling** in the stabilize
loop that hard-stops re-fire and writes a `divergent` fact (itself a retraction trigger). Cheap insurance
against the worst self-modifying failure mode. **Low cost, prevents the catastrophic case.**

---

## 3. ADAPT THE PLANNED 5 — how to MODEL each to best serve agentic reasoning

### 3.1 Memory-on-retraction — model it as a **typed, scoped, exclusionary lesson store**

The planned design (spec §4b) is sound and validated zero-core-change. Adaptations for agentic strength:

- **Keying — avoid the prose trap (K1).** Memory must be keyed by *discrete context*, not by the failed
  prose. Key = `(taskKind, strategyId, failureReason-enum)`. The spec's flat boolean projection keys
  (`failed_<ctx>_<strat>`) are exactly right *because* `getRef` can't aggregate a list — make the **context
  hash a discrete, canonicalized fact** (e.g. the segment's `label` normalized to a slug, or better a
  typed `taskKind` the eval concept already emits). If you key on the raw label string you reintroduce
  fragmentation; key on a typed enum.
- **Scope — anchor outside the dying subtree, but partition by context.** One global `{_id:'memory'}`
  free-node works mechanically, but for huge problems make memory **hierarchical**: anchor lessons on the
  *nearest surviving ancestor segment*, not only the root, so a strategy concept reads only lessons
  relevant to its local sub-problem (bounded reads — same discipline as bounded rollup). Global memory =
  context blowup at scale.
- **Shape — bounded, discrete, monotone.** `{strategy, outcome:'failed', reason:enum, atRev, conf}`. Never
  transcripts. Append-only.
- **Consumption — negative-only dependence (the termination key).** A strategy concept depends on memory
  *only to be disabled* (its `assert` excludes already-recorded failures), never re-enabled. This is what
  makes the strategy set *strictly shrink per context* → well-founded → terminating. This is the single
  most important correctness property; the spec nailed it, keep it inviolable.
- **Agentic upgrade — lessons should be *generative*, not just exclusionary.** Beyond "don't repeat A,"
  let a memory fact carry a bounded `hint` (e.g. "A failed because precondition P was unmet"); a strategy
  concept reads the hint and *casts a different, more specific strategy* (or, in the self-mod tier,
  `addConcept`s one). This is what turns memory-on-retraction from a dedup table into **learning across
  attempts within a single run** — the genuinely novel agent capability (N2).

### 3.2 Declarative AI-authorable concepts — model authoring as **typed-template synthesis from a vetted palette**

- **The AI authors declarative parts only** (require/assert/ensure/prompt/which-provider) from a
  **host-vetted provider palette**; it never writes provider JS. `LLM::complete` being universal means it
  rarely needs to. This is the safety boundary — keep it hard.
- **Schema validation checks STRUCTURE, never expressiveness** (the standing directive): field names/types
  present, asserts parse via `expr.js`, named provider exists, **and (new) every `require`/`ensure` ref
  resolves to a typed-fact-producing concept, not a prose field** (this is where D1 is enforced at author
  time — reject a concept that triggers on prose *before* it fragments the graph).
- **Give the authoring AI the trace + memory as the feedback signal** (spec §4c step 3). The loop is:
  author → run → trace shows fired/why + cost → memory records failures → AI patches. Model the AI author
  *itself as a meta-concept* (§3.3) so authoring is in-graph and auditable like everything else.
- **Agentic framing:** the unit the AI emits is a **concept↔prompt pair** = a reusable, inspectable,
  retractable *skill*. A library of these is a far better artifact than a pile of prompt strings, because
  each carries its trigger condition and its provenance. This is the real "skills as data" story.

### 3.3 Live self-modification — model the meta-concept as a **bounded, gated, single-writer strategist**

This is N3 — highest leverage, highest risk. Modeling constraints:

- **One meta-concept, single-writer, fires on a stable signal.** It should trigger on
  `ensure:["$stuck"]`-style facts (a `Stuck` fact deposited when a subtree exhausts its strategies / blows
  budget), not poll continuously. Single-writer avoids two meta-concepts patching the same concept in one
  stabilization pass.
- **Re-entrancy must be verified** (spec §4c flags it): patch/add called from *inside* a provider cb during
  stabilization. The same queue discipline as the mid-uncast write applies (`_mutationThreadRunning` guard
  queues nested mutations, drained after the in-flight one — Graph.js ~903-907, 1250-1252). `addConcept`
  must re-stabilize like `patchConcept` does. **Test this before shipping the tier.**
- **Every self-mod is a revision** → already auditable & rollback-able. Exploit this: a self-modification
  that makes things worse can be detected (cost/uncertainty rose) and `rollbackTo`'d. Model self-mod as
  *hypothesis-and-test*: patch → stabilize a bounded region → if worse, rollback. This makes the riskiest
  tier safe-by-construction using already-built machinery.
- **Gate behind trace+memory+budget being solid** (spec's own sequencing — agreed). Add D7 (apply-count
  ceiling) as the backstop against self-modification-induced oscillation.

### 3.4 Budget / pruning — model budget as a **rolled-up fact + ensure-gated frontier (beam by retraction)**

Do *not* model budget as an external counter the host decrements. Model it as graph facts (D5):

- **Cost rolls up like answers** (Σ children) and **value/priority rolls up** (max/aggregate). Each
  expandable frontier node carries `estCost` and `estValue`.
- **Beam = an `ensure` gate.** `Expand` becomes applicable only while the node is in the top-k frontier by
  value/cost *and* `remainingBudget > estCost`. When budget shrinks or a better sibling appears, lower-rank
  frontier nodes **fall out of the beam and retract** (the half-expanded subtree uncasts via cascade —
  exactly what JTMS gives you for free). **Pruning is retraction.** No other framework prunes a search tree
  by truth-maintenance; this is a structural fit.
- **Budget propagates down as an allowance.** A parent splits its allowance among children
  (`childAllowance = parentRemaining / estChildCount`), written as a fact each child reads. Decomposition
  can't explode because each node only expands within its inherited allowance — *the budget is local,
  matching the bounded-context philosophy.*
- **Per-concept cost annotation** (planned) feeds `estCost`; the trace's `ms` + token accounting feed
  *actual* cost back for the next estimate (closing the loop with D5/D3).
- **Honest note (K2):** this controls the *productive* tree size, which memoization cannot. Budget is the
  thing that makes "enormous" affordable. It is not optional polish — it is co-equal with the loop itself.

### 3.5 Verification concepts — model verification as **typed verdict facts + ensure-driven retraction + quorum**

- **A verifier is a concept that depends on another concept's output and emits a discrete verdict fact**
  (`{verdict:'pass'|'fail', confidence, reason-enum}`) — never prose. The checked concept's *validity*
  becomes `ensure:["$Verified.verdict=='pass'"]`, so **a failed verification retracts the unverified fact
  and cascades** (truth maintenance driven by a checker — the cleanest possible shape).
- **Truth, not just coherence (K3):** the verifier should check against *something external* — a tool, a
  computation, a retrieved source — not just "does this look coherent." Model it as a provider that can
  call a verification tool; emit `verifiedAgainst: <source-id>` as provenance.
- **Self-consistency via quorum (D6):** k verifier siblings (or k forks, below) emit k verdict facts; a
  `Consensus` concept `ensure`s on agreement count. Disagreement is itself a fact that can trigger a
  forked-comparison or a self-mod.
- **Compare alternatives given JTMS-not-ATMS — use fork as the ATMS substitute (N4):** the engine
  maintains one world; to *compare* alternatives you `fork()` one child per hypothesis (each develops its
  alternative to a stable, verified, costed answer), then a host-side (or meta-concept) selector reads each
  fork's `{answer, confidence, cost}` and `merge()`s the winner. **Model the fork's seed and project
  functions to carry only bounded results back** (don't merge the whole sub-graph — merge the typed
  verdict + answer), preserving the bound. This is poor-man's ATMS: explicit, costed, parallel worlds with
  a defined selection step. Honest: it is *not* free like ATMS labels — each fork pays full development
  cost. So fork **only at genuine decision points the verifier flags as high-uncertainty**, not by default.

---

## 4. THE BEST MODELING — strongest recommendation, ranked by leverage

How to model an agent's reasoning here to maximize capability on enormous problems. The mental model:
**a self-pruning, self-verifying, lesson-accumulating decomposition DAG of typed facts, where the LLM is
called only locally and only when a tracked fact changed.**

**Rank 1 — Typed-fact spine (D1). Without this, nothing else holds.**
Every inter-concept dependency is a discrete typed fact; prose is terminal-only. Enforce at author time.
This is the cheapest, highest-leverage decision: it is the precondition for the memo edge, partial replan,
exclusion-keyed memory, and confidence-driven defeasance all working. *Decide this and never break it.*

**Rank 2 — Budget-as-rolled-up-fact with beam-by-retraction (D5 + §3.4).**
Make cost/value/allowance graph facts that roll up and gate `Expand` via `ensure`. Pruning becomes
retraction; budget becomes local allowance. This is the mechanism that converts "terminates" into
"affordable" — the actual barrier to enormous problems (K2). Co-equal with the decompose/rollup loop.

**Rank 3 — Confidence/freshness facts + verification-by-retraction (D2 + §3.5).**
Provider facts carry confidence; verifiers emit typed verdicts; both drive `ensure`. The JTMS now defends
against the dominant truth risk (K3): low-confidence and falsified facts *retract themselves and cascade*.
This is the single most distinctive thing the architecture can do that no agent framework can — make the
graph's coherence machinery also serve *truth* maintenance.

**Rank 4 — Productive retraction: memory-on-retraction as scoped, exclusionary, generative lessons (§3.1).**
Failed branches deposit bounded, context-keyed, monotone lessons on the nearest surviving ancestor;
strategy concepts read them to *avoid repeats and adapt strategy*. Negative-only dependence guarantees
termination. This is N2 — cross-attempt learning *within one run*, which neither LangGraph nor a bare model
has. High leverage once Ranks 1–3 are solid (it depends on typed keys and on confidence to judge "failed").

**Rank 5 — Fork as explicit multi-world compare, gated by verifier uncertainty (N4 + §3.5).**
Single-world JTMS compares alternatives by forking only at decision points the verifier flags
high-uncertainty; each fork develops a verified, costed answer; a selector merges the bounded winner back.
This buys ATMS-like alternative comparison without the engine becoming an ATMS — at honest, paid cost, so
spend it sparingly.

**Rank 6 — In-graph self-modifying strategist as hypothesis-and-test (N3 + §3.3), gated last.**
A single-writer meta-concept fires on `Stuck`, reads trace+memory, `patch`/`addConcept`s a strategy,
stabilizes a bounded region, and `rollbackTo`s if cost/uncertainty worsened. Highest ceiling, highest risk;
ship only after Ranks 1–5 and the D7 apply-count guard. This is where "the AI authors its own control
structure" becomes real — and where it can also blow up, so it is last on purpose.

### The synthesis (one paragraph to build toward)
Model an enormous problem as a **typed-fact decomposition DAG**: a root segment seeds the prompt;
`EvalComplexity`/`Expand` grow children *within an inherited budget allowance*, writing only discrete facts;
each call sees only its local segment + its children's bounded answers; **frontier facts** coordinate where
to spend (stigmergy); a **beam `ensure`** keeps only top-k frontier nodes castable and *retracts the rest*;
leaf answers are **verified** by sibling/quorum verifier concepts emitting typed verdicts, and carry
**confidence**, so falsified/low-confidence facts *retract themselves and cascade*; **bounded rollup**
synthesizes leaf→root with O(1) answer size; failed branches deposit **scoped, exclusionary, generative
lessons** that future strategy concepts read to adapt; at high-uncertainty decision points the agent
**forks** parallel worlds and merges the verified winner; and a single, last-gated **meta-concept** rewrites
its own strategy by hypothesis-and-test with rollback. Every step is a revision-stamped, traceable atom.
The result is the one thing no current agent framework offers in one system: **a long-horizon agent whose
working memory is durable and local, whose plan reorders and prunes itself, whose wrong conclusions retract
precisely, whose failures teach, and whose every move is auditable** — bounded in context by construction
and bounded in cost by budget-as-fact.

---

## 5. Risk ledger (carry these forward)

| Risk | Source | Mitigation in this doc |
|---|---|---|
| **K1 — memo/key fragmentation on prose** | incremental study | D1 typed-fact spine (Rank 1); enforce at author-time validation |
| **K2 — termination ≠ economy; exploration explosion** | both studies | Budget-as-fact + beam-by-retraction (Rank 2); D3 frontier; D5 cost rollup |
| **K3 — hallucinated facts propagate cleanly (coherence ≠ truth)** | fiabilité study | Confidence/freshness facts + verification-by-retraction (Rank 3); external-source verifiers |
| **K4 — oscillation from memory/self-mod** | spec §4b/§4c | Negative-only dependence + exclusion keys (§3.1); D7 apply-count ceiling |
| **K5 — single-world (JTMS not ATMS)** | fiabilité study | Fork as explicit, costed multi-world compare, gated by uncertainty (Rank 5) |
| **K6 — concept-authoring/maintenance cost** | fiabilité study | AI-authorable typed-template synthesis from vetted palette (§3.2); concept↔prompt pair = reusable skill |
| **K7 — self-mod re-entrancy during stabilization** | spec §4c | Verify queue discipline; hypothesis-and-test + rollback; gate last (§3.3) |
| **K8 — non-hermetic cache poisoning (stale gravé fact)** | incremental study K3 | Freshness/TTL as facts (D2); confidence-driven retraction |

## 6. What NOT to claim (honesty guardrails)
- Don't claim the engine/forward-chaining is novel — Rete/Drools/Datalog precede it by decades. Novelty is
  the *target* (LLM-as-rule-action + truth maintenance + bounded-local context), not the technique.
- Don't claim "reasoning is in the data." Orchestration is; judgment is in the LLM provider.
- Don't claim content reproducibility. Reproducibility holds at the *trigger* level, not the gravé LLM output.
- Don't claim ATMS. It's a JTMS; multi-world is opt-in fork at real cost.
- Don't claim memoization controls cost. It controls *redundancy*; budget controls cost. Different problems.
