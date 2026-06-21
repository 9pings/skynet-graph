# Design — MOE Graph: Concept-Apply Inspector (v1) + reasoning-loop roadmap

**Date:** 2026-06-21 · **Branch:** `feat/moe-graph-v1-phase0`
**Status of the engine:** Phase 0 + Phase 1 of `doc/PLAN_DEV_V1_MOE_GRAPHE.md` complete (50 tests). This spec
opens the next phase: tooling + the decompose→synthesize reasoning loop.

---

## 0. The product loop we're building toward

Answer arbitrarily large prompts without context-window blowup, because **the graph is the working memory**
and every LLM call sees only bounded, local context:

```
user prompt
  -> seed a root segment (startNode -> goalNode) carrying the prompt
  -> concept↔prompt "experts" DECOMPOSE it into child subpaths (same start/end), recursively
  -> stabilize (forward-chaining to fixpoint)
  -> SYNTHESIZE: each parent rolls its children's answers into ONE bounded fact, leaf->root
  -> pick the best path
  -> answer = synthesized fact at the root (sourced from the chosen path)
```

This is also reactive: for live data, only the subpaths whose tracked inputs changed re-fire.

### Deduced toolset (sequenced)
1. **Inspector** (this spec) — trace every concept-apply (prompt/patch/why/timing) + a CLI. The instrument
   needed to develop everything below.
2. **Synthesis/rollup concept set** — the missing half of decomposition (design captured in §4).
3. **Budget/pruning** — beam + per-concept cost so "huge" isn't "ruinous".
4. **Session runner** — prompt in → answer out + trace, against the user's local LLM server.
5. **Disciplines** — concepts emit *typed facts* (memo stability); verification concepts (truth ≠ coherence).

Risks this design must respect (from `doc/aspect-*.md`): cost/exploration explosion (K2), final synthesis
re-concentrating context (mitigated by bounded rollup), memo-key fragmentation on prose (K1), hallucinated
facts propagating cleanly (K3).

---

## 1. Inspector v1 — scope

**Goal:** let a concept/prompt designer SEE what the graph did — for every concept application during a
stabilize run: the prompt sent (if LLM), the result-patch produced, **why the concept fired**, where it
landed, and how long it took. CLI over a **recorded trace artifact** (post-hoc; live streaming later).

**In scope:** engine instrumentation to emit a per-apply trace; a trace collector that writes a JSON artifact;
a CLI (`_lab/sg.js`) with `trace` (list), `show <n>` (full prompt/reply/patch + why), `diff <a> <b>`
(revision fact diff — reuses `diffRevisions`), `path <from> <to>` (best path + facts along it).

**Out of scope (later):** live tail; web/D3 viewer; cost rollup view; token accounting; filter/search.

---

## 2. Engine instrumentation (the trace layer)

Mirror the existing `cfg.onMutationApplied` / `_on.mutation` hook (App/Graph.js ~1218-1221).

