# The integrated demo — all four capabilities, one continuous run

A **9.5 GB local quant** (Qwen3.6-27B IQ2_XXS) works through a real annual-report analysis
(FinQA, Entergy 2008 — mechanically selected, criteria in `_data.js`) end-to-end, through the real
MCP surface and the real engine:

- **Act 1 — piece-by-piece**: a typed plan; each step served with only its bounded context.
- **Act 2 — repair + external think mode**: the certified method stock (`finqa-stock-q6.sgc`,
  23 KB, sha256-dossiered) orients the low-quant's output; an out-of-stock trap is **refused with
  the reason and the admissible options** — never silently guessed; a forced write is recorded
  `untrusted`, never admitted.
- **Act 3 — memory that reopens**: an erratum **retracts its consequences in cascade** and
  re-derives selectively at **0 model calls**; a withdrawn value **reopens** its dependent tasks
  with the reason (JTMS).
- **Act 4 — crash / replay**: bit-identical replay at 0 calls; a corrupted checkpoint is rejected
  fail-closed.

## Run it

```bash
# Replay the recorded film — deterministic, NO model, NO GPU, self-contained:
node examples/integrated-demo/run.js --replay

# Live run (records a fresh transcript) — needs a local GGUF:
#   put Qwen3.6-27B-UD-IQ2_XXS.gguf under ./models (or DEMO_MODEL=<path>), then:
node examples/integrated-demo/run.js            # add --quick for 4 steps instead of 8
```

The replay verifies **7 checks** (4 acts · zero ungated results in the synthesis · trap never
admitted · 0-call selective re-derivation · REOPEN with reason · bit-identical replay · corrupted
checkpoint rejected) and prints the verdict table with per-step provenance.

`mission-data.json` is the serialized mechanical selection, so the 75 MB FinQA dataset is NOT
needed; to regenerate it from source, set `FINQA_DATA=<dir containing train.json>`.
