# Skynet-Graph: Complete Technical Analysis

## What It Is

Skynet-graph is a **reactive, rule-driven knowledge graph engine** built around a formal concept system inspired by production-rule systems and language grammars. It is not a traditional property graph database — it is a **self-enriching graph**: as data is added, a rule engine automatically derives new facts, creates new objects, and classifies relationships, converging to a stable state.

The primary proven domain is **multimodal travel routing** (the test case is "here to Singapore"), but the architecture is intentionally generic.

---

## Core Mechanics

### 1. The Three Object Types

All graph objects are `Entity` instances carrying a flat key-value data map (`_`). They are typed by concept flags:

| Type | Marker | Role |
|---|---|---|
| **Node** | `Node: true` | A location, entity, or POI. Tracks `_incoming` and `_outgoing` segment IDs. |
| **Segment** | `Segment: true` | A directed edge. Holds `originNode` and `targetNode` IDs, auto-registered with their respective nodes. |
| **Document** (free node) | any | An unlinked record. Used as path descriptors, metadata bags, external data holders. |

---

### 2. The Concept System (Rule Engine)

Concepts are **JSON-defined production rules**. Each concept specifies:

```json
{
  "require": ["originNode:Position", "targetNode:Position"],
  "assert":  ["$Distance.inKm > 300"],
  "ensure":  ["$value == 8"],
  "follow":  ["$someRef:stuffSomewhere"],
  "provider": ["CommonGeo::Distance"],
  "cleaner":  ["User::UnCastWidget"],
  "applyMutations": [{ "$_id": "_parent", "MyFlag": true }],
  "defaultValue": true,
  "autoCast": false,
  "syncAfter": true
}
```

| Field | Behaviour |
|---|---|
| `require` | Preconditions: referenced values must exist before the concept can fire. |
| `assert` | Boolean conditions evaluated once; concept only fires if true. |
| `ensure` | Like `assert`, but the concept is **automatically removed** when the condition becomes false (reactive de-casting). |
| `follow` | Re-evaluates applicability every time the watched reference changes. |
| `provider` | Async external function (e.g. a geo API) that produces mutations when the concept fires. |
| `cleaner` | Async cleanup function run when the concept is removed. |
| `applyMutations` | Inline mutation template applied synchronously on cast. |

Concepts are organized hierarchically: child concepts in a subdirectory only become candidates when the parent concept is already present on an object. If a parent concept is removed, all its children are recursively uncast first.

---

### 3. The Stabilization Loop

The engine runs a **convergence loop** via `taskflows`:

```
mount → mark all objects unstable
  └─ stabilize task:
       for each unstable object:
         updateApplicableConcepts()
         → for each applicable concept: applyTo()
           → provider calls or inline mutations
           → pushMutation() → destabilizes affected objects
       repeat until _unstable is empty
  └─ _applyStabilized() → onStabilize callback
```

This is **forward-chaining inference**: the graph keeps firing rules until no more rules can apply. Once stable, the `onStabilize` callback fires (used to trigger server sync or deliver results to the caller).

---

### 4. The Mutation Template DSL

All graph changes are expressed as **mutation templates** — arrays of partial objects. This makes mutations serializable, replayable, and broadcastable.

Key template features:

| Syntax | Meaning |
|---|---|
| `"$_id": "_parent"` | Apply keys onto the object that triggered this mutation. |
| `"$originNode": "_parent:originNode"` | Resolve a reference from the parent's `originNode` field. |
| `"$targetNode": "$someGraphObjId"` | Resolve a global object ID from the graph. |
| `"Distance": null` | Uncast the Distance concept (triggers reactive cleanup). |
| `"$$key": "db:external_id"` | BagRef: a pointer to an external record (fetched lazily). |
| `"_id": "localReference"` | Named inner-template object, referenceable within the template. |

**Example — the "add airports" mutation template** (adds intermediate airport nodes to a travel segment automatically):

