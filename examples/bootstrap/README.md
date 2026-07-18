# Bootstraps — one runnable file per use-case class

Each file here is a SHORT, didactic, **deterministic** demo of one capability (one class of needs) or one
integration surface. No GPU, no network, no model: run any of them with plain `node`, they exit 0 and print
the **guarantee** they demonstrate (`BOOTSTRAP OK — …`). They are executed by the test suite
(`tests/integration/bootstrap-smoke.test.js`), so they cannot rot — and neither can the README claims they
back: every feature F1-F7 on the front page has its file here (see [`../README.md`](../README.md) for the
feature→file map).

These are the *vitrine*; the R&D proof-of-concept trail lives in `../poc/` (34 deeper POCs) and the full
original-use tour in `../run-basic.js`.

| File | Capability / surface | The guarantee it shows |
|---|---|---|
| `c6-proxy.js` | **C6 `createProxyCache`** — the main use case | covered → served local (0 frontier calls), miss → escalate, **0 hallucination**, drift → re-escalate |
| `c1-appliance.js` | C1 `createAppliance` — typed QA | typed question answered; OOV intake **refused, naming the missing requirement** — never a wrong answer |
| `c2-durable.js` | C2 `createDurableRunner` | recurrent stream **amortized** (task calls ≪ naive), full **audit**; file store = exact crash-resume |
| `c3-learning-library.js` | C3 `createLearningLibrary` | one expensive forge per method **class**, repeats elided, **restart at 0 forges**, `.sgc` shippable |
| `c4-reactive-kg.js` | C4 `reactiveKG` — the original use | concept rules **enrich the data** (Distance cast from Positions), every stabilize = a revision |
| `c5-self-mod.js` | C5 `createSelfMod` (opt-in, guarded) | a live rule **authored under supervision** (CEGIS: validator + counterexamples), reversible |
| `c7-plan-loop.js` | C7 `createPlanLoop` — the piece-by-piece zoom | each leaf sees **only its declared upstreams**; a severed leaf is **REFUSED at projection**, never guessed; a degenerate plan converges |
| `c8-mixture-serve.js` | C8 `createMixtureServe` | **fail-closed by default**; a trusted result is always certified; agreement on an **uncertified** shape trusts nothing (0-false lives at admission) |
| `c9-critical-mind.js` | C9 `createCriticalMind` — the external critic | points enter only **with witnesses**; the gate refuses the model's **own** under-witnessed thesis; honest UNDECIDED; a thin pool refused at **0 asks** |
| `forge-stock.js` | `forgeStock` — what `sg forge` runs | **0 false admissions**, proven non-vacuous by a live **neg-control**; the stock reloads; the dossier binds the exact `.sgc` by **sha256** |
| `f3-task-memory.js` | the JTMS task memory (**F3**) | a corrected premise **re-derives at 0 model calls**; a withdrawn one leaves a **HOLE** and **REOPENS** the dependent tasks, with the reason |
| `f7-substrate.js` | the versionable substrate (**F7**, no LLM at all) | every settle is a revision; diff is structural; **rollback restores the RULES too**; a fork is a sandbox until an explicit merge |
| `openai-client.js` | surface `sg serve` (OpenAI-compatible) | the standard OpenAI wire; repeat served local, **provenance headers** on every response |
| `mcp-tools.js` | the MCP toolkit (served by `mindsmith mcp`) | structured answers AND **structured typed refusals**; no direct-write tool |

The reasoning **strategies** (self-consistency, ReAct, Tree-of-Thoughts, …) are the sibling directory
[`../strategies/`](../strategies/) — same rules, same smoke-runner. Two of the catalog's thirteen live
*here* rather than there, because they are capabilities in their own right: Adversarial Debate is
`c9-critical-mind.js`, Decomposition is `c7-plan-loop.js`.

## The production equivalents (one command each)

```bash
# C6 behind ANY OpenAI client (point the client's baseURL at :4747/v1):
sg serve --frontier-model <path.gguf> --store ./stock.json

# the same capabilities as MCP tools for an agent host:
claude mcp add mindsmith -- mindsmith mcp     # the appliance serves this toolkit

# typed QA appliance in one command:
sg ask "your question" --concepts ./concepts --local-model <path.gguf>

# the original reactive KG over your concept rules:
sg run --concepts ./concepts --builtins
```

Some bootstraps accept `--live` (e.g. `FRONTIER_MODEL=<path.gguf> node c6-proxy.js --live`) to run the
same flow on an embedded gguf instead of the stub.
