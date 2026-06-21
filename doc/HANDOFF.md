# Handoff — Skynet-Graph V1 "MOE Graph"

**Date:** 2026-06-21 · **Branch:** `feat/moe-graph-v1-phase0` (off `master` @ `0e65ab4`)
**Status:** **85/85 tests green.** Phase 0 + Phase 1 complete; Inspector v1 built; the
decompose→synthesize **answer-loop** built; **memory-on-retraction + closed learning loop** built;
**array-append primitive** + **reactive budget cap** built; **typed-fact spine + canonicalization
barrier** (roadmap #1, the K1 keystone) built; **reactive synthesis** (#2) built; **verification
concepts** (#3, K3) built; **freshness/TTL as facts** (N1) built. The engine library is solid and
heavily instrumented.

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

## 1. What's built (commits, this branch vs master)

Phase 0 + Phase 1 (earlier): safe `expr.js` (jsep, no `new Function`), `rollbackTo`/`getRevisions`,
test harness, scoring=facts, `fork`/`merge`. Then this session:

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
| **freshness/TTL (N1)** | `_lab/clock.js` — host-driven `clock` free-node; `ensure:["$$clock:tick - $sensedAt < ttl"]` auto-retracts stale facts + cascades (cache-poisoning fix); `advanceClock`/`refetch` helpers. INVALIDATION automatic; REFETCH host-triggered (cast-once). **Zero core change.** | *this session* |

Specs: `f2434d2`,`d74dcab`,`27a0322` (inspector spec + roadmap).

---

## 2. How to run

```bash
npm test                  # 59 tests (node:test). Per-file count is deterministic; the AGGREGATE
                          #   count race-undercounts under --test-force-exit (all pass; verify per-file).
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
12. **Freshness/TTL (N1) — global clock ref needs DOUBLE-`$`** (re-bit me): `ensure:["$$clock:tick - $x < t"]`
   — `$clock` is a (nonexistent) key on the current scope; `$$clock` is the global free-node (gotcha #4).
   Time enters as a fact on a `clock` free-node (`_lab/clock.js`); `advanceClock` re-tests exactly the
   `$$clock`-following concepts. **Invalidation is automatic + reliable** (stale fact + dependents retract).
   **Refetch is NOT automatic** — a provider is cast-once; `refetch()` (uncast/recast) re-runs it. A
   self-autonomous reaper is optional-core. Also: an `ensure` with `||` (e.g. `$x==null || $$clock:tick-$x<t`)
   **short-circuits watcher registration** — if the first operand is true at eval time the second operand's
   ref watcher is never installed, so later changes don't re-fire it. Seed the stamp so the gate doesn't
   short-circuit, or split the fetch from the freshness gate.

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
**freshness/TTL (N1)**.

Next, highest-leverage first:
1. **Declarative AI-authoring** — `addConcept` (engine has `patchConcept`; add `addConcept`) + the now-built
   validator (`_lab/validate.js` — extend it: structure, expr parse, ref-soundness, self-flag, prose-edge
   rejection already done) from a vetted provider palette (now incl. `Verify::check`/`Vote::tally`); CEGIS loop
   using the trace + memory as counterexamples. Then **live self-modification** (meta-concept calls
   add/patchConcept mid-run) — LAST, gated behind trace+memory+budget; verify re-entrancy.
2. (core, optional) **engine primitives now justified by the rungs built:**
   - **stratified set-aggregation `count`/`all`** — generalizes `{__push}`+`.length`; unblocks richer voting/beam
     AND the #2 content-reactive re-roll (a real `count`/`all` over children).
   - **Tarjan-SCC negative-cycle lint** (§5.3) — #3's `ensure`-aggregate gates + verdict retraction make
     oscillation (K7) a live risk; the lint gives `ensure` well-founded (stratified) semantics.
   - **autonomous freshness reaper** — a `_loopTF`-piggybacked destabilize+recast of stale nodes, so N1's
     refetch is automatic (today it's host-triggered via `refetch()`).
3. **The live/standing regime (MODELISATION N10)** — compose N1 + #4(budget/beam, built) + the barrier into
   prospective/live/`ActiveProblem` terminal-typed paths: a never-terminating "be attentive & solve problems"
   graph. The pieces now exist; this is the integration capstone.

---

## 6. File map (key additions this session)

```
App/objects/Concept.js     patch()/_compileAssert(); _computeWhy(); applyTo threads applyCtx for the trace
App/objects/Entity.js      empty _openConcepts guard; {__push} array-append in set()
App/Graph.js               patchConcept/getConceptByName; getSnapshot/diffRevisions; onConceptApply +
                           traceProvider; App/db runtime-require (build fix)
providers/{geo,llm,index}  packaged base providers + register()
providers/canonicalize.js  deterministic fact snapping (enum/grain/type) + stable digest — the K1 grid
providers/verify.js        checker lib + Verify::check (verdict facts) + Vote::tally (k-of-n) — #3 (K3)
providers/llm.js           LLM::complete `{facts,prose}` canonicalization barrier (prompt.facts schema)
_lab/validate.js           author-time concept validator (prose-edge rejection, self-flag, expr-parse, palette)
_lab/clock.js              freshness/TTL (N1): clock free-node + advanceClock/clockNow/refetch helpers
_lab/trace.js, sg.js       trace collector + inspector CLI
_lab/loop.js, run-prompt.js  the decompose→synthesize answer-loop + LLM runner
                           (loop.js now also exports `reactiveLoopConceptTree` + reportUp/rollup providers)
doc/API.md                 public API reference
doc/MODELISATION.md        the model + prioritized roadmap (READ THIS)
doc/ideation/01-04*.md     the 4-lens agent ideation raw findings
docs/superpowers/specs/2026-06-21-moe-graph-inspector-design.md   inspector spec + §4b/4c roadmap detail
tests/integration/*        18 integration tests; tests/unit/* 3 unit (expr/concept-wiring/providers)
```

Untracked working docs left as-is: `doc/aspect-*.md` (the prior critical studies), `.claude/agents/Pascal.md`.
Auto-memory: `skynet-graph-agent-substrate-exploration.md` + `skynet-graph-rd-working-mode.md`.
