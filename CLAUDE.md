# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Skynet-graph is a **library**, not a runnable app (`readme.md`: "not a ready to run instance"). It is a rule-driven knowledge graph engine: data objects (nodes, segments, documents) are automatically enriched by a **concept system** — a grammar-like rule engine that casts transformations onto objects when conditions are met and uncasts them when they are not. A host application embeds the engine, supplies the concept definitions, and wires up provider functions.

## Commands

**Build:**
```bash
npm run build        # production build via layer-pack (lpack) -> dist/
npm run devLib       # staging build in watch mode (lpack :staging -w)
```
Build output lands in `dist/` (gitignored). The package `main` is `dist/Comp.js`; the engine entry is `App/index.js`, which re-exports `App/Graph.js`.

**Tests:**
- `npm test` runs the suite via Node's built-in runner (`node --test --test-force-exit tests/unit/*.test.js tests/integration/*.test.js`). Unit tests (`tests/unit/`) are pure; integration tests (`tests/integration/`) load the engine via `_lab/_boot.js` (`@babel/register`).
- `--test-force-exit` is required (the engine keeps timers/taskflow handles open). Side effect: the **aggregate** test COUNT can race-undercount across files (e.g. 43 vs 49) — tests still all pass; re-run a single file to get a deterministic count.
- `_lab/concepts.js#buildConceptTree(dir)` builds a concept tree from `concepts/<set>/`; the host passes `{ common: tree }` as `conceptMap` to `new Graph(...)`.
- Lab demos: `node _lab/run-basic.js` (non-LLM stabilization over the real `common` set) and `node _lab/run-problem.js` (LLM-driven plan decomposition; needs an endpoint — see `providers/llm.js`).
- Ignore `tests/Graph.test.js` — dead legacy (requires `../dist/graph`, a `QueryBased` set and `CommonTravel`/`../TimingUtils` that don't exist here).

## Architecture

### Core objects (`App/objects/`)

- **Entity.js** — Base class for all graph objects. Manages concept casting/uncasting, watchers, and cross-object references. Every graph object wraps an Entity, reached via `obj._etty`; the raw serialized data is `_etty._`.
- **Node.js** — Graph vertex. Tracks `_incoming` / `_outgoing` segments.
- **Segment.js** — Directed edge between two nodes (`originNode` → `targetNode`).
- **Concept.js** — A single rule. See "Concept rules" below.
- **PathMap.js** — Path discovery, selection, and traversal over results from `Graph.getPaths`.

### Graph engine (`App/Graph.js`)

The central engine owns every object (`_objById`), the concept registry (`_conceptLib`), and revision history (`_revs`). It is constructed as `new Graph(record, conf, conceptMap)`:
- `record` is either a serialized graph or `{graph: "<json string>"}`.
- `conf` overrides `Graph.prototype.cfg` (label, `autoMount`, `isMaster`, `conceptSets`, `defaultContext`, sync callbacks, `bagRefManagers`).
- `conceptMap` is supplied **by the host app**, keyed by concept-set name; `cfg.conceptSets` (default `["common"]`) selects which sets are `deepmerge`d into the active concept tree. This repo only ships the `common` set under `concepts/`.

**Stabilization** is the heart of the engine. A `taskflows` TaskFlow runs `App/tasks/stabilize.js` in a loop (`_loopTF`) that keeps applying applicable concepts to `_unstable` objects until nothing more can fire, then calls `_applyStabilized` (which fires the `stabilize` event and `cfg.onStabilize`). Mutations destabilize objects; stabilization re-casts/uncasts concepts; repeat until fixpoint.

**Mutations** (`pushMutation`) apply a template that creates or updates objects and marks them unstable. **Atomic updates + revisions** (`pushAtomicUpdates`, `_rev`, `_revs`) support master/client sync: when `cfg.isMaster` is false, mutations are forwarded to the master via `cfg.pushToMaster` and applied results stream back. `serialize()` produces a JSON snapshot.

**V1 "MOE" public API** (added on `feat/moe-graph-v1-phase0`; full reference in `doc/API.md`): `rollbackTo(rev)` / `getRevisions()` / `getSnapshot(rev)` / `diffRevisions(a,b)` (revision history — snapshots captured on each stabilize); `fork(seed,conf)` / `merge(child,targetId,project)` (sub-agent sub-graphs); `patchConcept(nameOrId,updates)` / `getConceptByName` (hot-patch an expert + re-evaluate). To update an existing object via a template, use `$$_id` (a plain `_id` creates a new object).

### Concept rules (`concepts/common/`)

Concept definitions are **JSONC** (JSON with `//` comments) — do not parse them as strict JSON. Files form a hierarchy via `childConcepts`; `Vertice.json` and `Edge.json` are the entry points for nodes and segments, and subdirectories specialize them (`Edge/Distance.json`, `Edge/Travel/*`, `Edge/Stay/*`, `Document/*`).

A concept's schema fields (handled in `Concept.js`):
- `require` — preconditions that must resolve before the concept is even considered. Unresolved requires register a watcher (`getRef(..., follow=true)`) so the object is retested when the referenced value appears. This is distinct from `assert`.
- `assert` / `ensure` — boolean expressions (joined with `&&`) compiled into `_assertTest`. Determines applicability once requires are satisfied.
- `provider` — `"Namespace::fn"` (optionally an array `["ns::fn", ...args]`). Looked up in `Graph.static._providers`. The core does **not** auto-wire providers (host opt-in): use the packaged `providers/` — `register(Graph, [{ CommonGeo }, createLLMProvider({ ask })])` — or set `Graph._providers` directly. A concept whose provider is missing/unwired silently falls back to flagging itself `true`. Provider fn signature: `(graph, concept, scope, argz, cb)`, `cb(err, mutationTemplate)`.
- `applyMutations` — a mutation template applied when the concept casts.
- `type: "enum"`, `defaultValue`, `autoCast: false`, `syncAfter` — control casting behavior (`autoCast:false` opts out of automatic casting; `syncAfter` is currently a no-op stub).

### Two embedded DSLs

The same `$`-prefixed reference syntax appears in mutation templates and in query/assert strings.

**Reference paths** (resolved by `Graph.getRef`, used in templates and refs):
- `$key` — global reference into a named scope/object by id.
- `a:b:c` — walk references across linked objects (e.g. `_parent:originNode`).
- `_parent` — the mutation's target object; aliases declared in a template resolve within it.
- In templates: `$_id` sets/derives the object id from a ref, `$$_id` forces a literal id, `$someKey` makes `someKey` a reference, `$$someKey` marks a **bagRef** (external data, see below), and `_incoming`/`_outgoing` nest child segments. See the worked airport example in the `Graph.js` header comment.

**Query / assert expressions** (`queryMaps`, `getChildMatching`, `_assertTest`): a string or array of strings where `$ref` tokens resolve via `scope.getRef("ref")` and are `&&`-joined, then compiled by **`App/expr.js`** — a safe jsep-based evaluator (no `new Function`/eval; `constructor`/`__proto__`/`prototype` access blocked). Example: `"$Distance.inKm!=0"`.

**bagRefs** are references to data living outside the graph (e.g. a DB record). They match `cfg.bagRefManagers[*].test` (default manager `caipi` matches `/^db:(.+)$/`) and are loaded asynchronously via `_preloadBagRefs` before mutations using them complete.

### Build system

Uses **layer-pack** (`lpack`), configured in `.layers.json` with two profiles: `default` (production) and `staging` (dev/watch). Both root at `App`, alias the root to `Skynet`, extend `lpack-react`, and externalize peer deps (React 16.3+) rather than bundling them.

## Reference docs

`doc/API.md` is the public API reference (construction, lifecycle, mutations, history/rollback, fork/merge, patchConcept, providers). `doc/doc.md` (French) is the full concept-schema specification; `doc/analysis.md` holds supplementary analysis. Consult them for concept-definition details beyond the summary above.
