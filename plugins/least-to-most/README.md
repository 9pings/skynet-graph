# least-to-most

Least-to-most prompting (solve the EASIEST sub-problem first, feed each solution into the next) as a
**Tier-0** [skynet-graph](../../README.md) plugin — pure grammar, zero JS — built on
[reason-kernel](../reason-kernel/README.md). The release order **emerges from the dataflow**: each
step's `Ready` gate hop-watches its predecessor's `Solved` flag (no scheduler, no loop), and `Solved`
**requires `Ready`** — an out-of-order answer is structurally refused (the ladder is load-bearing,
never decorative). Every solution tallies on the kernel ledger (the emergent order IS the audit);
the final composition gate opens at full coverage.

| Concept | Role | Kernel piece |
|---|---|---|
| `Plan` (+`Complete`) | the root (BY CONVENTION the `ledger` node) with `k` + the completion counter-gate | Ledger node convention |
| `Step` → `Ready` | the emergent release: `rank == 0 \|\| prev:Solved` (hop-watcher chain) | `require Thought` |
| `Step/Solved` | order-guarded solving (`require Ready`) + audit tally | `Ledger::tally solved` |

Seed shape:

```js
// { _id:'ledger', isPlan:true, k: 3, solved: [] }
// { _id:'s0', isThought:true, rank:0, text:'…' }
// { _id:'s1', isThought:true, rank:1, prev:'s0', text:'…' }   // the host writes `answer` on each
// { _id:'s2', isThought:true, rank:2, prev:'s1', text:'…' }   // released step, easiest first
```

Proven by `tests/unit/least-to-most.test.js` (0-model: emergent release cascade, the order guard
refusing an early answer, completion gate, negative controls). See [`doc/plugins.md`](../../doc/plugins.md).