```json
[
  { "Segment": true, "$originNode": "_parent:originNode", "targetNode": "nearbyOriginAirport" },
  { "_id": "nearbyOriginAirport", "Node": true, "isAirport": true, "$nearTo": "_parent:originNode" },
  { "Segment": true, "$_id": "_parent", "LongTravel": true, "Distance": null,
    "originNode": "nearbyOriginAirport", "targetNode": "nearbyTargetAirport" },
  { "_id": "nearbyTargetAirport", "Node": true, "isAirport": true, "$nearTo": "_parent:targetNode" },
  { "Segment": true, "originNode": "nearbyTargetAirport", "$targetNode": "_parent:targetNode" }
]
```

One mutation template automatically restructures a simple A→B edge into A→Airport→Airport→B, with new node objects created, linked, and marked unstable for further concept application.

---

### 5. The Reference Expression Language

A mini-language for navigating the graph in assertions, ensures, and templates:

| Expression | Meaning |
|---|---|
| `$key` | Value of `key` on the current object. |
| `$originNode:Position` | Follow the `originNode` ID, then get `Position` on that object. |
| `$Distance.inKm` | Get `inKm` sub-property of `Distance` on the current object. |
| `$$someId._id` | Get the ID of a global graph object. |

References used inside `ensure`/`follow` automatically wire **reactive watchers**: when the referenced value changes, the dependent concept's applicability is re-checked. Watchers are cleaned up precisely when a concept is uncast (`unRefAll`).

---

### 6. The Reactive Watcher Graph

Every object's `Entity` maintains:

- `_watcherByConceptName` — callbacks fired when a key is set
- `_followersByConceptName` — object IDs destabilized when a key changes
- `_watchers` — per-concept reference subscriptions (auto-wired from `ensure`/`follow` expressions)

When `entity.set(key, value)` is called:
1. Watchers on that key fire immediately (e.g. re-check concept applicability).
2. All follower objects are marked unstable (triggering another stabilization round).

This makes the graph **fully reactive**: a geo-position arriving on a node automatically propagates to any segment that `follow`s it, re-triggering distance calculation and travel-type classification.

---

### 7. Server-Client Synchronization

The graph has a built-in master/replica model:

- **Master graph** (server): applies mutations, increments revision numbers, broadcasts atomic updates.
- **Client graph**: receives `pushAtomicUpdates(from, to, atoms)`, replays mutations, re-stabilizes.
- Mutations from the client are forwarded to master via `pushToMaster()` and held with a sync token until the server confirms.
- `bagRefManagers` — pluggable connectors for fetching external records (e.g. `db:someId`) during mutation processing.

Serialization (`graph.serialize()`) captures the full state as a JSON string, including all concept maps and external bag-ref references.

---

## Concept Hierarchy Example (Travel Domain)

```
Edge (Segment: true)
├── Distance           requires: originNode:Position + targetNode:Position
│                      provider: CommonGeo::Distance
├── Travel             requires: Distance (inKm != 0)
│   ├── ShortTravel    assert: Distance.inKm <= 300
│   ├── LongTravel     assert: Distance.inKm > 300
│   │                  requires: targetNode
│   └── targetNode     (sub-concept of Travel)
└── Stay               assert: !Travel && (Distance.inKm == 0 || undefined)

Document (Record: true)
└── pathBasket         applyMutations: adds pathBasket:[] to the document
```

A segment starts with just `{ originNode, targetNode }`. After stabilization:

1. If both nodes have `Position` → `Distance` concept fires (calls geo provider) → `Distance.inKm` set.
2. If distance > 300 → `LongTravel` concept fires.
3. If distance == 0 → `Stay` concept fires.
4. If the segment crosses a long distance → the airports mutation template fires, restructuring the graph.

All of this happens **automatically**, purely from rules.

---

## PathMap

`PathMap` is a post-processing utility for the stabilized graph's path output. It is not part of the rule engine itself.

