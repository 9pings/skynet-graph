# artifact/paper-lattice — reproducibility companion of the lattice-growth paper

Companion artifact of **“Sound online growth of a typed *isa* lattice from noisy LLM extraction,
through candidate elimination made noise-tolerant by a localized-blame admission gate”** —
Nathanael Braun, 2026, Zenodo preprint, **doi:10.5281/zenodo.21201877** (French master text +
English version). Same layout and bit-identical files as the deposit bundle (`experiments/` kept at
the bundle's directory depth so every script runs unmodified).

## The four campaigns (`experiments/`)

| directory | paper sections |
|---|---|
| `2026-07-03-lattice-riddles/` | §6 live circuit (54/54), hardened oracles, volume 300/300 (§6.4), ratchet (§6.5–6.6), learned alias ring G4, RAG-on-ontology arm (§7.1), nine-model cross-family campaign (§7.4) |
| `2026-07-03-restriction-learning/` | §5 deterministic laboratory (126/126), credit probe (108/108), discovery rung-2 |
| `2026-07-03-parametric-reuse/` | parametric mount / zero-fire probes (§3, §7.2) |
| `2026-07-03-defab-gext/` | §7.3 external validity on DeFAb (SYS 34/35 vs DIRECT 30/35; L2 374/374) |

Each campaign carries its **LOG.md** (protocol + journal), the **probe scripts**, the
**RESULTS-\*.json** behind the paper's tables and figures, and a **content-addressed durable memo**
(`memo/`) of every model call.

## Replay

- Node 18+; `npm install` at the repo root (dependencies only — no build step).
- **Zero-GPU:** probe scripts re-serve every model call from `memo/`, so every table replays
  **bit-for-bit** without any model; the §5 laboratory and the control experiments are pure code.
- **Live re-runs** (optional) load local GGUF models through embedded `node-llama-cpp` — the exact
  models are named in each LOG.md (paper control: Qwen3.6-27B Q2_K_XL, MTP). Models not included.
- **Figures:** `doc/papers/2026-07-03 - sound-online-lattice-growth/figures/generate-figures.js`
  regenerates the paper's eight figures ×2 languages from these artifacts (provenance embedded in
  each SVG).

## Third-party data

`experiments/2026-07-03-defab-gext/data/` contains the public DeFAb instances (MIT) — credit their
authors (arXiv:2606.18557); our verifier semantics is reimplemented from the instance fields and
flagged as such in the paper (§7.3).

AGPL-3.0-or-later, like the engine.