### 2.1 New hook
- `cfg.onConceptApply(record)` — fired **once per (concept apply → mutation) pair**, inside `pushMutation`
  right after the `_revs[revNum]` write, guarded by `this._currentApply` (so host/sync-replay mutations,
  which have no apply context, don't pollute the trace). Also fan out to `_on.conceptApply` listeners.

### 2.2 Apply context
- `graph._currentApply = { conceptId, conceptName, targetId, kind, why, startTm, prompt?, reply?, ms? }`,
  a **single-slot** context set in `Concept.applyTo`:
  - default/enum branches are synchronous → set the context around the `pushMutation` call;
  - the provider branch is async → **re-establish** the context inside the provider callback, right before
    `graph.pushMutation(r, ...)`, because the engine may have processed other mutations in the async gap.
  - clear `prompt/reply/ms` after the first emitted record so a follow-up `applyMutations` patch (a second
    rev from the same apply) doesn't duplicate them. Multiple records sharing `conceptId/targetId/why` with
    distinct `rev/patch` is correct.

### 2.3 Record schema
```
{ rev, conceptId, conceptName, targetId,
  kind: 'provider'|'enum'|'default',
  patch,            // this._revs[rev].tpl (normalized template)
  bagRefs,
  prompt?, reply?,  // providers that opt in (see 2.5)
  ms,               // provider round-trip latency, or mutation-apply ms for sync branches
  why }             // see 2.4
```

### 2.4 "Why it fired"
Computed once in `applyTo` before the branches, by re-walking the concept's `require` list:
`why = require.map(c => ({ require: c, value: scope.getRef(c /* no follow */), producedAtRev }))`.
`producedAtRev` is **object-granular**: the `_rev` stamp (App/Graph.js ~987) of the object that holds the
resolved value — obtained via the trailing-colon `getRef("a:b:", scope)` "return the object" form, else
`scope._._rev`. Limitation (documented): it's the rev of the last mutation that touched that object, not the
specific key. Per-key precision is a later opt-in (`Entity.set` stamping); not in v1. If an `assert`/`ensure`
references refs beyond `require`, optionally extract `$ref` tokens and resolve them too (polish, not v1-core).

### 2.5 Prompt capture (zero engine↔provider coupling)
- `graph.traceProvider({prompt, reply})` — writes onto `this._currentApply` if present, else no-op.
- The bundled LLM provider (`providers/llm.js` `complete`) calls it once, after the reply, before `cb`.
- Custom providers opt in with the same one line. Non-LLM providers (geo) never call it → `prompt:undefined`.

### 2.6 Timing
Provider branch: reuse the existing `execTm` (`Date.now() - execTm` already computed next to
`_statsByProvider`). Sync branches: `Date.now() - startTm`. Record `kind` so the consumer interprets `ms`.

### 2.7 Gotchas (encode as tests/comments)
Provider returning `null` patch (e.g. geo waiting on positions) → no rev → no record (acceptable).
Single-slot `_currentApply` valid only for the synchronous span of one `pushMutation`. Don't read dead
`_revByIds`.

---

## 3. Trace collector + CLI

### 3.1 Collector
A small helper (in `_lab/` or `providers/` — host-side, not engine): `createTrace()` returns
`{ onConceptApply, records, write(path) }`. The host wires `cfg.onConceptApply = trace.onConceptApply`.
`write(path)` dumps `{ meta, records }` JSON. (Engine stays oblivious to files.)

### 3.2 CLI `_lab/sg.js`
Reads a trace JSON (and/or a serialized graph snapshot) and renders:
- `sg trace <file>` — table: `# | rev | concept | target | patch-summary | ms`.
- `sg show <file> <n>` — full record n: prompt (system/user), reply, patch (pretty), why (require→value@rev).
- `sg diff <file> <a> <b>` — uses the graph snapshot + `diffRevisions(a,b)` (added/removed/changed).
- `sg path <file> <from> <to>` — `getPaths` + facts along each path (best-path ranking is a later add).

CLI is dependency-light (Node, no framework). Patch-summary = compact (`{Distance:{inKm:…}}`, `+3 segs`).

---

## 4. Synthesis/rollup design (captured for the NEXT phase — validated, not built here)

The missing half of decomposition. Add a `Rollup` concept sibling to `Expand`/`EvalComplexity`:
```jsonc
Rollup: {
  _id:"Rollup", _name:"Rollup",
  require:["Task","Expand"],              // only non-atomic, already-expanded parents
  ensure:["$AnsweredCount==$childCount"], // WATCHED gate (assert would NOT install a watcher)
  provider:["AI::rollup"]
}
```
- **Constraint 1:** `require` can't express "all N children answered" (no aggregation in `getRef` walks). Use a
  **scalar counter**: `Expand` writes `childCount` + `AnsweredCount:0` + each child stores its `parentSeg`;
  each child, on becoming `Answered`, does a provider-side read-modify-write `+1` of the parent's
  `AnsweredCount` (no atomic `+=`; safe under single-threaded stabilization).
- **Constraint 2:** the gate **must be `ensure`** (only `ensure` installs watchers; `assert` resolves refs
  without `follow`). This is the subtle correctness point.
- **Read children bounded:** `scope._.expandedInto.map(id => getEtty(id)._.answer)` — direct children only.
  Never `getPaths`/`getAllPropsInPath` (pulls the whole sub-DAG → breaks the bound).
- **Write rollup:** `{ $_id:'_parent', Rollup:true, Answered:true, answer:"<bounded summary>" }` (cap
  `maxTokens` — the answer size must be O(1) regardless of subtree size; this invariant IS the value prop).
- **Termination:** leaf→root by induction (a parent's counter can't complete before its children answer);
  depth floor is the base case; self-flag (`Rollup:true`) prevents re-fire → converges to fixpoint.
- **Leaf half (also missing today):** atomic leaves must produce `Answered:true` + a bounded `answer` + the
  report-up increment.

---

## 4b. Memory-on-retraction → live strategy adaptation (user idea, 2026-06-21 — MAJOR roadmap)

When a path is retracted because it failed, don't let it vanish — have it **deposit a durable "memory"**
of what was tried, the outcome, and *why*, anchored OUTSIDE the retracted subtree. Future strategy/
decomposition concepts read that memory to avoid repeats and to **adapt strategy live** (change a prompt,
cast a different strategy, or invent a new one from the lessons of failed paths). This makes the JTMS
retraction *productive* — a differentiator no compared system has (LangGraph rolls back with no residue; a
bare LLM has no cross-attempt memory).

Maps onto existing/just-built mechanisms:
- **`cleaner`** (runs in `Entity.unCast` ~222 at retraction time) = the natural emit point: the dying
  concept's cleaner provider writes a memory fact.
- **The concept-apply trace** (just built) = the raw "what was tried + why" (`why`, `prompt`, `reply`, `patch`).
- **Anchor**: write memory to a stable survivor (root segment or a dedicated `memory` free-node) via
  `pushMutation(tpl, anchorId)` / `$$_id:anchorId`, since the failing subtree is being deleted.
- **`patchConcept` / `castConcept` / `fork`** (built) = the "change/create strategy" levers a meta-concept
  uses after reading memory.

Memory fact shape (bounded, discrete — NOT transcripts): `{ strategy, outcome:'failed', reason, atRev }`.

Honest risks (must engineer):
- **Termination/oscillation:** memory must be **append-only/monotonic** and strategy selection
  **exclusionary** (the strategy concept's `assert` excludes already-recorded failures) — else
  try-A→fail→try-B→fail→try-A loops. Same "dedup-vs-seen / loop-until-dry" discipline as a good search.
- **Bounded memory:** discrete summarized facts only, or memory itself blows context.
- **Mid-uncast safety:** VALIDATED (agent, 2026-06-21) — **implementable with ZERO required core changes.**
  Findings: `cleaner` (Entity.js:224-239) is the emit point; at that moment the retracted concept's own key
  is already `delete`d (Entity.js:205) but sibling/parent facts survive. A cleaner's nested `pushMutation` is
  **queued** by the `_mutationThreadRunning` guard (Graph.js:903-907) and drained after the in-flight mutation
  (1250-1252) — no re-entrancy. Anchor = a dedicated free-node `{_id:'memory', memory:[]}`; cleaner writes to
  it cross-object via `$$_id:'memory'` (works today). Feedback: strategy providers read the full list via
  `getEtty('memory')._.memory`; exclusion is assertable via flat boolean projection keys `failed_<ctx>_<strat>`
  (since `getRef` can't aggregate a list — established constraint). Termination: append-only memory +
  **negative-only** dependence (a strategy concept depends on memory only to be *disabled*, never re-enabled) +
  self-flag + exclusion-key-set-atomically-with-the-record ⇒ strictly shrinking strategy set per context ⇒
  well-founded. Only OPTIONAL engine change: pass `unReachable`/reason into the cleaner call (Entity.js:231-234,
  one line) so the recorded `reason` is precise rather than inferred. The host keeps a trace-index keyed by
  targetId (subscribe `graph.on('conceptApply', …)`) since the engine drops `_traceByApply` after emit.

Sequence: **inspector (now) → memory-on-retraction → budget/retry-bound → strategy-adaptation (self-modifying
tier, riskiest+coolest).** The trace built now is the prerequisite (it IS the "what worked and why").

## 4c. Declarative, AI-authorable concept system (user idea, 2026-06-21 — MAJOR pillar)

Make concept/trigger/prompt definition generic and clean enough that an **AI can create / modify / improve
experts** itself. Much is already enabled:
- Concepts are already declarative JSON (`require`/`assert`/`ensure`/`provider`/`applyMutations`/`childConcepts`).
- The generic **`LLM::complete`** provider (built) means a *complete working expert is pure JSON* — trigger
  (`require`/`assert`/`ensure`, safely evaluated by `expr.js`) + `prompt` block + a provider from a vetted palette.
  No code needed for the common case.
- **`patchConcept`** (built) already edits a concept live.

To build:
1. **`addConcept(parentNameOrId, def)`** — create a NEW concept at runtime (sibling to `patchConcept`; same
   re-evaluate-everything afterward). The create half of live authoring.
2. **Formal validated concept schema** (a JSON-schema) + AI-facing docs — emit valid concepts; reject malformed
   ones before they break stabilization.
3. **Self-improvement loop:** AI authors concept → run → **trace** (§2, built) shows fired/why → **memory-on-
   retraction** (§4b) records failures → AI patches/improves. The trace + memory ARE the feedback signal.

Design tension (resolve explicitly):
- *Never cap expressiveness* (standing directive) → validation checks STRUCTURE (field names/types, asserts
  parse, named provider exists), NOT the expression grammar.
- *Safety boundary*: AI authors the DECLARATIVE parts (triggers/prompts/which-provider) from a HOST-VETTED
  provider palette; it does NOT write arbitrary provider JS. `LLM::complete` being universal means it rarely
  needs to. Powerful AND safe.

Framing: "DSPy, but the AI authors the control structure, not just tunes prompts." Sequences after the inspector
(the feedback instrument); pairs with §4b (the self-improvement signal).

**LIVE / online (user, 2026-06-21).** Authoring is runtime, not design-time: a **meta-concept running inside the
graph** observes (trace + memory) and calls `addConcept`/`patchConcept` **mid-run** to change/create strategy,
then the graph re-stabilizes and continues — self-modification in the loop. `patchConcept` already re-stabilizes
live; `addConcept` must too. **Re-entrancy to verify:** calling patch/add from *within* a provider cb during
stabilization (the meta-concept IS a provider) — does the re-evaluate + re-stabilize compose safely with the
in-flight loop? Same concern class as the mid-uncast memory write (§4b). This is the self-modifying tier:
highest leverage, highest risk — gate it behind the trace+memory+budget being solid.

## 5. Testing (TDD)

Engine instrumentation (unit/integration, `tests/`):
- `onConceptApply` fires once per apply with correct `{conceptId, targetId, rev, patch, kind}` for default,
  enum, and provider concepts.
- `why` lists the resolved requires with object-granular `producedAtRev`.
- `traceProvider` is a no-op when no sink; captures prompt/reply when wired; geo apply has no prompt.
- multiple-mutation apply (provider + `applyMutations`) → multiple records, prompt only on the first.
- no record for host-initiated (no `_currentApply`) mutations.

Collector + CLI (lab-level): record a `run-basic`-style run, assert the trace artifact shape; smoke-test the
CLI commands against a fixture trace.

---

## 6. Open questions / deferred
- Per-key (vs object) rev attribution for `why` — opt-in `Entity.set` stamping. Deferred.
- Live tail / web viewer — deferred.
- Cost rollup + token accounting — deferred (feeds budget/pruning, §0.3).
- Whether to emit a `patch:null` "attempted but produced nothing" record for waiting providers — default: no.
