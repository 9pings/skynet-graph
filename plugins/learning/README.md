# learning (C3 — DLL)

The Defeasible Library Learning capability of [skynet-graph](../../README.md), as a plugin: distil
recurrent methods from real traces, adapt-or-forge through a verifier gate, index and re-mount them —
the learned library is a DISTRIBUTION, defeasible under drift (un-learning included).

`lib/` holds the DLL engine, moved here from `lib/authoring/learning/` (owner: the specific goes into
its plugin): `crystallize` / `mine` (trace → structural method), `adapt` / `library` / `recall`
(adapt-or-forge controller + O(1) dispatch index), `method-pack` / `method-explorer` (portable packages +
population explorer), the distillation detectors (`hotspot` / `compose-hotspot` / `cost-probe` /
`emittability` / `canon` / `compress` / `ancestry` / `debug-provider`), `parametric` (typed slot
machinery), `combinator`, and `master-loop`. `factory.js` is the packaged `createLearningLibrary` assembly,
reachable as `Graph.factories.createLearningLibrary`.

`relearn` (the standing un-learn loop) stays in `lib/authoring/core/` — it is consumed by the C5
self-mod factory (C5) and belongs to the supervision family (it follows `reactiveSupervisorTree`'s shape).

No concept sets and no static providers (Tier-1 JS machinery, assembled per host). The forge plugin
depends on this one (`mine` / `method-pack` / the factory).

See [`docs/plugins.md`](../../docs/plugins.md) and `docs/concept-learning.md`.
