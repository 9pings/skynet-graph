# Usage guide (Use 1 — the substrate)

> **R&D library.** Pure CommonJS, runs natively on Node 18+ — **no build step**. For the
> model see [architecture.md](architecture.md); for the concept schema see [original-2016-doc.md](original-2016-doc.md);
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
npm test           # 1350 tests — 0 failures, 2 known skips (node --test)
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
const { buildConceptTree } = Graph.authoring.concepts; // barrel; or require('skynet-graph/lib/authoring/core/concepts')
const conceptMap = { common: buildConceptTree('./concepts/common') };
Graph.register([{ CommonGeo: Graph.providers.CommonGeo }]); // wire providers
const g = new Graph(seed, { conceptSets: ['common'], autoMount: true }, conceptMap);
```

> **Authoring toolkit & plugin engines.** `Graph.authoring` namespaces the core toolkit (parity with
> `Graph.providers`), so you reach it without deep paths — e.g. `Graph.authoring.concepts.buildConceptTree`,
> `.validate`, `.contract`, `.method`, `.abstract`, `.corpusPack` (`lib/authoring/core/`, 27 modules, plus
> the `lattice/` vocabulary family). The capability-specific engines moved into their **plugins**: the
> DLL / creative-loop family (`crystallize`, `library` / `combinator` / `adapt` — the creative loop:
> dispatch → mount → **adapt-or-forge** → **antiUnify content-forge** → **blend** = combinational synthesis of a
> novel composite method, with a bounded `synthesizeByBlend`) lives in `plugins/learning/lib/`, and the
> plan-loop bricks — `dag-decompose` (the typed cutter prompt + archetype router), `context-project` (the bounded
> projection; `stratComplete` = the stratified CONTEXT/DONE/ROADMAP rendering), `givens` (the typed base-fact
> front door) and `leaf-io` (typed leaf output or a typed refusal) — in `plugins/planner/lib/`. Every module
> stays importable on its own (`require('skynet-graph/lib/authoring/core/<module>')`,
> `require('skynet-graph/plugins/learning/lib/<module>')`); the barrels are a convenience, not a gate. A runnable,
> offline end-to-end tour of the creative loop is `examples/creative-loop.js` (`node examples/creative-loop.js`);
> the example map is `examples/README.md`.

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
set. See [original-2016-doc.md](original-2016-doc.md) for every schema field.

> **Typed-fact discipline (do not break it).** A `require`/`assert`/`ensure` must key only
> on **discrete, typed** facts (enums, ids, numbers, booleans) — never on free-text prose,
> or the memo never hits. An `LLM::complete` concept writes canonicalized keys as tracked
> facts and the reply text on an *untracked* `prose` key. `lib/authoring/core/validate.js`
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
# the FORGE — dataset + executable oracle → certified .sgc method stock behind the zero-false-admission
# gate, with a sha256 validation dossier (the fuel of F1):
node bin/sg forge --adapter <adapter.js> --data <dir> --model <path.gguf> --out stock.sgc --dossier out/

sg proxy      # C6 one-shot/batch over the proxy cache        sg methods   # explore a stock's method classes
sg validate   # author-time grammar pre-flight on a concept dir (structure, not grammar)
sg plugin     # plugin tooling: list [dir] · validate <dir> · scaffold <name>   (see §10)
```