| Method | Purpose |
|---|---|
| `selectPaths(_with, _without)` | Filter paths by which concept flags they contain. |
| `selectPathsFromQuery(query)` | Filter with arbitrary expression strings. |
| `queryMapsOnPath(path, query)` | Find nodes/segments on a specific path matching a predicate. |
| `getAllPropsInPath(i, props)` | Extract property values from all objects in a path. |
| `extractShape(path)` | Produce lat/lng polyline arrays with transport type per segment. |
| `getPathDescriptor(i)` | Retrieve attached path descriptor documents (price, quality, carbon footprint, etc.). |

A commented-out Skycube integration was planned for multi-dimensional Pareto-optimal path selection (optimal paths across price/time/carbon simultaneously).

---

## Potential Use Cases

### 1. Multimodal Route Planning (Primary Domain)

The codebase is purpose-built for this. Given a start and end node with positions, the concept engine automatically:

- Calculates distances between connected nodes.
- Classifies segments as short/long travel or stays.
- Inserts intermediate transport hubs (airports) via mutation templates.
- Calls external APIs (fare APIs, routing APIs) as providers.
- Returns a PathMap of enriched itinerary options filterable by transport type, price, duration, and carbon footprint.

**Advantage over static routers:** Rules are data, not code. A new travel mode (e.g. ferry) requires only a new JSON concept file and a provider function.

---

### 2. Dynamic Knowledge Graph Construction

For any domain where data arrives incrementally and triggers derived facts:

- **Medical ontologies**: a node with `diagnosis: X` auto-applies treatment protocols from concept rules.
- **Financial graphs**: transaction nodes with amounts auto-classified by thresholds, triggering compliance concepts.
- **Supply chain**: goods nodes enriched with supplier data; logistics concepts fire based on location, weight, or class.

---

### 3. Collaborative Graph Editing

The server-client sync with atomic mutations and revision history is a foundation for real-time collaborative editing of structured data — similar to operational transformation but at the graph/concept level. Every mutation is a serializable, replayable atom with a revision number.

---

### 4. IoT and Sensor Data Processing

Sensor nodes with `Position`, `Temperature`, `Status` can have concepts that fire when:

- Temperature exceeds a threshold → `Alert` concept → triggers notification provider.
- Two sensor nodes are within distance X → `Proximity` concept fires.
- Status changes → cascading concept re-evaluation propagates through the graph reactively.

---

### 5. Workflow and Business Process Automation

Nodes represent tasks or entities; segments represent dependencies. Concepts fire when preconditions are met (`require: ["PreviousTask:completed"]`), calling provider functions to execute steps. Failed `ensure` conditions auto-uncast concepts, reverting workflow state automatically.

---

### 6. Recommendation and Personalization Engines

A user node and item nodes in a graph. Concepts fire based on user preference flags and item attributes, building scored `Relevant` or `Recommended` segments dynamically. Changing a preference triggers reactive re-evaluation through `ensure`, pruning or adding recommendations in real time.

---

### 7. Game and Simulation State Machines

The concept system is essentially a declarative state machine over a graph. NPCs, inventory, and world state as nodes/segments; behavior rules as concepts. State transitions happen automatically and reactively — no explicit transition code required.

---

## Advantages

### Declarative, Data-Driven Rules

Rules are JSON files in the `concepts/` directory. Adding a new rule requires no changes to engine code — only a new file and (optionally) a provider function. This makes the rule set extensible without touching the core engine.

### Automatic Dependency Tracking and Reactivity

The `ensure`/`follow` mechanism wires reactive watchers automatically from rule expressions. The engine does not require manual subscription management: when a dependency changes, the dependent concept re-evaluates. This is equivalent to having a spreadsheet formula engine embedded in a graph.

### Convergent Correctness (Stable-State Guarantee)

The stabilization loop runs until no unstable objects remain. The graph always reaches a fixed point (assuming rules are not circular). The caller never needs to orchestrate rule application order — the engine handles sequencing.

