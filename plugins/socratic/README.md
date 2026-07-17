# socratic

Socratic questioning as a **Tier-0** [skynet-graph](../../README.md) plugin — pure grammar, zero JS —
built on [reason-kernel](../reason-kernel/README.md). An inquiry declares a **bounded** set of probing
questions; each answered question distills into an insight **tallied on the kernel ledger** (append-only
audit — the completion order is the trail); the **synthesis gate opens only when every declared insight
is in** (counter-gate), so coverage is never faked. Follow-ups are depth-bounded per question
(null-guard) — no unbounded Socratic regress.

| Concept | Role | Kernel piece |
|---|---|---|
| `Inquiry` (+`Synthesize`) | the root (BY CONVENTION the `ledger` node) with `expected` + the completion counter-gate | Ledger node convention |
| `Question` → `Answered` → `Insight` | a probing chain; the insight tallies the question id | `require Thought` + `Ledger::tally insights` |
| `Answered/Deeper` | ONE bounded follow-up signal per question (`depth < maxDepth`, `followedUp` null-guard) | null-guard idiom |

The host asks the questions and answers them (its model, its tools); the plugin is the deposited
control flow + audit. Seed shape:

```js
// { _id:'ledger', isInquiry:true, expected: 3, insights: [] }
// { isThought:true, question:'…', depth:0, maxDepth:2 } ×3 — the host writes `answer` then `insight`
```

Proven by `tests/unit/socratic.test.js` (0-model structural: tally, counter-gate, bounded follow-up,
negative controls). See [`docs/plugins.md`](../../docs/plugins.md).
