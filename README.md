<h1 align="center">skynet-graph</h1>

<p align="center">
<b>An externalized reasoning layer & toolbox for LLMs
</b><br>


</p>

<p align="center">
<img src="./docs/img/headImg.png">
</p>

<p align="center"><i>Active R&D · a CommonJS library to embed + an <code>sg</code> CLI · Node 18+, no build step · AGPL-3.0</i></p>

<p align="center">
<a href="https://www.npmjs.com/package/skynet-graph"><img src="https://img.shields.io/npm/v/skynet-graph?logo=npm&amp;color=cb3837" alt="npm version"></a>
<a href="https://www.npmjs.com/package/skynet-graph"><img src="https://img.shields.io/npm/dm/skynet-graph?color=cb3837" alt="npm downloads"></a>
<a href="https://nodejs.org"><img src="https://img.shields.io/node/v/skynet-graph" alt="node version"></a>
<a href="./LICENSE"><img src="https://img.shields.io/npm/l/skynet-graph?color=blue" alt="AGPL-3.0"></a>
<a href="https://doi.org/10.5281/zenodo.21032471"><img src="https://zenodo.org/badge/DOI/10.5281/zenodo.21032471.svg" alt="DOI"></a>
<a href="https://doi.org/10.5281/zenodo.21201877"><img src="https://zenodo.org/badge/DOI/10.5281/zenodo.21201877.svg" alt="DOI"></a>
</p>

## What it is

**A generic, model-agnostic reasoning substrate**, using typed facts + declarative concept rules + truth
maintenance, that turns an LLM's reasoning from throwaway prose into a versioned graph you can **test,
reuse, replay and reopen**. Made for local models; nothing leaves the machine. *(Demonstrated
end-to-end below on a 9.5 GB local quant — the starkest, cheapest-to-verify case, not the limit.)*

Your model's reasoning today is trapped in prose: you cannot test one step in isolation, reuse it on the
next task, replay it deterministically, or reopen it when a fact changes. Skynet-graph act as an externalized reasoning layer doing that by structure. 
Basing the chosen **plugin(s)** and the prompt; the substrate mutates, cast typed
transformations, retract them when a premise fails, until it stabilizes into a stable, coherent result state serializable on purpose. 
Here four things it gives to any model, each measured on real runs with negative controls and deterministic re-runs:

- **Piece-by-piece on big tasks** — the task becomes a *typed* DAG; each step sees only a bounded
  neighbourhood, never the whole dossier. Cross-domain, N=200/domain: GSM8K **16→52 %**, FinQA **20→50 %**.
  Where whole-context prompting collapses on deep tasks (**0/33**), the pieces hold (**10/33**).
- **Certified-shape steering** — certified method shapes steer the output on covered queries: SQL
  **8→63 %**, finance **7→62 %**, at zero big-model calls. (This is what rescues a crippled quant — the
  most dramatic instance of a generic mechanism, not a low-quant-only trick.)
- **Task memory that reopens** — task state is a typed fact ledger (a JTMS). A late correction retracts
  its consequences in cascade and re-derives at 0 model calls; a withdrawn value **reopens** the steps
  that depended on it, with the reason.
- **An external think mode** — the model proposes, the graph refutes with the reason and the admissible
  options, the model revises. Zero false admissions, every campaign. On a debate, the job the graph does is
  **making the arguments real**: every point on the table has to name the statements that actually carry it,
  and a point that cites nothing does not get in — *including the ones the model invents itself*, which face
  the same gate. What you get back is a pool where each side's case is traceable to the evidence under it,
  and a ledger that says which points were admitted, which were refused, and why.
  **Weighing those arguments is the model's job, not the graph's** — a count of how many points each side
  scored is not a judgment, and we do not dress one up as a proof. The graph guarantees the inputs to the
  judgment, not the judgment. [See it run](examples/bootstrap/c9-critical-mind.js).

**See it in 30 seconds — no model, no GPU** (a deterministic replay of a real end-to-end run — the
9.5 GB quant analyzing an annual report, erratum and crash included):

```bash
git clone https://github.com/9pings/skynet-graph && cd skynet-graph
npm install && node examples/integrated-demo/run.js --replay      # 7 checks, bit-identical
```

