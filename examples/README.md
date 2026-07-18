# Examples — the map (enter by the right door)

Runnable demos of skynet-graph used **à nu** (standalone). Each boots the real engine from `../lib` — no
mocks. Two kinds: **offline** (deterministic, no model, no GPU — the default) and **⚡ needs an endpoint**
(an OpenAI-compatible local LLM: set `LLM_BASE` / `LLM_MODEL` / `LLM_API=openai`; see `llm.js`).

Everything under `bootstrap/` and `strategies/` is **executed by the test suite** (`bootstrap-smoke.test.js`,
`strategies-smoke.test.js`): each file exits 0 and prints the guarantee it demonstrates
(`BOOTSTRAP OK — …` / `STRATEGY OK — …`). They cannot rot, and neither can the README claims they back.

```
examples/
  bootstrap/      one file per CAPABILITY (C1-C9) + the forge + the two engine-native features + the surfaces
  strategies/     one file per REASONING STRATEGY (the 13-strategy catalog)
  integrated-demo/  the headline: all four capabilities in one continuous, replayable run
  forge-adapters/   dataset adapters for `sg forge` (finqa / spider / wikisql)
  poc/            the R&D proof-of-concept trail (34 deeper demos, by theme)
  *.js            the à-nu tour: run-basic · run-prompt ⚡ · run-problem ⚡ · creative-loop
```

## The headline — all four capabilities in one continuous run (offline replay)

- **`integrated-demo/`** — a 9.5 GB local quant works a real annual-report analysis end-to-end: typed plan,
  certified-stock repair + gated refusal (external think mode), cascading retraction + REOPEN (memory),
  bit-identical crash-replay. `node examples/integrated-demo/run.js --replay` verifies 7 checks with **no
  model and no GPU** — see its README.

## By README feature — every claim on the front page, runnable

| Feature (README) | Run it | What it proves |
|---|---|---|
| **F1** — certified-shape steering | `bootstrap/c6-proxy.js` · `bootstrap/forge-stock.js` | covered → served local at 0 frontier calls, **0 hallucination**; the stock behind it is forged at **0 false admissions**, proven non-vacuous by a live neg-control |
| **F2** — the piece-by-piece zoom | `bootstrap/c7-plan-loop.js` | each leaf sees **only its declared upstreams**; a severed leaf is REFUSED at projection, never guessed |
| **F3** — task memory that reopens | `bootstrap/f3-task-memory.js` | a corrected premise re-derives at **0 model calls**; a withdrawn one leaves a HOLE and **REOPENS** the dependent tasks, with the reason |
| **F4** — external think mode | `bootstrap/mcp-tools.js` | structured answers AND **structured typed refusals**; no direct-write tool |
| **F5** — external critical mind | `bootstrap/c9-critical-mind.js` | points enter only with witnesses; the gate refuses the model's **own** under-witnessed thesis; honest UNDECIDED below the margin bound |
| **F6** — local `.sgc` rooms | `bootstrap/c3-learning-library.js` | one forge per method **class**, repeats elided, restart at 0 forges, `.sgc` shippable |
| **F7** — the versionable substrate | `bootstrap/f7-substrate.js` | every settle is a revision; diff is structural; **rollback restores the RULES too**; a fork is a real sandbox |

## `bootstrap/` — one file per capability + surface

| File | Capability / surface | The guarantee it shows |
|---|---|---|
| `c6-proxy.js` | **C6 `createProxyCache`** — the main use case | covered → served local (0 frontier calls), miss → escalate, **0 hallucination**, drift → re-escalate |
| `c1-appliance.js` | C1 `createAppliance` — typed QA | typed question answered; OOV intake **refused, naming the missing requirement** |
| `c2-durable.js` | C2 `createDurableRunner` | recurrent stream **amortized** (task calls ≪ naive), full **audit**; file store = exact crash-resume |
| `c3-learning-library.js` | C3 `createLearningLibrary` | one expensive forge per method **class**, repeats elided, **restart at 0 forges**, `.sgc` shippable |
| `c4-reactive-kg.js` | C4 `reactiveKG` — the original use | concept rules **enrich the data** (Distance cast from Positions), every stabilize = a revision |
| `c5-self-mod.js` | C5 `createSelfMod` (opt-in, guarded) | a live rule **authored under supervision** (CEGIS: validator + counterexamples), reversible |
| `c7-plan-loop.js` | C7 `createPlanLoop` | bounded context per leaf · **REFUSED, not guessed** on a severed leaf · a degenerate plan converges |
| `c8-mixture-serve.js` | C8 `createMixtureServe` | **fail-closed by default**; a trusted result is always certified; agreement on an uncertified shape trusts nothing |
| `c9-critical-mind.js` | C9 `createCriticalMind` | witness gate · the generation gate refuses the model's own thesis · honest UNDECIDED · refusal at **0 asks** |
| `forge-stock.js` | `forgeStock` — what `sg forge` runs | **0 false admissions**, live neg-control, the stock reloads, the dossier binds the `.sgc` by **sha256** |
| `f3-task-memory.js` | the JTMS memory (F3) | re-derive at 0 calls on a correction · **REOPEN with the reason** on a withdrawal · idempotent sync |
| `f7-substrate.js` | the versionable substrate (F7) | revisions · structural diff · **rollback restores the rules** · fork = sandbox until an explicit merge |
| `openai-client.js` | surface `sg serve` (OpenAI-compatible) | the standard OpenAI wire; repeat served local, **provenance headers** on every response |
| `mcp-tools.js` | the MCP toolkit (served by `mindsmith mcp`) | structured answers AND **structured typed refusals**; no direct-write tool |
| `zoom-tool.js` | the `zoom` MCP tool (F2 on the agentic surface) | the HOST declares the plan; **bounded serving proven on the prompt strings** · a plan hole = typed refusal at **0 model calls** · the cost-ladder `economy` readout |

