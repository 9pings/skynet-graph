# Skynet-Graph — Public API

The stable surface of the engine as of the V1 "Neurosymbolic Reasoning Graph" (formerly "MOE Graph") Phase-0 work. Skynet-graph is a
**library**: a host app embeds the engine, supplies *concept definitions* (the experts) and
*provider functions* (the effectful work), and drives the graph through mutations.

Mental model: data objects (nodes, segments) carry **typed facts**. **Concepts** are declarative
rules that become applicable when their `require`/`assert` conditions hold against the facts; when
they cast, they add more facts and/or new child segments, which makes other concepts applicable —
a forward-chaining cascade that runs to a fixpoint (**stabilization**). Mutations destabilize;
stabilization re-casts/uncasts; repeat until nothing more fires. See `CLAUDE.md` and `doc/doc.md`
for the concept-schema and the embedded reference/template DSLs.

---

## Construction

```js
const Graph = require('skynet-graph');           // dist build; in-repo use _lab/_boot.js
const graph = new Graph(record, conf, conceptMap);
```

- **`record`** — the initial graph. Either a serialized snapshot `{ graph: "<json string>", lastRev }`
  or a plain `{ lastRev, nodes:[…], segments:[…], freeNodes:[…] }` (or `{ conceptMaps:[…] }`, each
  tagged with `Node:true` / `Segment:true`). Nodes/segments are `{ _id, … }`; segments also need
  `originNode` / `targetNode`. Arbitrary typed facts (e.g. `Position`, `Distance`) live right on the
  object record.
- **`conf`** — overrides merged onto `Graph.prototype.cfg`. Common fields:
  | field | meaning |
  |---|---|
  | `label` | name for logs |
  | `autoMount` | start stabilizing immediately (default `true`) |
  | `isMaster` | master vs client (client forwards mutations via `pushToMaster`) |
  | `conceptSets` | which keys of `conceptMap` to `deepmerge` into the active tree (default `["common"]`) |
  | `onStabilize(graph, tokens)` | called once the graph settles (the main hook) |
  | `bagRefManagers` | external-data ref managers (default `caipi` matches `/^db:(.+)$/`) |
- **`conceptMap`** — host-supplied, keyed by concept-set name (`{ common: <tree> }`). The tree is a
  nested `childConcepts` hierarchy. `_lab/concepts.js#buildConceptTree(dir)` assembles one from the
  `concepts/<set>/` directory.

---

## Lifecycle & stabilization

```js
new Graph(seed, {
  autoMount: true, isMaster: true, conceptSets: ['common'], bagRefManagers: {},
  onStabilize(g) { /* graph has reached a fixpoint */ }
}, { common: tree });
```

- **`onStabilize`** fires every time the graph reaches a coherent fixpoint — after the initial mount
  and after every mutation/rollback/patch settles. It is the primary place to read results and to
  drive the next step.
- **`graph.stabilize(cb?)`** — ensure the task loop is running; `cb` fires once on the next settle.
- A snapshot is captured on every settle (see History).

---

## Mutations

```js
graph.pushMutation(template, targetId, force?, atomId?, initialRefBag?, cb?);
```

Apply a mutation template that creates/updates objects and marks them unstable. The template uses the
`$`-prefixed reference/template DSL (`$_id`, `$$_id`, `$key` ref, `$$key` bagRef, `_incoming`/`_outgoing`
nesting). Example (grow the graph):

```js
graph.pushMutation([
  { _id: 'tokyo', Node: true, Position: { lat: 35.6762, lng: 139.6503 } },
  { _id: 'long2', Segment: true, originNode: 'paris', targetNode: 'tokyo' }
]);
```

Providers emit the same templates from their callback (see Providers). After mutating outside an
`onStabilize` turn, call `graph.stabilize()` if the loop isn't already running.

---

## State & history

| method | returns |
|---|---|
| `graph.serialize()` | `{ lastRev, graph: "<json>" }` snapshot of the whole graph |
| `graph.getCurrentRevision()` | current revision number |
| `graph.getRevisions()` | ascending list of revisions with captured snapshots |
| `graph.getSnapshot(rev)` / `graph.diffRevisions(a, b)` | snapshot at `rev` / added·removed·changed between revs |
| `graph.rollbackTo(rev)` | re-mount that snapshot, drop later ones (linear undo), re-stabilize — restores **rules too** |
| `graph.exportConcepts()` | the LIVE concept tree as a serializable record (reflects `addConcept`/`patchConcept`) — feed to `corpus-pack` / `exportConceptsToDir` |

