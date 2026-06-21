# Handoff — Skynet-Graph V1 "MOE" — Phase 0/1

**Date:** 2026-06-21 · **Branch:** `feat/moe-graph-v1-phase0` (off `master` @ `0e65ab4`)
**Status:** **53/53 tests green. Phase 0 + Phase 1 COMPLETE + Inspector v1 (concept-apply trace + `sg` CLI).**
All three headline differentiators (rollback, fork/merge, patchConcept) + base providers + API docs +
revision diff + production build fixed + the reasoning-loop tooling started.

**Active R&D direction (2026-06-21):** building the "answer huge prompts" loop (decompose→stabilize→
**synthesize**→answer). Design + roadmap in `docs/superpowers/specs/2026-06-21-moe-graph-inspector-design.md`.
Three user pillars captured & partly validated: (4b) **memory-on-retraction** — agent-validated as
implementable with ZERO core changes; (4c) **declarative AI-authorable concepts** (LLM::complete already makes
an expert pure JSON; needs `addConcept` + a validated schema); (4c-live) **online self-modification** (a
meta-concept calls add/patchConcept mid-run). Inspector v1 is the feedback instrument all of these need.

This is the live state for continuing `doc/PLAN_DEV_V1_MOE_GRAPHE.md`. Read it before resuming.

---

## 0. Orientation (what this is)

Building the engine as a **MOE Graph** reasoning substrate, per `doc/PLAN_DEV_V1_MOE_GRAPHE.md`.
Model is **fact-driven and additive, directed/acyclic**: a root segment = the problem/prompt;
concepts (experts) apply → add **props + new child segments/paths** → cascade-trigger more
concepts → prompts → facts. Experts don't contend for a property; the graph **grows in branches**.

**Standing user directives (do not violate):**
- **BUILD, not thin-layer.** The 5 studies in `doc/` recommend thin-layer; the user overrode that.
  Implement the plan; don't re-litigate build-vs-thin-layer, don't downscope.
- **Never cap expressiveness** of expressions / mutation templates.
- Prefer **leveraging what's already in the engine** over new machinery (scoring and fork/merge
  both turned out to need *no* new core feature).

---

## 1. Done this session (with commits)

