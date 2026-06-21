# Skynet-Graph — Public API

The stable surface of the engine as of the V1 "MOE Graph" Phase-0 work. Skynet-graph is a
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
| `graph.rollbackTo(rev)` | re-mount that snapshot, drop later ones (linear undo), re-stabilize |

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
  any `ask({system,user,maxTokens})`; the bundled `makeAsk()` is an Anthropic-style default
  (configurable via `LLM_BASE`/`LLM_MODEL`/`LLM_KEY` or `{ base, model, key }`).

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

## Running in-repo

```bash
npm test                 # unit + integration (node:test)
node _lab/run-basic.js   # non-LLM end-to-end stabilization over the real `common` set
node _lab/run-problem.js # LLM-driven plan decomposition (needs an endpoint; see providers/llm.js)
```

The engine loads under Node via `_lab/_boot.js` (`@babel/register`). The production `npm run build`
(lpack) currently fails on a host `require('App/db')` and is unrelated to the above.