```js
const revA = g.getCurrentRevision();
g.pushMutation(/* … grow … */);          // -> settles at revB
// later:
g.rollbackTo(revA);                       // the growth is undone, onStabilize re-fires at revA
```

Snapshots are full `serialize()` copies captured on each settle (delta-replay is a later optimization).

---

## Sub-agents — fork / merge

Spin up an independent child graph (a sandboxed sub-agent, optionally with a *different* concept set =
different capabilities), let it work a sub-problem, and reintegrate its result.

```js
const child = graph.fork(subSeed, {
  label: 'child', conceptSets: ['worker'],     // child-only capabilities
  reintegrateInto: 'root',                      // target object in the PARENT
  project: (child) => ({ $$_id: 'root', mergedWork: child._objById['sub']._etty._.work })
});
```

- **`fork(seed?, conf?)`** → a new child `Graph`. `seed` omitted ⇒ forks this graph's current snapshot.
  Reuses this graph's concept library unless `conf.conceptMap` overrides it. With `conf.reintegrateInto`
  (+ optional `conf.project`), the child auto-`merge`s back on its own stabilize.
- **`merge(child, targetId, project?)`** — apply `project(child)` (a mutation template) onto `targetId`
  in this graph, then `child.destroy()`. Default `project` attaches the child's serialized graph.

---

## Hot-patching experts — patchConcept

Change a live concept (an "expert") and re-evaluate the whole graph against it, both directions, with
no restart or rebuild.

```js
graph.patchConcept('Far', { assert: ['$Distance.inKm > 500'] });
```

- **`patchConcept(nameOrId, updates, cb?)`** — deep-merges `updates` into the concept's schema
  (**arrays REPLACE, not concatenate** — so `{assert:[…]}` overrides), recompiles its applicability
  test, then for every live object: newly-applicable + not cast ⇒ cast; cast + no-longer-applicable ⇒
  **uncast (cascading to child concepts)**; then re-stabilizes.
- **`getConceptByName(nameOrId)`** — resolve a concept by its library id, else by `_name`.

Tightening an assert retracts the concept where it no longer holds *and its dependent children*;
loosening one casts it onto newly-qualifying objects.

---

## Manual concept control & accessors

| method | meaning |
|---|---|
| `graph.castConcept(objId, conceptId, cb?)` | force-cast a concept onto an object, re-stabilize |
| `graph.unCastConcept(objId, conceptId, cb?)` | force-uncast, re-stabilize |
| `graph.getConcept(id)` | concept instance by library id |
| `graph.getRef(exp, scope?, follow?, unref?)` | resolve a reference path (`a:b:c`, `$key`) from a scope |
| `graph.getEtty(id)` | the Entity wrapper for an object id |
| `graph.getPaths(fromId, toId, skip?)` / `graph.getOpenPathOf(id)` | path discovery / a `PathMap` |
| `graph.on(evt, cb)` / `graph.un(evt, cb)` | subscribe/unsubscribe (`"stabilize"`, `"destroy"`) |
| `graph.destroy()` | tear down the graph and its objects |

Object internals: `graph._objById[id]._etty` is the Entity; `…._etty._` is the raw typed facts record
(e.g. `graph._objById['long']._etty._.Distance.inKm`).

---

## Providers

A provider does the effectful work a concept needs (geo math, an API/DB call, an LLM call) and emits
facts. The engine looks them up in `Graph._providers` (host-wired — the engine does **not** auto-load
them). A concept references one as `"Namespace::fn"` (optionally `["ns::fn", …args]`).

**Contract:**

```js
Graph._providers = {
  Namespace: {
    fn(graph, concept, scope, argz, cb) {
      // …compute…
      cb(err, mutationTemplate);   // template applied onto the scope object (`$_id:'_parent'`)
    }
  }
};
```

