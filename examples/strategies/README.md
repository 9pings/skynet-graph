# Reasoning strategies — one runnable file each

Every file here is **deterministic, GPU-free and model-free**: `node examples/strategies/<file>.js` exits 0
and prints the guarantee it just demonstrated (`STRATEGY OK — …`). The suite executes all of them
(`tests/integration/strategies-smoke.test.js`), so they cannot rot. The concepts are explained in
**[../../doc/strategies.md](../../doc/strategies.md)** — read that for the *why*, run these for the *how*.

## The one idea to take away

A strategy here is **not a class you subclass or a framework node you wire**. It is a **plugin you deposit**:
a concept set (files) on top of `reason-kernel`. There is no strategy API to call. The host writes typed
facts; the grammar decides which gates open; you read the gates. That is the whole contract:

```js
const { bootStrategy } = require('./_boot.js');
const s = bootStrategy('socratic', { nodes: [ /* your seed facts */ ] });
await s.settle();          // stabilization to fixpoint — the strategy IS the fixpoint
s.cast('ledger', 'Synthesize');   // ← did the gate open?
await s.ingest({ q2: { answer: 'a2', insight: 'i2' } });   // ← the host writes a fact; the graph re-decides
```

`_boot.js` is that boilerplate, once, with comments. It is examples' plumbing, not a public API — a real host
does exactly the same through `Graph.plugins.resolvePlugins`.

## The files

| File | Strategy | The guarantee it prints |
|---|---|---|
| `self-consistency.js` | Self-Consistency | a majority decides **only at margin ≥ threshold**; a tie is an honest `UNDECIDED`; an unparsable path abstains and never becomes a vote |
| `refinement.js` | Iterative Refinement | accept keys on a **snapped band**, never a raw float; the round budget bounds the loop by construction |
| `reflexion.js` | Reflexion | accept requires an **external** verdict — an unjudged attempt fires nothing (there is no self-scoring path, by design) |
| `socratic.js` | Socratic | synthesis is gated on **counted coverage** — one skipped probe blocks the conclusion; the follow-up regress is doubly bounded |
| `least-to-most.js` | Least-to-Most | the release order **emerges from the dataflow**; an out-of-order answer is structurally refused, then honoured in its turn |
| `analogical.js` | Analogical | a transfer is licensed only by a live+resolved source; **retracting it cascades the license out**; reopening takes an explicit re-arm |
| `react.js` | ReAct | the pending tool-call list is a **live cast set** that retires itself on the observation; three independent stops bound the loop |
| `meta-router.js` | Meta-Router | classify → dispatch the matching decomposition; an **off-enum label fails closed** to the safe general DAG |
| `tree-of-thoughts.js` | Tree-of-Thoughts | the prune **cascades subtrees natively** (1 write, 0 traversal code) and a pruned branch costs **0** propose calls |
| `mcts.js` | MCTS | UCB1 with **no randomness** — the search converges, the tree is the audit, two runs are byte-identical |

**The other three of the 13-strategy catalog** live where they belong rather than being duplicated here:
Chain-of-Thought is a single ask (no grammar needed — nothing to demo), **Decomposition** is C7
(`../bootstrap/c7-plan-loop.js`), and **Adversarial Debate** is C9 (`../bootstrap/c9-critical-mind.js`).

## Two rules these files all obey

- **No strategy self-scores.** Every score, critique or verdict comes from an EXTERNAL source (a judge model,
  an oracle, a test run). The generator judging itself was measured and refuted three times; the plugins
  deliberately ship no such path, and `reflexion.js` demonstrates the refusal.
- **Honest scope.** Only the debate (C9) is **LLM-measured** — GPU-replayed, with published numbers. The sets
  demoed here are *expressible and structurally proven* (0-model tests, negative controls, deterministic
  replay), which is what these files show. That is a real claim, and a smaller one than a benchmark.
