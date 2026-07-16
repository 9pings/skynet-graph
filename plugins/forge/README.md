# forge

The dataset→certified-stock capability of [skynet-graph](../../README.md), as a plugin. `sg forge` /
`Graph.combos.forgeStock` adapt a dataset + oracle into a gold-gated `.sgc` method stock with a sha256
validation dossier (forging is the FUEL of the library — never the headline).

**This tranche ships the GRAMMAR only** (`concepts/forge/` — the `Plan` concept: decompose a task segment
carrying a `taskKind` into a typed-step chain), extracted from what used to be a hard-coded `TREE` literal
inside `lib/combos/forge.js` (owner rule: no grammar declared in code). The forge **engine**
(`lib/combos/forge.js` + its authoring cluster `mine` / `stock` / `method-pack` / `dataset-adapter`) is
entangled across group-3 authoring and moves into this plugin in a later tranche (see the decomposition
map); until then it loads this grammar from here.

The `Plan::plan` provider is **factory-built per run** (`makePlanProvider` closes over the injected
`decompose` / `ask` / `voters`), so there is no static `providers.js` — the manifest only reserves the
`Plan` namespace.

See [`doc/plugins.md`](../../doc/plugins.md).