### Bidirectional Concept Lifecycle (Cast and Uncast)

Unlike most rule engines, skynet-graph supports **retraction**: `ensure` conditions that become false cause automatic concept removal, triggering cleaners and cascading uncast of child concepts. This is essential for dynamic environments where facts can become invalid.

### Async Provider Integration

Concepts can call external APIs (geo calculation, fare lookup, database queries) asynchronously via the provider mechanism. The `TaskFlow` engine holds the stabilization loop while providers execute, then continues. External latency is fully absorbed into the stabilization cycle with a built-in timeout warning at 25 seconds.

### Atomic Mutation Templates

All graph changes — whether from concept application or external input — are expressed as serializable templates. This enables:

- **History/replay**: a full revision log is built into the Graph.
- **Server-client sync**: mutations broadcast atomically to all replicas.
- **Revertability**: concept cleaners can invert a mutation.

### Hierarchical Concept Scoping

Sub-concepts only become candidates when their parent is active. This dramatically reduces the search space during stabilization and provides natural semantic grouping — a `LongTravel` check is only evaluated when `Travel` and `Distance` are already established.

### Pluggable External References (BagRefs)

The `bagRefManagers` system allows the graph to lazily dereference external IDs (database records, API endpoints) on demand, without coupling the graph engine to any specific backend.

### Built-in Performance Profiling

`graph.printStats()` outputs per-provider execution time sorted by total cost — essential for identifying slow concepts in a production stabilization run.

---

## Limitations and Open Areas

| Area | Detail |
|---|---|
| **No cycle detection** | Circular concept dependencies (A requires B, B requires A) would cause infinite stabilization loops. |
| **Tests non-functional** | `npm test` is a placeholder. The real test (`Graph.test.js`) requires a built `dist/` and external providers not included in the repo. |
| **`__SERVER__` global** | A compile-time constant injected by lpack. The raw source is not runnable without the build step. |
| **Skycube removed** | Multi-criteria Pareto path selection was planned but commented out. |
| **No concept schema validation** | Malformed concept JSON fails silently at runtime rather than at load time. |
| **Provider registry is external** | `Graph.static._providers` must be populated before graph construction. No provider implementations are included in the repo. |

---

## Relevance to AI Systems

This section examines whether skynet-graph's architecture offers genuine advantages for AI applications, and where its limits lie.

---

### The Stabilization Loop as an Agentic Reasoning Loop

The core engine loop — fire applicable rules, collect results, re-evaluate until stable — is structurally identical to how modern AI agent frameworks work:

```
AI agent loop:           Skynet-graph stabilization:
─────────────────        ──────────────────────────
observe world state  →   mount graph / pushMutation
select applicable    →   updateApplicableConcepts()
  tools/actions
call tools           →   concept provider() calls
integrate results    →   pushMutation() → destabilize
repeat until done    →   loop until _unstable empty
deliver answer       →   onStabilize callback
```

The difference from frameworks like LangChain or AutoGen is **how orchestration is expressed**: those frameworks require imperative code ("call tool X, then if result Y call tool Z"). Skynet-graph expresses the same logic declaratively — "tool Z requires the output of tool X" — and the engine derives the execution order automatically.

This means tool orchestration logic lives in JSON concept files, not in code. Changing the sequence in which AI tools are called, or adding a new tool, does not require touching any orchestration logic.

---

### Provider = AI Tool / LLM Function Call

The `provider` field in a concept maps directly onto the function-calling / tool-use paradigm of modern LLMs:

```json
{
  "require": ["entity:Description"],
  "provider": ["LLM::Classify"],
  "applyMutations": [{ "$_id": "_parent", "ClassificationPending": true }]
}
```

A concept like this would fire whenever a node gains a `Description`, call an LLM classification function asynchronously, and write the result back as a mutation. The stabilization loop naturally handles the async wait. Other concepts waiting on `Classification` would then fire in the next round — no manual chaining required.

