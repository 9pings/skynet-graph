<h1 align="center">skynet-graph</h1>

<p align="center">
<b>Make a small local model work a big task the way humans always have — piece by piece.</b><br>
The engine cuts the task into typed pieces, <i>zooms</i> the model onto one piece at a time with exactly
the context it needs, keeps every result as a typed fact with provenance so a late correction re-derives
for free, and steers the model's output against a certified method vocabulary. Nothing leaves the machine.
</p>

<p align="center">
<img src="./doc/img/headImg.png">
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

**skynet-graph is the low-level reasoning substrate + a library of composable combos** — the engine you
*embed*. The substrate is a versionable, git-like reasoning graph: declarative concept rules + provider
functions driven to a coherent belief state by stabilization, with native cascading retraction and
rollback / fork / merge on what the system currently holds true. On top of it, a set of **combos**
(`Graph.combos.*`, C1–C9 + the forge) each turn on one capability for a task type — the *bricks* an
application assembles.

For a small local model those bricks add up to four capabilities (one line each here; the measured
numbers, negative controls, limits and maturity live in **[doc/CAPABILITIES.md](doc/CAPABILITIES.md)**):

- **Piece-by-piece** — works a big task one bounded piece at a time: **×2.5–3.2** on multi-step tasks, and where whole-context prompting collapses (**0/33**) the pieces hold (**10/33**).
- **Low-quant repair** — certified method shapes steer the output: SQL **8→63 %**, finance **7→62 %**, at zero big-model calls on covered queries.
- **Task memory that reopens** — a late correction retracts its consequences in cascade; "done" steps reopen with the reason, at 0 model calls.
- **External think mode** — the model proposes, the graph refutes with the reason: a native think budget scores **13/24 ≈ chance**, the external critical mind **0 wrong verdicts**.