```bash
# boot a graph from folders and print the stabilized facts. A runnable seed ships in the repo
# (the Paris→Singapore/Versailles travel graph, the same one examples/run-basic.js builds inline):
node bin/sg run --concepts ./concepts/common --builtins --seed examples/seed-travel.json
#   -> stabilized: 5 object(s); long -> Distance/Travel/LongTravel, short -> Distance.inKm=18/ShortTravel

# the general form:
node bin/sg run --concepts ./concepts --builtins --seed <file.json> [--sets common]
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
  / `lib/authoring/core/corpus-pack.js` are the programmatic equivalents.
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
node examples/integrated-demo/run.js --replay   # the 4 capabilities assembled — 7 checks, deterministic, no GPU
node examples/run-basic.js     # non-LLM stabilization over the real `common` set
node examples/run-prompt.js    # decompose → synthesize vs a local LLM (set LLM_BASE), writes a trace
node examples/run-problem.js   # LLM-driven plan decomposition
node examples/poc/appliance-typed-qa.js              # the typed-QA appliance (C1), canned & deterministic
node examples/poc/appliance-typed-qa.js --local-model <gguf>   # …same, over a real embedded model
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

### Embedded inference (in-process, no external endpoint)

The library can run its small functional model(s) **itself** (a self-contained appliance) via the same
`ask` seam — `makeLocalAsk` is a drop-in `ask` backed by **node-llama-cpp** (native, GGUF, GPU auto-detected).
It's an **optional** native dep (not committed; installed on demand) and GGUF models live in the **gitignored**
`models/` dir:

```bash
npm run local-inference:setup                 # install the engine (node-llama-cpp) into node_modules
npm run local-inference:setup -- --turboquant # + guidance for the TheTom TurboQuant+ fork
# then drop a .gguf into models/ (or set LOCAL_MODEL / pass modelPath)
```

```js
const { register, createLLMProvider, makeLocalAsk } = require('skynet-graph/lib/providers');
register(Graph, [ createLLMProvider({ ask: makeLocalAsk({ modelPath: 'models/small.gguf' }) }) ]);
```

**Grammar-constrained decoding is format INSURANCE, not a quality lever** (measured: constrained decoding
*hurt* signature stability — the shipped posture keeps it OFF by default): pass `jsonSchema` (or `gbnf`) only
when a malformed typed fact is worse than a distorted one, e.g. as a last-resort parse backstop. The real K1
signature-stability lever is the strong prompt + the canonicalization barrier (`prompt.facts`).
Grammar guarantees valid *format*, not correct *content* — keep the C-contract/verify pass as the content check,
and reserve a bigger/remote model for the META/supervisor tier. Per-concept **multi-model** = one `makeLocalAsk`
per `namespace` (a specialist GGUF, or one base + a per-context LoRA). The no-build/browser sibling is `wllama`
(same GGUF, WASM, CPU-only — no GPU) — a future `makeWasmAsk`.

**Centralized host (GPU/VRAM + prompt cache).** Every `makeLocalAsk` is a thin handle over a **process-wide shared
host** (`createLocalModelHost`): N handles / namespaces of the *same* GGUF share **one** VRAM load, several
constrained grammars share that load (grammar is applied per-call), identical deterministic (temp-0) prompts are
served from an in-memory cache, and VRAM is bounded by **LRU eviction** — set `SG_LOCAL_VRAM_BUDGET_GB` /
`SG_LOCAL_MAX_MODELS`, or pass `opts.host = createLocalModelHost({ vramBudgetGB, maxModels, cacheSize })` for a
dedicated budget. (In-process analogue of a grant-based GPU orchestrator; the model loader is injectable, so the
registry/cache/eviction logic is unit-testable without a GPU.)

**Request/response (`sg ask`).** Two modes. **`sg ask "<q>" --concepts <dir> --local-model <gguf>`** is the
**typed QA appliance** (`Graph.factories.createAppliance`): the prose→typed front door → the packaged reason loop
over `concepts/_substrate` → a durable memo → a typed answer OR a **typed refusal that names the missing
requirement** — the product posture ON by default (fail-closed, memo ON, validator ON, constrained grammar
OFF). It follows the typed *spec* (refuse when the input isn't faithfully typed) rather than world-plausibility,
and a repeat question replays from the persisted sub-graph at **0 model calls**. Without `--concepts`, `sg ask`
runs the legacy best-effort decompose→synthesize loop (kept for compat). `--json` prints the structured result.

Programmatically:

```js
const Graph = require('skynet-graph');
const app = Graph.factories.createAppliance({ concepts: './concepts/mydomain', ask: { localModel: 'models/small.gguf' } });
const r = await app.answer('…');   // { status:'answered', answer, confBand } | { status:'refused', reason, missing:[…], prose }
```

The underlying bricks stay usable "à nu" — the appliance is a thin, optional assembly. `session.answer(text)`
(the legacy loop) resolves with `{answer, state}` and `Graph.settle(g)` is the promise-returning settle verb.

### Capability factories (`Graph.factories.*`) — thin, delivered assemblies over the bricks

Each factory composes existing bricks with the product posture ON by default (fail-closed, memo/store ON,
validator ON, constrained grammar OFF); none is a required path — the bricks stay usable "à nu". Most of
them ship from a **plugin** (§10): C2 durable, C3 learning, C7 planner, C8 mixture-serve and C9
critical-mind each export their factory from their plugin's `factory.js`, re-exported on this flat catalog;
C1 / C4 / C5 / C6 still live in `lib/factories/`.

```js
// C1 — typed-QA appliance (above): intake → reason-loop → typed refusal → memo.
const app = Graph.factories.createAppliance({ concepts: './concepts/mydomain', ask });