| # | Work | Commit |
|---|------|--------|
| 1 | **`new Function`/eval eliminated** (8 sites) → `App/expr.js` (jsep + safe interpreter) | `7d228ca` |
| 2 | **`Graph.rollbackTo(rev)`** (snapshot-on-stabilize) + `getRevisions()` + filled `history_goto` | `7d228ca` |
| 3 | **Test harness** (`node:test`) + bootstrap + unit/integration tests | `7d228ca` |
| 4 | **Scoring = facts** (plan #4 rewritten; cycles marked out-of-scope) + lock-in test | `53d19ea` |
| 5 | **`Graph.fork()` / `Graph.merge()`** — sub-agent sub-graphs, reintegrate via `pushMutation` | `f3a04fa` |
| 6 | **`Graph.patchConcept(name, updates)`** — hot-patch an expert + bidirectional re-eval (cast/uncast cascade) | `ca108a4` |
| 7 | **Base providers packaged** (`providers/`: Geo + backend-agnostic LLM + `register()`); `_lab` now consumes it | `6919623` |
| 8 | **Public API docs** (`doc/API.md`) + readme pointer | `ff33281` |
| 9 | **Serialization round-trip tests** (plain + grown graph; compares defined facts) | `76e8b63` |
| 10 | **Revision indexing/search** — `getSnapshot(rev)` + `diffRevisions(a,b)` (added/removed/changed) | `a480f35` |
| 11 | **Robustness:** empty/childless concept set guard (no `Object.keys(undefined)` crash) | `07cd384` |
| 12 | **Build fixed:** host `App/db` resolved at runtime (not bundled) → `npm run build` emits `dist/` | `6f29120` |
| 13 | **Coverage:** manual `castConcept`/`unCastConcept` (+cascade) lock-in | `b709195` |
| 14 | **Coverage:** `getPaths` (linear/diamond/unreachable) | `6f0117c` |
| 15 | **CLAUDE.md refresh** — stale Tests/providers/`new Function`/API sections corrected | `c44cb72` |
| 16 | **Capstone:** "Git for reasoning" composition (grow→fork/merge→diff→rollback) | `ebd8e32` |

### Details
- **`App/expr.js`** — `compileExpression(source, {empty})` → `(resolve, names) => value`. jsep parses the
  full expression grammar (members/index/calls/ternary/array/object/all operators). `$ref`/`$$ref`/`a:b:c`
  walks are captured whole by the original regex and rewritten to `__ref("...")`, then handed verbatim to
  `getRef`. **Security:** `constructor`/`__proto__`/`prototype` access is blocked (no Function escape).
  Curated safe globals (Math, JSON, Number…). Runtime errors → `undefined` (faithful to the old try/catch).
- **Wiring** — all 8 eval sites replaced: `Concept.js` assert compiler; `Graph.js` `queryMaps` +
  `getChildMatching` (via `compileScopeQuery`); `Entity.js` `doEval` + `test` + the watcher-closure
  (Category B, a plain closure now); `PathMap.js` ×2 (via `compilePathQuery`).
- **rollbackTo** — `_applyStabilized` calls `_captureSnapshot()` (a full `serialize()` per coherent
  revision). `rollbackTo(rev)` re-mounts that snapshot, drops snapshots after `rev` (linear undo),
  re-stabilizes. Delta-replay (memory-light) deferred.
- **Scoring** — confirmed a score is just a fact: readable in asserts (`$confidence > 0.7`), available to
  providers via `scope` (prompt input), aggregatable along paths via `PathMap`. No schema fields, no
  conflict resolution. See `tests/integration/scoring.test.js`.
- **fork/merge** — `fork(seed, conf)` makes an independent child `Graph` (its own `conceptSets` =
  capabilities); `conf.reintegrateInto` + `conf.project` auto-`merge` on the child's stabilize.
  `merge(child, targetId, project)` does `pushMutation(project(child), targetId, true)` then
  `child.destroy()`. `init` now stashes `this._conceptMap` so children reuse the library.
- **patchConcept** — `patchConcept(nameOrId, updates, cb)`. `Concept.patch(updates)` deep-merges into
  `_schema` (**arrays REPLACE, not concat** — so `{assert:[...]}` overrides) and recompiles
  `_assertTest` via the new shared `Concept._compileAssert()` (extracted out of `Concept.init`). Then
  re-evaluates **every** live object both ways: newly-applicable+not-cast → `castConcept`;
  cast+no-longer-applicable → `Entity.unCast` (which **cascades** to child concepts — the subtle part),
  then re-stabilize. `Graph.getConceptByName` resolves by `_conceptLib` id first, else by `_name`.

---

## 2. How to run

```bash
npm test                 # 32 unit+integration tests (node:test, --test-force-exit)
node _lab/run-basic.js   # non-LLM end-to-end stabilization over the real `common` concept set
node _lab/run-problem.js # LLM-driven plan decomposition (needs an endpoint; see _lab/llm.js)
```

- The engine loads in Node via **`_lab/_boot.js`** (`@babel/register` + `@babel/preset-env`).
- **`_lab/concepts.js`** `buildConceptTree(setDir)` assembles the nested concept tree from the
  `concepts/<set>/` directory hierarchy (JSON5). The host supplies `conceptMap` to `new Graph(...)`.
- Tests live in `tests/unit/*.test.js` (pure) and `tests/integration/*.test.js` (load the engine).

---

## 3. Caveats / known issues (pre-existing unless noted)

- **`npm run build` (webpack/lpack) fails** on `require('App/db')` (host module, `Graph.js` default
  `bagRefManagers`). **FIXED** (`6f29120`): `App/db` now resolved at runtime via webpack's
  `__non_webpack_require__` escape hatch (falls back to plain require under node/babel), so the bundle
  no longer statically resolves it. `npm run build` succeeds and emits `dist/Skynet.js` (one benign
  "Critical dependency" warning for the intentional host-resolved require).
- ~~Empty `childConcepts: {}` crashes `Entity.init`~~ **FIXED** (`07cd384`): both Entity reads guard with
  `|| {}`; a childless concept set now mounts/stabilizes (test: `tests/integration/empty-concepts.test.js`).
- **`taskflows` needs `isfunction`** but doesn't declare it; npm pruned it → restored as a direct dep.
- rollback/fork snapshots are **full `serialize()` copies** (fine at plan scale <10k nodes; delta-replay later).
- **`npm test` count races** under `--test-force-exit` (the engine keeps timers/taskflow handles open):
  the aggregate may report e.g. 43 vs 50 — all tests still pass; re-run a single file for a deterministic
  count. (Deterministic fix would need per-test `g.destroy()` teardown or unref'd engine timers.)
- **Template update gotcha:** to update an existing object via a mutation template use `$$_id` (a plain
  `_id` creates a *new* object — surfaced while writing the revision-diff test).

---

## 4. Next — pick up here

**Phase 0 and Phase 1 of `doc/PLAN_DEV_V1_MOE_GRAPHE.md` are COMPLETE** (see §1, commits 1–16).
The engine library is solid and tested (50 tests). What remains in the plan is **Phase 2/3 — product
tooling**, which needs your direction before building (each is large, opinionated, or adds heavy deps):

- **Phase 2:** CLI debugger (`sg log/rollback/diff/inspect`), graph visualizer (web/D3), Python SDK
  (WASM or HTTP), worked examples, ready-made LLM providers (OpenAI/Mistral alongside the generic one),
  structured logging (pluggable `cfg.logger` instead of `debug = console`).
- **Phase 3:** perf/benchmarks, provider result cache (TTL/freshness — see `aspect-calcul-incremental.md`
  K3), auth, REST/GraphQL server, monitoring.

**Removed from scope:** cycle detection (DAG by construction); scoring machinery (facts).

### Smaller decision-light follow-ups (could do without product calls)
- Make `npm test` deterministic (per-test `g.destroy()` teardown or unref engine timers) — see §3 caveat.
- `bagRefs` (external-data) test coverage; the `caipi` default now degrades gracefully if `App/db` absent.
- A pluggable logger (`cfg.logger`) to silence the engine's `console` chatter cleanly (currently tests
  monkeypatch `console.log/info/warn`).

### Suggested next concrete step
A **CLI debugger** is the highest-leverage Phase-2 item and reuses everything built: it's a thin wrapper
over `serialize`/`getRevisions`/`getSnapshot`/`diffRevisions`/`rollbackTo`/`getPaths`. Good first user-facing
deliverable. Confirm scope before building.

---

## 5. File map (this branch vs master)

```
NEW   App/expr.js                         safe expression evaluator (jsep)
NEW   tests/unit/expr.test.js             24 parser tests (grammar, security, aetheris coverage)
NEW   tests/unit/concept-wiring.test.js   Concept._assertTest via the parser
NEW   tests/integration/stabilize.test.js end-to-end stabilization (real `common` set)
NEW   tests/integration/rollback.test.js  grow → re-stabilize → rollback → undone
NEW   tests/integration/scoring.test.js   confidence-as-fact (assert gate, provider input, aggregate)
NEW   tests/integration/fork.test.js      sub-agent fork + reintegrate
NEW   tests/integration/patch-concept.test.js  hot-patch expert: tighten->uncast+cascade, loosen->cast
NEW   providers/{geo,llm,index}.js        packaged base providers (Geo + LLM) + register() helper
NEW   tests/unit/providers.test.js        haversine/parseJSON/createLLMProvider/register units
NEW   tests/integration/providers.test.js packaged CommonGeo drives the real `common` Distance concept
NEW   doc/API.md                          public API reference (readme.md points to it)
NEW   tests/integration/serialize.test.js serialize -> new Graph round-trip (plain + grown)
NEW   tests/integration/revisions.test.js getSnapshot + diffRevisions (added/removed/changed)
NEW   tests/integration/empty-concepts.test.js  childless concept set mounts/stabilizes
NEW   tests/integration/manual-cast.test.js     castConcept/unCastConcept + cascade lock-in
NEW   tests/integration/getpaths.test.js  getPaths linear/diamond/unreachable
NEW   tests/integration/git-for-reasoning.test.js  capstone: grow→fork/merge→diff→rollback
EDIT  _lab/llm.js, _lab/run-basic.js      now consume providers/ instead of duplicating glue
EDIT  App/Graph.js                        parser wiring; rollbackTo; fork/merge; patchConcept+getConceptByName; getSnapshot/diffRevisions/_snapshotFacts; App/db runtime-require
EDIT  App/objects/Concept.js              assert compiler -> compileExpression; _compileAssert() extracted; patch()
EDIT  App/objects/Entity.js               doEval/test/watcher -> compileExpression; empty _openConcepts guard
EDIT  App/objects/PathMap.js              queries -> compilePathQuery
EDIT  CLAUDE.md                           refreshed Tests/providers/expr/API sections
EDIT  package.json / package-lock.json    deps (jsep, @jsep-plugin/*, isfunction) + test scripts
EDIT  doc/PLAN_DEV_V1_MOE_GRAPHE.md       scoring=facts (#4), cycles out of scope
```

Uncommitted, NOT mine (left untouched): `doc/aspect-*.md`, `.claude/agents/Pascal.md`.
`doc/HANDOFF.md` is an untracked working ledger (not committed); `doc/API.md` + `CLAUDE.md` ARE committed.
Auto-memory updated: `skynet-graph-agent-substrate-exploration.md`.
