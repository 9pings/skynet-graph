# Usage guide

> **R&D library.** Pure CommonJS, runs natively on Node 18+ — **no build step**. For the
> model see [architecture.md](architecture.md); for the concept schema see [doc.md](doc.md);
> for the full API surface see [API.md](API.md). The **concept-organization strategy is
> still WIP** — treat `concepts/common/` as an example, not a recommended ontology.

## 1. Install & load

```bash
npm install        # deps only; no compile
npm test           # 111 tests (node --test)
```

```js
const Graph = require('skynet-graph');   // the Graph constructor, with statics attached
```

The engine core (`lib/graph`) is filesystem-free. The package facade (`lib/index.js`)
adds the standalone helpers below as statics on `Graph`.

## 2. Boot from directories (the easy path)

`Graph.fromDirs` loads concept sets + providers from plain folders, registers them, and
returns a stabilizing graph.

```js
const g = Graph.fromDirs({
  concepts : './concepts',     // dir of set sub-dirs, or a single set dir (auto-detected)
  providers: './my-providers', // dir of provider modules (optional)
  builtins : true,             // also wire the packaged Geo + default LLM providers
  seed     : { conceptMaps: [  // initial objects (or a path to a JSON snapshot)
    { _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },
    { _id: 'b', Node: true, Position: { lat: 1.35,  lng: 103.8 } },
    { _id: 's', Segment: true, originNode: 'a', targetNode: 'b' }
  ]},
  conf: {
    onStabilize(graph) {
      const objs = JSON.parse(graph.serialize().graph).conceptMaps;
      // ... read stabilized facts; e.g. the segment now has Distance {inKm: 10728}
    }
  }
});
```

`conf.conceptSets` defaults to every set found under `concepts`. Options: `concepts`,
`providers`, `providerCtx` (passed to provider factory modules), `builtins`, `seed`,
`conf`, or a pre-built `conceptMap`.

### The low-level constructor

`fromDirs` is sugar over `new Graph(record, conf, conceptMap)`:

```js
const { buildConceptTree } = require('skynet-graph/lib/authoring/concepts');
const conceptMap = { common: buildConceptTree('./concepts/common') };
Graph.register([{ CommonGeo: Graph.providers.CommonGeo }]); // wire providers
const g = new Graph(seed, { conceptSets: ['common'], autoMount: true }, conceptMap);
```

## 3. Concept sets