// C2 — durable workflow runner: a compact spec → a crash-safe, memoizing, auditable run.
const runner = Graph.factories.createDurableRunner({ store: 'flow.db', runTask });   // file → SQLite, else in-memory
await runner.run('run-1', spec, records);   // compile → ensureRun → inject → drain (task calls amortize)
await runner.resume('run-1', spec);          // crash-recovery: reclaim orphaned tokens → finish (exactly-once)
const { summary } = runner.audit('run-1');   // the derivation forest + verdict + blame

// C3 — learning method library: the always-on cost ladder + a persistent, shippable, LEARNING library.
const lib = Graph.factories.createLearningLibrary({ signature, forge, store: 'lib.json',
	learning: true, target, dispatchFacts });   // learning OPT-IN: the FORGE arm becomes dispatch→adapt→forge
await lib.solve(problem);   // MATCH→RETRIEVE→FORGE→ESCALATE; a warm class replays at 0 calls
lib.crystallizeFrom(mt.records, { episodeTree, schemaGraph });   // distill methods from a REAL trace → catalog
lib.drift(problem);         // a fallen premise → re-derive BOTH layers (exact cache + catalog template)
lib.blame({ contract, failedAtoms });   // localized per-slot blame (admissible iff ONE role) — credit() dual
const sgc = lib.pack({ name: 'methods', version: 'v1' });   // ship the warm library (version-gated)

// C4 — the reactive KG (the engine's original Use-1): a trivial preset over fromDirs (builtins ON).
const kg = Graph.factories.reactiveKG({ concepts: './concepts/common', seed });   // rule-KG + geo, usable à nu

// C5 — supervised self-modification (OPT-IN, guarded): edits the LIVE rules; rollbackTo is the guarantee.
const sm = Graph.factories.createSelfMod({ graph, propose });   // author() needs a proposer (the "judge")
await sm.author({ goal });          // CEGIS: propose→validate→install→test→refine
sm.rollbackTo(sm.revisions()[0]);   // reversibility — restore any prior coherent revision

// C6 — the local-first PROXY CACHE / DISTILLER (the main use case): a verified stock in front of a
// FRONTIER model. Covered → served local (0 frontier calls); miss → escalate + enrich; 0 hallucination.
const px = Graph.factories.createProxyCache({
	frontierAsk: Graph.factories.makeFrontierAsk(chatAsk),   // any ({system,user}) -> text backend = the truth
	store: './stock.json', retention: true,               // durable cross-restart + usage-tracked eviction
	...Graph.factories.makeLocalCoverage({ localAsk })       // opt-in: a small model snaps paraphrases to one key
});
const { answer, source } = await px.answer('What is the capital of France?');   // source: 'local'|'frontier'

// C7 — the hierarchical PLAN LOOP (the piece-by-piece zoom): a task longer than the context is decomposed
// into typed leaves, each served with ONLY a projected digest, rebalanced to a fixpoint, reassembly verified.
// decompose + serveLeaf are INJECTED (typed-loop + createProxyCache.solve in production) — usable "à nu".
const loop = Graph.factories.createPlanLoop({ decompose, serveLeaf });
const { answer: a7, refused } = await loop.run(task, { givens, labels: labelsOf(givens) });
// givens: plugins/planner/lib/givens.js#seedOf · labelsOf = the measured CELLS rule (label an input iff its
// provenance is a structured table cell — never prose, never producers)

