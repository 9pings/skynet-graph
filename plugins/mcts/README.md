# mcts

Monte-Carlo Tree Search as a [skynet-graph](../../README.md) plugin (Tier-1: a thin driver), the
design's **class-B** shape: **the state lives in the graph** — `visits`/`wins`/`move`/`expanded`/
`terminal` facts and parent edges, inspectable and replayable — and only the **selection policy**
(the UCB1 argmax + the rollout sequencing) stays imperative. The `Expandable` gate is the live
expansion frontier, natively maintained.

**Deterministic by construction**: no `Math.random` in the driver — the exploration is the UCB1
term (unvisited children first in id order, then `wins/visits + c·√(ln N / n)`, tiebreak by id).
With a deterministic host rollout the whole search replays bit-identically (test-asserted).

```js
const { createMCTS } = require('mcts').factories;
const mcts = createMCTS({
  actions:  async (node) => [...],          // available moves at this node (the host)
  simulate: async (node) => 0 | 1,          // the rollout result (the host — deterministic ⇒ replayable)
  iterations: 20, c: 1.414,
});
const { best, root, children } = await mcts.run('the seed state');   // best = most-visited root child
```

Proven by `tests/unit/mcts.test.js` (0-model scripted: convergence on the winning move, the live
frontier gate, terminal handling, replay determinism). See [`doc/plugins.md`](../../doc/plugins.md).
