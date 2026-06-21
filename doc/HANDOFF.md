# Handoff — Skynet-Graph V1 "MOE Graph"

**Date:** 2026-06-21 · **Branch:** `feat/moe-graph-v1-phase0` (off `master` @ `0e65ab4`)
**Status:** **59/59 tests green.** Phase 0 + Phase 1 complete; Inspector v1 built; the
decompose→synthesize **answer-loop** built; **memory-on-retraction + closed learning loop** built;
**array-append primitive** + **reactive budget cap** built. The engine library is solid and
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
8. **Reactive synthesis is NOT yet done** — the post-pass `synthesize` (in `_lab/loop.js`) is the current,
   correct, race-free synthesis. A reactive Rollup concept is now UNBLOCKED by `{__push}` (gate
   `$$x:answeredBy.length==$childCount`) but not built.

---

## 4. The model (see doc/MODELISATION.md for the full thing)

Substrate = demand-driven incremental compute (Adapton/Salsa) + forward-chaining production + JTMS
defeasance over a typed-fact hypergraph. Workload = AND/OR graph search + bounded catamorphism (fold).
One reused mechanism: **everything-is-a-fact gated by `ensure`/`assert`**. Honest limits: K1 prose
memo-fragmentation (existential → typed-fact spine), coherence≠truth (K3 → verification), JTMS-not-ATMS
(fork for multi-world), cost-explosion (K2 → budget, now demonstrated).

---

## 5. Roadmap — pick up here (from MODELISATION §9, adjusted for what's now built)

Done: inspector · answer-loop · memory-on-retraction + learning loop · `{__push}` primitive · budget cap.

Next, highest-leverage first:
1. **Typed-fact spine + canonicalization barrier** (K1, the existential precondition) — discipline +
   a structured-output concept that extracts discrete facts from LLM prose; a test proving downstream
   concepts key on discrete facts, not prose.
2. **Reactive synthesis** — now unblocked by `{__push}`: a `Rollup` concept gated on
   `ensure:["$$<parent>:answeredBy.length == $childCount"]`, each child appends its id on Answer; provider
   reads `expandedInto` children's bounded answers. Replaces the post-pass for the live regime.
3. **Verification concepts** (K3) — a refuter writes a distinct verdict key; k-of-n voting via `{__push}`
   + `.length`; gate downstream via `ensure`. Deterministic checkers >> LLM-refuters.
4. **Freshness/TTL as facts** (N1) — timed-destabilize stale provider facts; enables the live/standing-paths
   regime (prospective/live/`ActiveProblem` terminals — MODELISATION N10).
5. **Declarative AI-authoring** — `addConcept` + a validated schema (validate structure, not grammar; vetted
   provider palette); then **live self-modification** (meta-concept calls add/patchConcept mid-run) — LAST,
   gated behind trace+memory+budget; verify re-entrancy.
6. (core, optional) **stratified set-aggregation primitive** — generalizes `{__push}`+`.length`; unblocks
   richer voting/beam.

---

## 6. File map (key additions this session)

```
App/objects/Concept.js     patch()/_compileAssert(); _computeWhy(); applyTo threads applyCtx for the trace
App/objects/Entity.js      empty _openConcepts guard; {__push} array-append in set()
App/Graph.js               patchConcept/getConceptByName; getSnapshot/diffRevisions; onConceptApply +
                           traceProvider; App/db runtime-require (build fix)
providers/{geo,llm,index}  packaged base providers + register()
_lab/trace.js, sg.js       trace collector + inspector CLI
_lab/loop.js, run-prompt.js  the decompose→synthesize answer-loop + LLM runner
doc/API.md                 public API reference
doc/MODELISATION.md        the model + prioritized roadmap (READ THIS)
doc/ideation/01-04*.md     the 4-lens agent ideation raw findings
docs/superpowers/specs/2026-06-21-moe-graph-inspector-design.md   inspector spec + §4b/4c roadmap detail
tests/integration/*        18 integration tests; tests/unit/* 3 unit (expr/concept-wiring/providers)
```

Untracked working docs left as-is: `doc/aspect-*.md` (the prior critical studies), `.claude/agents/Pascal.md`.
Auto-memory: `skynet-graph-agent-substrate-exploration.md` + `skynet-graph-rd-working-mode.md`.
