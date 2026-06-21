# Handoff — Skynet-Graph V1 "MOE Graph"

**Date:** 2026-06-21 · **Branch:** `feat/moe-graph-v1-phase0` (off `master` @ `0e65ab4`)
**Status:** **96/96 tests green.** Phase 0 + Phase 1 complete; Inspector v1 built; the
decompose→synthesize **answer-loop** built; **memory-on-retraction + closed learning loop** built;
**array-append primitive** + **reactive budget cap** built; **typed-fact spine + canonicalization
barrier** (roadmap #1, the K1 keystone) built; **reactive synthesis** (#2) built; **verification
concepts** (#3, K3) built; **freshness/TTL as facts** (N1) built; **declarative AI-authoring**
(roadmap #10): `addConcept` + ref-soundness validation + a **CEGIS authoring loop** built;
**live self-modification re-entrancy** (#11.a): a meta-concept can `add`/`patchConcept` mid-stabilize —
deferred to a quiescent boundary (fixes the silently-dropped mid-apply patch); **scoped re-eval** (#11.b):
`patchConcept` re-evaluates only the affected frontier, not the whole graph; **apply-ceiling backstop**
(#11.c.1): a runaway (target, concept) loop is bounded + flagged `divergent` (a non-cast condition);
**concept-lib versioning** (#11.c.2 / N6): `rollbackTo` restores the rules too (full schema snapshot), so a
rolled-back self-mod doesn't resurrect. The engine library is solid and heavily instrumented.

Read this, then `doc/MODELISATION.md` (the definitive model + prioritized roadmap), then resume.

---

## 0. Orientation & standing directives (do not violate)

Building the engine as a **MOE Graph** reasoning substrate. Model: nodes + segments (directed edges)
carry **typed facts**; **concepts** (declarative-JSON "experts") cast when their `require`/`assert`/
`ensure` hold — adding facts + child segments, cascade-triggering more concepts; a forward-chaining
**stabilization** loop runs to fixpoint; `ensure`/`unCast` **retracts** a concept + cascades when a
premise falls (JTMS defeasance). Providers (incl. a generic `LLM::complete`) do effectful work.

The flagship use: **answer enormous prompts without context-window blowup** — the graph is the working
memory; each LLM call sees only bounded local context. Loop: seed a root segment (prompt) → DECOMPOSE
into sub-path segments → stabilize → SYNTHESIZE bottom-up (bounded rollup) → answer.

**Standing user directives:**
- **BUILD, not thin-layer.** Implement the plan; don't re-litigate; don't downscope.
- **Never cap expressiveness** of expressions / mutation templates. (Validate *structure*, not grammar.)
- **Prefer leveraging what's already in the engine** over new machinery.
- **R&D working mode:** act as the concept/prompt-designer pro; deduce + build tools; use subagents for
  deep aspects; **step back between phases**; **verify-before-build** (reading the code has repeatedly
  caught wrong "free lunch" assumptions — keep doing it). The user's worry is a "trou sans fond"; the
  answer is *instrumented, incremental* R&D — each rung is tested + inspectable, so value is measurable.

---

## 1. What's built (cumulative ledger on this branch)

Phase 0 + Phase 1 (earlier): safe `expr.js` (jsep, no `new Function`), `rollbackTo`/`getRevisions`,
test harness, scoring=facts, `fork`/`merge`. Then, across the R&D sessions on this branch (the last
four rows are **session 3**, all **zero core-engine change** — they touch only `providers/*` + `_lab/*`):

| # | Work | Commit |
|---|------|--------|
| `patchConcept` | hot-patch an expert live + bidirectional re-eval (cast/uncast cascade) | `ca108a4` |
| providers/ | packaged Geo + backend-agnostic LLM (`createLLMProvider`) + `register()` (host opt-in) | `6919623` |
| doc/API.md | public API reference | `ff33281` |
| serialize tests | round-trip characterization | `76e8b63` |
| revision diff | `getSnapshot(rev)` + `diffRevisions(a,b)` | `a480f35` |
| robustness | empty/childless concept-set guard | `07cd384` |
| **build fixed** | host `App/db` resolved at runtime (`__non_webpack_require__`) → `npm run build` emits `dist/` | `6f29120` |
| coverage | manual `castConcept`/`unCastConcept` + cascade; `getPaths` | `b709195`,`6f0117c` |
| CLAUDE.md | refreshed stale Tests/providers/expr sections | `c44cb72` |
| capstone | "Git for reasoning" composition (grow→fork/merge→diff→rollback) | `ebd8e32` |
| **Inspector v1** | `cfg.onConceptApply` trace + `graph.traceProvider` (prompt capture) | `a3ae4f7`,`86e7307` |
| trace + CLI | `_lab/trace.js` collector + `_lab/sg.js` (`trace`/`show`/`concepts`/`errors`) | `e4be256` |
| **answer-loop** | `_lab/loop.js` (decompose concepts + `synthesize` bottom-up) + `_lab/run-prompt.js` | `36405c1` |
| **MODELISATION** | 4-agent ideation → `doc/MODELISATION.md` (the model + roadmap) + `doc/ideation/*` | `5b65e93`,`39a12fc` |
| **memory-on-retraction** | retracted concept's `cleaner` deposits a durable lesson on a surviving anchor | `f27d6fe` |
| **learning loop** | adapt strategy from failures (try A→B→C, learn, converge) | `6a8bfd8` |
| **{__push}** | array-append primitive — race-free fan-in (the aggregation-gap keystone) | `a26d13f` |
| **budget cap** | assert-gated `$$budget:spent.length < CAP` bounds exploration (K2) | `02c9789` |
| **typed-fact spine** | canonicalization barrier (roadmap #1, K1): `LLM::complete` `{facts,prose}` contract (`providers/canonicalize.js`) + author-time validator (`_lab/validate.js`) rejecting prose-on-dependency-edges. **Zero core change.** | `be797c0` |
| **reactive synthesis** | roadmap #2: `reactiveLoopConceptTree` — `ReportUp` (`{__push}` self-id into parent `answeredBy`) + `Rollup` gated `ensure:["$answeredBy.length==$expandedInto.length"]`; bottom-up synthesis IN stabilization, == the post-pass. **Zero core change.** | `73ea0fd` |
| **verification (K3)** | roadmap #3: `providers/verify.js` — deterministic checker lib + `Verify::check` (distinct verdict fact + provenance, never overwrites target) + k-of-n `Vote::tally` (consensus + confidence over `{__push}` votes). Verdict facts gate downstream via `ensure` → refutation = defeasance. **Zero core change.** | `194bcea` |
| **freshness/TTL (N1)** | `_lab/clock.js` — host-driven `clock` free-node; `ensure:["$$clock:tick - $sensedAt < ttl"]` auto-retracts stale facts + cascades (cache-poisoning fix); `advanceClock`/`refetch` helpers. INVALIDATION automatic; REFETCH host-triggered (cast-once). **Zero core change.** | `23b2b70` |
| **addConcept (#10)** | `Graph.addConcept(parentNameOrId, schema, cb)` — symmetric twin of `patchConcept`: builds+registers a `new Concept` (auto-registers into `_conceptLib`, recursive children), attaches under `parent._openConcepts` keyed by `_id` (engine invariant), mirrors into `parent._schema.childConcepts` (serialize carries it), opens it in each live object's `_mapOpenConcepts` + re-sweeps. Reuses cast/sweep/stabilize only — **additive method, no semantic change to existing paths.** Deferred-`require` watcher fires when the fact later appears. | `9406694` |
| **validator ref-soundness (#10)** | `_lab/validate.js` layer 3: collects `applyMutations`-template keys as produced facts; new **`unknown-ref`** check (gated on a host-declared `knownFacts` ref-alphabet — §6.5 "host owns the provider palette + ref alphabet") flags a `require`/`ensure` on a fact NO concept produces & the alphabet doesn't declare (the silent never-fires footgun); cross-walk (`a:b`) refs skipped (sound). Warning by default, `strict`→error. | `9406694` |
| **CEGIS authoring (#10)** | `_lab/author.js#authorConcept(graph, spec)` — counterexample-guided synthesis: an **injected** proposer emits a concept term → **author-time oracle** (`validateConceptTree`, malformed → counterexample) → install (`addConcept`/`patchConcept`) → **behavioral oracle** (stabilize, test goal predicate, unmet → counterexample) → refine. Counterexamples threaded back each round → candidate space shrinks → convergence. Backend-agnostic (LLM in prod, stub in tests). **Zero core change.** | `9406694` |
| **self-mod re-entrancy (#11.a)** | `add`/`patchConcept` issued **mid-stabilize** (from a meta-concept's provider) now defer to the quiescent `_loopTF` boundary via a `_pendingStructural` queue (drained by `_drainStructural`), gated by a `_stabilizing` flag (set in `stabilize.js`, cleared in `_applyStabilized`). Fixes the verified hazard: a patch of the concept **currently mid-apply** was silently dropped (its self-flag not yet written → re-eval saw it as not-cast → no retraction). Host-issued ops (incl. from `onStabilize`) still apply immediately. `patch`/`add` bodies split into kick-less `_doPatchConcept`/`_doAddConcept`. **Core change (the re-entrancy keystone for #11).** | `b4b0821` |
| **self-mod scoped re-eval (#11.b)** | `_doPatchConcept` re-evaluated **every** object (`Object.keys(_objById)`, O(graph) stop-the-world). Now `_scopedReevalIds(concept)` returns only the frontier whose cast-state could change: `_mapsByConcept[C._name]` (cast/was-cast → uncast direction) ∪ `_mapsByConcept[r]` per simple `require` r (holds a needed fact → cast direction, incl. never-cast objects). Falls back to the full scan when unscopable (no `require`, or a cross-object `a:b` require). Proven: 53 objects → 3 candidates; behaviour-preserving (characterization test). | `f702211` |
| **apply-ceiling backstop (#11.c.1)** | per-`(target/concept)` apply tally (`_applyCount`, reset on each settle) with a `cfg.applyCap` ceiling (default 1000). Over the cap → `_markDivergent` `{__push}`es a reason record `{concept, applies, reason:'apply-cap'}` into the target's **`divergent` array fact** — which `Concept.isApplicableTo` reads as a **NON-CAST CONDITION** (so the runaway concept de-casts + stops; the record says WHY). Framing (engine author): a self-destabilizing re-cast loop is a legitimate *iterative-trial* technique, so this is a BACKSTOP (high default, per-episode reset never kills a converging trial), and `divergent` = "didn't converge in the ceiling" outcome, not an error. | `a7415e1` |
| **concept-lib versioning (#11.c.2 / N6)** | `rollbackTo` restored facts but NOT the concept library, so a runtime `add`/`patchConcept` survived a rollback and *resurrected* (a surviving concept re-cast). Now `_captureSnapshot` also stores the **full live schema tree** (`_serializeConceptTree` — walks `_openConcepts` for adds + reads each concept's current `_schema` for patches; cached, invalidated on edit), and `rollbackTo` calls `_restoreConceptTree` (rebuild `_conceptLib`/`_rootConcept` from a deep-cloned snapshot) **before** `mount`. "Git for reasoning" now covers data AND rules — the prerequisite for safe hypothesis-and-test. | *uncommitted* |

Specs: `f2434d2`,`d74dcab`,`27a0322` (inspector spec + roadmap).

---

## 2. How to run

```bash
npm test                  # 103 tests (node:test). Per-file count is deterministic; the AGGREGATE
                          #   count can race-undercount under --test-force-exit (all pass; verify per-file).
node _lab/run-basic.js    # non-LLM stabilization over the real `common` set
node _lab/run-prompt.js   # decompose→synthesize→answer vs a local LLM (LLM_BASE=...); writes a trace
node _lab/sg.js trace /tmp/run-prompt.trace.json    # inspect the reasoning trace
npm run build             # now works -> dist/Skynet.js (one benign "Critical dependency" warning)
```
Engine loads under Node via `_lab/_boot.js` (@babel/register). `_lab/concepts.js#buildConceptTree`
assembles a concept tree from `concepts/<set>/`.

---

## 3. KEY ENGINE FINDINGS / GOTCHAS (hard-won — read before building concepts)

1. **A concept MUST self-flag with its OWN `_name`** (e.g. set `Answer:true`), or `updateApplicableConcepts`
   keeps seeing it applicable and **re-fires it forever** (manifests as a non-stabilizing/timeout). The
   provider's mutation must include `{$_id:'_parent', <ConceptName>:true}`.
2. **To UPDATE an existing object via a template use `$$_id`** (literal id). A plain `_id` creates a NEW object.
3. **Arrays REPLACE on update** (`Entity.set`: `this._[key]=content`) — they do NOT concat. So a
   read-modify-write append from a provider RACES. Use the **`{__push:x}`** primitive (appends at
   serialized apply-time = race-free) for any fan-in counter/list. `[N×]` keys are also race-free (distinct).
4. **Global node refs in expressions need DOUBLE-`$`**: `$$budget:spent` — the ref regex consumes one `$`.
   (A single `$foo` is a key on the current scope.) `.length` resolves fine via `getRef`.
5. **`assert` vs `ensure`:** `ensure` installs watchers AND is **defeasant** (retracts the concept when the
   premise later falls). `assert` is a one-time gate at evaluation, **no watcher, no retraction**.
   → completion-gating / reactive re-test = `ensure`; **budget / "don't undo work already done" = `assert`**.
6. **The aggregation gap:** `getRef` walks SINGLE refs — no `forall`/`count`. Only `.length` on one array
   works. Race-free counting = `{__push}` into an array + `$$x:arr.length` gate. (The one core primitive
   still worth adding later: stratified set-aggregation `count`/`all`.)
7. **`cleaner` hook** (`Entity.js` ~224) fires on uncast with `(graph, concept, scope, argz, cb)`; its
   returned tpl is pushed. Mid-uncast `pushMutation` is **queue-safe** (the `_mutationThreadRunning` guard
   defers it — no re-entrancy). This is what makes memory-on-retraction zero-core.
8. **Reactive synthesis is BUILT** (#2, `_lab/loop.js#reactiveLoopConceptTree`) — `Rollup` gated
   `ensure:["$answeredBy.length==$expandedInto.length"]`, children append via `{__push}`. Bottom-up
   synthesis runs IN stabilization and equals the post-pass. The deterministic post-pass `synthesize`
   stays the one-shot default (reactivity buys nothing cold). KNOWN LIMIT: it is reactive on
   *completion*, not on a live leaf-answer *content* change (re-roll needs per-child answer-following =
   the aggregation gap, roadmap #5/§5.3).
9. **Cast-state ≠ a literal `true`.** `_etty._mappedConcepts[Name]` records cast-state but its *value* is
   not the boolean `true` — to test "is concept C cast on obj," read the **self-flag fact** `obj._etty._.<C>`
   (what a provider / default-cast writes), or test *key presence* in `_mappedConcepts`. (Cost me a red test.)
10. **Defeasance/retraction paths — which RELIABLY retract a downstream** (verified by probe; cost real
   debugging in #3). A cast concept is uncast ONLY by its OWN `ensure` watcher (`static_ensure`) or by a
   structural cascade — NOT by a `require` follower. So:
   - **`require:['X']` does NOT retract on X falling** — `require` is a cast-time LHS pattern (watches for X
     to *appear*), not defeasance. Downstream that must retract on refutation MUST gate via **`ensure`**.
   - **RELIABLE:** (a) an `ensure`-invariant verifier auto-retracts when its target fact changes; (b) a
     downstream **nested** under it (`childConcepts`) cascade-retracts; (c) a downstream `ensure:["$v=='pass'"]`
     retracts when `v` is flipped by a **direct mutation / provider re-run**.
   - **FLAKY — avoid:** flipping a verdict fact via a `cleaner` *during* the verifier's own uncast cascade did
     NOT reliably re-fire a sibling's `ensure` watcher in the same settle. Use a nested consumer (cascade) or a
     direct verdict mutation instead.
   - A provider verifier is **cast-once** — it will NOT re-run on a target change (write the invariant as the
     concept's `ensure` if you need reactive re-evaluation).
11. **Why the canonicalization barrier works WITHOUT a core equality guard** (verified): `Entity.set`
   (Entity.js:330) destabilizes followers *unconditionally* (no `old===content` check). The memo / "don't
   re-fire" property is NOT from set-equality — it is from **cast-once + self-flag** (an already-cast concept
   is not re-fired) and **`ensure` re-test absorbing a same-value write** (unchanged discrete fact →
   `isApplicableTo` unchanged → no uncast → no cascade). Canonicalization (snap enums / round numerics) is
   what keeps the discrete fact *actually* stable so the gate doesn't spuriously flip. A prose-keyed gate
   flips every run → uncast → fragmentation. The optional N8 `old!==content` guard (literal hysteresis,
   skips even the re-sweep) stays out — `[C×1]`, and the barrier is correct without it.
13. **`stabilize(cb)` is a SETTLE-HOOK — a write is what produces a settle (BY DESIGN, confirmed with the
   engine author + empirically).** `cb` fires only when the graph actually settles, and it only settles if
   the op **wrote/destabilized** something. A NO-OP op — a `patchConcept` changing no cast-state (e.g.
   `$x>500`→`$x>600` when the concept was never cast), an `addConcept` matching nothing, or even a bare
   `stabilize(cb)` on an already-quiescent graph (`running=false, unstable=0`) — destabilizes nothing → no
   settle → `cb` never fires. This is the engine's **auto-throttle**, not a bug: *(a)* `toggleGraphObjectState`
   `return false`s if the object is already in `_unstable` (idempotent — "already unstable → it just
   continues"); *(b)* `stabilize` is `if (!_taskFlow.running) _taskFlow.run()` ("else check what's pending +
   launch"); *(c)* `release` drops `running` to false at locks-0, so a burst of writes coalesces into one
   run. **You can always get a settle by WRITING** (a real op leaves `_unstable.length`/`_triggeredCastCount`
   non-empty → fires in ms). The host handling for a no-op is therefore *"nothing to wait for"*, NOT an
   engine change: `_lab/author.js#applyOp` resolves on the next tick when `!_unstable.length &&
   !_triggeredCastCount`. (Do NOT "fix" `stabilize` to fire `cb` when already stable — it would break the
   settle-hook contract and can double-fire `cfg.onStabilize`.) `addConcept` always writes in the
   matching case, so it settles normally; only the genuine no-op needs the guard.
12. **Freshness/TTL (N1) — global clock ref needs DOUBLE-`$`** (re-bit me): `ensure:["$$clock:tick - $x < t"]`
   — `$clock` is a (nonexistent) key on the current scope; `$$clock` is the global free-node (gotcha #4).
   Time enters as a fact on a `clock` free-node (`_lab/clock.js`); `advanceClock` re-tests exactly the
   `$$clock`-following concepts. **Invalidation is automatic + reliable** (stale fact + dependents retract).
   **Refetch is NOT automatic** — a provider is cast-once; `refetch()` (uncast/recast) re-runs it. A
   self-autonomous reaper is optional-core. Also: an `ensure` with `||` (e.g. `$x==null || $$clock:tick-$x<t`)
   **short-circuits watcher registration** — if the first operand is true at eval time the second operand's
   ref watcher is never installed, so later changes don't re-fire it. Seed the stamp so the gate doesn't
   short-circuit, or split the fetch from the freshness gate.
14. **Self-modification mid-stabilize: ADD is safe, in-flight PATCH is not (the #11.a hazard).** Verified by
   probe: a meta-concept's provider calling `addConcept` mid-stabilize **already works** — the add
   writes/destabilizes and the running loop picks it up (finding #13's write-to-destabilize). Patching an
   already-cast **sibling** also works. BUT patching the concept **currently mid-apply** is *silently
   dropped*: at patch time its self-flag is not yet written (the provider cb writes it after), so
   `patchConcept`'s re-eval sees `isCast=false` and skips the retraction — the concept stays cast at a now-
   false assert. Fix (#11.a): the `_stabilizing` flag (set in `stabilize.js`, cleared in `_applyStabilized`)
   routes any mid-stabilize `add`/`patchConcept` into `_pendingStructural`, drained at the quiescent
   `_loopTF` boundary (`_drainStructural`, just before `_applyStabilized`) where cast-state is settled; the
   drained op writes → the loop re-stabilizes (no extra kick). Host-issued ops (incl. from `onStabilize`,
   where `_stabilizing` is already false) still apply immediately, so #10 is unchanged. *(Resolved by #11.c.1:
   the apply-ceiling backstop — finding #15.)*
15. **Re-application is DUAL-USE: a self-destabilizing re-cast loop is a legitimate iterative-TRIAL technique,
   not just pathology (engine author, 2026-06-21).** "C'est comme ça que je faisais pour stabiliser et faire des
   chemins/cast essais." A provider that re-writes a changing fact (or unsets its own self-flag) re-casts
   itself — historically the author's way to *iterate / try paths & casts until convergence*. So the #11.c.1
   apply ceiling is a **backstop, not a killer**: `cfg.applyCap` default is HIGH (1000) and `_applyCount` is
   **reset on every healthy settle** (`_applyStabilized`), so a converging trial loop is never cut short — only
   genuine non-convergence (unbounded within one non-settling episode) trips it. When it trips, `_markDivergent`
   records WHY into the target's **`divergent` array fact** (race-free `{__push}`), which `isApplicableTo` reads
   as a **non-cast condition** → the concept de-casts (also a retraction trigger). Read `divergent` as "did not
   converge within the iteration ceiling" — a reusable *trial outcome* feeding memory/beam/learning, NOT an
   error flag. **Future:** an explicit per-concept iteration budget would turn the bounded re-cast into a
   controlled explore-variations loop (AO*/beam §6.2 + the learning loop U7).

---

## 4. The model (see doc/MODELISATION.md for the full thing)

Substrate = demand-driven incremental compute (Adapton/Salsa) + forward-chaining production + JTMS
defeasance over a typed-fact hypergraph. Workload = AND/OR graph search + bounded catamorphism (fold).
One reused mechanism: **everything-is-a-fact gated by `ensure`/`assert`**. Honest limits: K1 prose
memo-fragmentation (existential → typed-fact spine), coherence≠truth (K3 → verification), JTMS-not-ATMS
(fork for multi-world), cost-explosion (K2 → budget, now demonstrated).

---

## 5. Roadmap — pick up here (from MODELISATION §9, adjusted for what's now built)

Done: inspector · answer-loop · memory-on-retraction + learning loop · `{__push}` primitive · budget cap ·
**typed-fact spine + canonicalization barrier (#1)** · **reactive synthesis (#2)** · **verification (#3)** ·
**freshness/TTL (N1)** · **declarative AI-authoring (#10)** · **self-mod re-entrancy (#11.a)**.

Next, highest-leverage first — **finishing #11 (live self-modification, the highest-risk tier).** #11.a
(re-entrancy: mid-stabilize `add`/`patchConcept` defer to the quiescent boundary) and #11.b (scoped
re-eval: `_scopedReevalIds` frontier, not O(graph)) are DONE. Remaining:
1. **#11.c — the safe self-mod regime** (gate behind the existing instruments). #11.c.1 (apply-ceiling
   backstop = `divergent` non-cast condition) and #11.c.2 (N6 concept-lib versioning — rollback restores
   rules too) are DONE. Remaining:
   - a single-writer **meta-concept on a `Stuck` fact** (a subtree exhausted strategies / blew budget), not
     continuous polling;
   - **hypothesis-and-test**: patch/add → stabilize a bounded region → `rollbackTo` if worse (now safe — N6
     restores the concept-lib edits too);
   - **probationary experts**: an AI-authored concept's first outputs are verification-gated (#3) until a
     reputation fact (via the memory machinery) clears it.
2. (core, optional) **engine primitives now justified by the rungs built:**
   - **stratified set-aggregation `count`/`all`** — generalizes `{__push}`+`.length`; unblocks richer voting/beam
     AND the #2 content-reactive re-roll (a real `count`/`all` over children).
   - **Tarjan-SCC negative-cycle lint** (§5.3) — #3's `ensure`-aggregate gates + verdict retraction make
     oscillation (K7) a live risk; the lint gives `ensure` well-founded (stratified) semantics. *(The
     validator already builds the concept-dependency edges for ref-soundness — natural place to add the lint.)*
   - **autonomous freshness reaper** — a `_loopTF`-piggybacked destabilize+recast of stale nodes, so N1's
     refetch is automatic (today it's host-triggered via `refetch()`). (This is the *write-to-destabilize*
     pattern of finding #13 made autonomous — the reaper writes/destabilizes, the existing settle fires.)
3. **The live/standing regime (MODELISATION N10)** — compose N1 + the budget *cap* (built; full AO\*/beam
   from §6.2 is still only the cap, not the priority-heap/beam-by-retraction) + the barrier into
   prospective/live/`ActiveProblem` terminal-typed paths: a never-terminating "be attentive & solve problems"
   graph. Most pieces now exist; this is the integration capstone (and would benefit from finishing the beam).

---

## 6. File map (cumulative; session 3's 4 rungs added only `providers/*` + `_lab/*`, zero `App/*` change)

```
App/objects/Concept.js     patch()/_compileAssert(); _computeWhy(); applyTo threads applyCtx + apply-count
                           ceiling (#11.c.1); isApplicableTo reads `divergent` as a non-cast condition
App/objects/Entity.js      empty _openConcepts guard; {__push} array-append in set()
App/tasks/stabilize.js     drains _triggeredCast; sets _stabilizing=true (#11.a re-entrancy bracket)
App/Graph.js               patchConcept/addConcept (+kick-less _doPatchConcept/_doAddConcept, #10/#11.a);
                           _scopedReevalIds frontier (#11.b); _markDivergent + _applyCount/_applyCap (#11.c.1);
                           _pendingStructural queue + _drainStructural at the _loopTF quiescent boundary;
                           getConceptByName; getSnapshot/diffRevisions; _serializeConceptTree/
                           _restoreConceptTree — concept-lib snapshot+restore in _captureSnapshot/rollbackTo
                           (#11.c.2/N6); onConceptApply + traceProvider; App/db runtime-require (build fix)
providers/{geo,llm,index}  packaged base providers + register()
providers/canonicalize.js  deterministic fact snapping (enum/grain/type) + stable digest — the K1 grid
providers/verify.js        checker lib + Verify::check (verdict facts) + Vote::tally (k-of-n) — #3 (K3)
providers/llm.js           LLM::complete `{facts,prose}` canonicalization barrier (prompt.facts schema)
_lab/validate.js           author-time concept validator (prose-edge rejection, self-flag, expr-parse, palette,
                           +#10 ref-soundness/`unknown-ref` gated on a host `knownFacts` ref-alphabet)
_lab/author.js             #10 CEGIS authoring loop: validate→addConcept/patchConcept→stabilize→goal-oracle→
                           refine; injected proposer (LLM in prod, stub in tests); host-side `applyOp` no-op guard
_lab/clock.js              freshness/TTL (N1): clock free-node + advanceClock/clockNow/refetch helpers
_lab/trace.js, sg.js       trace collector + inspector CLI
_lab/loop.js, run-prompt.js  the decompose→synthesize answer-loop + LLM runner
                           (loop.js now also exports `reactiveLoopConceptTree` + reportUp/rollup providers)
doc/API.md                 public API reference
doc/MODELISATION.md        the model + prioritized roadmap (READ THIS)
doc/ideation/01-04*.md     the 4-lens agent ideation raw findings
docs/superpowers/specs/2026-06-21-moe-graph-inspector-design.md   inspector spec + §4b/4c roadmap detail
tests/integration/*        29 integration files (+add-concept, author-cegis, self-mod, patch-scoped,
                           apply-cap, concept-versioning on top of canon-barrier, reactive-synth, etc.)
tests/unit/*               6 unit files (expr, concept-wiring, providers, canonicalize, validate, verify)
```

Untracked working docs left as-is: `doc/aspect-*.md` (the prior critical studies), `.claude/agents/Pascal.md`.
Auto-memory: `skynet-graph-agent-substrate-exploration.md` + `skynet-graph-rd-working-mode.md`.