`scope` is the object's Entity; read its context with `graph.getRef('originNode:Position', scope)`.
Return `cb(null, null)` to no-op (e.g. wait for a dependency).

### Packaged base providers (host opt-in)

```js
const Graph = require('skynet-graph');
const { register, CommonGeo, createLLMProvider } = require('skynet-graph/providers');

register(Graph, [ { CommonGeo }, createLLMProvider({ ask: myBackend }) ]);
// register(Graph)  with no selection wires the defaults (Geo + a default LLM client)
```

- **`CommonGeo`** → `CommonGeo::Distance` — haversine great-circle distance between two node
  `Position`s, emitting `{ Distance: { inKm } }`. Drives `concepts/common/Edge/Distance.json`.
  (`haversineKm(a, b)` is also exported as a pure function.)
- **`createLLMProvider({ ask, parseJSON?, namespace? })`** → `{ LLM: { complete } }`, a generic
  concept↔prompt runner. The concept supplies a `prompt` block:

  ```json
  { "provider": ["LLM::complete"],
    "prompt": { "system": "You judge.", "user": "Step: ${label}",
                "maxTokens": 500, "json": true, "as": "Classification" } }
  ```

  `system`/`user` interpolate `${ref}` tokens (resolved against the scope via `graph.getRef`);
  `json:true` salvages the reply (robust to "thinking" preambles — returns the last balanced JSON);
  the result is written back as facts (merged if a plain object, or stored under `as`). Backend errors
  are captured as an `llmError` fact so the graph still settles. The backend is **pluggable** — pass
  any `ask({system,user,maxTokens})`; the bundled `makeAsk(opts)` **dispatches on `opts.api` / env
  `LLM_API`** — `anthropic` (default, `/v1/messages`) or `openai` (`/v1/chat/completions`, for
  vLLM / llama.cpp / LM-Studio; reads `choices[0].message.content` and falls back to
  `reasoning_content` for reasoning models). `makeOpenAIAsk` / `makeAnthropicAsk` are exported too.
  All configurable via `LLM_BASE` / `LLM_MODEL` / `LLM_KEY` or `{ base, model, key }`.

#### Canonicalization barrier — the `facts` / `prose` contract

An `LLM::complete` expert whose output **feeds downstream experts** must not let raw prose onto a
dependency edge: two semantically-equal replies differ textually, so a `require`/`ensure` keyed on prose
re-keys every run and the memo never hits (risk **K1**, `doc/MODELISATION.md` §4.2). Declare a `facts`
schema and the provider writes **only** those discrete, canonicalized keys as *tracked* facts; the free
text lands on an *untracked* prose key; a stable `<name>FactsDigest` is emitted as an explicit memo key.

```json
{ "provider": ["LLM::complete"],
  "prompt": {
    "system": "Classify the risk.", "user": "Step: ${label}",
    "facts": {                                  // the tracked, discrete spine
      "severity": { "enum": ["low","medium","high"] },   // snapped to a closed vocabulary
      "priceK":   { "grain": 100, "from": "price" },      // numeric rounded to a grain; read raw `price`
      "count":    { "type": "int" }                       // int | number | bool | id | string
    },
    "prose": "summary"                          // free text -> UNTRACKED key (default: `<name>Prose`)
  } }
```

Snapping is **deterministic only** (never embedding similarity — a fuzzy false-hit graves a wrong fact
that *propagates*). An out-of-vocabulary enum **fails closed**: the fact is `null` and the key is listed
in `<name>CanonMiss` (visible, never a silent wrong snap). Helpers are exported for direct use:
`canonFacts(raw, schema) -> { facts, misses }`, `canonValue(raw, spec)`, `digest(facts)`.
With no `facts` schema declared, the provider keeps its legacy merge/`as` behavior (back-compatible).
- **`register(Graph, fragments?)`** merges provider-map fragments onto `Graph._providers`, preserving
  any already set.

### Verification — verdict facts + `ensure` defeasance

The engine maintains **coherence**, never **truth** (K3): a hallucinated-but-valid fact propagates and
retracts cleanly. Verification makes unreliability *visible and non-propagating* by emitting discrete
**verdict facts** that downstream concepts gate on via `ensure` — a refuted fact auto-retracts its
dependents (refutation *is* defeasance; no new engine path). Verdicts are discrete (the typed-fact spine),
never prose, and **never overwrite** the checked fact. `createVerifier()` (from `skynet-graph/providers`)
returns `{ Verify: { check }, Vote: { tally } }`; `checks` and `majority` are exported too.

