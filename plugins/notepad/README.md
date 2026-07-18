# notepad — the first instance-type descriptor

A named, persistent, **attributable** notepad: the state-memory pillar (`state_note` / `state_recall`)
expressed as **actions on a graph instance** rather than ad-hoc MCP lanes. Deliberately the simplest
possible type — its real deliverable is the **descriptor form** the instance service dispatches on.

## The descriptor contract

`sg-plugin.json` declares `entrypoints.descriptor` → `descriptor.js` exports:

```js
{ type: 'notepad', version: '1.0.0',
  conceptSets: [],                                // grammar merged at boot (none needed here)
  concurrency: ['shared-sequenced', 'fork-merge'],// modes this type supports
  create(seed) -> template,                       // seed a fresh instance
  actions: {
    note:   { write: true,  input: {text:'string'}, apply(g, args, ctx) -> template },
    recall: { write: false, input: {},              project(g) -> {notes, count} },
  },
  projections: { summary(g) -> {title, count} } }
```

Loaded like factories: `loadPlugin(dir).descriptor`, collected by `resolvePlugins()` under
`descriptors[type]` (one claimer per type). The reference consumer is
`lib/plugins/descriptor.js` — `validateDescriptor` / `createInstance` / `runAction`.

## What it guarantees (and how)

- **Attribution is enforced at the door.** A write action's template is stamped `by: ctx.agent`
  by the RUNNER — never by descriptor authors, so it cannot be forgotten; a write without an
  agent is a typed refusal. `by` rides the object facts, `diffRevisions`, and the revision atoms.
- **Out-of-band writes never surface.** `recall` keys on the typed alphabet (`NoteEntry`), so a
  write that bypasses the action door does not appear in it (the engine does not reject such
  writes — the exclusive door is the service's job).
- **Replay-deterministic.** All ids are literal (`$$_id`) — nothing minted, byte-identical re-runs.

Tests: `tests/unit/notepad-descriptor.test.js` (GO bar, the out-of-band negative, typed refusals,
fail-closed validation, determinism).
