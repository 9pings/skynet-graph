<h1 align="center">skynet-graph</h1>

<p align="center">
<b>Make a small local model work a big task the way humans always have — piece by piece.</b><br>
The engine cuts the task into typed pieces, <i>zooms</i> the model onto one piece at a time with exactly
the context it needs, keeps every result as a typed fact with provenance so a late correction re-derives
for free, and steers the model's output against a certified method vocabulary. Nothing leaves the machine.
</p>

<p align="center">
Under the hood: a neurosymbolic <b>reasoning graph</b> — typed-fact nodes and edges, enriched by declarative
<b>concept</b> rules that cast facts when their preconditions hold and <b>retract them, cascading, when a
premise later falls</b>. A forward-chaining loop stabilizes the graph to a fixpoint; every revision is snapshotted.
</p>

<p align="center">
<img src="./doc/img/headImg.png">
</p>

<p align="center"><i>Active R&D · a CommonJS library to embed + an <code>sg</code> CLI · Node 18+, no build step · AGPL-3.0</i></p>

<p align="center">
<a href="https://doi.org/10.5281/zenodo.21032471"><img src="https://zenodo.org/badge/DOI/10.5281/zenodo.21032471.svg" alt="DOI"></a>
<a href="https://doi.org/10.5281/zenodo.21201877"><img src="https://zenodo.org/badge/DOI/10.5281/zenodo.21201877.svg" alt="DOI"></a>
</p>

---

## What it does for a small local model — four capabilities, measured

Small local models are fine on a *surface* step; they derail when a request makes them **compose** several
things at once. This library puts them in front of one surface at a time — and the effect is measured on
real GPUs, with a standing rule: a refuted claim is removed from this page the day it falls.

**Proof degrees:** **[live]** = measured on GPU with real local models · **[measured]** = deterministic,
replayable without a model · **[PoC]** = an accounting demonstration, not a benchmark.

| Capability | What happens | Measured |
|---|---|---|
| **Repair low-quants** | a menu of *certified* method shapes steers a heavily-quantized model's output — it recovers most of what compression broke, at **zero big-model calls** | SQL, covered queries: low-quant 8→**63 %** (high-quant 46→92 %), N=201 · finance, traffic view: 7→**62 %** (20→78 %), N=120 · [live] |
| **Task memory that reopens** | task state = typed facts with provenance (JTMS): a drifted premise **retracts its consequences in cascade**, and a "done" step **reopens itself with the reason** — it never rots | recomputable drift re-derives at **0 model calls**, selectively (independent facts untouched); crash-replay is bit-identical at 0 calls [live] · 100 % recall at **894 constant tokens/call** vs 50 % at 4 286 for a carry-everything baseline [PoC] |
| **Piece-by-piece (the zoom)** | the task becomes a typed DAG; each piece is served with ONLY its bounded neighbourhood (parent goal + resolved inputs + what to produce) — the model never sees the whole | a decomposed plan **beats full-context** processing 0.93 vs 0.73 at half the peak context [live] · composite queries unreachable in one shot (0 % strict) reach **55 %** by recursive split, 0 false routes on 24 controls [live, n=22] |
| **An external think mode** | the model proposes; the graph **refutes with the reason** and enumerates the admissible options (tested through its own gate, never guessed); the model revises — bounded, with honest refusal | one dialogue round: 17/24 → **24/24** correct at zero false admissions [live] · a hallucination trap converges in 2 rounds; an over-constrained input is refused, not invented [live] |

All four run assembled in **one continuous end-to-end demo** — a 9.5 GB quant handling a real annual-report
analysis: typed plan, per-step gated admission with cell-level provenance, an erratum retracting and
re-deriving selectively at 0 calls, a withdrawn value reopening its tasks, crash-replay bit-identical. [live]

The certified vocabulary these capabilities lean on is **fuel, not the headline**: a *forge* (`sg forge`)
builds `.sgc` method stocks from any dataset that has an executable oracle, behind a **zero-false-admission**
gate (held across every campaign: 0 false shapes admitted, 3 datasets, 2 forge models) — each stock ships
with an auditable sha256 validation dossier.

**What is honestly NOT claimed** (each of these was tested, and the page follows the results):
- the guarantee is **at admission, not at execution** — at use time the stock *orients*; a suggestion is not
  a correctness proof (a runtime "trusted answers" tier was tested and **refuted** — removed);
- the win lives on the **typed, recurrent slice** of the work: free prose and genuinely novel reasoning stay
  in the model, without guarantee — a design boundary, not a bug;
- forge yield is a **per-domain parameter** (not model-invariant — refuted), and amortization is a property
  of the *domain's* stereotypy;
- the small model executes surface steps well; it is **not** the task cutter (measured limit).