Three patterns (all engine-verified; pick by reactivity need):

1. **Deterministic verifier = a concept whose `ensure` IS the invariant** — full `expr.js` grammar (uncapped):
   `{ "_name":"BudgetOK", "require":["cost","cap"], "ensure":["$cost <= $cap"] }`. Its self-flag is the verdict;
   a target change re-tests it and auto-retracts. A consumer **nested** under it (`childConcepts`) cascade-
   retracts on refutation. Prefer this — deterministic checkers ≫ LLM-refuters, and it is reactive.
2. **Independent verdict provider** `Verify::check` — for a check that runs as an effect (external lookup /
   LLM-refuter): `{ "provider":["Verify::check"], "verify":{ "target":"$x", "check":"range", "params":{"min":0,"max":100}, "as":"x" } }`
   writes `xVerdict`/`xVerified`/`xVerifiedAgainst` (provenance), never `$x`. Downstream gates `ensure:["$xVerified == true"]`.
   (A provider verifier is **cast-once** — it re-runs only on uncast/recast; use pattern 1 for reactive re-checking.)
3. **k-of-n voting** `Vote::tally` — self-consistency: n strategies `{__push}` a vote into a grow-only array;
   a `Vote` concept gated `ensure:["$votes.length == $expected"]` emits `consensus` + `confidence = agree/n`;
   downstream gates `ensure:["$confidence >= 0.7"]`. Treat `confidence` as a heuristic, never proof (a biased
   model votes confidently wrong). Independence discipline: the refuter must not be the call that produced the fact.

Deterministic checkers: `range`, `oneOf`, `equals`, `approx`, `nonEmpty` — `(value, params) -> { pass, reason }`,
extend via `createVerifier({ checks: { … } })`.

### Freshness / TTL — time as a fact

The engine has no internal wall-clock (replay stays hermetic). Time enters as an ordinary fact on a
`clock` free-node; a time-bound concept gates freshness in an `ensure`. Advancing the clock re-tests
exactly the concepts that follow it, so a fact that has gone **stale auto-retracts** (and its dependents
cascade) — the cache-poisoning fix (an LLM/API fact otherwise lives forever). `_lab/clock.js` provides
the helpers:

```js
const { clockSeed, clockNow, advanceClock, refetch } = require('./_lab/clock');
// seed: { freeNodes: [ clockSeed(0) ], nodes: [ { _id:'n', source:'db', sensedAt:0 } ] }
// concept: { "require":["source"], "ensure":["$$clock:tick - $sensedAt < 2"], "provider":["AI::sense"] }
//   ($$clock — DOUBLE-$, a GLOBAL free-node ref; a single $clock is a key on the current scope)
advanceClock(g, 3);          // tick 0 -> 3: the fact is now stale -> retracts + cascades
refetch(g, 'n', 'Live');     // host-triggered re-run against the current clock
```

- **Invalidation is automatic and reliable.** **Refetch is host-triggered** — a provider is cast-once, so a
  stale provider-fact re-derives only on uncast→recast (`refetch`). A fully-autonomous reaper is an optional
  core primitive. A provider stamps its fetch time with `clockNow(graph)`.
- Pitfall: an `ensure` with `||` (`"$x==null || $$clock:tick-$x<t"`) **short-circuits watcher registration** —
  seed the stamp so the freshness operand always evaluates, or split the fetch from the freshness gate.

---

## Author-time concept validation

A host-side validator enforces the typed-fact discipline **before** a concept tree reaches the engine —
the safety gate for hand- or AI-authored concepts. It validates *structure*, never the expression grammar.

```js
const { validateConceptTree, validateOrThrow } = require('./_lab/validate');
const { errors, warnings } = validateConceptTree(tree, { palette: ['LLM::complete', 'CommonGeo::Distance'] });
```

