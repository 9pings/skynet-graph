# refinement

Iterative refinement / reflexion (draft → score → improve until good enough, bounded) as a **Tier-0**
[skynet-graph](../../README.md) plugin — pure grammar, zero JS — and the **third client** of
[reason-kernel](../reason-kernel/README.md). Three strategies on one kernel is the product thesis:
a reasoning strategy is a couple of concept files, not a class.

## How it composes on the kernel

| Concept | What it does | Kernel piece it reuses |
|---|---|---|
| (kernel) `Scored` | snaps an attempt's raw `score` to a K1 `scoreBand` | `Score::band` + `require Thought` |
| `Accept` | accept the attempt iff `scoreBand == 'high'` (the ThresholdGate — keys on the snapped band, never a raw float) | the kernel `Scored` band |
| `Refine` | below threshold **and** `round < maxRounds` → signal the host to produce the next, improved attempt | the same band + the null-guard-round |

At the last round neither `Accept` nor `Refine` casts, so the loop terminates — the bound is a fact, not a
JS counter.

## Use

The host produces an attempt, scores it (self-critique or a scorer), seeds a Thought, and reacts to the
grammar: `Accept` → done; `Refine` → produce round+1 and repeat.

```js
const rf  = require('refinement');                             // carries reason-kernel
const cfg = require('skynet-graph').plugins.resolvePlugins([rf]);
// seed an attempt: { isThought:true, score:0.62, round:0, maxRounds:3 }
// boot → if `Accept` cast, take it; if `Refine` cast, produce the next attempt; else stop (budget spent)
```

## A note on the canonicalization barrier

The pre-refactor self-consistency test gated acceptance on a **raw float** (`$confidence >= 0.6`). This
plugin snaps the score to a discrete band first (`Score::band`) and gates on `$scoreBand == 'high'` — the
K1-clean form the engine's typed-fact discipline wants. Same intent, a barrier-safe expression.

See [`doc/plugins.md`](../../doc/plugins.md).
