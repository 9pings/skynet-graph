# The Creative Loop — a map of the distillation & dispatch bricks

> **What this is.** A practical, code-grounded map of the *creative / distillation loop* — the host-side layer that turns
> LLM/engine execution **traces** into a library of typed, defeasible, **composable** concept-Methods, and dispatches
> them deterministically. It answers the three questions the theory-heavy docs (`concept-as-graph.md`, `MODELISATION.md`)
> don't: **which bricks exist, which are core vs experimental, and how they chain end-to-end.** Every brick lives in
> `lib/authoring/` or `lib/providers/` and is **ZERO-CORE** (the `lib/graph/` engine is untouched). Companion to
> `architecture.md` (the engine) — this is the authoring/learning layer above it.
>
> Grounded by a per-module read of the real code (verdicts below cite who imports each brick + which tests cover it).
> Read alongside the barrel `lib/authoring/index.js` (curated one-line roles + the declared shelved tier) and the
> standing design direction `concept-as-graph.md` §9.

## The mental model (one paragraph)

The engine is a rule-driven knowledge graph: *concepts* cast/uncast transformations onto objects until a fixpoint
(*stabilization*). The **creative loop sits on top**: when an LLM-driven run produces a recurring reasoning step, the loop
**forges** it into a *Method* — a typed, contracted, library-indexed sub-graph — so the *next* time that step is needed
it is **retrieved and mounted at zero model calls** instead of re-asked. Methods **compose** (a method's body slot is
filled by another dispatched method), are **verified** by a born-with-it defeasible contract at runtime, and are
**un-learned** when they drift. The whole thing is bounded by the **K1 barrier**: only the *recurrent + typed +
canonicalizable* fraction of behavior amortizes into the library; everything else stays in the model (the honest floor).
Two sub-systems meet: a **front door** (prose → a typed dispatch key, deterministically, LLM last-resort) and a
**distillation loop** (trace → mined structure → crystallized Method → composed → indexed).

## The end-to-end spine

```
  ┌──────────────────────── FRONT DOOR — library-science dispatch (prose → typed key) ────────────────────────┐
  │  prose/task ─▶ intake ────▶ canonicalize ───▶ (miss?) borderline ───▶ registry (Σ_sep) ──┐                │
  │               (NLU: 27B)   exact-match +      LLM last-resort,        curated + versioned │                │
  │                → natural   confluent synonym  re-canonicalized,       vocab CATALOG where │                │
  │                  words     RING lookup        PROVISIONAL/propose     the rings LIVE      │                │
  │                               │ hard miss           │ propose-only                        │                │
  │                               ▼ CanonMiss           ▼ (autonomous RegistryMerge loop)     │                │
  │                          (fail-closed →       ring grows ⇄ retractRingAlias (un-learn)     │                │
  │                           host escalate)                                                   ▼                │
  └────────────────────────────────────────────────────────────────────────▶  dispatch (library.js byKey)     │
                                                                               O(1) libraryKey bucket, no search│
  ┌──────────────────── DISTILLATION LOOP — trace → Method ────────────────────┐              │  retrieve-or-  │
  │  traces ─▶ mine / antiUnify ─▶ gate ─▶ crystallize ─▶ compose ─────────────┼─▶ indexMethod─┤  forge         │
  │  (firing   recurrent           (2 paths) typed method   blendMethods /      │  (amortize:   │  adaptOrForge  │
  │   records) STRUCTURE (LGG)               +contract?     synthesizeByBlend   │   next hit=0) │  (adapt.js)    │
  │                                                        depth-3, 0 forge     │               ▼                │
  │                                                                            │      runtime assertPost        │
  │                                                                            │      (contract.js = the MOAT)   │
  │                                                                            │               │ drift → blame   │
  │                                                                            └──▶ relearn (un-learn) + revise  │
  └────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The two halves share one object: the **typed dispatch key**. The front door's job is to make prose land on the *same*
key across paraphrases (so the memo hits); the distillation loop's job is to make a key *worth* having (a reusable Method
behind it). Break the typedness and the index degrades to linear matching or NP composition — the design law of
`concept-as-graph.md` §9.

### ⚠ The one structural fact to internalize: there are TWO retrieve-or-forge stacks, over TWO libraries

This is the non-obvious thing a reader (and the cont.⁶ session) misses, so it is stated up front:

- **The dispatch / creative-loop stack** — `crystallize.js` → `library.js` (`byKey` index) → `adapt.js` (`adaptOrForge`
  + `synthesizeByBlend`) → `combinator.js`. This is where **composition actually lives** (`synthesizeByBlend` grafts a
  depth-3 method from existing parts at **0 forge calls**). It is proven by **real-engine integration tests** and reached
  through `Graph.authoring`, but it is **NOT wired into the always-on loop** — nothing under `lib/` calls `adaptOrForge`
  except the barrel.
- **The always-on master loop** — `master-loop.js` → `recall.js` (fuzzy-recall → exact-verify) + a cache + `mount.js`.
  A cost-ordered arm ladder (escalate / match / recall-full / recall-partial / forge). It runs on the **recall index +
  cache**, a *different* library structure from `library.js#byKey` — and it is what `method-pack.js` packages.

