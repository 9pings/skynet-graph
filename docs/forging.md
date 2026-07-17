# Forging your own domain — the stock cookbook

This is the recipe for turning a dataset **with a free oracle** into a certified `.sgc` stock — the
fuel the serving surfaces run on (`sg mcp --stock` lanes, the `zoom` tool's cost ladder, mixture).
It is written to be followed by a person **or by an agent**: every step is a command, every claim in
it is a number from a committed dossier, and the honest-reading rules are part of the recipe, not a
footnote.

**What a stock is.** A set of *certified computation shapes* (op-sequence classes like
`subtract>divide` or `filter>aggregate>select`) extracted from a dataset whose gold answers can be
**re-executed mechanically**. Certification means: the forge model's decomposition of real items in
that class matched the gold shape, consistently, and a corrupted shape was verified to be rejected.
The standing invariant across every stock shipped so far: **0 false admitted** — the gate would
rather admit little than admit wrong.

## The recipe

### 1. Pick a dataset with a FREE ORACLE

Feasibility follows the oracle scale: **executable gold** (a program, a SQL query, calculator
annotations that re-execute) beats binding labels, which beat expert labels. If checking an item
needs a human — stop, this recipe does not apply.

Shipped references, one per oracle style (all under `examples/forge-adapters/`):

| adapter | oracle | gold gate at load |
|---|---|---|
| `finqa.js` | a closed 10-op DSL program + `exe_ans` | program re-executes AND matches the answer (scale pinned per item) |
| `wikisql.js` / `spider.js` | SQL against the gold DB | query shape re-derived, executable |
| `gsm8k.js` | calculator annotations `<<a+b=c>>` + `#### N` | every annotation is a binary op re-executed; the chain must land exactly on `####` |

### 2. Write the adapter (three exports, fail-closed everywhere)

```js
module.exports = { name, stepEnum, loadClasses, decompose };
```

- `stepEnum` — the closed vocabulary of typed steps (the ops).
- `loadClasses({data, classes, per}) → { "<shape>": [recs] }` — **the gold gate lives here**: an item
  enters a class ONLY if its gold re-executes and matches. Skip anything ambiguous — a 53.7 % parse
  rate with a clean gate (gsm8k) is worth more than 100 % with a leaky one. Each rec carries
  `problem` + `goldSteps` (+ whatever the prompt needs).
- `decompose(ask, rec, o)` — with `ask=null` return `rec.goldSteps` (and a truncated copy under
  `o.corrupt` — the dossier's negative control calls it); with a model, prompt it to emit the
  op sequence, **grammar-insured** (`grammar: { jsonSchema: … enum: stepEnum … }` — format
  insurance, the measured rule).

### 3. Dry-run the gold-forge first (no GPU)

```sh
node bin/sg forge --adapter examples/forge-adapters/<yours>.js --data <dir> --per 3 --name my-stock
```

No `--model` = the deterministic gold-forge: it exercises your gate and shows the class
distribution before you spend a model minute. For gsm8k this showed 4016/7473 items parseable
(53.7 % — the rest have compound annotations, honestly rejected) across 559 classes, top-15 = 41.9 %.

### 4. Forge with the model

```sh
node bin/sg forge --adapter … --model <path.gguf> --classes <top-shapes> --per 3 --name my-stock
```

Exit 0 iff the dossier verdict passes. The dossier (written next to the `.sgc`) is the deliverable:
per-class model-shape vs gold-shape, admitted/attempted, FALSE-admitted count, and the built-in
negative control (a corrupted shape must be rejected).

### 5. Read the dossier HONESTLY — the per-domain yield rule

Yield is a property of the DATASET's decomposition style, not of your skill. The shipped stocks,
verbatim from their dossiers (all forged on the same 27B reference quant; the gsm8k dossier ships
in-repo as [`examples/forge-adapters/gsm8k-stock.dossier.md`](../examples/forge-adapters/gsm8k-stock.dossier.md)):

| stock | admitted / attempted | FALSE admitted |
|---|---|---|
| finqa | 8 / 12 | 0 |
| spider | 6 / 14 | 0 |
| gsm8k | 3 / 12 | 0 |
| wikisql (scaled) | 4 / 18 | 0 |

Why the spread: FinQA's gold is a **canonical** DSL — one valid program per item — so stereotyped
classes admit well. GSM8K's gold is **one valid decomposition among several** (a
`multiply>subtract` problem also solves as `multiply>multiply>subtract`), so only the stereotyped
classes survive — and a consistency vote does **not** lift that (measured: `--vote 3` returned the
identical 3/12 — a vote cannot repair a semantic ambiguity, only sampling noise). Report the number
you got; never widen `--classes`/`--per` to chase it.

### 6. Use the stock

```sh
node bin/sg mcp --frontier-model <gguf> --stock SG-Rooms/lib1/my-stock.sgc
```

`hint` serves the certified-shape menu; `propose` gates a shape against the frozen referential;
the `zoom` tool serves plan leaves through the cost ladder. What the certified path buys is
**auditability** — a verdict that is computed, traced to its operands, and replayable — with the
gate guaranteeing *shape ∈ referential + operands traced + deterministic execution*. What it does
NOT guarantee (say it in your report too): the model picking the *right* operand among the traced
ones.

## The three standing rules

1. **The oracle pays for everything.** No free oracle → no stock. The guarantee stops at admission.
2. **0 false admitted is the invariant; yield is the honest per-domain variable.** A small clean
   stock beats a big dirty one — misses escalate, wrongs would not.
3. **The negative control is not optional.** Every dossier carries it; a stock whose corrupted
   shape is NOT rejected is not a stock.