## Two ways to use it

The library is **one engine with two front doors**. They share the same core; you can stop at the first.

![the two uses](doc/img/two-uses.svg)

### Use 1 — the substrate: a *versionable, git-like reasoning orchestrator*

The base library, **standalone, no LLM required**. Model a domain in declarative concept rules (JSONC), wire
deterministic providers (geo, a DB, your own), and let stabilization + retraction keep the belief state coherent
as data changes. Because every stabilization is **revision-snapshotted**, the reasoning itself is
version-controlled — the control you have over *code*, applied to *belief*:

- **`rollbackTo(rev)`** — rewind to any past revision, **concept rules included** (a rolled-back self-edit stays gone).
- **`diffRevisions(a, b)`** — see exactly which beliefs changed between two points; pinpoint where a conclusion went wrong.
- **`fork` / `merge`** — branch a sub-world with its own concept pool and merge back only a snapped interface (assume-guarantee).
- **automatic retraction (JTMS)** — a falsified premise un-casts itself *and its consequences*, in cascade, with no rollback code.

This is a complete, tested capability on its own — a reactive, typed, reversible knowledge engine.
→ **[doc/usage.md](doc/usage.md)** · model **[doc/architecture.md](doc/architecture.md)** · schema **[doc/doc.md](doc/doc.md)** · **[doc/API.md](doc/API.md)**

### Use 2 — the target system: *bounded context via composable concept-subgraphs*

The R&D goal, built **on Use 1**. The thesis: a hard problem blows up an LLM's context window; here a learned
**concept-graph is a method** — a reusable sub-graph you carry by its **typed contract, not its body**, so each
step sees only a bounded neighbourhood. The supervisor **forges** methods, **crystallizes** the recurrent ones
into reusable concept-tools, and **composes tools into bigger tools** — a small typed library covering a large
space of problems, that **un-learns** a method when its premise drifts.

- **A concept-graph = a two-faced method** — outer face: a *single method with a defeasible typed contract* (a black box); inner face: *productions* (for / while / map / fold). Bounded context = carrying the contract, not the body.
- **Build / execute separation** — the **graph builds + tests** the method (the belief-view: decidable, traceable, defeasible); a separate **durable workflow engine executes** a compiled translation (crash-resumable, at scale).
- **Soundness under composition** — methods compose on their typed contracts; a wrong learned contract is **asserted at runtime, blamed, and revised** (the un-learn moat no RAG / skill-library has).

→ **[doc/concept-as-graph.md](doc/concept-as-graph.md)**

---

## What it is, concretely

Nodes and segments (directed edges) carry **typed facts** (enums, ids, numbers, booleans). **Concepts** are
declarative JSON rules: each *casts* facts onto an object when its `require` / `assert` / `ensure` preconditions
hold — and **un-casts, cascading, when an `ensure` premise later falls** (truth maintenance, no hand-written
rollback). A forward-chaining loop **stabilizes** the graph to a fixpoint. **Providers** (geo, a DB, a generic
`LLM::complete`) do the effectful work behind the rules.

![the typed-fact model](doc/img/model.svg)

The discipline that everything keys on **discrete, typed facts** — never free prose — is load-bearing: it is
what makes the incremental memo hit, and it is the ceiling (**K1**) that bounds Use 2 (only recurrent, typed,
canonicalizable structure amortizes; genuinely novel reasoning stays in the model).

## Measured

**Bounded context (Use 2).** Recovering one code planted in each of N document sections, on a real local model
(`examples/poc/bounded-context.js`):

|                              | recall            | max tokens / call                        |
|------------------------------|-------------------|------------------------------------------|
| **engine**                   | **100 %** (10/10) | **894** — one shard, independent of size |
| baseline (carry-everything)  | 50 % (5/10)       | 4 286 — truncates, can't see past it     |

Per-call context stays **constant** as the problem grows — engine **O(N)** total vs a naive **O(N²)**.

**Amortization + drift (the durable executor, Use 2).** A recurrent typed stream of 24 cases with a mid-stream
policy drift, live local model:

|                          | model calls | wall  | correct on drift |
|--------------------------|------------:|------:|------------------|
| **engine** (typed reuse) | **6**       | 1.3 s | **12/12**        |
| retrieve-nearest + adapt | 24          | 3.2 s | **0/12** (stale) |

The typed-premise key re-derives on drift; surface-similarity retrieval serves a stale answer. Replays survive a
process restart at **0 calls**. *(Both bounds are proven by accounting + a fair baseline, not by overflowing the model.)*

## Quick start

```bash
npm install        # no build step — pure CommonJS, Node 18+
npm test           # 1130+ tests

node bin/sg run --concepts ./concepts --builtins --seed ./seed.json
```