// C8 — the MIXTURE-RUNTIME server: a cheap local model ORIENTED by a forged certified stock, escalating the
// rest to a bigger tier. NOTE: the runtime cross-agreement "trusted answers" tier documented in its header was
// REFUTED at scale — keep the fail-closed default (nothing auto-trusted); orientation lifts the score only.
const mx = Graph.factories.createMixtureServe({ certifiedShapes, small, big, proposeMenu });
// certifiedShapes is REQUIRED. Caution: injecting `predict` without `trust: () => false` re-enables the
// REFUTED cross-agreement default — keep fail-closed (nothing auto-trusted).

// C9 — the external CRITICAL MIND: declared viewpoints established through a witness gate over a statement
// pool, anchored generation of missing theses (0-fabrication measured), a typed LEDGER as the deliverable,
// and a certification-aware verdict — mechanical only at the measured margin bound, else an honest UNDECIDED.
const cm = Graph.factories.createCriticalMind({ ask });
const r  = await cm.run({ topic, statements, viewpoints });   // frame FREE/MATERIAL/DECLARED, announced
```

## 10. Plugins — installable, droppable capabilities

A capability ships as a **plugin**: `{ sg-plugin.json manifest, concepts/<set>/ (grammar in files),
optional providers.js (Tier-1), optional factory.js (the packaged factory), index.js (the npm
auto-export) }`. The repo ships fifteen under `plugins/` — `reason-kernel` · `critical-mind` · the strategy pack
(`self-consistency` · `refinement` · `socratic` · `least-to-most` · `analogical` · `react-loop` ·
`tree-of-thoughts` · `mcts`) · `planner` · `learning` · `forge` · `durable` · `mixture-serve` —
and they are the pattern to copy; the full contract is **[plugins.md](plugins.md)**.

The strategy pack is worth its own page: a reasoning strategy here is a **concept set you deposit** on
`reason-kernel` (seven of the thirteen are Tier-0 — pure grammar, zero JS), so there is no strategy API to
call — the host writes typed facts, the graph decides, the host reads which gates opened. The framing, the
recipes (seed shape → the facts you write → the gates you read) and the honest scope are
**[strategies.md](strategies.md)**; one runnable, model-free file each lives in `examples/strategies/`.

```js
const Graph = require('skynet-graph');

// dev / in-tree: point the loader at plugin dirs — deps resolve as siblings in the same call
const cfg = Graph.plugins.loadPlugins(['./plugins/reason-kernel', './plugins/self-consistency']);

// npm: a published plugin's index.js exports its object — the host just requires it
// (inside the plugin: module.exports = Graph.definePlugin(__dirname, [require('reason-kernel')]))
const criticalMind = require('@scope/critical-mind');
const cfg2 = Graph.plugins.resolvePlugins([criticalMind]);   // flatten carried deps → dedup/topo/semver/namespace checks

// wire the resolved config exactly as a host does by hand:
Graph._providers = cfg.providers;
const g = new Graph(seed, { conceptSets: cfg.conceptSets, autoMount: true }, cfg.conceptMap);
```

```bash
sg plugin list [dir]              # enumerate a folder's plugins from their manifests (no code is run)
sg plugin validate <dir>          # load + lint ONE plugin: deps ⊆ package.json, grammar, derived cross-checks
sg plugin scaffold <name> [root]  # write a loadable Tier-0 skeleton package
```

Two trust tiers: **Tier-0** = grammar + `.sgc` only, no JS — safe by construction (the concept DSL is a
compiled expression evaluator: no I/O, no eval); **Tier-1** = JS providers/factories — trust required.
The discipline behind the split: **grammar always lives in files** under `concepts/<set>/`, never
hard-coded in JS, and a dependent keys on the fact names its dependency produces — the alphabet *is*
the API (freeze and version a kernel's alphabet early).

## 11. Serving surfaces — OpenAI-compatible endpoint & MCP tools

The library serves its main use cases over two ZERO-INTEGRATION surfaces (both thin assemblies over the
capability factories; both zero-dep):

```bash
# 1) sg serve — an OpenAI-COMPATIBLE endpoint over the C6 proxy. Point ANY OpenAI client's baseURL at it:
sg serve --frontier-model <path.gguf> --store ./stock.json            # → http://127.0.0.1:4747/v1
#   const client = new OpenAI({ baseURL: 'http://127.0.0.1:4747/v1', apiKey: 'sg-local' });
# A covered query is served from the verified local stock at 0 frontier calls; provenance rides EVERY
# completion (headers x-sg-served-from/-arm/-cost/-coverage/-saved/-sgc-version + usage.sg_*). stream:true is honored
# (simulated SSE). Add --studio to open the visual debugger on port+1 (live request lines in its trace
# panel); Ctrl-C prints the economy report.

