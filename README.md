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
reuse, replay and reopen**. Made for local models; nothing leaves the machine.

Your model's reasoning today is trapped in prose: you cannot test one step in isolation, reuse it on the
next task, replay it deterministically, or reopen it when a fact changes. Skynet-graph act as an
externalized reasoning layer doing that by structure.
Basing the chosen **plugin(s)** and the prompt; the substrate mutates, cast typed
transformations, retract them when a premise fails, until it stabilizes into a stable, coherent result
state serializable on purpose.

What that buys any model, in one line each — piece-by-piece serving of tasks too big for one prompt,
certified-shape steering of the output, a task memory that *reopens* when a premise drifts, and an
external think mode where the model proposes and the graph refuses with the reason. The measured detail —
numbers, negative controls, limits, per-feature maturity bars — lives in
**[docs/CAPABILITIES.md](docs/CAPABILITIES.md)**; every claim there follows a standing rule: **a refuted
claim is removed the day it falls** (several retired ones are listed on purpose).

**See it in 30 seconds — no model, no GPU** (a deterministic replay of a real end-to-end run — a
9.5 GB local quant analyzing an annual report, erratum and crash included):

```bash
git clone https://github.com/9pings/skynet-graph && cd skynet-graph
npm install && node examples/integrated-demo/run.js --replay      # 7 checks, bit-identical
```