Checks: every concept has a `_name` (the self-flag — without it the engine re-fires it forever);
`assert`/`ensure` parse under the real evaluator (`App/expr.js`) and don't touch `constructor`/`__proto__`;
`provider` ∈ a vetted `palette` (advisory warning, or an error under `{ strict: true }`); and the valuable
one — **ref soundness**: a `require`/`ensure`/`assert` that keys on a **prose** fact (a declared `prose`
key, or the `<name>Prose`/`<name>CanonMiss` defaults) is **rejected** (it would fragment the memo, K1),
and a bare dependency on a child-set (`expandedInto`/`answeredBy`/…) without `.length` is **warned** (the
"all-children-answered" footgun — `getRef` has no quantifier). `validateOrThrow` throws on the first error.

### Mixture-of-Reasoners regime providers (host opt-in, additive)

All are `require('skynet-graph/providers')` factories; pair each with its ready-made concept-tree
fragment. The deterministic core is untouched.

| factory | wires | concept-tree helper |
|---|---|---|
| `createSemiring()` | `Semiring::reduce` — fold `{__push}`ed contributions under `boolean`/`logodds`/`maxplus`/`probor` | `semiringConceptTree({ semiring, contribKey, bands? })` |
| `createSemiring()` (pareto family) | multi-criteria **skyline SELECT** → `selectedId`/`frontIds`/`frontSize` | `selectConceptTree({ criteria, lex })` — the Candidate→Selected cluster |
| `createStats()` | `Stats::{report,grandMean,shrink}` — hierarchical Beta-Binomial shrinkage | `shrinkageConceptTree(...)` |
| `createNogood()` | `Nogood::guard` — learned sound-skip of dead-ends | `nogoodGuardConcept()` / `guardTrial(schema)` |
| `createVerifier()` | `Verify::check` (verdict facts) + `Vote::tally` (k-of-n) | — |
| `createConsistency()` | `Merge::combine` — sheaf-style agree/borderline/conflict bands | `consistencyConceptTree()` |
| `createSolver({ solve })` | `Solve::run` — a C-regime **fork** that searches; crosses only the snapped model | `solverConceptTree()` |
| `createConstat()` | `Constat::record` — typed lesson-on-retraction `{claim,retractedBecause,certaintyBand,atRev}` | — |

Pure helpers: `paretoFront` / `paretoSelect` / `makePareto` / `dominates` / `reduceSemiring`
(`lib/providers/semiring.js`).

### Tiling, grammar graph & corpus exchange (`lib/authoring/`)

- **`treeDecomposition(tree)` / `forkPlan(tree)`** (`decompose.js`) — derive, off the concept-dependency
  graph, the separator interface + the candidate forks + each fork's **frontier alphabet** + the treewidth
  cost bound (`partitionPays`). Feeds `fork`/`merge` and `validateMergeProjection`.
- **`conceptFactGraph(conceptMap)`** (`grammar-graph.js`) — the concept↔fact flux graph: produced /
  consumed facts **with polarity**, cross-corpus links, writer-collisions, entry points, tiling overlay.
- **`.sgc` corpus exchange** (`corpus-pack.js`): `deriveManifest` (produces/consumes alphabet, required
  providers), `packCorpus` / `unpackCorpus` (a portable bundle of the *authored grammar*). Disk round-trip:
  `Graph.loadConceptMap(dir, { validate })` ↔ `exportConceptsToDir(tree, dir)` (`lib/load.js`). The sibling
  that packs the *learned method library* is `method-pack.js` (next section).

### The support grammar (`lib/authoring/support.js`)

`supportConceptTree({ criteria, lex })` + `makeSupportProviders({ evalFn, expandFn, proposeFn,
escalateFn, escalateBar, rollupFn })` compose the decompose loop with the per-segment
**Propose → Pareto-SELECT → Adopt** alternative-search trio + escalation on `Stuck`. Inject the content
functions (deterministic in tests, an LLM in production).

### Master-graph supervisor & method library (`lib/authoring/`)

The LLM-driven **use 2** surface — forge / crystallize / reuse typed methods on top of the substrate. Host-side,
ZERO-CORE, additive (the base hand-authoring use needs none of it). Full guide: [supervisor.md](supervisor.md).

