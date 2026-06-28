# Usage guide (Use 1 — the substrate)

> **R&D library.** Pure CommonJS, runs natively on Node 18+ — **no build step**. For the
> model see [architecture.md](architecture.md); for the concept schema see [doc.md](doc.md);
> for the full API surface see [API.md](API.md). The **concept-organization strategy is
> still WIP** — treat `concepts/common/` as an example, not a recommended ontology.

> **Scope of this guide — Use 1, the substrate, standalone.** §1–§9 below cover the foundational use:
> **authoring a concept grammar by hand** to model and enrich a domain, with deterministic
> providers and **no LLM required** (the geo `Distance` rule in §2/§3 is a complete worked
> example). This use stands on its own. The LLM-driven **Use 2** target system — concept-graphs as
> composable methods, forged / crystallized / reused on top, with a durable executor and a contract —
> is layered over exactly this substrate (**[concept-as-graph.md](concept-as-graph.md)**); it is
> additive, never a prerequisite for the above.

## 1. Install & load

```bash
npm install        # deps only; no compile
npm test           # 510 tests (node --test)
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

Key rules (hard-won):

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

Both graph-running commands — `sg run` and `sg studio` — print the boot banner and stream the
engine's logs. Both default to the **dashboard** on a TTY (a fixed bottom status bar over scrolling
colored logs — stats live only in the bar) and fall back to **plain / log-only** off a TTY or with
`--log-plain` (no bar; the stats are emitted as periodic log lines instead). For `sg studio` the bar
reflects the **active session's** graph (root, a fork, or the selected session). The
`trace`/`show`/`concepts`/`errors` commands only inspect a saved artifact — there is no live graph, so
they print their data directly with no engine logs. `sg studio` also accepts `--log-level`/`--log-file`.

`sg run` takes the full set of logging flags:

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

### The Studio (`sg studio`) — the web inspector & console

A browser front-end for the engine: a registry of live `Graph` sessions (a root + a tree of
forks) over WebSocket, with a no-build React UI.

```bash
node bin/sg studio [--root <dir>] [--port 4848] [--open] [--log-level <lvl>] [--log-file <path>]
# corpora are auto-discovered under --root (default cwd); the prompt console uses LLM_BASE if set
```

It visualizes and drives the full V1 API: the **graph canvas** (cast-concept flags on each edge,
a pulse on the target of the most recent `conceptApply`), the **concept tree** + a live **editor**
(edit → validate → patch), the **fork tree** (fork / switch / merge), the **revision timeline**
(rollback / diff), and a **prompt console** (the decompose → synthesize loop). The
`forkPlan` op exposes the tree-decomposition **tiling** (separators + tiles + frontier alphabets)
of the active corpus. The engine core stays fs-free — all fs/serving lives in `lib/studio`.

#### Grammar workbench & corpus exchange

A **data / grammar** view toggle in the toolbar switches the centre canvas between the *instance*
graph (the running objects, above) and the **grammar graph** — the second, orthogonal view of a
corpus: its **concepts ↔ facts** flux graph. A concept *writes* facts (green edges = self-flag +
`applyMutations` keys) and *reads* them (blue = positive support, **red dashed = a negated /
defeasance dependency**); separator facts (the narrow waist) are gold diamonds, external **entry
points** are hollow, and concepts are coloured by their set. The side panel surfaces the derived
**manifest** (the produces/consumes alphabet, the required providers), the **cross-corpus links**
(a fact one set produces and another consumes) and any silent **fact collisions** (a fact two sets
both write — the `leadTime` trap). This is the view for perfecting *grammars and their interactions*.

- **Corpus exchange (`.sgc`)** — *export .sgc* packs the live corpus (reflecting runtime
  add/patchConcept edits) into a portable single-file bundle `{ manifest, conceptMap, seed? }`;
  *import .sgc* validates it on load (hard errors block, warnings surface) and runs it. The on-disk
  JSONC tree stays canonical for editing; `Graph.exportConcepts()` + `lib/load.js#exportConceptsToDir`
  / `lib/authoring/corpus-pack.js` are the programmatic equivalents.
- **Provider trace** — the apply-correlated log records (`graph.logger.tail(n, { applyId })`) for the
  active session, joining each apply's provider calls to its trace.
- **Retraction flash** — when a concept is *retracted* (JTMS defeasance / cascade), the affected
  object flashes red on the canvas. The Studio derives this from the state diff (no engine change)
  and emits a `retract` event.
- **Sub-graph split** — with a fork selected, *split* shows the parent and the fork side by side and
  previews the **merge projection** (`validateMergeProjection`): what crosses the frontier and any
  `frontier-leak` (a fact not in the declared alphabet) — before you merge.

New ops: `grammarGraph`, `corpusManifest`, `exportCorpus`, `importCorpus`, `providerTrace`,
`mergePreview`; new event: `retract`.

Embeddable as a library (not only via the CLI):

```js
const Graph  = require('skynet-graph');
const server = Graph.createStudioServer({ Graph, root: './', ask: myLLM, logger });
```

The wire contract is `lib/studio/protocol.js` (`OPS` client→server, `EVENTS` server→client). The
browser pulls React/cytoscape from a CDN (esm.sh) — vendor them for an offline / air-gapped demo.

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

### LLM backend (`ask`)

The packaged `LLM::complete` provider is backend-agnostic — a host injects an async
`ask({system,user,maxTokens})`. The bundled `makeAsk(opts)` dispatches on the API flavour
(`opts.api` or env `LLM_API`):

- **`anthropic`** (default) — `POST <LLM_BASE>/v1/messages` (default base `:3000`).
- **`openai`** — `POST <LLM_BASE>/v1/chat/completions` (vLLM / llama.cpp / LM Studio / any
  OpenAI-compatible server). Reads `choices[0].message.content`, and for **reasoning models**
  that return an empty `content` plus a separate `reasoning_content`, falls back to the latter.

```bash
LLM_API=openai LLM_BASE=http://localhost:5000 LLM_MODEL=my-model node examples/run-prompt.js
```

Env: `LLM_API` · `LLM_BASE` · `LLM_MODEL` · `LLM_KEY`. `makeOpenAIAsk` / `makeAnthropicAsk` are
exported directly too. A live end-to-end check of the canonicalization barrier against a real model
is the gated test `tests/integration/llm-live.test.js` (`LLM_LIVE=1`).
