# Reasoning strategies — one kernel, deposited sets

Chain-of-Thought, ReAct, Tree-of-Thoughts, Reflexion, MCTS… the usual way to get these is a framework that
ships each one as its own class, with its own loop, its own state, and its own bugs. Thirteen strategies
means thirteen implementations that share nothing.

Here a strategy is **a concept set you deposit on one shared kernel** — files, not a fork. There is no
`Strategy` base class and nothing to subclass, because there is no strategy *object*: the strategy is a
grammar over typed facts, and the engine runs it the same way it runs everything else.

This page is the *why* and the recipes. Every strategy below has **one runnable, model-free file** in
[`examples/strategies/`](../examples/strategies/) that prints the guarantee it demonstrates; the test suite
executes all of them, so what you read here stays true.

## The contract, once

Every Tier-0 strategy works exactly the same way. That is the point of the kernel:

```js
const { loadPlugin, definePlugin, resolvePlugins } = require('skynet-graph').plugins;

const cfg = resolvePlugins([ definePlugin('<the strategy plugin>', [ loadPlugin('reason-kernel') ]) ]);
Graph._providers = cfg.providers;
const g = new Graph(seed, { conceptSets: cfg.conceptSets, /* … */ }, cfg.conceptMap);
```

Then, forever after:

1. **The host writes typed facts.** `g.ingest({ step1: { answer: 'a' } })` — an answer, a score, an
   observation, a vote class.
2. **The graph decides.** Stabilization runs to fixpoint; gates cast and uncast.
3. **The host reads which gates are open.** `Ready`, `Accept`, `Synthesize`, `NeedsAction`, `Decide` — a
   cast set, not a status field you maintain.

That is the whole API. There is no `strategy.run()` to call, no callbacks to register, no loop to write.
`examples/strategies/_boot.js` wraps those lines with comments; read it once and every example is legible.

**Two classes of strategy.** Eleven are **Tier-0** — pure grammar, *zero JS*: nothing of ours executes, so
there is no code of ours to trust. Two (Tree-of-Thoughts, MCTS) are **Tier-1**: they keep state in the graph
but need a thin imperative driver, because their selection policy is an **argmax across siblings** (a beam,
a UCB1 pick) and the per-object rule DSL cannot express a cross-sibling view — nor should it be tortured
into one. Those drivers are ~60 lines each, and everything they decide is written back as facts.

## What the kernel gives them

[`reason-kernel`](../plugins/reason-kernel/) is small on purpose, and it grew **only when a real client
demanded a brick** — never speculatively. That rule is why it is still small:

| Brick | What it does | Which client demanded it |
|---|---|---|
| `Thought` | the generic reasoning node every strategy `require`s — the shared vocabulary | the kernel's reason to exist |
| `Ledger::tally` / `untally` | append-only accumulation; a retraction is an **append**, so the ledger *is* the audit trail | critical-mind (C9) |
| `Ledger::decide` | the k-ary **margin bound**: a verdict only when the winner beats the runner-up by ≥ threshold, else `UNDECIDED` | self-consistency |
| `Score::band` | snap a raw 0–1 score to a discrete band, so gates key on an enum and never a float | refinement |
| `Relation` | a generic typed relation (`relKind`) between two thoughts | analogical |
| `Mark::set` / `unset` | the watched mirror of a cast — see the gotcha at the bottom | tree-of-thoughts |

**The invariant that matters most:** a dependent keys on the **fact names** its dependency produces — the
alphabet *is* the API. Rename a produced fact and dependents silently stop casting. Freeze a kernel's
alphabet early; `deriveManifest` makes it inspectable and diffable so this stays discipline, not surprise.

## The catalog — 13 strategies