So "the library" is two things. **Unifying these two stacks on the system's own trace is precisely NEXT #1** (the
end-to-end distillation loop, below) — the bricks all exist and are individually tested; the *whole chain* has never
been run and measured as one live loop.

## The bricks, by stage

> Each table: **module** · the verbs it exports · **feeds →** · **tier** (defined below). `file:line` anchors are in the
> notes, not the tables, to keep them scannable. **bold module** = the stage's linchpin.

### 1 · DETECT — trace → scored generalization candidate

| module | exports (verbs) | feeds → | tier |
|---|---|---|---|
| **`mine.js`** | `traceMiner`/`methodTrace` (collect firings) · `mineChains` (producer→consumer edges) · `mineMethods` (recurrent structural candidates) | crystallize / mdl+abstraction | CORE |
| `abstract.js` | `antiUnify` (Plotkin-LGG stability) · `relativize`/`instantiate` (id-hole rewrite) · `generalizeContent`/`fillContentHoles`/`blendAtSegment` | mine, adapt, crystallize, combinator | SHARED-INSTRUMENT |
| `mdl.js` | `mdlGain`/`rankCandidates` (bits ΔL) · `makeMdlGate` | crystallize (edge path only) | CORE (narrow) |
| `abstraction.js` | `evaluate` (double engine-boot MDL/utility admit) · `interfaceRegression` | crystallize (the admit authority) | CORE |
| `decompose.js` | `treeDecomposition`/`forkPlan` · `bagInterface`/`separatorGate` (Σ_sep) | abstraction, extract, registry | SHARED-INSTRUMENT |
| `ancestry.js` | `decideLeaf`/`promoteContentVars`/`enhanceCandidateWithAncestry` (bake/promote/forge) | *(test-only; enhances a candidate)* | EXPERIMENTAL |

**Notes.** `antiUnify` is the actual scorer and lives in **`abstract.js:144`**, not `mine.js` (which delegates to it).
There are **two mining paths**: `mineChains` (data-flow *edges*, MDL-ranked by `mdl.js` then admitted by
`abstraction.evaluate`'s double engine boot) and `mineMethods` (recurrent *structure*, gated by antiUnify-stability + the
K1 `signatureDetermined` check, **no MDL**). `ancestry.js` is a research post-processor: **zero `lib/` importers, absent
from the barrel** — reached only by its own integration tests. Dead/superseded: `emitMethodAsSubgraph` (kept as
`emitEquivalence` instrumentation), `inferCtx` (superseded by `declaredCtx`).

### 2 · COMPOSE & CRYSTALLIZE — candidate → indexed, dispatchable, contracted Method

| module | exports (verbs) | feeds → | tier |
|---|---|---|---|
| **`crystallize.js`** | `crystallizeStructural` (→ candidate: frontier + contract? + `libraryKey` + `templatesBySig`) · `synthesizeContract` (defeasible post, or null) · `reifyFrontier`/`libraryKey` | library.indexMethod | CORE |
| `library.js` | `indexMethod` (file under `byKey`) · `dispatch` (O(1) bucket + app-cond refine) · `dispatchInterface` (loosened recall) · `appConditionsHold` | adapt, combinator | CORE |
| `adapt.js` | `adaptOrForge` (retrieve/adapt/forge → verifier-gate → index-back) · `synthesizeByBlend` (depth-3 compose @0 calls) · `blendMethods`/`composeContract` · `antiUnifyAdapt` | library.indexMethod (amortize) | CORE-of-loop |
| `combinator.js` | `dispatchConcept`/`buildDispatchProvider` (0-call cross-concept mount; durable `Done` guard) | engine mount | CORE |
| `method.js` | `lintMethod` (decidability/frame lint) · `applySubgraphArg`/`mapSubgraph` · `selectCluster` | crystallize.lintFrontier | SHARED-INSTRUMENT |
| `method-pack.js` | `packMethods`/`unpackMethods`/`loadMethods` (`.sgc` portable, B8 version gate) | the master-loop recall library | SHARED-INSTRUMENT |