▶ **No clone?** Play the same recorded run in your browser — **[the live demo](https://9pings.github.io/skynet-graph/)**.

> **Active R&D.** Some of this is measured and replayable, some is proven only structurally, and plenty
> still needs work — [CAPABILITIES.md](docs/CAPABILITIES.md) carries a maturity bar per feature, and the
> demos publish the losses too.
> We believe the substrate is ideal for higher-level reasoning strategies, so the strategy here is to
> improve concept grammars, the providers and the prompts they generate to get what we want.

Where it sits in your setup — two zero-integration doors into one local loop:

```
 [your agent / app / any OpenAI client]
        │
        ├─► OpenAI-compatible endpoint    sg serve  →  http://127.0.0.1:4747/v1
        └─► MCP tools                     sg mcp    →  ask · zoom · hint · propose · state_recall · plan_sync · critique
                      │
                      ▼
        [typed reasoning graph]    plan · admission gates · typed ledger · JTMS memory
                      │
                      ▼
        [your local GGUF model]    — nothing leaves the machine
```

> **Two packages, one loop.** This repo — **`skynet-graph`** — is the **substrate + the capabilities as
> plugins**. **[mindsmith](https://www.npmjs.com/package/mindsmith)** is the ready-made app that puts
> them in users' hands: the endpoint, the MCP tool surface, the local rooms, and the **instance
> service** — named persistent graph workspaces (a living debate, a roadmap that reopens, a shared
> notepad) generated from the plugins' type descriptors. **To *run* this on your model →
> `npx mindsmith`. Embed skynet-graph to *build* your own.**

## The substrate — core features

A *versionable, git-like reasoning orchestrator*, standalone, **no LLM required**. Model a domain in
declarative concept rules, wire providers, and let stabilization keep the belief state coherent as data
changes. Everything below is core engine, model-free, and covered by the deterministic test suite:

- **Stabilization to a fixpoint.** Mutations destabilize objects; the engine keeps casting applicable
  concepts and un-casting failed ones until nothing more can fire — the settled graph *is* the result,
  serializable on purpose.
- **Truth maintenance (JTMS), native.** A falsified premise un-casts itself *and its consequences* in
  cascade, with no rollback code — and re-derives at zero model calls. This is what "a task memory that
  reopens" is made of.
- **Revisions, forks, merges.** `rollbackTo(rev)` (rules included) · `getSnapshot` / `diffRevisions` ·
  `fork`/`merge` sub-worlds. Every fact carries its provenance; revision atoms carry their author.
- **Deterministic replay.** A run re-derives bit-for-bit (`--replay`), which is also how every demo and
  paper table in this repo is verified.
- **Grammar lives in files.** Concept rules are JSONC data (`concepts/<set>/`), never hard-coded in JS —
  read, diff, validate (`sg validate`, author-time) and version a capability like data. The typed-fact
  discipline (rules key on discrete, canonicalized facts, never free prose) is what makes steps testable
  and memoizable.
- **Providers, backend-agnostic.** A concept can call a provider (`LLM::complete`, geo, verify, yours);
  inject any async `ask` — local gguf, any OpenAI-compatible endpoint, or none at all.
- **Typed-action instance descriptors.** A plugin can declare a *workspace type* (actions, projections,
  concurrency, version) — the contract the mindsmith instance service dispatches on and generates MCP
  tools from, with attribution stamped at the door.
- **Ops you can see.** One logger per graph, apply-correlated tracing (`sg trace`, `trace_tail`), a
  visual debugger (`sg studio`), `.sgc` corpus packs for exchanging learned material through admission
  gates, and a `worker_threads` runtime for distributed sub-graphs.

→ **[docs/usage.md](docs/usage.md)** · **[docs/architecture.md](docs/architecture.md)** ·
**[docs/API.md](docs/API.md)** · schema **[docs/original-2016-doc.md](docs/original-2016-doc.md)**

## Quick start

**Run the demos + tests** — from a clone (the demos and the test suite are not in the npm tarball):

```bash
git clone https://github.com/9pings/skynet-graph && cd skynet-graph
npm install        # no build step — pure CommonJS, Node 18+
npm test           # ~1530 tests — 0 failures, 2 known skips
node examples/integrated-demo/run.js --replay    # the capabilities assembled, no GPU
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

**Serve it** — zero-integration surfaces:

```bash
sg serve --frontier-model <path.gguf> --store ./stock.json    # OpenAI endpoint → http://127.0.0.1:4747/v1
claude mcp add sg -- node bin/sg mcp --frontier-model <path.gguf> --store ./stock.json   # MCP tools
sg studio                                                     # the visual debugger
```

Runnable, deterministic, GPU-free demos of every capability live under **`examples/bootstrap/`** and
**`examples/strategies/`** — one short file each, printing the guarantee it demonstrates, all executed by
the test suite (the map is [`examples/README.md`](examples/README.md)).

## Plugins — the capabilities, indexed

The repo is a small **core** (the engine `lib/graph/` + the authoring toolkit `lib/authoring/`) and the
capabilities as **plugins** under `plugins/` — each a self-contained, droppable npm package
`{ manifest, concept grammar in files, optional JS providers, optional factory, optional instance-type
descriptor }`. Two trust tiers: **Tier-0** = grammar + `.sgc` only, no JS — safe by construction;
**Tier-1** = readable JS providers/factories. Every bundled plugin validates at zero errors
(`sg plugin validate`, enforced by the suite); everything stays usable bare (`Graph.factories.*`).

| Plugin | Tier | What it ships |
|---|---|---|
| `reason-kernel` | 0 | the shared foundation: the append-only **Ledger** + margin decidability gate, `Score` bands, `Thought`/`Relation`, the `Mark` watched-mirror brick |
| `critical-mind` | 1 | C9 — the external critical mind: witness gate, 0-fabrication anchored generation, typed ledger, the judgment brief + `judgePrompt` · ships the **`dialectic` instance type** (the living debate) |
| `planner` | 1 | C7 — the plan loop / piece-by-piece zoom: decompose grammar + projection engine + `createPlanLoop` · ships the **`plan` instance type** (persistent roadmap, needs-checked at the door, `sync` = typed task-list delta) |
| `notepad` | 1 | the first **instance type** — a named persistent notepad (note/recall, attribution-first `by`); fixes the typed-action descriptor contract |
| `learning` | 1 | the DLL toolkit (crystallize / mine / adapt / method-pack) + `createLearningLibrary` (C3) |
| `forge` | 1 | dataset + executable oracle → gold-gated `.sgc` method stock + sha256 dossier — what `sg forge` runs *(deps: learning; the cookbook is [docs/forging.md](docs/forging.md))* |
| `durable` | 1 | C2 — the durable workflow executor: checkpoint store + `compileMethod` + `runFlow` + audit |
| `mixture-serve` | 1 | C8 — the mixture-runtime server: a cheap local model oriented by certified stock, the rest escalated |
| `self-consistency` | 0 | k paths → snapped votes → the margin bound (a tie is an honest UNDECIDED) |
| `refinement` | 0 | iterative refinement on a snapped score band + `reflexion` (external binary verdict), bounded rounds |
| `socratic` | 0 | insight tallies + a coverage counter-gate (no concluding over a skipped probe) |
| `least-to-most` | 0 | the release order emerges from the dataflow; out-of-order answers structurally refused |
| `analogical` | 0 | defeasible maps-to transfer — retract the source case and the license uncasts in cascade |
| `react` | 0 | the pending tool-call list as a live cast set that retires itself on the observation |
| `tree-of-thoughts` | 1 | state-in-graph + a thin deterministic beam driver; pruning cascades natively |
| `mcts` | 1 | UCB1 with no `Math.random` — the tree is the audit, two runs are byte-identical |

The full contract — manifest schema, dependencies carried as objects, the *alphabet-is-the-API*
invariant, `sg plugin list|validate|scaffold` — is **[docs/plugins.md](docs/plugins.md)**.

## Reasoning strategies — one kernel, deposited sets

Chain-of-Thought, ReAct, Tree-of-Thoughts, Reflexion, MCTS… the usual way to get these is a framework
that ships each as its own class, its own loop, its own bugs. Here **a strategy is a concept set you
deposit on one shared kernel** — files, not a fork; seven of the thirteen are **Tier-0** — pure
grammar, zero JS.
The contract never changes: *the host writes typed facts, the graph decides, the host reads which gates
are open.* Two standing rules: **nothing self-scores** (the generator judging itself was measured and
refuted — three times), and **honest scope** (only the debate, C9, is LLM-measured; the other sets are
structurally proven, not LLM-benchmarked). The catalog, one runnable file per strategy, the recipes and
the kernel's brick-by-brick rationale: **[docs/strategies.md](docs/strategies.md)** +
[`examples/strategies/`](examples/strategies/).

## Documentation

Start with **[docs/usage.md](docs/usage.md)** (practical guide: `fromDirs`, concept sets, providers, the
`sg` CLI, plugins, distributed execution), then **[docs/architecture.md](docs/architecture.md)** (how it
works + vision + honest limits). Reference: **[docs/API.md](docs/API.md)** (the public API) ·
**[docs/plugins.md](docs/plugins.md)** (the plugin contract) · **[docs/strategies.md](docs/strategies.md)**
(the reasoning-strategy page) · **[docs/CAPABILITIES.md](docs/CAPABILITIES.md)** (feature maturity, the
measured numbers and their limits) · **[docs/forging.md](docs/forging.md)** (build your own certified
stocks) · **[docs/MODELISATION.md](docs/MODELISATION.md)** (the model + roadmap) ·
**[docs/original-2016-doc.md](docs/original-2016-doc.md)** (the full concept-schema specification, FR
with EN pointer) · [`examples/README.md`](examples/README.md) (the runnable map).

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