Each AI capability (embedding generation, LLM inference, classifier call, vector search, external API) becomes a provider behind a concept. The concept's `require`/`assert` conditions define exactly when that capability should activate.

---

### Neurosymbolic Integration

Skynet-graph provides a natural **neurosymbolic architecture** without any additional machinery:

- **Symbolic layer**: the concept rule system — structured, deterministic, interpretable, auditable.
- **Neural layer**: provider functions — LLM calls, embedding models, classifiers, similarity search.

The two layers are cleanly separated at the provider boundary. Neural outputs (e.g. an embedding vector, a classification label, a generated text) become hard facts written into the graph via mutations. Those facts then trigger further symbolic rules. This grounds neural outputs in a verifiable, structured state rather than letting them float as ephemeral text.

Example pipeline for entity enrichment:
```
Node { text: "..." }
  → [concept: NeedsEmbedding] provider: EmbeddingModel::Encode
  → Node gains { embedding: [...] }
  → [concept: NeedsClassification] provider: LLM::Classify
  → Node gains { category: "X" }
  → [concept: Category:X] fires child concepts specific to category X
```

Each step fires only when the previous one has completed and its output is present in the graph.

---

### Structured Agent Memory

LLM agents suffer from context window limits and the absence of structured, queryable memory. The graph provides three distinct memory tiers without any extra infrastructure:

| Memory type | Skynet-graph equivalent |
|---|---|
| **Working memory** | Unstable objects currently being processed by the stabilization loop. |
| **Short-term / session memory** | Stable in-memory graph state (all concept maps). Fully queryable via `getRef` expressions. |
| **Long-term / persistent memory** | `graph.serialize()` → JSON. `graph.mount()` → restore. Revisioned. |
| **External knowledge** | BagRefs (`db:someId`) — lazy pointers to external records (databases, vector stores, APIs). |

The reactive watcher system means that when a memory item is updated (e.g. a belief is revised), every concept that `follow`s or `ensure`s that item automatically re-evaluates — without the agent needing to explicitly "notice" the change.

---

### Grounded World State vs. Hallucination

A persistent problem with LLM-based agents is that reasoning happens entirely in text, with no external ground truth. Facts asserted by the LLM in one step can silently contradict facts from another step, with no mechanism to detect or resolve the conflict.

Skynet-graph provides a **persistent, structured world state** that all reasoning steps read from and write to:

- A concept cannot fire unless its `require` preconditions are actually present in the graph.
- An `ensure` condition that becomes false removes the concept that depended on it — there is no way for a stale belief to persist silently.
- All mutations are revision-stamped and replayable; the history of how any fact was derived is traceable.

LLM outputs that are fed back into the graph as mutations become verifiable facts. If an LLM claims "the distance is 500km" and writes that as `Distance: { inKm: 500 }`, the `LongTravel` concept will fire automatically — but if the LLM writes 50km instead, `ShortTravel` fires and `LongTravel` does not, regardless of what the LLM "thinks" the travel type should be. The symbolic rules act as a consistency enforcer over neural outputs.

---

### Declarative AI Pipelines (vs. Imperative Chains)

Current AI pipeline tools (LangChain, LlamaIndex, Haystack) require writing code that explicitly sequences operations. This creates tight coupling between pipeline steps and makes it hard to add, remove, or reorder steps without rewriting control flow.

In skynet-graph, an AI pipeline is a set of concept rules:

```
Step 1: Chunk documents        → concept: needs Document → splits text, creates chunk nodes
Step 2: Embed chunks           → concept: needs Embedding (require: chunk:Text)
Step 3: Link similar chunks    → concept: needs SimilarityEdge (require: both:Embedding)
Step 4: Summarize clusters     → concept: needs Summary (require: cluster:formed)
Step 5: Generate answer        → concept: needs Answer (require: Summary, UserQuery)
```