**Notes.** **Composition already exists** and lives here: `synthesizeByBlend` (`adapt.js:200`) + `blendMethods` +
`abstract.blendAtSegment` graft a depth-3 method from existing `templatesBySig` parts at `calls:0`, under a terminating
μ-descent on `methodDepth` — "a cache cannot (it replays); crystallize cannot without ≥2 traces." `adaptOrForge` indexes
the forged/adapted method back (`adapt.js:168`) so the *next* encounter hits at 0 calls (the amortization).
**Correction to the folklore:** the "refuse a method with no sound contract" gate is **here** (`adapt.js#hasSoundContract`,
reject at `:159`), **not** in `crystallizeStructural` — that admits a contractless method (`synthesizeContract` may return
null at `:263`, yet `:502`/`:506` still return `admitted:true`); it refuses on *other* soundness grounds
(untyped-behavioral-param, echoed-require, ambiguity, leak). The `adapt.js:16` comment claiming it mirrors
crystallize's refusal is inaccurate.

### 3 · FRONT DOOR — prose → deterministic typed dispatch key (LLM last-resort)

| module | exports (verbs) | feeds → | tier |
|---|---|---|---|
| `intake.js` (C0) | `createIntake` → `Intake::type` (prose → typed facts + digest; own miss-loop; `resolveFacts` seam) | canonicalize; borderline (on miss); registry | CORE |
| **`canonicalize.js`** | `canonValue`/`canonFacts` (exact + confluent ring snap; **no embedding**) · `digest` (memo key) · `compileEnumMap` · `normToken` | intake, borderline, registry, +8 authoring | CORE |
| `borderline.js` | `makeBorderlineSnap` (LLM last-resort on a miss; re-canonicalized; provisional + propose-only) · `enumGbnf` · `pickMember` | intake (opt-in seam); registry (proposals) | CORE |
| `registry.js` (Σ_sep) | `deriveRegistry`/`freezeRegistry` · `specForKey`/`resolveFactsSchema` · `mergeRingProposals` (admit + confluence re-check) · `retractRingAlias` (un-learn) · `registryLoopTree`/`Reg::merge` (autonomous loop) | intake (resolveFacts); canonicalize (specForKey) | CORE |
| `emittability.js` | `profile`/`perTaskStats`/`fleissKappa`/`poolAgreement` (paraphrase-stability profiler) | *(tests only)* | SHARED-INSTRUMENT |

**Notes.** Prose crosses into the typed world **exactly once**, at `Intake::type`. `canonicalize` is the single
soundness barrier (the most-imported module in `lib/`) and does a **one-probe** exact + case/ws-normalized + curated-ring
lookup — never an embedding or edit-distance (the HARD RULE, `canonicalize.js:32`). A reusable `FactsDigest` is minted
**only** when `IntakeStatus==='typed'` (`intake.js:191`), so a miss can never false-hit the memo; a borderline guess rides
an untracked `<name>Borderline` fact and stays un-cacheable. The vocabulary **self-grows** — a propose-only ring proposal
is deposited on a proxy node, and the autonomous `RegistryMerge` loop admits it (member ∈ enum ∧ confluence re-checked) —
and stays **reversible** via `retractRingAlias`, which de-locks first-writer-wins confluence and version-bumps to
invalidate anything typed through the retracted alias.

### 4 · SOUNDNESS SPINE, GATES & CONTROL

| module | exports (verbs) | role | tier |
|---|---|---|---|
| **`contract.js`** | `assertPost` (runtime monitor) · `checkCompose`/`entailsKey`/`footprintCycles` (static ⊨) · `reviseOnBlame` (CEGIS) · `widenOnVerified` · `holdsAtoms` (live admission) | defeasible soundness | CORE (runtime) |
| `relearn.js` | `makeRelearnProviders` (`Lib::blame`/`Lib::revise`) · `relearnTree` | the reference **un-learn** loop | CORE (opt-in) |
| `recall.js` | `createRecallIndex` (fuzzy cosine) · `verify` (structure-exact → full/partial/reject) · `recallAndVerify` | the master-loop RETRIEVE arm | CORE |
| `master-loop.js` | `createMasterLoop` → `{solve, drift, stats}` (cost-ordered arm ladder) | the **always-on driver** | CORE |
| `loop.js` | `loopConceptTree`/`reactiveLoopConceptTree` · `makeDecomposeProviders` · `synthesize` | decompose→answer DAG ("answer a huge prompt") | CORE |
| `extract.js` | `extractSubgraph` (k-hop slice + frozen frontier) · `mergeSlice` (single-writer + assumption-recheck) | the fork / multi-process ship lever | SHARED-INSTRUMENT |
| `widen.js` | `widenTree`/`makeWidenProviders` | test-under-drift **widen** (pairs with relearn) | SHARED-INSTRUMENT |
| `compose-hotspot.js` | `composeHotspots` (4-way verdict) · `provenanceChains` · `anyComposeCandidate` | `compress.js` gate — STRUCTURAL half | INSTRUMENT (not wired) |
| `cost-probe.js` | `costProbe`/`paysToCompress` | `compress.js` gate — COST half | INSTRUMENT (not wired) |