These are the building blocks; **[mindsmith](https://www.npmjs.com/package/mindsmith) is the public façade
that puts them in users' hands** (an OpenAI endpoint + MCP tools + local rooms). This repo is what mindsmith
— or your own app — is built on.

**See it in 30 seconds — no model, no GPU** (a deterministic replay of a real end-to-end run — the
9.5 GB quant analyzing an annual report, erratum and crash included):

```bash
git clone https://github.com/9pings/skynet-graph && cd skynet-graph
npm install && node examples/integrated-demo/run.js --replay      # 7 checks, bit-identical
```

Every claim on this page follows a standing rule: **a refuted claim is removed the day it falls**
(several are listed below on purpose). The full feature map — maturity bars, numbers, limits,
snippets — is **[doc/CAPABILITIES.md](doc/CAPABILITIES.md)**.

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

> **Two packages, one loop.** This repo — **`skynet-graph`** — is the **substrate + the combos**: the
> reasoning engine and the composable bricks (`Graph.combos.*`, C1–C9 + the forge) that each *activate* a
> capability for a task type. **[mindsmith](https://www.npmjs.com/package/mindsmith)** is the ready-made
> **app that actually uses them** — the endpoint + MCP tools + local rooms drawn above, assembled and
> hardened. **To *run* this on your model → `npx mindsmith serve`. Embed skynet-graph to *build* your own.**

---

## Capabilities & maturity

The measured detail — numbers, negative controls, limits and snippets per feature — lives in
**[doc/CAPABILITIES.md](doc/CAPABILITIES.md)**; **[mindsmith](https://www.npmjs.com/package/mindsmith)**
is where those capabilities are framed and put in users' hands. Maturity uses a 6-rung honest scale
(rung 6 = external replications, empty pre-launch):

| Feature — details per row in [doc/CAPABILITIES.md](doc/CAPABILITIES.md) | Maturity (6-rung honest scale; rung 6 = external replications, empty pre-launch) |
|---|---|
| [F1 — Repair low-quants](doc/CAPABILITIES.md#f1-low-quant-repair) | `█████░` 5/6 — product-integrated |
| [F2 — The piece-by-piece zoom](doc/CAPABILITIES.md#f2-piece-by-piece-zoom-on-big-tasks) | `████░░` 4/6 — measured at scale, not turnkey yet |
| [F3 — Task memory that reopens](doc/CAPABILITIES.md#f3-task-memory-that-reopens) | `█████░` 5/6 — product-integrated |
| [F4 — External think mode](doc/CAPABILITIES.md#f4-external-think-mode) | `█████░` 5/6 — product-integrated |
| [F5 — External critical mind](doc/CAPABILITIES.md#f5-external-critical-mind) | `█████░` 5/6 — product-integrated |
| [F6 — Local `.sgc` rooms](doc/CAPABILITIES.md#f6-local-sgc-rooms) | `█████░` 5/6 — product-integrated |
| [F7 — The versionable reasoning substrate](doc/CAPABILITIES.md#f7-the-versionable-reasoning-substrate) | `█████░` 5/6 — product-integrated |
| [The integrated demo](doc/CAPABILITIES.md#the-integrated-demo) | `█████░` 5/6 — ships in this repo |

The certified vocabulary these capabilities lean on is **fuel, not the headline**: a *forge* (`sg forge`)
builds `.sgc` method stocks from any dataset that has an executable oracle, behind a **zero-false-admission**
gate (held across every campaign: 0 false shapes admitted, 3 datasets, 2 forge models) — each stock ships
with an auditable sha256 validation dossier.

### Where it beats what you'd reach for

The head-to-head against a bigger model, an agent scratchpad, a decomposition framework, a native think
mode, LLM-as-judge, a RAG method-index, or a rules engine — each a measured delta or a checked absence —
is framed for users in **[mindsmith](https://www.npmjs.com/package/mindsmith)**'s "Why not just…?", with
the per-feature numbers behind each in **[doc/CAPABILITIES.md](doc/CAPABILITIES.md)**.

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

Runnable, deterministic, GPU-free demos of every use-case class live in **`examples/bootstrap/`** —
one short file per combo and per surface, each printing the guarantee it demonstrates.

> **The app that uses these — [mindsmith](https://www.npmjs.com/package/mindsmith).** The endpoint + rooms
> above, packaged and hardened: `npx mindsmith serve` (OpenAI-compatible, no-egress by default, proven on
> real sockets) · `mindsmith rooms list|import|export|freeze` (your own shareable stock mini-repos — no
> catalog, no subscription, sha256 dossiers). Embed *this* library instead when you are building your own.
>
> **For AI agents reading this repo**: `CLAUDE.md` at the root is the machine-oriented map (architecture,
> commands, gotchas); the MCP surface is one command away (`claude mcp add sg -- node bin/sg mcp …`).

## Two ways to use it — and how it works

The library is **one engine with two front doors**; they share the same core, and you can stop at the first.

![the two uses](doc/img/two-uses.svg)

**Use 1 — the substrate**: a *versionable, git-like reasoning orchestrator*, standalone, **no LLM
required**. Model a domain in declarative concept rules (JSONC), wire deterministic providers, and let
stabilization keep the belief state coherent as data changes: `rollbackTo(rev)` (rules included),
`diffRevisions(a, b)`, `fork`/`merge` sub-worlds, and native cascading retraction — a falsified premise
un-casts itself *and its consequences*, with no rollback code. A complete, tested capability on its own.
→ **[doc/usage.md](doc/usage.md)** · **[doc/architecture.md](doc/architecture.md)** · **[doc/API.md](doc/API.md)** · schema **[doc/original-2016-doc.md](doc/original-2016-doc.md)** (FR, EN pointer inside)

**Use 2 — the target system**, built on Use 1: a learned **concept-graph is a method** — a reusable
sub-graph carried by its **typed contract, not its body**, so each step sees only a bounded
neighbourhood. The supervisor forges methods, crystallizes the recurrent ones into reusable tools,
composes tools into bigger tools — and **un-learns** a method when its premise drifts (the moat no
RAG / skill-library has). Everything keys on **discrete, typed facts** — never free prose — which is
both what makes the memoization hit and the honest ceiling: only recurrent, typed, canonicalizable
structure amortizes; genuinely novel reasoning stays in the model.
→ **[doc/concept-as-graph.md](doc/concept-as-graph.md)** · full model + roadmap **[doc/MODELISATION.md](doc/MODELISATION.md)**

> **Heads-up.** Active R&D. Use 1 is solid and tested; Use 2 is an advancing conception with measured
> PoCs (not a product). How best to organize concepts is still open — treat the shipped `concepts/`
> sets as illustrative, not a recommended ontology.

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
