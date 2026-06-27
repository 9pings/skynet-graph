# The master-graph supervisor & method library

> **Audience:** a reader who knows what the engine is (a rule-driven graph that stabilizes typed-fact
> concepts to a fixpoint — see [architecture.md](architecture.md)) and wants the **Use 2** surface: the
> LLM-driven supervisor that *forges*, *crystallizes*, and *reuses* methods on top of the substrate.
> Everything here is **host-side and ZERO-CORE** — it does not touch `lib/graph/`, and it is **additive**:
> the base hand-authoring use ([usage.md](usage.md)) needs none of it. The full R&D trail is the canonical
> study [WIP/studies/2026-06-27-master-graph-supervisor.md](WIP/studies/2026-06-27-master-graph-supervisor.md)
> and the productization LOG [WIP/experiments/2026-06-27-productization/LOG.md](WIP/experiments/2026-06-27-productization/LOG.md);
> this doc is the durable summary.

## 1. The idea

A **master graph** is an LLM supervisor's bounded, auditable working memory. Rather than re-prompting the
model for every problem, the supervisor distils recurrent reasoning into typed **methods** (sub-graphs of
concepts), **reuses** a matching method when one exists, and **partial-collapses + re-forges** a method when
a premise drifts. Methods compose into bigger methods (concepts-as-tools → tools-from-tools), so a small
typed library covers a large combinatorial space of problems. The ceiling (K1) is honest: only *recurrent,
typed, canonicalizable* structure amortizes — genuinely novel reasoning stays in the model.

## 2. The control loop (`authoring/master-loop.js`)

`createMasterLoop({ signature, forge, reForge, cache, index, mount })` is a standing controller that climbs a
**value-of-computation ladder** per problem and takes the first arm that resolves at acceptable cost:

```
  MATCH    exact cache hit on the K1 signature              → 0 model calls
  RETRIEVE fuzzy recall (U5) → typed VERIFY                 → 0 (full) or partial cost
  FORGE    fork + LLM + crystallize into the library        → full cost; warms the library
  ESCALATE a method deopted K times → always re-forge / LLM → full cost, never cached (the floor)
```

- `loop.solve(problem)` → `{ result, arm, regime, cost }`.
- `loop.drift(problem)` — a premise changed → invalidate the method in **both** the cache and the recall
  index (re-derive, never a stale replay) + record a deopt (the mount-rank descends toward the floor).
- The caller injects `signature` (the typed K1 `{structure, content}`), `forge`, and optionally `reForge`
  (partial re-forge of only the differing content on a recalled skeleton); the rest is library machinery.

## 3. The pieces (each usable à nu)

| Module | Role |
|---|---|
| **`recall.js`** | FUZZY-RECALL → TYPED-VERIFY (U5). `createRecallIndex()` (embedding/similarity, ORDERS only), `verify(q, cand)` → `full`/`partial`/`reject` (exact + typed, ADMITS), `recallAndVerify`. Recall is lossy; verify is the soundness gate — a high-similarity but structurally-different method is **rejected**, never falsely replayed. |
| **`mount.js`** | The 3-regime MOUNT policy (U2). `createMountController()` → `decide(id, signals)` picks **instance** (fork-per-case, the safe default) / **inline** (`addConcept`, read-only frontier only) / **frozen** (warm-cache replay + deopt-guard) / **escalate** (the K1 floor), with hysteresis + a well-founded deopt-budget rank (termination). |
| **`../providers/cache.js`** | The DERIVATION CACHE — content-addressed memo over a provider, keyed on the **canonical justification** of a cast. A retract→re-derive becomes a hash lookup; a 2nd identical instance replays at ~0 calls. `createProviderCache({ store, version })` → `wrap`/`wrapFragment`; `keyFromScope` for cross-object providers. Fail-open on an unkeyable cast, version-namespaced (B8). |
| **`abstract.js`** | ABSTRACTIVATION (F6 — the keystone). `relativize`/`instantiate` (created ids → holes, frontier refs bound at the call site), `antiUnify` (Plotkin LGG soundness check), `methodTransform` (the `{onStore,onReplay}` the cache accepts), `emitMethodAsSubgraph` (serialize a derived sub-graph into a re-mountable parameterized method, via the engine-native `Graph#getMutationFromPath`). Makes cross-problem **structural** transfer sound + non-zero. |
| **`crystallize.js`** + `mine.js` + `abstraction.js` + `memo-stability.js` | FORGE → library. `mine` frequent producer→consumer chains from the trace, `crystallize`/`adopt`/`consolidate` install a composed method, gated by the MDL/utility `abstraction.evaluate` (scores **model calls**, U4) and `memo-stability` (fail-closed: a change must preserve incumbents' memo keys). The slow/consolidation half of the CLS loop whose fast half is the cache. |
| **`reaggregate.js`** | Defeasible RE-AGGREGATION (U3). A cleaner-on-retract un-pushes a contribution + re-folds, so a derived **summary** (not just the belief) updates on drift. |
| **`bounded-merge.js`** | `boundedProject` — a merge crosses only the declared separator alphabet Σ_sep, not the whole child (bounded context at the AND-join). |

## 4. Persistence & portability

The library survives restarts and **moves between deployments**:

- **`store.js`** — `createFileStore(path)` is a write-through Map-like; pass it as the cache/derivation `store`
  so the warm library re-loads on a cold process and replays at 0 calls. `saveIndex`/`loadIndex` persist the
  recall index; `saveSgc`/`loadSgc` read/write any `.sgc` bundle.
- **`method-pack.js`** — the `.sgc` **crystallized-method package** (M3). The sibling of `corpus-pack.js`
  (which packs the *authored grammar*); this packs the *learned library*. `packMethods(loop, { name, version })`
  → an `.sgc` bundle (`kind:'methods'`, a derived typed `schema`, the recall-index entries); `loadMethods(bundle,
  host, { version })` re-hydrates it into a fresh deployment. **B8 soundness:** the version gate covers **both**
  replay paths — versions agree → hydrate index + exact cache (0-call replay); differ → hydrate **neither**, the
  host re-forges (a stale-version method never replays verbatim). The typed verify still re-gates on the
  receiver, so a structurally-foreign method is rejected across deployments.

## 5. Status & honest lines

Built + measured (2026-06-27, ZERO-CORE): the arms (U1–U6 + Σ_sep/bounded-merge gates), the thin end-to-end
PoC (`examples/poc/master-graph.js`, 71% call elision over typed hop-methods), and **productization** M1 (the
always-on loop), M2 (persistence), M3 (the `.sgc` package) — see `examples/poc/master-loop.js`. **Remaining:**
M4 — wire `forge` to the real engine (fork + crystallize) on a real recurrent workload, measured vs naive + RAG.

**Hold these lines.** K1 ceiling: amortization of recurrent typed methods, **not** capability extension — the
win is LLM-call/token **elision + drift-robustness + auditability**, not CPU speed. A reactive, retractable
**belief-view** atop a durable executor (not itself one; the cache is the idempotency key). **Fuzziness in
recall, exactness in truth** — a fuzzily-retrieved method is *proposed*, its parts typed-**verified** before
they mount; the rest partial-collapses and re-forges (never a wrong derivation). Bounded context is by
**discipline** (the fold-digest window), not automatic.
