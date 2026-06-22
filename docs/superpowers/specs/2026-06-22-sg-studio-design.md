# sg studio — visual debug/run/build tool for concept graphs

**Date:** 2026-06-22 · **Status:** design approved, pre-implementation.

A local, browser-based studio to **debug, run, prompt, fork, inspect history, and
create/switch concept corpora** against a live skynet-graph engine — the visual companion
to the `sg` CLI for *studying how a graph develops*.

## 1. Goals / non-goals

**Goals**
- Watch a graph **build live**: see concepts cast (facts + child segments appear), with the
  `why fired` for each, as stabilization runs.
- Drive the engine interactively: switch corpora, seed/mutate, run, **fork/merge**,
  **rollback/diff** revisions, **patchConcept/addConcept live**, and run the
  decompose→synthesize **prompt** loop.
- Create/edit a concept corpus with author-time **validation** before applying.
- Stay in the project's **no-build** ethos: one added Node dep (`ws`); the frontend is
  React-via-CDN (no bundler).

**Non-goals (this spec)**
- Not a hosted/multi-user product; single local user, `localhost` only.
- No auth, no persistence layer beyond the engine's own serialize/revisions.
- No new engine-core machinery — the studio only *drives* the existing public API.

## 2. Architecture

```
browser (no build)        ⇄  WebSocket  ⇄   server.js  →  session(s)  →  Graph (engine)
React18 + htm + cytoscape       JSON msgs       http+ws       wrapper       lib/graph
   (via esm.sh / import-map)
```

Three layers with a clean boundary; the **engine-facing wrapper carries the logic and is
unit-tested without any web layer**.

- **`lib/studio/session.js`** — wraps ONE live `Graph` instance: holds its conceptMap,
  registered providers, and a trace collector (`lib/sg/trace.js#createTrace`). Exposes
  *ops* and emits *events* (§4). No web dependency. **This is the tested unit.**
- **`lib/studio/studio.js`** — a session registry: the root session + a tree of forked
  child sessions, keyed by id. Routes ops to the active/target session; relays events
  tagged with `sessionId`. Also owns corpus discovery (scan a configured root dir) and the
  optional LLM `ask` backend for the prompt loop.
- **`lib/studio/protocol.js`** — the shared message contract: op names + payload shapes +
  event types. Imported by both server and (documented for) the frontend.
- **`lib/studio/server.js`** — thin `http` + `ws` plumbing: serves the static frontend and
  bridges WS messages ⇄ studio ops/events. No web framework.
- **`lib/studio/public/`** — the no-build frontend (§5).
- **`bin/sg` / `lib/sg/cli.js`** — new `sg studio [--root <dir>] [--port N] [--open]`
  subcommand that starts the server (and opens the browser).

## 3. UI layout

```
┌─ sg studio ──────────────────────────────────────────────────────────────┐
│ corpus:[common ▼] providers:[geo,llm]  ● live   rev 7/12   ⟲ rollback ▶ run│
├──────────────┬──────────────────────────────────────────┬────────────────┤
│ CONCEPTS     │  GRAPH CANVAS (live node-link, cytoscape) │ INSPECTOR      │
│ ▸ Vertice    │     (A)───seg s──▶(B)                     │ segment "s"    │
│ ▸ Edge       │             │ Distance{inKm:10728}        │ facts: …       │
│   ▸ Distance │             ▼  (sub-segments cast live)   │ cast by:       │
│ [+add][edit] │                                           │  Distance ✓    │
│  (editor)    │                                           │  why: Pos×2    │
├──────────────┴──────────────────────────────────────────┴────────────────┤
│ TIMELINE ◀ rev0 ─●──────────── rev12 ▶  [rollback] [diff a..b]            │
│ TRACE #5 Distance→s 1ms · #6 Travel→s …          FORKS ▸ root ▸ child1     │
├───────────────────────────────────────────────────────────────────────────┤
│ PROMPT > "plan a trip…"  [run]     answer ▸ (bottom-up synthesis)          │
└───────────────────────────────────────────────────────────────────────────┘
```

Left = concept tree (+ add/edit) · center = **live graph canvas** · right = inspector
(facts + which concepts cast + `why fired`) · bottom = revision timeline + trace + fork
tree, and a prompt console.

## 4. Protocol (the session contract)

Every client→server message is `{ id, sessionId?, op, args }`; the server replies
`{ id, ok, result | error }` and pushes unsolicited `{ type, sessionId, payload }` events.

**Ops (client → server)**
| op | args | result |
|---|---|---|
| `listCorpora` | — | available corpus dirs under `--root` |
| `loadCorpus` | `{conceptsDir, providersDir?, builtins?, sets?}` | `{conceptTree, providers, state}` |
| `reset` | — | `{state}` |
| `mutate` | `{template, targetId?}` | ack (events follow) |
| `run` | — | ack |
| `state` | — | `{objects, currentRev, revCount}` |
| `conceptTree` | — | the active conceptMap as a tree |
| `getConcept` | `{nameOrId}` | concept schema (for the editor) |
| `validateConcept` | `{schema, parentNameOrId?}` | `{ok, errors, warnings}` |
| `patchConcept` | `{nameOrId, updates}` | `{ok, validation}` (events follow) |
| `addConcept` | `{parentNameOrId, schema}` | `{ok, validation}` |
| `revisions` | — | revision list |
| `snapshot` | `{rev}` | `{objects}` at rev |
| `rollback` | `{rev}` | ack (events follow) |
| `diff` | `{a, b}` | structural diff |
| `fork` | `{seed?, conf?}` | `{childId}` |
| `merge` | `{childId, targetId?, project?}` | ack |
| `selectSession` | `{sessionId}` | `{state}` |
| `prompt` | `{text, opts?}` | streams `promptProgress`, ends `promptAnswer` |