# 2) sg mcp — the same capabilities as MCP TOOLS for an agent host (stdio JSON-RPC):
claude mcp add sg -- node bin/sg mcp --frontier-model <path.gguf> --store ./stock.json [--stock <f.sgc>]
# Base tools: ask (answer OR a STRUCTURED typed refusal naming the missing requirement), drift, metrics,
# lattice_load (learning through the version-gated admission — there is NO direct-write tool),
# methods_describe, lattice_rings, trace_tail (debug by applyId).
#
# The ASSISTANT lanes (--stock <f.sgc> wires hint/propose from a forged stock):
#   SOFT  — hint (the certified-shape menu, advisory) · state_recall / state_note (the certified task
#           state) · plan_sync (the graph plan mirrored onto the HOST's task list — REOPEN included)
#   HARD  — propose (gate-tested: admitted, or refused with the reason + gate-tested options;
#           force → recorded-untrusted, NEVER admission — the gate does not cede)
#   C9    — critique (the external critical mind: viewpoints + witness gate + anchored generation +
#           typed ledger + a verdict that is mechanical only at the measured margin, else UNDECIDED).
#           The result carries `brief` (the judgment dossier: theses + verbatim witnesses + attacks/
#           standing + open points + structural facts) and a self-contained `judgePrompt` the HOST runs
#           itself to render a justified decision with a certainty note — the engine guarantees the
#           arguments, weighing them is the judge's job, and the judge is the host model.
#           Iteration contract: OPEN points + UNDECIDED = a typed DATA REQUEST — the host gathers real
#           statements (web/docs) and re-calls critique with `statements` (the frame becomes MATERIAL);
#           to SPLIT a mixed question, re-call with per-dimension `viewpoints`, forwarding
#           `brief.carry.statements` so the same evidence re-gates under the new frame.
#   INSTANCES — graph_invoke / graph_instances.

# 2b) sg try — one-shot LIVE probe of an MCP tool feature (the SAME tool surface as sg mcp, no
#     JSON-RPC piping). Human summary → stderr, THE ARTIFACT → stdout (pipe-friendly); --json = full payload.
sg try critique --model ./models/model.gguf --prompt "Should we migrate to ESM?"
#     → stderr: frame/verdict/counts/margin + the typed advice · stdout: the judgePrompt — paste it
#       into YOUR model (the judge is the host). [--statements <file>] one "PRO: ..."/"CON: ..." line
#       per line (frame MATERIAL) · [--viewpoints "v1 | v2"] (DECLARED) · [--polish]
sg try sc --model ./models/model.gguf --prompt "17 x 23?" --k 5
#     → the self-consistency vote (verdict/consensus/votes/abstained). [--threshold N] [--temperature X]
#       [--max-tokens N]. Backends: --model <gguf>, or env FRONTIER_MODEL / LOCAL_MODEL / LLM_BASE.

# 3) sg flow run — a durable C2 workflow from a JS module (spec + tasks are code):
sg flow run examples/poc/durable-flow.js --store ./flow.sqlite        # --resume = exactly-once recovery
```

Runnable, deterministic, GPU-free demos of every capability and both surfaces live in `examples/bootstrap/`
(one file per use-case class, each printing the guarantee it demonstrates — run them with plain `node`), and
one per reasoning strategy in `examples/strategies/`. Both directories are executed by the test suite, and
every feature F1-F7 on the README maps to a file — the map is `examples/README.md`.