Some accept `--live` (e.g. `FRONTIER_MODEL=<path.gguf> node c6-proxy.js --live`) to run the same flow on an
embedded gguf instead of the stub.

## `strategies/` — one file per reasoning strategy

The 13-strategy catalog as **deposited concept sets on one kernel** (Tier-0 = pure grammar, zero JS). The
host writes facts, the graph decides, the host reads the gates — there is no strategy API to call.
See **[strategies/README.md](strategies/README.md)** for the table, and **[../docs/strategies.md](../docs/strategies.md)**
for the recipes and the honest scope (only the debate, C9, is LLM-measured).

`self-consistency` · `refinement` · `reflexion` · `socratic` · `least-to-most` · `analogical` · `react` ·
`meta-router` · `tree-of-thoughts` · `mcts` — plus the two that live in `bootstrap/` because they are
capabilities (Debate = `c9-critical-mind.js`, Decomposition = `c7-plan-loop.js`).

## The base socle (offline)

- **`run-basic.js`** — the engine's INITIAL objective: a rule-driven knowledge graph. Mounts the shipped
  `common` concept set (travel/geo) and **stabilizes** — nodes become `Vertice`, edges get
  `Distance`/`Travel`/`LongTravel` enriched by the grammar. No LLM. The deterministic heart, nothing else.
- **`seed-travel.json`** — the same travel graph as a standalone seed, so the base runs à-nu through the CLI:
  `node bin/sg run --concepts ./concepts/common --builtins --seed examples/seed-travel.json` (→ 5 stabilized objects).
- **`creative-loop.js`** — the five authoring tools end-to-end, deterministic: **crystallize** a re-mountable
  defeasible method → **library** dispatch (O(1) by FrontierSignature) → **adapt-or-forge** (hit at 0 calls /
  antiUnify content-forge + amortise) → **combinator** (reuse a method under a *different* concept) →
  **blend** (combinational synthesis of a novel composite, bounded). Swap the stub for a real model.

## LLM-driven (⚡ needs an endpoint)

- **`run-prompt.js`** — an `LLM::complete` concept enriching objects with the canonicalization barrier (typed
  facts tracked, prose untracked). | **`run-problem.js`** — recursive plan-graph decomposition driven by the model.
- Helpers: **`llm.js`** (wire a backend `ask`), **`load.js`** (load concepts/providers from dirs via `fromDirs`).

## `poc/` — the R&D trail (by theme)

> Offline unless flagged ⚡. These are the proof-of-concept trail, not the vitrine: deeper, rougher, and not
> all smoke-tested. Start with `bootstrap/` and `strategies/`; come here when you want the workings.

- **Domain grammars:** `clinical.js`, `supply.js`, `demo.js`, `trip-decompose.js` — hand-authored concept grammars.
- **Contracts & un-learning:** `contract-compose.js`, `contract-unlearn.js`, `durable-contract.js` ⚡ —
  the separation-triple checker, blame → revise, defeasance.
- **Library learning / methods:** `method-instance.js`, `concept-bridge.js`, `concept-population.js`,
  `learn-nogood.js`, `equilibrium.js`, `cache-instances.js`, `plasticity.js` ⚡ — crystallize/abstract/cache.
- **Problem-solving (search/decompose):** `problem-paths.js` ⚡, `problem-domain.js` ⚡, `problem-domain-dag.js` ⚡,
  `problem-delegate.js` ⚡, `problem-adjacency.js`, `problem-bounded.js`, `problem-worker.js` ⚡,
  `worker-solver-provider.js` ⚡ — the support grammar (Attempt/Candidate/Selected).
- **Master / supervisor loop:** `master-graph.js`, `bounded-context.js` ⚡ — retrieve-or-forge,
  partial-collapse-on-drift, bounded context.
- **Durable executor:** `durable-flow.js` ⚡, `durable-mapreduce.js` ⚡, `durable-contract.js` ⚡ — Layer-A/B
  checkpoint store + interpreter (map/fold/join, crash-resume).
- **Distributed / forks:** `fork-driver.js` — fork/merge sub-graphs.

## More

Library + CLI guide: **[../docs/usage.md](../docs/usage.md)** · Reasoning strategies:
**[../docs/strategies.md](../docs/strategies.md)** · Architecture + honest limits:
**[../docs/architecture.md](../docs/architecture.md)** · Public API: **[../docs/API.md](../docs/API.md)** ·
Plugin contract: **[../docs/plugins.md](../docs/plugins.md)**. The standalone CLI:
`node ../bin/sg run --concepts ../concepts --builtins`.
