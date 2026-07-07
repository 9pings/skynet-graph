# Bootstraps — one runnable file per use-case class

Each file here is a SHORT, didactic, **deterministic** demo of one combo (one class of needs) or one
integration surface. No GPU, no network: run any of them with plain `node`, they exit 0 and print the
**guarantee** they demonstrate (`BOOTSTRAP OK — …`). They are executed by the test suite
(`tests/integration/bootstrap-smoke.test.js`), so they cannot rot.

These are the *vitrine*; the R&D proof-of-concept trail lives in `../poc/` (33 deeper POCs) and the full
original-use tour in `../run-basic.js`.

| File | Combo / surface | The guarantee it shows |
|---|---|---|
| `c6-proxy.js` | **C6 `createProxyCache`** — the main use case | covered → served local (0 frontier calls), miss → escalate, **0 hallucination**, drift → re-escalate |
| `c1-appliance.js` | C1 `createAppliance` — typed QA | typed question answered; OOV intake **refused, naming the missing requirement** — never a wrong answer |
| `c2-durable.js` | C2 `createDurableRunner` | recurrent stream **amortized** (task calls ≪ naive), full **audit**; file store = exact crash-resume |
| `c3-learning-library.js` | C3 `createLearningLibrary` | one expensive forge per method **class**, repeats elided, **restart at 0 forges**, `.sgc` shippable |
| `c4-reactive-kg.js` | C4 `reactiveKG` — the original use | concept rules **enrich the data** (Distance cast from Positions), every stabilize = a revision |
| `c5-self-mod.js` | C5 `createSelfMod` (opt-in, guarded) | a live rule **authored under supervision** (CEGIS: validator + counterexamples), reversible |
| `openai-client.js` | surface `sg serve` (OpenAI-compatible) | the standard OpenAI wire; repeat served local, **provenance headers** on every response |
| `mcp-tools.js` | surface `sg mcp` (MCP tools) | structured answers AND **structured typed refusals**; no direct-write tool |

## The production equivalents (one command each)

```bash
# C6 behind ANY OpenAI client (point the client's baseURL at :4747/v1):
sg serve --frontier-model <path.gguf> --store ./stock.json

# the same capabilities as MCP tools for an agent host:
claude mcp add sg -- node bin/sg mcp --frontier-model <path.gguf> --store ./stock.json

# typed QA appliance in one command:
sg ask "your question" --concepts ./concepts --local-model <path.gguf>

# the original reactive KG over your concept rules:
sg run --concepts ./concepts --builtins
```

Some bootstraps accept `--live` (e.g. `FRONTIER_MODEL=<path.gguf> node c6-proxy.js --live`) to run the
same flow on an embedded gguf instead of the stub.