- **`master-loop.js`** — `createMasterLoop({ signature, forge, reForge, cache, index, mount })` → `{ solve,
  drift, stats, cache, index, mount, keyOf, idOf }`. The cost-ladder controller MATCH→RETRIEVE→FORGE→ESCALATE;
  `solve(p)` → `{ result, arm, regime, cost }`; `drift(p)` invalidates a method (cache + index) + records a deopt.
- **`recall.js`** — fuzzy-recall → typed-verify: `createRecallIndex()` (`add`/`recall`/`remove`), `verify(q,
  cand)` → `full`/`partial`/`reject` (the soundness gate — structure decides, never the similarity score),
  `recallAndVerify`.
- **`mount.js`** — `createMountController()` → `decide(id, signals)` (instance/inline/frozen/escalate, hysteresis
  + a deopt-budget rank), `recordDeopt`, `regimeOf`, `deoptBudget`.
- **`abstract.js`** — F6 abstractivation: `relativize`/`instantiate` (id/frontier holes), `antiUnify` (Plotkin
  LGG), `methodTransform` (the cache `{onStore,onReplay}`), `emitMethodAsSubgraph` (re-mountable parameterized
  method via `Graph#getMutationFromPath`). The cross-problem structural-transfer keystone.
- **`crystallize.js`** (+ `mine.js`, `abstraction.js`, `memo-stability.js`) — `crystallize`/`adopt`/`consolidate`:
  mine a producer→consumer chain → compose → MDL/utility gate (`abstraction.evaluate` scores model calls) →
  install fail-closed (memo-stability). `reaggregate.js` — defeasible re-aggregation (a summary updates on drift);
  `bounded-merge.js` — `boundedProject` (cross only Σ_sep at a merge).
- **Persistence & portability.** `store.js` — `createFileStore(path)` (write-through Map-like cache/store),
  `saveIndex`/`loadIndex`, `saveSgc`/`loadSgc` (any `.sgc` file). `method-pack.js` — the `.sgc` **methods**
  package: `packMethods(loop, { name, version })` / `loadMethods(bundle, host, { version })` /
  `unpackMethods` / `deriveMethodSchema`. The **B8 version gate** covers both replay paths (versions agree →
  hydrate index + exact cache; differ → re-forge, no stale verbatim replay), and the receiver's typed verify
  rejects a structurally-foreign method.

### Learned concepts — population training, plasticity & serving (`lib/authoring/`)

Train concepts as neural-net populations instead of hand-authoring them, then bake the frozen result
back into the engine. Host-side, ZERO-CORE. Full guide: [concept-learning.md](concept-learning.md).

- **`equilibrium.js`** — gradient through a fixpoint (Deep Equilibrium Models / implicit diff):
  `solveFixpoint(F, z0, {maxIter,tol})` (Picard to `z*`), `implicitGrad(Jz, Jtheta, gradL, {mode})`
  (`mode:'direct'` dense adjoint solve or `{neumann:K}`), `spectralRadius(Jz)` (the `ρ` regime
  instrument), `numJac(fn, point)` (finite-difference Jacobian of one sweep).
- **`concept-net.js`** — a population of concept-units (gate-NN × update-NN):
  `ringPopulation(K)` / `chainPopulation(K)` / `widePopulation(K)` (builders) →
  `train(pop, {X,T,steps,lr,hard})` (learn at the fixpoint, returns `{theta,loss0,loss,rho}`),
  `grad` / `loss`, `evolve({makePop,X,T,maxK,margin})` (grow the form by success, utility-gated),
  `bakePopulation(pop, theta)` → `{conceptTree, providers}` (serve a frozen population as real engine
  concepts), `unrollPopulation(pop, N)` → `{pop, tieTheta, readout}` (serve a *cyclic* population by
  unrolling its fixpoint to depth N; a direct cyclic bake deadlocks).
- **`lifecycle.js`** — the plasticity ledger: `createLifecycle()` → `register` / `record(name, ok)` /
  `plasticity(name)` (the unified knob `p∈[0,1]`) / `regime(name)` / `reputation(name)`. Thread
  `plasticity` into `createLLMProvider({ ask, plasticity })` (→ temperature) or `createNet(net,
  { plasticity })` (→ STE exploration noise) so `p=1` explores / `p=0` serves deterministically.

### Studio (embeddable web workbench)

