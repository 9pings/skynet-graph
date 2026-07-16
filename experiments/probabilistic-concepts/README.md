# experiments / probabilistic-concepts (shelved)

The probabilistic concept-net line of research, moved OUT of `lib/` during the 07-16 authoring
decomposition (group 5 → experiments). It is **shelved**: test/POC-only, never on the shipped path, and it
carried hard-coded grammar (which the decomposition keeps out of `lib`).

| Module | What it explored |
|---|---|
| `concept-net.js` | concept-net populations at the fixpoint |
| `graph-net.js` | graph-net variant |
| `equilibrium.js` | implicit-equilibrium solver |
| `ste.js` | straight-through soft-train / hard-infer |

Kept for reference, excluded from the npm tarball (`.npmignore`). The engine's *additive* probabilistic
bricks that DO ship (providers `semiring` / `stats`, with real consumers) stay in `lib/providers/`. The
tests still live under `tests/` and exercise these modules from here.