**Events (server → client)**
| type | payload |
|---|---|
| `conceptApply` | `{rev, conceptName, targetId, kind, patch, why, ms}` (a trace record) |
| `stabilize` | `{currentRev, objectCount}` |
| `mutation` | `{targetId, rev}` |
| `rollback` | `{rev}` |
| `state` | `{objects, currentRev, revCount}` (sent on settle / after structural ops) |
| `forks` | `{tree}` (session tree) |
| `promptProgress` / `promptAnswer` | loop progress / final answer |
| `error` | `{message, opId?}` |

**Graph data shape for the canvas** — derived from `serialize().graph.conceptMaps`
(each object = its raw facts): objects with `Node:true` → cytoscape nodes; `Segment:true`
→ cytoscape edges (`originNode→targetNode`) labeled with a few key facts; free-nodes
(e.g. `clock`, `budget`) → standalone nodes. The full fact set + cast list + `why` shows
in the inspector on selection. Newly-cast elements (from `conceptApply`) pulse so you
*see* the graph develop.

## 5. Frontend (no-build, React)

- `public/index.html` — an **import-map** loads `react`, `react-dom`, `htm`, and
  `cytoscape` from `esm.sh`. No bundler, no JSX (htm tagged templates). Preact+`preact/compat`
  is the documented fallback if React+htm proves awkward.
- `public/app.js` — root component + a tiny WS client (`public/ws.js`) wrapping the
  protocol (request/response by `id`, event subscription).
- Components (each focused): `GraphCanvas` (cytoscape; renders state, animates
  `conceptApply`), `Inspector`, `ConceptTree` + `ConceptEditor` (JSON edit → `validateConcept`
  → `patch/addConcept`), `Timeline` (revisions slider, rollback, diff), `TracePanel`,
  `ForkTree`, `PromptConsole`, `Toolbar` (corpus switch, run/reset/rollback).
- Styling: plain CSS, a clean dark dev-tool theme (the `frontend-design` skill may refine
  aesthetics during build). No heavy component lib (keeps it no-build/lean).

## 6. Engine mapping (no core changes)

| Feature | session op → engine API |
|---|---|
| switch corpus | `loadConceptMap`/`loadProviders`/`register`, rebuild `new Graph` |
| run/debug | `pushMutation` + stream `cfg.onConceptApply`; `serialize()` for state |
| history | `getRevisions`/`getSnapshot`/`rollbackTo`/`diffRevisions` |
| patch live | `lib/authoring/validate.js` → `patchConcept`/`addConcept` (watch the cascade) |
| fork/merge | `fork`/`merge` (each fork = a child session/Graph) |
| prompt | seed root segment + `lib/authoring/loop.js#reactiveLoopConceptTree`; LLM `ask` from studio config |

## 7. Testing

- **`tests/integration/studio-session.test.js`** (node:test): drive `session.js` ops and
  assert emitted events + serialized state — `loadCorpus → mutate → run` casts Distance and
  emits `conceptApply`; `rollback`/`diff`; `patchConcept` re-eval cascade; `fork`/`merge`.
  This pins the whole engine-facing contract without a browser.
- **`tests/integration/studio-protocol.test.js`**: round-trip a few ops over an in-process
  WS connection to `server.js` (start on an ephemeral port, connect, assert responses/events).
- Frontend: logic kept in small modules; **manual verification** + an optional Playwright
  smoke (via the `webapp-testing` skill) — boot the server, load `common`, seed a segment,
  assert the canvas shows the Distance edge.

## 8. Dependencies

- **Add:** `ws` (WebSocket server). Frontend deps (`react`, `react-dom`, `htm`,
  `cytoscape`) are CDN/ESM — **not** installed, **not** bundled.
- `sg studio` LLM backend reuses `examples/llm.js#makeAsk` over `LLM_BASE` env (prompt
  feature degrades gracefully with a notice if absent).

## 9. Build order (lots — to be sequenced by writing-plans)

1. `session.js` + `studio.js` + `protocol.js` + tests (the engine-facing core).
2. `server.js` (http static + ws) + `sg studio` CLI command + protocol round-trip test.
3. Frontend shell + WS client + **GraphCanvas (live)** + Inspector — the "study development" core.
4. Timeline (revisions/rollback/diff) + TracePanel.
5. ConceptTree + ConceptEditor (validate → patch/add live).
6. ForkTree (fork/merge visualization, session switching).
7. PromptConsole (answer-loop; LLM backend).

## 10. Risks / open questions

- **Live single-stepping** of stabilization isn't exposed by the engine (the loop is async
  to fixpoint). The studio approximates "steps" via the `conceptApply` event stream +
  revision scrubbing, not a true pause-between-casts debugger. (Acceptable; a real
  step-debugger would need a core hook — out of scope.)
- **Large graphs**: cytoscape handles hundreds of nodes fine; thousands may need
  level-of-detail/clustering — deferred until a real corpus needs it.
- **Fork session lifecycle**: forks are in-process child Graphs held by `studio.js`;
  merged/closed forks are destroyed to avoid leaks.