`const server = Graph.createStudioServer({ Graph, root, ask, logger })` — an http+ws server over a
registry of live `Graph` sessions, driving a no-build React UI. Wire ops (`lib/studio/protocol.js`):
`grammarGraph` · `corpusManifest` · `exportCorpus` / `importCorpus` (`.sgc`) · `providerTrace` ·
`mergePreview` · `forkPlan` · `fork`/`merge`/`selectSession` · `mutate`/`run`/`state` ·
`revisions`/`snapshot`/`rollback`/`diff` · `validateConcept`/`patchConcept`/`addConcept` · `prompt`.
Events include a Session-derived `retract` (the red-flash signal). Also via `bin/sg studio`.

## Logging & diagnostics

One logger per graph (`graph._log`, exposed as `graph.logger`). Levels, severity descending:
`error > warn > log > info > verbose` — a record reaches sinks iff `rank(level) <= rank(threshold)`
(default `warn`, or env `SG_LOG_LEVEL`). A `LogRecord` is `{ level, ts, label, ctx, msg, args }` and is
JSON-serializable (Errors in `args` are reduced to `{name,message,stack}`).

**Configure** (in `cfg`, e.g. via `new Graph(seed, conf, conceptMap)` or `Graph.fromDirs({conf})`):

| key | meaning |
|---|---|
| `cfg.logger` | inject a logger instance (`Graph.createLogger(...)`); overrides the rest |
| `cfg.logLevel` | threshold name for the auto-built logger |
| `cfg.onLog(record)` | convenience sink fn |

**`graph.logger` interface** (the debugger/host hook):

| method | returns |
|---|---|
| `addSink(fn)` / `removeSink(fn)` | register/unregister `fn(record)` |
| `tail(n, filter?)` | last `n` records; `filter` = `{concept?, target?, applyId?, level?}` |
| `records` | the bounded ring buffer (default 500) |
| `setLevel(name)` / `level` | get/set the threshold |
| `child(ctx)` | a logger that merges `ctx` into every record |

**Provider logging contract** (no provider-signature change): inside a provider, reach a context logger via
`scope.log` (ctx `{target,type}`) or `concept.log(scope)` (ctx `{concept,target,type,applyId}`):

```js
function work ( graph, concept, scope, argz, cb ) {
  const log = concept.log(scope);          // capture early (freezes applyId for async)
  log.verbose('prompt', prompt);
  log.warn('input missing on %s', scope._._id);
  cb(null, { $_id: '_parent', Worked: true });
}
```

Each concept-apply mints `graph._applyId`, stamped into **both** the contextual logger and the
`cfg.onConceptApply` trace record. So the logs a concept produced *while applying* are retrievable with
`graph.logger.tail(n, { concept })` or `{ applyId }`, and join the trace by `applyId` — all **without
storing anything on the graph objects** (logs live in the logger, never as facts). For full history beyond
the bounded buffer, attach a sink (file/studio).

**CLI:** `sg run … [--log-level <lvl>] [--log-mode dashboard|plain] [--log-plain] [--log-file <path>]
[--log-file-level <lvl>]`. A styled boot banner prints at startup. `dashboard` = TTY mode where colored
logs scroll normally under a live **status bar pinned at the bottom** (graph state, unstable node/segment
counts, main-loop queue size, rev, applies, provider time, elapsed); degrades to plain off a TTY. `plain` =
line output (logs → stderr, run summary → stdout). `--log-file` writes `.jsonl` (machine-readable) or
formatted text. **Workers:** pass `logger` to `createGraphWorker`/`spawnGraph` and a dispatched graph's
log records re-emit into it, tagged `{worker:true}`.

`Graph.createLogger({ label, level, onRecord, capacity, console })` builds a logger standalone.

## Running in-repo

```bash
npm test                     # unit + integration (node:test, native CJS — no Babel)
node examples/run-basic.js   # non-LLM end-to-end stabilization over the real `common` set
node examples/run-problem.js # LLM-driven plan decomposition (needs an endpoint; see lib/providers/llm.js)
node bin/sg run --concepts ./concepts --builtins   # standalone CLI boot
```

The engine is native CommonJS and runs directly under Node (no build step; `tests/_boot.js` just sets
`__SERVER__`).