```js
const Graph = require('skynet-graph');

// Use 1 — boot from folders of concept rules + providers, stabilize, read facts:
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
# OpenAI-COMPATIBLE endpoint over the local-first proxy cache (C6): point ANY OpenAI client's baseURL
# at it — a covered query is served from the verified local stock at 0 frontier calls, a miss escalates
# and enriches. Provenance on every completion (x-sg-* headers); 0 hallucination by construction.
sg serve --frontier-model <path.gguf> --store ./stock.json          # → http://127.0.0.1:4747/v1

# The same capabilities as MCP TOOLS for an agent host (typed refusals arrive STRUCTURED):
claude mcp add sg -- node bin/sg mcp --frontier-model <path.gguf> --store ./stock.json

# One-command typed QA, and the visual debugger:
sg ask "your question" --concepts ./concepts --local-model <path.gguf>
sg studio            # (or: sg serve --studio — live request lines in its trace panel)
```

Runnable, deterministic, GPU-free demos of every use-case class live in **`examples/bootstrap/`** —
one short file per combo and per surface, each printing the guarantee it demonstrates.

> **The ready-made appliance** — if you just want the endpoint + local `.sgc` stock rooms without embedding
> the library, use **[skynet-dequantizer](https://github.com/9pings/skynet-dequantizer)**: `skynet-dequantizer serve` (OpenAI-compatible,
> no-egress by default, proven on real sockets) · `skynet-dequantizer rooms list|import|export|freeze` (your own
> shareable stock mini-repos — no catalog, no subscription, sha256 dossiers).
>
> **For AI agents reading this repo**: `CLAUDE.md` at the root is the machine-oriented map (architecture,
> commands, gotchas); the MCP surface is one command away (`claude mcp add sg -- node bin/sg mcp …`).

## Docs

**Use 1 — the substrate**

| | |
|---|---|
| [doc/usage.md](doc/usage.md) | Practical guide — concept sets, providers, the CLI, fork / rollback / diff, distributed exec |
| [doc/architecture.md](doc/architecture.md) | How the engine works in depth + the reasoning regimes (opt-in) + the honest limits |
| [doc/API.md](doc/API.md) | Public API reference |
| [doc/doc.md](doc/doc.md) | Concept-schema reference (the rule language) |

**Use 2 — the target system**

| | |
|---|---|
| [doc/concept-as-graph.md](doc/concept-as-graph.md) | The conception: the two-faced method, bounded context by contract, forge / reuse, the durable executor, the un-learn moat, the creative loop (library dispatch → mount → adapt-or-forge), and the **Construct → Method flex programme** (interface-only dispatch · multi-path Construct · bidirectional widen · the ancestry oracle behind the bag-separator Σ_sep gate) |
| [doc/MODELISATION.md](doc/MODELISATION.md) | The full model + R&D roadmap |
| [doc/concept-learning.md](doc/concept-learning.md) | *(optional, shelved)* training concept-populations at the fixpoint |

> **Heads-up.** Active R&D. Use 1 is solid and tested; Use 2 is an advancing conception with measured PoCs (not a
> product). **How best to organize concepts is still open** — treat the shipped `concepts/` sets as illustrative,
> not a recommended ontology. `examples/poc/` holds the runnable problem-solving, durable-executor, and contract demos.

## Papers

The R&D is written up as two companion preprints (Nathanael Braun, 2026), open access on Zenodo,
each in English and French.

**“Defeasible Library Learning: Typed Methods with Runtime Contracts that Un-learn on Drift”** —
the system paper: the *life* of the typed method library (amortize, compose, un-learn on drift).
Reproducibility package: [`artifact/paper-dll/`](artifact/paper-dll/) (run with `npm test`).

**DOI v1: [10.5281/zenodo.21032471](https://doi.org/10.5281/zenodo.21032471)** · **v2 (editorial
revision + harness-generated figures): [10.5281/zenodo.21201723](https://doi.org/10.5281/zenodo.21201723)**

**“Sound online growth of a typed *isa* lattice from noisy LLM extraction, through candidate
elimination made noise-tolerant by a localized-blame admission gate”** — the companion
admission-gate paper: what may *enter* the library, one gate measured at three grains (slot
restriction, *isa* edge, surface alias). Reproducibility package:
[`artifact/paper-lattice/`](artifact/paper-lattice/) — the four experiment campaigns with their
content-addressed durable memos: every table replays bit-for-bit without a GPU.

**DOI: [10.5281/zenodo.21201877](https://doi.org/10.5281/zenodo.21201877)**

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

## License

GNU AGPL-3.0-or-later — see [LICENSE](./LICENSE). © 2026 Nathanael Braun &lt;pp9ping@gmail.com&gt;
