# Reproducibility artifact — "Defeasible Library Learning"

Self-contained experiment code for the paper *Defeasible Library Learning: Typed Methods with Runtime Contracts
that Un-learn on Drift*. Everything here runs against the public `skynet-graph` engine (`../../lib/`); no other
private material is required. The paper's broader R&D trail is intentionally not part of this repository.

## Layout
- `workload.js` — the typed approval workload (recurrent stream + external mid-stream premise-invalidation; known ground truth).
- `arms.js` — the seven arms behind one interface (Naive, Long-context, RAG, CBR, Skill, **Invalidating**, **STRUCT**).
- `harness.js` — deterministic-stub / live model, instrumentation (calls / tokens / wall / per-call context), scoring, the `#34` self-test.
- `e1-transfer.js` — E1, structural transfer + the −F6 ablation (bundles `F6-transfer.js`, its dependency).
- `e3-compose.js` — E3, composition soundness + the G1/G2/G3 gate ablations (uses `examples/poc/contract-compose.js`).
- `p4-coverage.js` — P4, the K1-coverage gradient + soundness boundary.
- `scale.js` — E5, bookkeeping cost at stream scale.
- `measure-e2-live.js` — E2 on a live local model (needs an OpenAI-compatible endpoint; see header).

## Reproduce
Deterministic results (no model needed):
```
node artifact/paper-dll/e1-transfer.js
node artifact/paper-dll/e3-compose.js
node artifact/paper-dll/p4-coverage.js
node artifact/paper-dll/scale.js
npm test            # incl. tests/integration/paper-*.test.js (the deterministic regression suite)
```
E2 stub results are produced by `tests/integration/paper-harness.test.js`. The live E2 table:
```
MODEL=<model> BASE=http://localhost:5000 node artifact/paper-dll/measure-e2-live.js
```

The deterministic stub is a perfect oracle of the *current* rule given only what each arm's prompt reveals, so all
staleness/cost come from each arm's mechanism, not model error (see the paper, §4.1). Licensed AGPL-3.0-or-later.
