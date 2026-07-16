# forge

The dataset→certified-stock capability of [skynet-graph](../../README.md), as a plugin. `sg forge` /
`Graph.factories.forgeStock` adapt a dataset + oracle into a gold-gated `.sgc` method stock with a sha256
validation dossier (forging is the FUEL of the library — never the headline).

**The plugin carries the GRAMMAR, the ENGINE and the FACTORY.** `concepts/forge/` — the `Plan` concept
(decompose a task segment carrying a `taskKind` into a typed-step chain), extracted from what used to be
a hard-coded `TREE` literal (owner rule: no grammar declared in code). `lib/` — the engine, moved here
from `lib/authoring/forge/`: `stock` (goldGate / consistencyVote / packStock), `ground` (gold-mined
grounding rings), `dataset-adapter` (labelled datasets → class-grouped corpora; WikiSQL built-in).
`factory.js` — the `forgeStock` pipeline (dataset+oracle → gold-gated `.sgc` stock + sha256 validation
dossier), what `sg forge` runs. Depends on the [`learning`](../learning/README.md) plugin (mine's
`methodTrace`, `method-pack`, `createLearningLibrary`) — carried as an object dep by `index.js`.

The `Plan::plan` provider is **factory-built per run** (`makePlanProvider` closes over the injected
`decompose` / `ask` / `voters`), so there is no static `providers.js` — the manifest only reserves the
`Plan` namespace.

See [`doc/plugins.md`](../../doc/plugins.md).