**Notes.** The contract's soundness is **asymmetric**: the **runtime** half is the load-bearing moat — `assertPost` is
wired into the durable interpreter's assert-before-commit (`interpreter.js:86`) and `holdsAtoms` gates live admission
(`library.js`) — while the **static** compose-time half (`checkCompose`/`footprintCycles`) has **no live caller**
(instrument + tests only; its own docstring says the runtime assert is the load-bearing one). `relearn.js` is the
autonomous un-learn loop that **`registry.js`'s `RegistryMerge` and `widen.js` both copy** (blame → revise →
`patchConcept`, as reactive concepts). `compress.js` **does not exist on disk**; its two gates are decided *instruments*,
never wired into dispatch — and per the cont.⁶ correction their standing "NO-GO" is **reopened** (see below): the
`cost-probe` framing measured elided *forge* calls, but `synthesizeByBlend` already composes at 0 forge, so the baseline
was wrong. The instruments are sound; the decision is open.

## The three tiers (core vs experimental) — the honest split

- **CORE — load-bearing and exercised by real-engine integration tests.** Front door: `intake`, `canonicalize`,
  `borderline`, `registry`. Detect: `mine`, `mdl`, `abstraction`. Compose: `crystallize`, `library`, `combinator`, and
  `adapt` (**core *of the creative loop*, but reached via `Graph.authoring` + tests, not the always-on master loop**).
  Spine/control: `contract` (runtime half), `relearn`, `recall`, `master-loop`, `loop`.
- **SHARED-INSTRUMENT — measurement, gates, and primitives, not on a live runtime path.** `abstract` (the LGG primitive
  everyone builds on), `decompose` (Σ_sep), `method`, `method-pack`, `emittability`, `extract`, `widen`, and the two
  `compress.js` gates `compose-hotspot` + `cost-probe`. Sound *as instruments*; a green instrument is not a shipped
  feature.
- **SHELVED / EXPERIMENTAL.** Marked `(shelved)` in the barrel: `conceptNet`, `graphNet`, `equilibrium`, `ste` (the
  probabilistic concept-net line — additive research, studies filed, off the critical path). Plus `ancestry.js`
  (unwired research post-processor).

## Where the open questions sit (mapping the roadmap onto the bricks)

The owner-agreed NEXT is **integration + measurement, not new operators** — the bricks exist; two are un-chained/un-decided:

1. **The end-to-end distillation loop, MEASURED on a narrow real domain** *(needs owner go — touches the program core).*
   Every brick in stages 1→2→4 exists and is tested *in isolation*; what has never been done is running the *whole chain*
   on the system's **own emergent trace** and measuring reuse (elided calls, composability, before/after). Concretely
   this is also **wiring the dispatch stack into a live loop** — closing the "two stacks, two libraries" gap above.
2. **Re-open `compress.js` EMPIRICALLY, against `synthesizeByBlend`** *(needs owner go).* The cont.⁶ verdict
   ("compress.js filed on the forge-cost axis") is **void**: `adapt.js#synthesizeByBlend` already composes at depth-3 for
   0 forge calls and `indexMethod` amortizes, so `cost-probe` (which counts elided *forge* calls) measured the wrong
   baseline. The honest question is whether *offline proactive mining* beats *on-demand blend + index-on-first-encounter*
   on **search cost / latency / coverage** — measured on the trace question 1 produces. `composeHotspot` + `costProbe`
   remain the right *instruments*; only the framing was wrong.
3. **Debt (no go needed).** A **scalability bench** N=1000+ (never measured; `extract.js` is the fork lever to test), and
   the **C0 back-check** depth (a CEGIS re-check of the intake result vs the prose). The **NUL/CI** gap is closed
   (`tests/unit/source-hygiene.test.js`).

**The standing guardrail:** any "new idea" from an external LLM about this repo must first be grepped in `lib/authoring/`
before treating it as work — the already-built rate is very high (both external reviews re-derived the *existing* archi).
Assemble + measure; don't re-code.

## Reading order for the next agent

1. This map (the substrate in one view) → 2. `concept-as-graph.md` §9 (the formal frame / standing direction) →
3. `adapt.js` (`adaptOrForge` / `synthesizeByBlend`) + `library.js` (dispatch) → 4. `contract.js` (the moat) +
`relearn.js` (un-learn) → 5. the front door (`intake.js` → `canonicalize.js` → `borderline.js` → `registry.js`) →
6. `doc/WIP/HANDOFF.md` (the live ledger) for the current fork.
