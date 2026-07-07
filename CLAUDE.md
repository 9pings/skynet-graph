# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Skynet-graph is a **library** to embed (and a standalone `sg` CLI), not a ready-to-run product (see `README.md`). It is a rule-driven knowledge graph engine: data objects (nodes, segments, documents) are automatically enriched by a **concept system** — a grammar-like rule engine that casts transformations onto objects when conditions are met and uncasts them when they are not. A host application embeds the engine, supplies the concept definitions, and wires up provider functions.

## Commands

**No build step.** The library is pure CommonJS and runs natively on Node 18+ (`npm install` fetches deps only — layer-pack/Babel/React were removed during industrialization). The package `main` is `lib/index.js` (a facade exposing the `Graph` constructor + `fromDirs` / `loadConceptMap` / `loadProviders` / `createGraphWorker` / `spawnGraph` statics); the engine entry is `lib/graph/index.js`, which re-exports `lib/graph/Graph.js`.

**Tests:**
- `npm test` runs the suite via Node's built-in runner (`node --test --test-force-exit tests/unit/*.test.js tests/integration/*.test.js`), 1130+ tests. Unit tests (`tests/unit/`) are pure; integration tests (`tests/integration/`) load the engine via `tests/_boot.js` (which sets `__SERVER__` and requires the engine — **no Babel**; the source is native CommonJS).
- `--test-force-exit` is required (the engine keeps timers/scheduler handles open). Side effect: the **aggregate** test COUNT can race-undercount across files — tests still all pass; re-run a single file for a deterministic count.
- `lib/authoring/concepts.js#buildConceptTree(dir)` builds a concept tree from `concepts/<set>/`; or use `Graph.fromDirs({concepts})` / `Graph.loadConceptMap(dir)`. The host passes `{ common: tree }` as `conceptMap` to `new Graph(...)`.
- Standalone: `node bin/sg run --concepts ./concepts --builtins`. Demos: `node examples/run-basic.js` (non-LLM stabilization over the real `common` set) and `node examples/run-problem.js` (LLM-driven plan decomposition; needs an endpoint — see `lib/providers/llm.js`).
- Ignore `tests/Graph.test.js` — dead legacy (requires modules that don't exist here).

## Architecture

### Core objects (`lib/graph/objects/`)

- **Entity.js** — Base class for all graph objects. Manages concept casting/uncasting, watchers, and cross-object references. Every graph object wraps an Entity, reached via `obj._etty`; the raw serialized data is `_etty._`.
- **Node.js** — Graph vertex. Tracks `_incoming` / `_outgoing` segments.
- **Segment.js** — Directed edge between two nodes (`originNode` → `targetNode`).
- **Concept.js** — A single rule. See "Concept rules" below.
- **PathMap.js** — Path discovery, selection, and traversal over results from `Graph.getPaths`.

### Graph engine (`lib/graph/Graph.js`)

The central engine owns every object (`_objById`), the concept registry (`_conceptLib`), and revision history (`_revs`). It is constructed as `new Graph(record, conf, conceptMap)`:
- `record` is either a serialized graph or `{graph: "<json string>"}`.
- `conf` overrides `Graph.prototype.cfg` (label, `autoMount`, `isMaster`, `conceptSets`, `defaultContext`, sync callbacks, `bagRefManagers`).
- `conceptMap` is supplied **by the host app**, keyed by concept-set name; `cfg.conceptSets` (default `["common"]`) selects which sets are `deepmerge`d into the active concept tree. This repo only ships the `common` set under `concepts/`.

**Stabilization** is the heart of the engine. A vendored zero-dep `TaskFlow` (`lib/graph/tasks/taskflow.js`) runs `lib/graph/tasks/stabilize.js` in a loop (`_loopTF`) that keeps applying applicable concepts to `_unstable` objects until nothing more can fire, then calls `_applyStabilized` (which fires the `stabilize` event and `cfg.onStabilize`). Mutations destabilize objects; stabilization re-casts/uncasts concepts; repeat until fixpoint.

**Mutations** (`pushMutation`) apply a template that creates or updates objects and marks them unstable. **Atomic updates + revisions** (`pushAtomicUpdates`, `_rev`, `_revs`) support master/client sync: when `cfg.isMaster` is false, mutations are forwarded to the master via `cfg.pushToMaster` and applied results stream back. `serialize()` produces a JSON snapshot.

**V1 "MOE" public API** (added on `feat/moe-graph-v1-phase0`; full reference in `doc/API.md`): `rollbackTo(rev)` / `getRevisions()` / `getSnapshot(rev)` / `diffRevisions(a,b)` (revision history — snapshots captured on each stabilize); `fork(seed,conf)` / `merge(child,targetId,project)` (sub-agent sub-graphs); `patchConcept(nameOrId,updates)` / `getConceptByName` (hot-patch an expert + re-evaluate). To update an existing object via a template, use `$$_id` (a plain `_id` creates a new object).

### Library surface (facade, CLI, runtime)

Beyond the engine core (`lib/graph/`, filesystem-free), the package ships:
- **`lib/index.js`** — the facade: `require('skynet-graph')` returns `Graph` with `fromDirs` / `loadConceptMap` / `loadProviders` / `register` / `providers` / `createGraphWorker` / `spawnGraph` / `createLogger` attached as statics. `Graph.fromDirs({concepts, providers, builtins, seed, conf})` boots a stabilizing graph from plain folders.
- **`lib/graph/log.js`** — the logger core (fs-free, lives in the engine): `createLogger`, five levels `error>warn>log>info>verbose`, `child(ctx)`, sinks, a bounded ring buffer.
- **`lib/load.js`** — directory loaders (`loadConceptMap`, `loadProviders`); kept out of the engine so the core stays fs-free.
- **`lib/providers/`** — packaged providers (`geo`, `llm`, `canonicalize`, `verify`) + `register`.
- **`lib/authoring/`** — `concepts.js` (tree builder), `validate.js` (author-time validator), `author.js` (CEGIS), `supervise.js`, `loop.js`, `clock.js` (R&D tooling).
- **`lib/sg/` + `bin/sg`** — the CLI: `sg run --concepts <dir> [--providers <dir>] [--builtins] [--seed f] [--trace out]`, the trace inspector (`trace`/`show`/`concepts`/`errors`), `sg ask` (typed appliance), `sg proxy` (C6 one-shot/batch), `sg methods` (explorer), `sg studio` (web inspector), plus the **serving surfaces**: `sg serve` (OpenAI-compatible endpoint over the C6 proxy — `lib/sg/serve.js`, pure handler + zero-dep http; provenance headers `x-sg-*`; `--studio` attaches the visual debugger on port+1), `sg mcp` (MCP tools server, stdio JSON-RPC — `lib/sg/mcp.js`; ask returns a STRUCTURED typed refusal; `lattice_load` = learning through the gate; no direct-write tool), and `sg flow run <module.js>` (the C2 durable runner as a CLI).
- **`lib/combos/`** — the six thin assemblies (`createAppliance` C1, `createDurableRunner` C2, `createLearningLibrary` C3, `reactiveKG` C4, `createSelfMod` C5, `createProxyCache` C6 + `makeFrontierAsk`/`makeLocalCoverage`/`makeTypedIntakeKey`), reached via `Graph.combos.*`.
- **`lib/studio/`** — the web Studio (server/session/UI): canvas, timeline/rollback, concept editor, grammar view, forks/merge, provider trace, and the **LearningPanel** (the typed lattice registry: declare vocab, propose alias THROUGH `mergeRingProposals`, retract, `.sgc` lattice import/export). Headless smoke: `npm run test:studio` (puppeteer devDep).
- **`lib/runtime/`** — distributed sub-graphs over `worker_threads` + a socket transport (`transport-socket.js`): `createGraphWorker` / `spawnGraph` ship a JSON conceptMap + seed + provider-dir to a worker and proxy a parent-bound model `ask` back over the channel. The protocol is plain-JSON (`protocol.js`), transport-agnostic.
- **`examples/`** — runnable demos (`run-basic`, `run-prompt`, `run-problem`) + **`examples/bootstrap/`** (one deterministic, GPU-free file per combo/surface, each printing the guarantee it demonstrates; executed by the suite via `bootstrap-smoke.test.js`).

### Logging (`lib/graph/log.js` + `lib/sg/log-sinks.js`)

The engine uses **one logger per graph** (`graph._log`, exposed as `graph.logger`); the old `var debug = console` indirection now routes there. Levels, severity descending: `error > warn > log > info > verbose` (emit iff `rank(level) <= rank(threshold)`; default `warn`, or env `SG_LOG_LEVEL`). A host configures it via `cfg.logger` (inject your own), `cfg.logLevel`, or `cfg.onLog(record)`.

- **Debugger/host interface:** `graph.logger.addSink(fn)` / `removeSink` / `tail(n, {concept|target|applyId|level})` / `records` / `setLevel`. Logs live in the logger (bounded ring buffer + sinks) — **never as facts on the graph objects**.
- **Provider access (no signature change):** a provider reaches a context logger via `scope.log` (ctx `{target,type}`) or `concept.log(scope)` (ctx `{concept,target,type,applyId}`, apply-correlated). Each apply mints `graph._applyId`, stamped into both the contextual logger and the `cfg.onConceptApply` trace record, so an apply's logs are retrievable with `graph.logger.tail(n,{applyId})` and join the trace by `applyId`.
- **CLI:** `sg run … [--log-level <lvl>] [--log-mode dashboard|plain] [--log-plain] [--log-file <path>] [--log-file-level <lvl>]`. A styled boot banner (`SKYNET·GRAPH v<version>`) prints at startup. `dashboard` (TTY) = normal **colored logs scrolling** with a live **status bar pinned at the bottom** (graph state stable/stabilizing, unstable node/segment counts, main-loop queue size, rev, applies, provider time, elapsed) via a zero-dep DECSTBM scroll region; degrades to plain off a TTY. `plain` is line-oriented (logs → stderr, summary → stdout). `--log-file` writes `.jsonl` (machine) or formatted text. Sinks live in `lib/sg/` (the engine core stays fs-free).
- **Workers:** a dispatched graph's logs are forwarded to the parent — pass `logger` to `createGraphWorker`/`spawnGraph` and worker records re-emit into it, tagged `{worker:true}`.

### Concept rules (`concepts/common/`)

Concept definitions are **JSONC** (JSON with `//` comments) — do not parse them as strict JSON. Files form a hierarchy via `childConcepts`; `Vertice.json` and `Edge.json` are the entry points for nodes and segments, and subdirectories specialize them (`Edge/Distance.json`, `Edge/Travel/*`, `Edge/Stay/*`, `Document/*`).

A concept's schema fields (handled in `Concept.js`):
- `require` — preconditions that must resolve before the concept is even considered. Unresolved requires register a watcher (`getRef(..., follow=true)`) so the object is retested when the referenced value appears. This is distinct from `assert`.
- `assert` / `ensure` — boolean expressions (joined with `&&`) compiled into `_assertTest`. Determines applicability once requires are satisfied.
- `provider` — `"Namespace::fn"` (optionally an array `["ns::fn", ...args]`). Looked up in `Graph.static._providers`. The core does **not** auto-wire providers (host opt-in): use the packaged `providers/` — `register(Graph, [{ CommonGeo }, createLLMProvider({ ask })])` — or set `Graph._providers` directly. A concept whose provider is missing/unwired silently falls back to flagging itself `true`. Provider fn signature: `(graph, concept, scope, argz, cb)`, `cb(err, mutationTemplate)`. **GOTCHA (bites every time — a wired provider does NOT auto-flag the concept cast):** when a provider IS wired and returns a mutation, the engine applies that mutation but does **not** set the concept's `_name` fact for you (`Concept.js`:213-229 — the auto-flag is only the *no-provider* fallback). So the returned template **must set its own cast marker** (e.g. `{ $_id:'_parent', <ConceptName>:true }`, like `concepts`-style providers / the `plan` provider's `Split:true`), otherwise the concept stays applicable-but-not-cast and **re-fires every stabilize pass until the apply-cap (1000) trips `divergent`**. A separate boolean (e.g. `Decomposed:true`) is then your re-fire guard, distinct from the `_name` marker.
- `applyMutations` — a mutation template applied when the concept casts.
- `type: "enum"`, `defaultValue`, `autoCast: false`, `syncAfter` — control casting behavior (`autoCast:false` opts out of automatic casting; `syncAfter` is currently a no-op stub).