A **set** is a directory of `*.json` concept files; sub-directories specialize a concept
via `childConcepts` (the dir name = the parent's child key). Engine invariants the loader
honors: a child's key **must** equal its `_id`; `_id` is globally unique; `_name` is the
flag written on entities (defaults to the file basename).

```
concepts/common/
  Vertice.json            # entry for nodes
  Edge.json               # entry for segments
  Edge/Distance.json      # specializes Edge: require both Positions -> CommonGeo::Distance
  Edge/Travel/...         # deeper specializations
```

`Graph.loadConceptMap('./concepts')` auto-detects: a dir with top-level `*.json` is a
single set (named by its basename); otherwise each immediate sub-dir holding `*.json` is a
set. See [doc.md](doc.md) for every schema field.

> **Typed-fact discipline (do not break it).** A `require`/`assert`/`ensure` must key only
> on **discrete, typed** facts (enums, ids, numbers, booleans) — never on free-text prose,
> or the memo never hits. An `LLM::complete` concept writes canonicalized keys as tracked
> facts and the reply text on an *untracked* `prose` key. `lib/authoring/validate.js`
> enforces this at author time.

## 4. Providers

Providers do effectful work; the engine never auto-wires them (host opt-in). A provider fn
is `(graph, concept, scope, argz, cb)` calling `cb(err, mutationTemplate)`.

```js
const { register, CommonGeo, createLLMProvider } = require('skynet-graph/lib/providers');
register(Graph, [
  { CommonGeo },                                  // packaged great-circle distance
  createLLMProvider({ ask: myModelBackend })      // backend-agnostic LLM::complete
]);
```

**Load from a directory.** A provider module exports a fragment `{ Namespace: { fn } }`, or
`{ default: fragment }`, or a **factory** `(ctx) => fragment` so it can self-configure from
`ctx` (e.g. an `ask` backend or env):

```js
// my-providers/remote.js
module.exports = (ctx) => ({
  Remote: { work(graph, concept, scope, argz, cb) {
    Promise.resolve(ctx.ask({ q: 'work' })).then(r => cb(null, { $_id: '_parent', Remote: true, work: r }));
  } }
});
```

```js
Graph.register(Graph.loadProviders('./my-providers', { ask: myModelBackend }));
```

## 5. Mutations & lifecycle

```js
g.pushMutation(template, targetId);   // create/update objects, mark unstable
```

Key rules (hard-won — see `doc/WIP/HANDOFF.md` §3):

- **A concept must self-flag** with its own `_name` (e.g. write `Distance: true` /
  `{$_id:'_parent', <Name>: true}`) or it re-fires forever.
- **`$$_id` updates** an existing object (literal id); a plain `_id` creates a new one.
- **Arrays replace on update** — for race-free fan-in use the `{__push: x}` primitive.
- **Global node refs need double-`$`**: `$$clock:tick`, `$$budget:spent.length`.
- **`assert` vs `ensure`:** completion-gating / reactive re-test → `ensure`; budget /
  "don't undo work already done" → `assert`.
- **`onStabilize` is a settle-hook** — it fires only after something actually wrote and the
  graph then settled; a no-op never settles.

## 6. History, fork, rollback, patch

```js
g.getRevisions();              // revision list
g.getSnapshot(rev);            // serialized state at rev
g.diffRevisions(a, b);         // structural diff
g.rollbackTo(rev);             // restore data AND rules to rev (defers if mid-stabilize)

const child = g.fork(seed, { reintegrateInto: targetId, project });  // sub-agent sub-graph
g.merge(child, targetId, project);                                   // bring results back

g.patchConcept(nameOrId, updates);     // hot-patch an expert + re-evaluate the frontier
g.addConcept(parentNameOrId, schema);  // author a new expert live
g.getConceptByName(name);
```

See [API.md](API.md) for exact signatures and semantics.

## 7. The `sg` CLI

```bash
# boot a graph from folders and print the stabilized facts:
node bin/sg run --concepts ./concepts --builtins --seed ./seed.json [--sets common]
                [--providers ./my-providers] [--trace out.json] [--json] [--timeout 8000]

# inspect a trace artifact (written by --trace, or by lib/sg/trace.js):
node bin/sg trace    out.json        # list every concept-apply (rev, concept, target, ms)
node bin/sg show     out.json 3      # full detail of record 3 (prompt / reply / patch / why)
node bin/sg concepts out.json        # per-concept rollup (count + total ms), heaviest first
node bin/sg errors   out.json        # applies whose patch flagged an llmError
```

### Logging

`sg run` also takes logging flags:

```bash
node bin/sg run --concepts ./concepts --builtins \
                --log-level info          # error|warn|log|info|verbose (default info)
                --log-mode dashboard      # dashboard | plain (default: dashboard on a TTY, else plain)
                --log-file run.jsonl      # journal (.jsonl = machine-readable, else formatted text)
                --log-file-level verbose  # separate level for the file (default verbose)
```

A styled banner (`SKYNET·GRAPH v<version>`) prints at boot.

- **dashboard** — on a TTY: normal **colored logs scroll** as usual, with a live **status bar pinned at
  the bottom** showing the graph state (`stable`/`stabilizing`), the unstable node/segment counts, the
  main-loop queue size, current rev, applies, provider time and elapsed. Degrades to plain off a TTY.
- **plain** (`--log-plain`) — one clean line per record, no cursor control; logs go to **stderr** so the
  stabilized-facts summary on **stdout** stays pipeable.

Programmatically, every graph exposes `graph.logger` (`addSink`/`tail(n, {concept|applyId})`/`setLevel`);
providers log with context via `scope.log` / `concept.log(scope)`. See `doc/API.md` → *Logging & diagnostics*.

With `package.json` `bin`, this is also available as `sg …` once installed.

## 8. Distributed execution

Stabilize sub-graphs in separate worker processes; dispatch graph parts to warm workers.

```js
// one-shot: spawn a worker, dispatch a seed, get the stabilized snapshot back:
const snapshot = await Graph.spawnGraph({
  conceptMap,                 // JSON concept map (or `concepts: <dir>` the worker can read)
  geo: true,                  // register the packaged Geo provider on the worker
  // llm: true,               // register the LLM provider wired to the proxied `ask`
  ask: myModelBackend,        // parent answers proxied model calls
  seed
});
const seg = JSON.parse(snapshot.graph).conceptMaps.find(o => o._id === 's');

// warm, reusable worker serving many independent dispatches:
const w = Graph.createGraphWorker({ conceptMap, geo: true, ask: myModelBackend });
const s1 = await w.dispatch(seedA);
const s2 = await w.dispatch(seedB);
w.terminate();
```

Only JSON crosses the boundary (`conceptMap`, `seed`, provider **dir paths**, the
serialized snapshot). In-memory provider closures are **not** shipped — load them on the
worker from a directory, and proxy a parent-bound model backend via `ask`. The protocol is
plain-JSON (`init` / `dispatch` / `ask` / `result`), so a cross-instance transport
(child_process IPC, or TCP/WebSocket to a waiting remote instance) can replace
`worker_threads` behind the same shape.

## 9. Examples

```bash
node examples/run-basic.js     # non-LLM stabilization over the real `common` set
node examples/run-prompt.js    # decompose → synthesize vs a local LLM (set LLM_BASE), writes a trace
node examples/run-problem.js   # LLM-driven plan decomposition
```