| Strategy | Where | Shape | Runnable |
|---|---|---|---|
| Chain-of-Thought | a single ask (any factory) | trivial — no grammar needed | — |
| Decomposition | `concepts/_substrate` (C1) / `planner` (C7) | grammar + projection engine | [`c7-plan-loop.js`](../examples/bootstrap/c7-plan-loop.js) |
| Least-to-Most | `least-to-most` | Tier-0: emergent release chain + order guard | [`least-to-most.js`](../examples/strategies/least-to-most.js) |
| Adversarial Debate | `critical-mind` (C9) | **the measured one** — grammar face by default | [`c9-critical-mind.js`](../examples/bootstrap/c9-critical-mind.js) |
| Reflexion | `refinement` (set `reflexion`) | Tier-0: external binary verdict, bounded rounds | [`reflexion.js`](../examples/strategies/reflexion.js) |
| Iterative Refinement | `refinement` (set `refinement`) | Tier-0: score band, bounded rounds | [`refinement.js`](../examples/strategies/refinement.js) |
| Self-Consistency | `self-consistency` (+ MCP tool) | Tier-0: snapped votes + the margin bound | [`self-consistency.js`](../examples/strategies/self-consistency.js) |
| Socratic | `socratic` | Tier-0: insight tallies + coverage counter-gate | [`socratic.js`](../examples/strategies/socratic.js) |
| Analogical | `analogical` | Tier-0: defeasible maps-to transfer (JTMS) | [`analogical.js`](../examples/strategies/analogical.js) |
| Meta-Router | `makeArchetypeRouter` (planner) | classify → dispatch, fail-closed | [`meta-router.js`](../examples/strategies/meta-router.js) |
| ReAct | `react-loop` | Tier-0: live action worklist + 3 stops; tools = host | [`react.js`](../examples/strategies/react.js) |
| Tree-of-Thoughts | `tree-of-thoughts` | Tier-1: native cascade prune + beam driver | [`tree-of-thoughts.js`](../examples/strategies/tree-of-thoughts.js) |
| MCTS | `mcts` | Tier-1: stats-as-facts + deterministic UCB1 driver | [`mcts.js`](../examples/strategies/mcts.js) |

### Honest scope — read this before quoting any of it