**Typed-fact discipline (the canonicalization barrier — never break it).** A `require`/`ensure`/`assert` must key only on **discrete, typed** facts (enums, ids, numbers, booleans), never on free-text **prose** — a prose dependency re-keys every run, so the memo never hits (risk K1). An `LLM::complete` concept that feeds downstream declares a `prompt.facts` schema: the provider writes only those canonicalized (enum-snapped / grain-rounded) keys as *tracked* facts, the reply text on an *untracked* `prose` key, and a stable `<name>FactsDigest`. `lib/authoring/validate.js#validateConceptTree` enforces this at author time (rejects prose-on-dependency-edges, missing `_name`, unparseable exprs; validates **structure, not grammar**). See `doc/API.md` (the `facts`/`prose` contract) and `doc/MODELISATION.md` §4.2.

### Two embedded DSLs

The same `$`-prefixed reference syntax appears in mutation templates and in query/assert strings.

**Reference paths** (resolved by `Graph.getRef`, used in templates and refs):
- `$key` — global reference into a named scope/object by id.
- `a:b:c` — walk references across linked objects (e.g. `_parent:originNode`).
- `_parent` — the mutation's target object; aliases declared in a template resolve within it.
- In templates: `$_id` sets/derives the object id from a ref, `$$_id` forces a literal id, `$someKey` makes `someKey` a reference, `$$someKey` marks a **bagRef** (external data, see below), and `_incoming`/`_outgoing` nest child segments. See the worked airport example in the `lib/graph/Graph.js` header comment.