Adding a new step (e.g. a reranking step between 3 and 4) means adding one new concept JSON file that `require`s similarity edges and produces ranked edges. No existing concept is modified.

---

### Multi-Agent Coordination via Graph Sync

The master/replica synchronization model maps naturally onto multi-agent systems:

- **Master graph** = shared world state (environment).
- **Client graphs** = individual agent instances with local views.
- Atomic mutations from one agent are broadcast to all others via `pushAtomicUpdates`.
- Each agent's local concept set can differ (different `conceptSets` config), meaning agents can have different capabilities and observe different derived facts from the same raw data.
- Sync tokens allow an agent to wait for its mutation to be acknowledged by the master before proceeding — useful for coordinating on shared resources.

This is a lightweight implementation of a **blackboard architecture**, a classical multi-agent coordination pattern where agents read from and write to a shared structured knowledge base.

---

### Planning and Goal-Directed Reasoning

The concept system can model STRIPS-like planning directly:

- **States**: concept flags on nodes (`GoalReached: true`, `StepComplete: true`).
- **Actions**: concepts with `require` (preconditions) and `applyMutations` (effects).
- **Goal test**: `onStabilize` fires when no more rules can apply — i.e. the plan has fully executed or is stuck.
- **Plan revision**: `ensure` conditions that become false auto-retract their concept and its downstream effects, enabling reactive re-planning when the world changes.

Unlike classical planners that compute a plan upfront and then execute it, skynet-graph executes rules reactively as their preconditions become satisfied — closer to **reactive planning** or **situation calculus**.

---

### Interpretability and Auditability

This is a significant advantage over purely neural approaches. Every derived fact in the graph can be traced to:

1. The concept that produced it (which rule fired).
2. The preconditions that were satisfied at the time (which `require`/`assert` passed).
3. The provider that was called (which external function ran).
4. The mutation template that wrote it (exactly what was changed).

The `_mappedConcepts` map on each `Entity` is a live audit trail of which concepts are currently active on that object. `graph.printStats()` gives per-provider execution time. Revision history (`_revs`) records every mutation in order.

For regulated domains (medical AI, financial AI, legal AI) where decisions must be explainable, this traceability is a hard requirement that most LLM-only pipelines cannot satisfy.

---

### AI-Specific Limitations

These advantages come with significant caveats when applying the engine to AI workloads:

| Limitation | Impact on AI |
|---|---|
| **Boolean-only concept applicability** | No confidence scores, probabilities, or fuzzy matching. An LLM output either satisfies a `require` or it does not. Probabilistic reasoning requires external handling. |
| **No built-in vector operations** | Semantic similarity search (essential for RAG) must live entirely in a provider; the graph itself has no notion of distance between concept maps. |
| **Static rule set** | Concepts are defined at load time. The graph cannot learn new rules from experience or update its own concept library at runtime. |
| **No cycle detection** | LLM reasoning can produce self-referential outputs (A concludes B, B concludes A). Without cycle detection, this causes an infinite stabilization loop. |
| **No built-in LLM provider** | There is no included concept or provider for calling an LLM. These must be implemented and registered externally. |
| **Single-threaded mutation processing** | The `_mutationThread` serializes all mutations. High-throughput AI pipelines generating many parallel mutations would queue up. |

---

### Summary Assessment

Skynet-graph is a strong fit for AI systems that need **structured, verifiable, reactive reasoning** on top of neural capabilities. It is not itself an AI system — it is an infrastructure layer that enforces structure, causality, and consistency on the outputs of AI components.

Its strongest AI value propositions are:

1. **Declarative tool orchestration** — replaces imperative agent loop code with data-driven concept rules.
2. **Grounded world state** — prevents hallucinated facts from persisting; all AI outputs must be committed as graph mutations.
3. **Neurosymbolic bridge** — clean separation between symbolic rules (concepts) and neural inference (providers), with structured integration at the mutation boundary.
4. **Interpretability** — complete derivation trail for every fact, essential for auditable AI systems.
5. **Reactive memory** — agent beliefs update automatically when their dependencies change, without explicit invalidation logic.

