# Examples — a map (enter by the right door)

Runnable demos of skynet-graph used **à nu** (standalone). Each example boots the real engine from `../lib`.
Two kinds: **offline** (deterministic, no network) and **needs an endpoint** (an OpenAI-compatible local LLM —
set `LLM_BASE` / `LLM_MODEL` / `LLM_API=openai`; see `llm.js`). Run any with `node examples/<file>`.

## The headline — all four capabilities in one continuous run (offline replay)
- **`integrated-demo/`** — a 9.5 GB local quant works a real annual-report analysis end-to-end:
  typed plan, certified-stock repair + gated refusal (external think mode), cascading retraction +
  REOPEN (memory), bit-identical crash-replay. `node examples/integrated-demo/run.js --replay`
  verifies 7 checks with **no model and no GPU** — see its README.

## Start here — the base socle (offline)
- **`run-basic.js`** — the engine's INITIAL objective: a rule-driven knowledge graph. Mounts the shipped `common`
  concept set (travel/geo) and **stabilizes** — nodes become `Vertice`, edges get `Distance`/`Travel`/`LongTravel`
  enriched by the grammar. No LLM. This is the deterministic heart (concepts + stabilization) with nothing else.
- **`seed-travel.json`** — the same travel graph as a standalone seed file, so the base runs à-nu through the CLI:
  `node bin/sg run --concepts ./concepts/common --builtins --seed examples/seed-travel.json` (→ 5 stabilized objects).

## The creative loop — authoring à nu (offline)
- **`creative-loop.js`** — the five authoring tools end-to-end, deterministic: **crystallize** a re-mountable
  defeasible method → **library** dispatch (O(1) by FrontierSignature) → **adapt-or-forge** (hit at 0 calls /
  antiUnify content-forge + amortise) → **combinator** (reuse a method under a *different* concept) → **blend**
  (combinational synthesis of a novel composite + `synthesizeByBlend`, bounded). Swap the stub for a real model.

## LLM-driven (needs an endpoint)
- **`run-prompt.js`** — an `LLM::complete` concept enriching objects with the canonicalization barrier (typed facts
  tracked, prose untracked). | **`run-problem.js`** — recursive plan-graph decomposition driven by the model.
- Helpers: **`llm.js`** (wire a backend `ask`), **`load.js`** (load concepts/providers from dirs via `fromDirs`).

## `poc/` — capability demos (by theme)
> Offline unless flagged ⚡ (needs an endpoint).

- **Domain grammars:** `clinical.js`, `supply.js`, `demo.js`, `trip-decompose.js` — hand-authored concept grammars.
- **Contracts & un-learning:** `contract-compose.js`, `contract-unlearn.js`, `durable-contract.js` ⚡ —
  the separation-triple checker, blame → revise, defeasance.
- **Library learning / methods:** `method-instance.js`, `concept-bridge.js`, `concept-population.js`,
  `learn-nogood.js`, `equilibrium.js`, `cache-instances.js`, `plasticity.js` ⚡ — crystallize/abstract/cache.
- **Problem-solving (search/decompose):** `problem-paths.js` ⚡, `problem-domain.js` ⚡, `problem-domain-dag.js` ⚡,
  `problem-delegate.js` ⚡, `problem-adjacency.js`, `problem-bounded.js`,
  `problem-worker.js` ⚡, `worker-solver-provider.js` ⚡ — the support grammar (Attempt/Candidate/Selected).
- **Master / supervisor loop:** `master-graph.js`, `bounded-context.js` ⚡ — retrieve-or-forge,
  partial-collapse-on-drift, bounded context.
- **Durable executor:** `durable-flow.js` ⚡, `durable-mapreduce.js` ⚡, `durable-contract.js` ⚡ — Layer-A/B
  checkpoint store + interpreter (map/fold/join, crash-resume).
- **Distributed / forks:** `fork-driver.js` — fork/merge sub-graphs.

## More
- Library + CLI guide: `../doc/usage.md`. Architecture + honest limits: `../doc/architecture.md`. Public API:
  `../doc/API.md`. The standalone `sg` CLI: `node ../bin/sg run --concepts ../concepts --builtins`.