▶ **No clone?** Play the same recorded run in your browser — **[the live demo](https://9pings.github.io/skynet-graph/)**.

> **Active R&D.** Some of this is measured and replayable, some is proven only structurally, and plenty
> still needs work — [CAPABILITIES.md](docs/CAPABILITIES.md) carries a maturity bar per feature, and the
> demos publish the losses too. 
> We believe the substrate is ideal for higher-level reasoning strategies, so the strategy here is to improve concept grammars, the providers and the prompts they generate to get what we want.
> 

Every claim on this page follows a standing rule: **a refuted claim is removed the day it falls**
(several are listed below on purpose). The full feature map — maturity bars, numbers, limits,
snippets — is **[docs/CAPABILITIES.md](docs/CAPABILITIES.md)**.

Where it sits in your setup — two zero-integration doors into one local loop:

```
 [your agent / app / any OpenAI client]
        │
        ├─► OpenAI-compatible endpoint    sg serve  →  http://127.0.0.1:4747/v1
        └─► MCP tools                     sg mcp    →  ask · hint · propose · state_recall · plan_sync · critique
                      │
                      ▼
        [typed reasoning graph]    plan · admission gates · typed ledger · JTMS memory
                      │
                      ▼
        [your local GGUF model]    — nothing leaves the machine
```

> **Two packages, one loop.** This repo — **`skynet-graph`** — is a **minimal core + the capabilities as
> plugins**: the reasoning engine, and each capability (C1–C9 + the forge) packaged as an installable
> plugin that *activates* it for a task type (factories on `Graph.factories.*`; see
> [Architecture](#architecture--a-minimal-core-capabilities-as-plugins) below).
> **[mindsmith](https://www.npmjs.com/package/mindsmith)** is the ready-made
> **app that actually uses them** — the endpoint + MCP tools + local rooms drawn above, assembled and
> hardened. **To *run* this on your model → `npx mindsmith serve`. Embed skynet-graph to *build* your own.**

---

## Capabilities & maturity

The measured detail — numbers, negative controls, limits and snippets per feature — lives in
**[docs/CAPABILITIES.md](docs/CAPABILITIES.md)**; **[mindsmith](https://www.npmjs.com/package/mindsmith)**
is where those capabilities are framed and put in users' hands. Maturity uses a 6-rung honest scale
(rung 6 = external replications, empty pre-launch):

| Feature — details per row in [docs/CAPABILITIES.md](docs/CAPABILITIES.md) | Maturity (6-rung honest scale; rung 6 = external replications, empty pre-launch) | Run it (deterministic, no GPU) |
|---|---|---|
| [F1 — Certified-shape steering](docs/CAPABILITIES.md#f1-low-quant-repair) | `█████░` 5/6 — product-integrated | [`c6-proxy.js`](examples/bootstrap/c6-proxy.js) · [`forge-stock.js`](examples/bootstrap/forge-stock.js) |
| [F2 — The piece-by-piece zoom](docs/CAPABILITIES.md#f2-piece-by-piece-zoom-on-big-tasks) | `████░░` 4/6 — measured at scale, not turnkey yet | [`c7-plan-loop.js`](examples/bootstrap/c7-plan-loop.js) |
| [F3 — Task memory that reopens](docs/CAPABILITIES.md#f3-task-memory-that-reopens) | `█████░` 5/6 — product-integrated | [`f3-task-memory.js`](examples/bootstrap/f3-task-memory.js) |
| [F4 — External think mode](docs/CAPABILITIES.md#f4-external-think-mode) | `█████░` 5/6 — product-integrated | [`mcp-tools.js`](examples/bootstrap/mcp-tools.js) |
| [F5 — External critical mind](docs/CAPABILITIES.md#f5-external-critical-mind) | `█████░` 5/6 — product-integrated | [`c9-critical-mind.js`](examples/bootstrap/c9-critical-mind.js) |
| [F6 — Local `.sgc` rooms](docs/CAPABILITIES.md#f6-local-sgc-rooms) | `█████░` 5/6 — product-integrated | [`c3-learning-library.js`](examples/bootstrap/c3-learning-library.js) |
| [F7 — The versionable reasoning substrate](docs/CAPABILITIES.md#f7-the-versionable-reasoning-substrate) | `█████░` 5/6 — product-integrated | [`f7-substrate.js`](examples/bootstrap/f7-substrate.js) |
| [The integrated demo](docs/CAPABILITIES.md#the-integrated-demo) | `█████░` 5/6 — ships in this repo | [`integrated-demo/run.js --replay`](examples/integrated-demo/) |

Every file in that last column is **deterministic, model-free and GPU-free**, prints the guarantee it
demonstrates, and is executed by the test suite — so a claim on this page that stopped being true would
break the build. The map of all of them is [`examples/README.md`](examples/README.md).

The certified vocabulary these capabilities lean on is **fuel, not the headline**: a *forge* (`sg forge`)
builds `.sgc` method stocks from any dataset that has an executable oracle, behind a **zero-false-admission**
gate (held across every campaign: 0 false shapes admitted, 3 datasets, 2 forge models) — each stock ships
with an auditable sha256 validation dossier.

### What this answers

Agent frameworks bury reasoning inside prompts, callbacks and framework nodes. Four questions they
struggle to answer — that a typed graph answers in *executable* form:

- **Where does the reasoning live?** In declarative concept rules + a typed fact ledger, not in prose (`concepts/`, [docs/API.md](docs/API.md)).
- **Can a step be tested on its own?** Each concept is a pure rule with typed pre/post-conditions; `sg validate` checks them at author time.
- **Can it be reused across tasks?** A learned sub-graph *is* a method, carried by its typed contract — it composes, and **un-learns** when its premise drifts.
- **Can a run be traced and replayed?** Bit-for-bit: `--replay` re-derives the whole run at 0 model calls, and every fact carries its provenance.

### Why not just…?

Each row is a measured delta **or** a checked absence — never a vibe. The last column is the part most
comparisons quietly drop.

| Instead of… | you'd get | skynet-graph gives | …and does **not** claim |
|---|---|---|---|
| a bigger / frontier model — or a **closed reasoning layer** (e.g. CoreThink, which wraps Claude 4 / Grok 4) | more raw capability, at API cost, off-machine | typed gates + deterministic replay on **your own local** model; nothing leaves the machine | that it out-raw-reasons a frontier model, or any big-model number we have not measured |
| a decomposition framework (LLMCompiler, ReWOO) | a task DAG | a **typed** DAG where each step sees only a bounded neighbourhood, behind an admission gate | that the small model is the task *cutter* (a measured limit) |
| LLM-as-judge | a verdict, always | every argument on the record with the evidence under it, unsupported points refused by name, and zero-false coverage off certified perimeters | a verdict: weighing the arguments is the model's job — the graph makes them auditable, not decidable |
| a RAG skill-library | retrieved snippets | typed methods that **un-learn** when their premise drifts — the moat no RAG index has | that novel, free-prose reasoning amortizes |
| a native "think" mode | a longer in-model CoT | an external critic that refutes with the reason + the admissible options, and puts every argument on the record with the evidence carrying it — the model's own new angles included, gated the same way | to weigh the arguments for you: the pool is auditable, the judgment over it is still the model's |
| a rules engine | deterministic rules | rules **+** truth maintenance: a falsified premise un-casts itself *and its consequences*, with no rollback code | hand-encoded completeness — the rules are learned and defeasible |

The per-feature numbers behind each row live in **[docs/CAPABILITIES.md](docs/CAPABILITIES.md)**.

**What is honestly NOT claimed** (each of these was tested, and the page follows the results):
- the guarantee is **at admission, not at execution** — at use time the stock *orients*; a suggestion is not
  a correctness proof (a runtime "trusted answers" tier was tested and **refuted** — removed);
- the win lives on the **typed, recurrent slice** of the work: free prose and genuinely novel reasoning stay
  in the model, without guarantee — a design boundary, not a bug;
- forge yield is a **per-domain parameter** (not model-invariant — refuted), and amortization is a property
  of the *domain's* stereotypy;
- the small model executes surface steps well; it is **not** the task cutter (measured limit);
- a **verdict** (weighing which side wins) is reliable **on certified perimeters** or at wide margins;
  on free, uncertified content the engine renders **counts + zero-false coverage + an honest UNDECIDED**,
  not a verdict — the measured decidability bound, kept rather than papered over (graded weighting and
  goal-criteria weighting were both tested and **refuted** for a low-quant judge).

## Quick start

**Run the demos + tests** — from a clone (the demos and the test suite are not in the npm tarball; npm is for
*embedding the library in your app*, see just below):

```bash
git clone https://github.com/9pings/skynet-graph && cd skynet-graph
npm install        # no build step — pure CommonJS, Node 18+
npm test           # 1350 tests — 0 failures, 2 known skips
node bin/sg run --concepts ./concepts --builtins --seed ./seed.json
node examples/integrated-demo/run.js --replay    # the four capabilities assembled, no GPU
```

**Embed it in your app** — `npm install skynet-graph`, then:

```js
const Graph = require('skynet-graph');

// boot from folders of concept rules + providers, stabilize, read facts:
const g = Graph.fromDirs({
  concepts: './concepts',
  builtins: true,                                  // wire the packaged geo + LLM providers
  seed: { conceptMaps: [
    { _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },
    { _id: 'b', Node: true, Position: { lat: 1.35,  lng: 103.8 } },
    { _id: 's', Segment: true, originNode: 'a', targetNode: 'b' },
  ]},
  conf: { onStabilize: g => console.log(g.serialize().graph) },   // s now carries Distance { inKm: 10728 }
});
```

The `LLM::complete` provider is backend-agnostic: inject any async `ask`, or use the bundled client
(`LLM_API=anthropic`, default; `LLM_API=openai` for vLLM / llama.cpp / LM-Studio).

### Serve it — zero-integration surfaces

```bash
# OpenAI-compatible endpoint over the local-first proxy cache: point ANY OpenAI client's baseURL at it.
# Covered queries → served from the verified local stock at 0 frontier calls; provenance headers on every
# completion (x-sg-*); 0 hallucination by construction on the covered slice.
sg serve --frontier-model <path.gguf> --store ./stock.json          # → http://127.0.0.1:4747/v1

# The same capabilities as MCP TOOLS for an agent host (typed refusals arrive STRUCTURED):
claude mcp add sg -- node bin/sg mcp --frontier-model <path.gguf> --store ./stock.json

# One-command typed QA, and the visual debugger:
sg ask "your question" --concepts ./concepts --local-model <path.gguf>
sg studio            # (or: sg serve --studio — live request lines in its trace panel)
```


Runnable, deterministic, GPU-free demos of every use-case class live (in the repo) under
**`examples/bootstrap/`** — one short file per capability and per surface, each printing the guarantee it demonstrates.


## Architecture — a minimal core, capabilities as plugins

The repo is not a monolith. A small **core** — the engine (`lib/graph/`, filesystem-free: typed facts,
concepts, stabilization, JTMS) plus the authoring & contract toolkit (`lib/authoring/`) — and the
capabilities packaged as **plugins** under `plugins/`, each a self-contained, droppable bundle
`{ manifest, concept grammar in files, optional JS providers, optional packaged factory }`:

| Plugin | What it ships |
|---|---|
| `reason-kernel` | the shared reasoning foundation: the append-only **Ledger**, the margin decidability gate, the `Score` band, the generic `Thought` + typed `Relation` concepts, the `Mark` watched-mirror brick |
| `critical-mind` | C9 — the external critical mind: witness gate, anchored 0-fabrication generation, typed ledger, certification-aware margin verdict *(deps: reason-kernel)* |
| **the strategy pack** — `self-consistency` · `refinement` (+ `reflexion`) · `socratic` · `least-to-most` · `analogical` · `react-loop` | **Tier-0, pure grammar (zero JS)**: the reasoning strategies as deposited concept sets — see [Reasoning strategies](#reasoning-strategies--one-kernel-deposited-sets) below *(deps: reason-kernel)* |
| `tree-of-thoughts` · `mcts` | Tier-1: state-in-graph + a thin deterministic search driver (beam / UCB1) — the selection policy is an argmax across siblings, which the per-object rule DSL cannot express *(deps: reason-kernel)* |
| `planner` | C7 — the plan loop / piece-by-piece zoom: the decompose grammar + the projection engine + `createPlanLoop` |
| `learning` | the DLL toolkit (crystallize / mine / adapt / method-pack) + `createLearningLibrary` (C3) |
| `forge` | dataset + executable oracle → gold-gated `.sgc` method stock + sha256 dossier — what `sg forge` runs *(deps: learning)* |
| `durable` | C2 — the durable workflow executor: checkpoint store + `compileMethod` + `runFlow` + audit (`createDurableRunner`) |
| `mixture-serve` | C8 — the mixture-runtime server: a cheap local model oriented by a certified stock, the rest escalated to a bigger tier |

*(Fifteen plugins in total — the six strategy sets are grouped in the two rows above to keep the table
readable; `sg plugin list plugins/` enumerates them all from their manifests without running any code.)*

- **A plugin is an npm package.** Its `index.js` exports the plugin object —
  `Graph.definePlugin(__dirname, [require('reason-kernel')])` — and its dependencies are `require`d and
  **carried as objects**. `resolvePlugins` flattens that object graph (dedup, topo-sort, semver check,
  one claimer per provider namespace) and never fetches anything: npm + `require` do all resolution.
- **Two trust tiers.** Tier-0 = grammar + `.sgc` only, no JS — safe by construction (the concept DSL is
  a compiled expression evaluator: no I/O, no eval). Tier-1 = JS providers/factories — full power, so
  trust is required. The discipline: push capability into Tier-0 grammar; keep Tier-1 for genuinely new
  providers.
- **Grammar lives in files** (`concepts/<set>/*.json`), never hard-coded in JS — a capability can be
  read, diffed, validated and versioned like data.
- **Tooling — `sg plugin`**: `list` (manifests only, no code run) · `validate <dir>` (dependency lint +
  author-time grammar validation + derived manifest cross-checks) · `scaffold <name>` (a loadable Tier-0
  skeleton). Every bundled plugin validates at zero errors — enforced by the test suite.
- **Everything stays usable bare.** Each plugin's factory is re-exported on the flat `Graph.factories.*`
  catalog, and every underlying module remains importable on its own — the plugin layer is packaging,
  not a gate. A few assemblies still live in `lib/factories/` (the C1 typed-QA appliance, the C4
  reactive-KG preset, the C5 self-mod guard, the C6 proxy cache), on the same catalog.

The full contract — manifest schema, the dependency-cycle rule, the *alphabet-is-the-API* invariant —
is **[docs/plugins.md](docs/plugins.md)**.

## Reasoning strategies — one kernel, deposited sets

Chain-of-Thought, ReAct, Tree-of-Thoughts, Reflexion, MCTS… the usual way to get these is a framework that
ships each as its own class, with its own loop, its own state and its own bugs: thirteen strategies means
thirteen implementations that share nothing.

Here **a strategy is a concept set you deposit on one shared kernel** — files, not a fork. There is no
`Strategy` class to subclass because there is no strategy *object*: it is a grammar over typed facts, and
the engine runs it like everything else. Seven of the thirteen are **Tier-0 — pure grammar, zero JS**:
nothing of ours executes, so there is no code of ours to trust. The rest ride Tier-1 plugins — readable
JS (the debate's LLM leaves, the planner's projection engine, two ~60-line search drivers), never a framework.

The contract never changes: **the host writes typed facts, the graph decides, the host reads which gates
are open.** No `run()`, no callbacks, no loop of yours to get wrong.

```js
const s = bootStrategy('least-to-most', { nodes: [ /* ranked sub-problems */ ] });
await s.settle();
s.cast('s1', 'Ready');                       // ← is this rung released? (the dataflow decided, not a scheduler)
await s.ingest({ s0: { answer: 'a0' } });    // ← the host answers; the next rung arms ITSELF
```

| Strategy | Shape here | Runnable |
|---|---|---|
| Self-Consistency | k paths → snapped votes → **the margin bound**: a tie is an honest `UNDECIDED`, never a coin flip | [`self-consistency.js`](examples/strategies/self-consistency.js) |
| Iterative Refinement | accept on a snapped **band** (never a raw float); the round budget bounds the loop structurally | [`refinement.js`](examples/strategies/refinement.js) |
| Reflexion | accept on an **external** binary verdict — an unjudged attempt fires nothing | [`reflexion.js`](examples/strategies/reflexion.js) |
| Socratic | insight tallies + a **coverage counter-gate**: you cannot conclude over a probe you skipped | [`socratic.js`](examples/strategies/socratic.js) |
| Least-to-Most | the release order **emerges from the dataflow**; an out-of-order answer is structurally refused | [`least-to-most.js`](examples/strategies/least-to-most.js) |
| Analogical | a **defeasible** transfer: retract the source case and the license uncasts in cascade, reason appended | [`analogical.js`](examples/strategies/analogical.js) |
| ReAct | the pending tool-call list is a **live cast set** that retires itself on the observation; 3 stops | [`react.js`](examples/strategies/react.js) |
| Meta-Router | classify → dispatch the matching decomposition; an off-enum label **fails closed** | [`meta-router.js`](examples/strategies/meta-router.js) |
| Tree-of-Thoughts | prune one node → the **subtree cascades out natively** (0 traversal code); a pruned branch costs 0 calls | [`tree-of-thoughts.js`](examples/strategies/tree-of-thoughts.js) |
| MCTS | UCB1 with **no `Math.random`** — the tree is the audit and two runs are byte-identical | [`mcts.js`](examples/strategies/mcts.js) |
| Adversarial Debate | **the measured one** (C9): witness gate, 0-fabrication, honest `UNDECIDED` below the margin bound | [`c9-critical-mind.js`](examples/bootstrap/c9-critical-mind.js) |
| Decomposition | C7: a typed DAG where each leaf sees only its declared upstreams | [`c7-plan-loop.js`](examples/bootstrap/c7-plan-loop.js) |
| Chain-of-Thought | a single ask — trivial, no grammar needed | — |

Every row is **deterministic and model-free**: `node examples/strategies/<file>.js` prints the guarantee it
just demonstrated, and the suite executes all of them, so the table cannot drift from the code.

**Two rules worth knowing before you build on this.** (1) **Nothing self-scores** — every score, critique or
verdict must come from an EXTERNAL source (a judge model, an oracle, a test run). That is not a gap to fill:
the generator judging itself was measured and refuted three times, so the plugins ship no such path, and
there is deliberately no `reflect`/`refine` MCP tool. (2) **Honest scope** — only the debate (C9) is
LLM-measured; the other sets are *expressible and structurally proven* (0-model tests, negative controls,
deterministic replay), not LLM-benchmarked. Both rules, the recipes, and the kernel's brick-by-brick
rationale: **[docs/strategies.md](docs/strategies.md)**.

## About the substrate

A *versionable, git-like reasoning orchestrator*, standalone, **no LLM
required**. Model a domain in declarative concept rules (JSONC), wire deterministic providers, and let
stabilization keep the belief state coherent as data changes: `rollbackTo(rev)` (rules included),
`diffRevisions(a, b)`, `fork`/`merge` sub-worlds, and native cascading retraction — a falsified premise
un-casts itself *and its consequences*, with no rollback code. A complete, tested capability on its own.
→ **[docs/usage.md](docs/usage.md)** · **[docs/architecture.md](docs/architecture.md)** · **[docs/API.md](docs/API.md)** · schema **[docs/original-2016-doc.md](docs/original-2016-doc.md)** (FR, EN pointer inside)

## Papers

Two companion preprints (Nathanael Braun, 2026), open access on Zenodo, each in English and French —
with in-repo reproducibility packages ([`artifact/paper-dll/`](artifact/paper-dll/),
[`artifact/paper-lattice/`](artifact/paper-lattice/) — every table replays bit-for-bit without a GPU).

- **“Defeasible Library Learning: Typed Methods with Runtime Contracts that Un-learn on Drift”** —
  the system paper. DOI v1 [10.5281/zenodo.21032471](https://doi.org/10.5281/zenodo.21032471) ·
  v2 [10.5281/zenodo.21201723](https://doi.org/10.5281/zenodo.21201723)
- **“Sound online growth of a typed *isa* lattice from noisy LLM extraction …”** — the companion
  admission-gate paper. DOI [10.5281/zenodo.21201877](https://doi.org/10.5281/zenodo.21201877)

<details>
<summary>BibTeX</summary>

```bibtex
@misc{braun2026dll,
  author    = {Braun, Nathanael},
  title     = {Defeasible Library Learning: Typed Methods with Runtime Contracts that Un-learn on Drift},
  year      = {2026},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.21201723},
  url       = {https://doi.org/10.5281/zenodo.21201723}
}
@misc{braun2026lattice,
  author    = {Braun, Nathanael},
  title     = {Sound online growth of a typed isa lattice from noisy LLM extraction, through candidate elimination made noise-tolerant by a localized-blame admission gate},
  year      = {2026},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.21201877},
  url       = {https://doi.org/10.5281/zenodo.21201877}
}
```
</details>

## License

GNU AGPL-3.0-or-later — see [LICENSE](./LICENSE). © 2026 Nathanael Braun &lt;pp9ping@gmail.com&gt;