It is a poor fit for AI workloads that are purely generative (text in / text out), probabilistic, or require dynamic rule learning. It is best understood as the **structured reasoning substrate** in a hybrid system where LLMs or ML models handle perception and generation, and the graph handles state, consistency, and rule-based inference.

---

## Would a WebAssembly Version Make Sense?

This is a non-trivial question. The answer depends heavily on target environment and graph scale — and there is one hard architectural blocker that must be addressed first.

---

### The Hard Blocker: `new Function()`

Skynet-graph uses JavaScript's dynamic code generation pervasively. Every concept assertion, every `ensure` condition, every `follow` watcher, and every PathMap query compiles an expression string into a live function at runtime:

```js
// Concept.js — fires for every concept at load time
this._assertTest = new Function("scope", "graph",
    "try{ return (" + asserts.join(") && (")
        .replace(/\$(\w[\w.:$]+)/ig, 'scope.getRef("$1")') + "); }catch(e){ return undefined; }"
);

// Entity.js — generates watcher functions dynamically
new Function("c", "graph", "me",
    "return function b_" + cname + "(){" +
    "graph._conceptLib[c].isApplicableTo(me, graph)&&" +
    "graph.castConcept(me._._id, c)};"
)
```

**WASM has no `new Function` equivalent.** It cannot generate and execute new code at runtime from a string. This is not a minor inconvenience — the entire concept applicability system, the expression language, and the PathMap query engine are built on it. A WASM port must resolve this before anything else is possible.

There are three paths through this blocker, each with a different cost/benefit profile:

| Approach | What it means | Cost | Benefit |
|---|---|---|---|
| **Expression interpreter in WASM** | Implement a mini-interpreter for the `$ref.key > value` expression language inside the WASM module | Medium — build a parser + evaluator | Consistent, sandboxed, portable |
| **Ahead-of-time compilation of concepts** | At concept load time, parse expressions and compile them to WASM bytecode | High — requires a full expression compiler | Fastest possible assertion evaluation (10–50× vs current `new Function`) |
| **JS callback for expressions** | WASM calls back into JS for each assertion evaluation | Low — keep current JS code for expressions | Defeats much of the performance purpose; adds interop overhead on the hottest path |

---

### What WASM Would Actually Help With

Setting aside the blocker, the core stabilization loop is exactly the kind of workload WASM is designed for:

- **Pure in-memory computation** — iterating objects, checking conditions, applying mutations. No I/O. CPU-bound.
- **Predictable performance** — WASM has no garbage collector pauses. The JS version is subject to V8/SpiderMonkey GC interrupting stabilization mid-cycle, which is observable on large graphs.
- **Tight inner loop** — `updateApplicableConcepts` is called on every unstable object in every stabilization round. Even a modest speedup here compounds across thousands of objects and multiple rounds.

For reference: WASM typically runs 1.5–3× faster than equivalent optimized JS for pure computation. For a graph of hundreds of nodes this is imperceptible. For tens of thousands of nodes stabilizing across many rounds it becomes meaningful.

---

### What WASM Would Not Help With

The real bottleneck for any serious deployment of skynet-graph is **not** the concept evaluation loop — it is the provider calls. Geo distance calculations, fare API lookups, LLM inference: these are all async network calls that take 50–500ms each. Making the stabilization loop 2× faster saves microseconds while providers consume seconds. WASM gives zero benefit here.

Similarly, the server-client sync (`pushAtomicUpdates`, `pushToMaster`) is network-bound. Serialization/deserialization of graph state (`JSON.stringify`/`JSON.parse`) is already highly optimized in JS engines.

---

### Where WASM Genuinely Makes Sense

#### 1. Non-JS Host Environments

This is the strongest case. The current codebase targets browsers and Node.js. If skynet-graph needs to run inside:

- **Python ML pipelines** (via `wasmtime-py` or `wasmer-python`) — no Node.js dependency
- **Rust services** (via `wasmtime` crate) — embed the graph engine in a Rust backend
- **Cloudflare Workers / Deno Deploy** — edge environments with native WASM support but restricted Node.js APIs
- **Embedded / IoT** (via `wasmtime` or `wasm3`) — resource-constrained devices where a full JS runtime is too heavy

In all of these cases, WASM is not a performance optimization — it is the **portability mechanism** that makes the engine available outside the JS ecosystem.

#### 2. The Expression Evaluator as a WASM Compile Target

The most pragmatic and high-value partial WASM approach: keep the orchestration, serialization, and provider system in JS, but replace `new Function` with a small expression compiler that emits WASM bytecode for each concept assertion at concept-load time.

```
concept.json loaded
  → parse "$Distance.inKm > 300"
  → compile to WASM function: (scope) => scope.getRef("Distance.inKm") > 300
  → cache compiled WASM module
  → call from JS during stabilization
```

This eliminates the `new Function` problem and converts the hottest path (assertion evaluation, called once per concept per unstable object per stabilization round) from interpreted dynamic JS to compiled WASM. The rest of the engine stays in JS unchanged.

#### 3. Large-Scale AI Workloads

If skynet-graph is used as an AI reasoning substrate (as described in the previous section), graph sizes can grow very large: thousands of chunk nodes, hundreds of thousands of similarity edges, complex multi-hop concept hierarchies. At that scale, GC pressure in the JS version becomes a real problem. A WASM core with linear memory and manual allocation would eliminate it.

---

### What Language Would Make Sense for a WASM Port

| Language | WASM story | Fit for this codebase |
|---|---|---|
| **Rust** | Best-in-class (`wasm-bindgen`, `wasm-pack`), zero-cost, no GC | Ideal for performance and portability; steepest rewrite effort |
| **AssemblyScript** | TypeScript-like syntax, easiest port from JS, good JS interop | Most practical for a partial port of the core loop; limited ecosystem |
| **C++ via Emscripten** | Mature, battle-tested | Heavy toolchain; less ergonomic for graph data structures |
| **Go via TinyGo** | Emerging WASM support | GC present; JSON/graph handling is comfortable in Go |

For this specific codebase, **AssemblyScript** is the most pragmatic starting point: the source is already TypeScript-compatible in structure, the JS interop model is well-understood, and the expression evaluator could be ported incrementally. A full production port would eventually want Rust for the performance-critical core.

---

### Recommended Path

A full WASM rewrite is not cost-justified unless the target environment requires it. The pragmatic approach is a **three-phase hybrid**:

**Phase 1 — Resolve the `new Function` dependency (prerequisite for anything)**
Replace dynamic expression compilation with a small, self-contained expression parser and either an interpreter (simpler) or a WASM-emitting compiler (faster). This is necessary regardless of WASM and also improves the current JS version's security posture (CSP headers block `eval`/`new Function` in strict environments).

**Phase 2 — WASM for non-JS portability**
Compile the graph core (Entity, Concept, stabilization loop, mutation engine) to WASM via AssemblyScript or Rust. Expose a clean host interface for providers (JS callbacks or WASI-compatible async). This unlocks Python, Rust, and edge deployments.

**Phase 3 — WASM expression compiler for AI-scale graphs**
For deployments with very large graphs (AI workloads, knowledge bases), compile concept assertions to WASM bytecode at load time. This is the performance ceiling — assertions evaluated at near-native speed with zero GC.

**Short answer:** a WASM version makes sense only if you need portability beyond JS runtimes, or if you are operating at graph scales (tens of thousands of nodes) where JS GC becomes observable. For the current travel routing use case running in a browser or Node.js server, the JS version is sufficient and a WASM port would add significant engineering cost for negligible runtime benefit. The blocker is always `new Function` — solving that problem is the prerequisite for any WASM strategy.