**Query / assert expressions** (`queryMaps`, `getChildMatching`, `_assertTest`): a string or array of strings where `$ref` tokens resolve via `scope.getRef("ref")` and are `&&`-joined, then compiled by **`lib/graph/expr.js`** — a safe jsep-based evaluator (no `new Function`/eval; `constructor`/`__proto__`/`prototype` access blocked). Example: `"$Distance.inKm!=0"`.

**bagRefs** are references to data living outside the graph (e.g. a DB record). They match `cfg.bagRefManagers[*].test` (default manager `caipi` matches `/^db:(.+)$/`) and are loaded asynchronously via `_preloadBagRefs` before mutations using them complete.

### No build system

Native CommonJS — **no bundler/transpiler** (layer-pack, Babel, React were removed during industrialization). `node lib/...` and `node --test` run the source directly (real line numbers when debugging). The only runtime global is `__SERVER__` (true=node / false=browser), defaulted to server at the engine entry (`lib/graph/index.js`) so the lib loads standalone. An optional single-file esbuild bundle can be added on demand but is not required.

## Reference docs

Start with the root `README.md`, then `doc/architecture.md` (how it works + vision + honest limits) and `doc/usage.md` (practical guide: `fromDirs`, concept sets, providers, the `sg` CLI, distributed exec). `doc/API.md` is the public API reference; `doc/doc.md` (French) is the full concept-schema specification; `doc/MODELISATION.md` is the model + roadmap. The R&D working trail — critical studies, ideation, plans, and the live `HANDOFF.md` ledger — lives under `doc/WIP/`.
