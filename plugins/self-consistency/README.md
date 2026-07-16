# self-consistency

Self-consistency (majority vote over k independent reasoning paths) as a **Tier-0** [skynet-graph](../../README.md)
plugin — **pure grammar, zero JS providers** — built entirely on [reason-kernel](../reason-kernel/README.md).
It is the second client of the kernel and the cheapest proof that the kernel *subsumes* a reasoning strategy:
a strategy becomes a couple of concept files, not a class.

## How it composes on the kernel

| Concept | What it does | Kernel piece it reuses |
|---|---|---|
| `Vote` | each path (a kernel `Thought` carrying a snapped `answerClass`) appends its class to `ledger.votes` | `require Thought` (crossCorpus edge) + `Ledger::tally` |
| `Decide` | once all `k` votes are in, decide the consensus iff its margin over the runner-up ≥ `threshold`, else `UNDECIDED` | `Ledger::decide` (the k-ary margin bound — the same decidability principle C9 uses) |

Because it declares no provider namespace and ships no JS, self-consistency is safe by construction: install
a stranger's strategy of this shape and it runs sandboxed (the DSL evaluates expressions over facts — no eval,
no I/O).

## Use

The host runs its model `k` times, snaps each answer to a discrete `answerClass`, and seeds the graph:

```js
const sc  = require('self-consistency');                       // carries reason-kernel
const cfg = require('skynet-graph').plugins.resolvePlugins([sc]);
// seed: one `{ _id:'ledger', isDecision:true, k, threshold, votes:[] }` node + k `{ isThought:true, answerClass }` paths
// boot with cfg.conceptMap / cfg.conceptSets / cfg.providers → read `verdict` / `consensus` / `margin` off the ledger node
```

A path that produces **no parseable answer abstains** — do not seed it as a Thought, and set `k` to the
number of valid votes. A parse-failure is not a vote class; counting it as one would let "failed to answer"
win the plurality. (With a thinking model, budget the tokens so the hidden reasoning does not consume the
whole reply — otherwise paths abstain silently.)

The verdict is mechanical only at margin ≥ threshold — below the bound the honest output is `UNDECIDED`.
See [`doc/plugins.md`](../../doc/plugins.md). A runnable live demonstrator (k real 2-bit paths → snap → this
plugin decides) lives in the R&D trail; the plugin's own logic is GPU-free and proven by
`tests/unit/self-consistency.test.js`.

**MCP exposure**: `sg mcp` ships this strategy as the `self_consistency` tool (params `question` / `k` /
`threshold` / `temperature` / `maxTokens`) — the host samples the paths on the wired backend, applies the
abstention rule, and THIS plugin decides on the graph. Strategies are exposed as MCP params/tools, never as
model-name suffixes.