**Only the debate (C9) is LLM-measured**: GPU-replayed, published numbers, negative controls
(see [CAPABILITIES.md F5](CAPABILITIES.md#f5-external-critical-mind)). The other sets are **expressible and
structurally proven** — 0-model tests, negative controls, deterministic replay — and *not* LLM-benchmarked.
That is a real claim and a smaller one than a benchmark. The distinction is kept deliberately: a page that
blurs "we proved the machinery" into "we proved it helps" is the kind of claim this project removes.

One narrower thing *has* been checked live, because the recipes below teach the **host** side and a recipe
whose host side never met a model is a guess. On a 9.5 GB local quant (Q2), with bars registered in advance:
the **ReAct** loop ran end-to-end unaided (the model emitted a typed `actionTool` every round, the worklist
retired itself on each observation, the loop stopped on its own `FINISH`); **C9** reproduced the shape this
page describes (every witness real, 0 open points, margin 0 → honest `UNDECIDED`); and the **MCTS** driver
returned **two byte-identical searches with a real model in the loop** — the replay claim holding with live
inference, not just scripted stubs. That is a *smoke*, not a benchmark: it says the host side works, and says
nothing about whether any of these make a model better at anything.

Worth knowing from the same run: mid-search, Q2 stopped answering in the required form and emitted garbage
candidates. The **external oracle scored them 0 and the beam pruned them**, and the search still returned the
right answer. Re-run with Q2 scoring *its own* proposals — the refuted self-audit config — the garbage won.
One run, an illustration rather than a measurement (the refutation has its own campaigns), but a concrete
picture of why the rule below has no exceptions.

### The rule with no exceptions: nothing self-scores

**A score, critique, or verdict must come from an EXTERNAL source** — a judge model, an oracle, a test run.
No strategy here ships a self-scoring path, and that is not an oversight to be fixed later: the generator
judging itself was measured and **refuted three times** (a low-quant self-audit lands at chance). So:

- `refinement` takes a score; it does not compute one.
- `reflexion` takes a verdict; an unjudged attempt fires **nothing** (`reflexion.js` demonstrates the refusal).
- Tree-of-Thoughts takes a `score` function; the docstring says out loud that it must not be the generator.
- There is **no `reflect` / `refine` MCP tool**, on purpose — it would productise the refuted self-audit.
  `self_consistency` is the only strategy tool exposed, because a vote is not a judgment.

---

## The recipes

Each recipe is: the seed you write, the facts the host supplies, the gates you read. All of them are the
running code in `examples/strategies/` — reduced here to the shape you would type.

### Self-Consistency — k paths, one decidable vote

*When:* you can sample the same question k times and snap each answer to a class.

```js
nodes: [
  { _id: 'ledger', isDecision: true, threshold: 2, k: 5, votes: [] },   // the pool declares itself
  { _id: 'path0', isThought: true, answerClass: 'A' },                  // ← the host snaps each reply to a CLASS
  /* …k of them… */
]
```
**Gates:** `Vote` (per path, tallies it) · `Decide` (on the ledger, once all k are in) → writes `verdict`,
`consensus`, `margin`.
**The bound:** `verdict` is the consensus **iff** margin ≥ threshold; a tie is `UNDECIDED`, never a coin
flip. **Abstention:** a path with no `answerClass` (an unparsable reply) casts no `Vote` — the pool never
completes and no verdict is invented. That failure mode is measured, not hypothetical.
**Live:** the `self_consistency` MCP tool does the sampling for you. Note the gotcha it paid for: a local
backend pinning its seed returns *k identical paths* even at temperature 0.7 — the vote is silently vacuous.
The tool salts each attempt deterministically to force real divergence.
**Note:** the vote ledger is append-only with no cleaner — a *changed* vote does not re-decide. Retraction
lives in C9, not here.

### Iterative Refinement — draft, score, accept or go again

*When:* you have an external scorer that returns a number.

```js
nodes: [{ _id: 'r0', isThought: true, score: 0.4, round: 0, maxRounds: 3 }]   // score ← YOUR judge
```
**Gates:** `Scored` (snaps `score` → `scoreBand`) · `Accept` (band is high) · `Refine` (below threshold AND
round < maxRounds).
**The loop:** `while (cast(id,'Refine')) { redraft; ingest next attempt }` — the gate *is* the loop condition.
**The bound:** at `round == maxRounds` a bad attempt casts **neither** gate: the loop terminates by
construction, with no `while` of yours to get wrong.

### Reflexion — same family, binary verdict

*When:* your judge answers pass/fail (a test run, an oracle, a reviewer model).

```js
nodes: [{ _id: 'v0', isThought: true, critiqueVerdict: 'FLAWED', round: 0, maxRounds: 3 }]
```
**Gates:** `Correct` (verdict is `CORRECT`) · `Revise` (otherwise, within budget).
**The refusal:** no `critiqueVerdict` → neither gate. Not "assumed fine", not self-graded. Go get a verdict
from something that is not the drafter.

### Socratic — probe, distill, conclude only at full coverage

*When:* you want a claim interrogated before it is accepted.

```js
nodes: [
  { _id: 'ledger', isInquiry: true, expected: 3, insights: [] },              // declare how many probes
  { _id: 'q1', isThought: true, question: 'q?', depth: 0, maxDepth: 2,
    answer: 'a1', insight: 'i1' },                                            // ← host asks, host distills
]
```
**Gates:** `Answered` · `Insight` (tallies onto the ledger) · `Synthesize` (**only** at `insights == expected`)
· `Deeper` (a follow-up, iff `depth < maxDepth` and none spawned yet).
**The counter-gate:** answer 2 of 3 and `Synthesize` stays shut — you cannot conclude over a probe you
skipped. It is **live**: answer the last one later and the gate opens itself, no re-plan.

### Least-to-Most — the ladder that schedules itself

*When:* sub-problems have a difficulty order and each should see the previous answers.

```js
nodes: [
  { _id: 'ledger', isPlan: true, k: 3, solved: [] },
  { _id: 's0', isThought: true, rank: 0 },
  { _id: 's1', isThought: true, rank: 1, prev: 's0' },     // ← the chain is just a `prev` ref
]
```
**Gates:** `Ready` (rank 0, or `prev` is `Solved`) · `Solved` (has an answer **and** was Ready) · `Complete`
(all k solved).
**Two properties you would otherwise code:** the release order **emerges** (no scheduler — solve s0 and s1
arms itself), and the **order guard is structural** (`Solved` requires `Ready`, so a pre-written
out-of-order answer sits uncounted until its turn actually comes — then it counts).

### Analogical — a transfer that falls when its source does

*When:* you solve a new case by mapping it onto a solved one.

```js
freeNodes: [{ _id: 'ledger', grounded: [], groundedRetracted: [] }],
nodes: [
  { _id: 'src', isThought: true, live: true, resolved: true },       // the solved case
  { _id: 'tgt', isThought: true },
  { _id: 'm1', isRelation: true, relKind: 'maps-to', from: 'src', to: 'tgt' },
]
```
**Gates:** `Mapping` (`relKind == 'maps-to'` — the enum routes) · `Grounded` (the transfer license: source
live **and** resolved).
**The point:** `ingest({ src: { live: false } })` → the license uncasts **in cascade**, the retraction is
appended to the ledger. You write one fact; you do not hunt dependents. This is the C9 JTMS, reused verbatim.
**The asymmetry (know this):** restoring the source does **not** re-license on its own — the cross-object
hop-watcher is not re-armed after an uncast, so reopening takes an explicit write to the dependent. Gates
that read facts on their **own** node (C9's verdict over its ledger counts) *do* re-decide both ways.
Retraction is free; reopening is deliberate.

### ReAct — the worklist you don't maintain

*When:* the model must call tools and see results.

```js
nodes: [
  { _id: 'ledger', isReactSession: true, maxRounds: 3, trace: [] },
  { _id: 't0', isThought: true, round: 0, actionTool: 'search', actionInput: 'q' },
]
```
**Gates:** `NeedsAction` (a typed pending call — **uncasts when `observation` lands**) · `Observed` (tallies
into the trace) · `Continue` · `Done`.
**The idea:** "what tool calls are outstanding?" = the set currently casting `NeedsAction`. A live worklist,
maintained by the engine — not a queue you push, pop, and desynchronise.
**Three independent stops:** the round budget · a `finalAnswer` on the session · the one-successor
null-guard. The tools stay yours (the impure part stays out of the grammar).

### Meta-Router — classify, then dispatch

*When:* different task shapes deserve different decompositions.

```js
const r = makeArchetypeRouter({ ask });               // your grammar-constrained model
const { archetype, hint, leaves } = await r.route(task);
```
**Fail-closed:** the label is a closed enum (`sequential | extraction | multihop | aggregate | planning`);
anything else — a hallucinated label, empty, prose — snaps to `planning`, the general DAG, which is always
safe. A misclassification costs a less-tailored decomposition, never a broken one.
**Honest scope:** the archetype→scheme map is a **well-motivated prior**, not a proven law (the study's own
evidence is same-model-inflated and thin cross-model). The decision *mechanism* is what ships. Bring your
own `archetypes`/`hints` — it is usable à nu.

### Tree-of-Thoughts — beam search whose prune is free

```js
const tot = Graph.factories.createTreeOfThoughts({ propose, score, beamWidth: 2, branching: 3, maxDepth: 3 });
const { best, path, expanded, pruned } = await tot.run('the seed problem');
```
**State in graph:** `depth`, `parent`, `score`/`scoreBand`, `pruned`. **Policy in driver:** top-k per depth.
**The prune cascades natively:** `Live` gates on "not pruned AND parent is Live" — a recursive hop-watcher,
so pruning one node darkens its whole subtree with **zero traversal code**. And a pruned branch costs **0**
propose calls: `propose` only ever runs on the live frontier. `score` must be an external judge.

### MCTS — a search you can reproduce

```js
const mcts = Graph.factories.createMCTS({ actions, simulate, iterations: 20, c: 1.414 });
const { best, root, children } = await mcts.run('the seed state');
```
**State in graph:** `visits`, `wins`, `move`, `expanded`, `terminal`, parent edges — the tree *is* the audit.
**Policy in driver:** UCB1 argmax + rollout sequencing. **No `Math.random` anywhere** — exploration is the
UCB1 term, not noise. With a deterministic rollout the whole search **replays bit-identically**, so you can
re-derive exactly how a move got recommended. A dead-end returns `best: null` rather than inventing a move.

---

## Two authoring gotchas these plugins paid for

Both are linted or documented, because both cost real debugging time.

1. **`Node` / `Segment` are the pre-set ROOT FACTS** of the concept system. Concept trees *anchor* on them
   via `require` (the Vertice/Edge pattern: `require: "Node"`). The trap is **naming a concept after a root
   fact while giving it conditions** — it maps the instant the object exists, before its late `require`s
   resolve, and its children are then silently never descended. The validator warns `engine-marker-name` on
   that exact shape; a bare root anchor is legitimate.

2. **A concept flag appears loudly but vanishes silently.** A cast writes the flag through `set()` (watchers
   fire); an uncast `delete`s it (no watcher fires). So a **cross-object** gate on `$other:Flag` re-evaluates
   when the flag appears and **never** when it disappears — the retraction does not cascade. Mirror it with
   the kernel's `Mark::set`/`unset` so the cleaner writes the fall through `set()` and distant hop-watchers
   fire. This is exactly what Tree-of-Thoughts' recursive `Live` gate rides on.

## Where to go next

- **Run them:** [`examples/strategies/`](../examples/strategies/) — one file per strategy, each printing its guarantee.
- **The plugin contract** (manifest, tiers, deps, `sg plugin`): [plugins.md](plugins.md).
- **What is measured vs. merely built:** [CAPABILITIES.md](CAPABILITIES.md).
- **Write your own:** `sg plugin scaffold <name>` writes a loadable Tier-0 skeleton. A strategy is a concept
  set + a manifest; copy `self-consistency` (the Tier-0 template) and deposit your own gates.
