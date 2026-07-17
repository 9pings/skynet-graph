# react

The ReAct loop (Thought → Action → Observation) as a **Tier-0** [skynet-graph](../../README.md)
plugin — pure grammar, zero JS — built on [reason-kernel](../reason-kernel/README.md). The grammar
owns the CONTROL and the AUDIT; the tools (the impure part) stay entirely on the host side:

- **`NeedsAction` is a LIVE signal**: a step with a typed `actionTool` and no `observation` yet. The
  moment the observation lands the ensure falls and it **uncasts** — the set of cast `NeedsAction`
  IS the pending tool-call worklist, maintained natively (no queue code).
- **`Observed` tallies** the step into the session `trace` (kernel Ledger, append-only): the
  trajectory is the audit trail.
- **`Continue`** is the bounded next-step signal — three independent stops: the round budget
  (`round < maxRounds`), the terminal answer (`finalAnswer` on the session), and the one-successor
  null-guard (`continued`). The loop cannot run away and cannot fork.
- **`Done`** = the terminal gate on the session's `finalAnswer`.

Seed shape (the session is BY CONVENTION the `ledger` node):

```js
// { _id:'ledger', isReactSession:true, maxRounds: 6, trace: [] }
// { _id:'t0', isThought:true, round:0, text:'…', actionTool:'search', actionInput:'…' }
// the host: executes the tool for each cast NeedsAction → writes `observation` → reads Continue
// → seeds the next step (round+1) + `continued:1` → … → writes `finalAnswer` on the session.
```

Proven by `tests/unit/react.test.js` (0-model: live signal + ensure-fall, trace audit, the three
stops, negative controls). See [`docs/plugins.md`](../../docs/plugins.md).
