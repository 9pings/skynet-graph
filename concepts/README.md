# Concept sets — the shipped grammars

Each sub-directory is a **concept set**: a hand-authored grammar of declarative rules (JSONC) that cast
typed facts + child segments as the graph stabilizes. They are loaded with
`Graph.fromDirs({ concepts: './concepts' })` or `Graph.loadConceptMap(dir)`; `conf.conceptSets` selects
which are active. See [../doc/usage.md](../doc/usage.md) §3 (concept sets) and
[../doc/doc.md](../doc/doc.md) (the full schema reference).

> These are **examples of hand-authored grammars** — the base, standalone use of the engine (no LLM
> required). They are *illustrative*, not a recommended ontology (concept-organization strategy is WIP).
> The LLM-driven master-graph supervisor is layered *on top of* this substrate, not a prerequisite for it.

| Set | Layer | What it shows |
|---|---|---|
| **`common/`** | base / illustrative | The original travel/geo grammar. `Vertice` (nodes) + `Edge` (segments) + `Edge/Distance` (great-circle via `CommonGeo::Distance`) + `Edge/Travel/*`, `Edge/Stay/*`, `Document/*`. The canonical "hand-author a deterministic grammar for a domain" example — start here. |
| **`clinical/`** | domain grammar | **Defeasance**: `Observation → LabValue → OutOfRange` then a `Diagnosis` gated on the lab verdict → nested `Medication`; a refuted lab **retracts** the diagnosis and cascade-retracts the medication (JTMS), depositing a typed `constat` record. Shows `ensure`-driven un-casting. |
| **`supply/`** | domain grammar | **Pavage / tiling**: `Procurement` + `Inventory` + `Transport` sub-domains under a `Fulfillment` hub; `forkPlan` derives the tiles + their separator alphabet. Shows TTL defeasance (a stale ETA re-plans). |
| **`_substrate/`** | universal spine | The acyclic backbone (`Task`, `Claim`, `Frontier`) the **problem-solving grammar** builds on (decompose → rollup → claim, with a snapped frontier). Underpins the `examples/poc/problem-*.js` demos; usable on its own as a generic decomposition skeleton. |

**Authoring invariants the loader honors** (see usage §3): a child concept's key must equal its `_id`;
`_id` is globally unique; `_name` (the flag written on entities) defaults to the file basename; and the
**typed-fact discipline** — `require`/`assert`/`ensure` key only on discrete typed facts (enums/ids/numbers/
booleans), never on free-text prose. `lib/authoring/validate.js` enforces this at author time.
