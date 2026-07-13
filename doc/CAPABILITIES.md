# Capabilities — what is measured, what is not

Every feature below carries a **maturity bar**, its **measured numbers**, its **limits**, a
**2–5 line way to use it**, and a plain-language explanation. The numbers come from GPU campaigns
with negative controls and deterministic re-runs; a standing house rule applies to this page as to
the README: **a refuted claim is removed the day it falls** — several refuted claims are listed
below on purpose, because knowing where the floor is *is* the product.

## How to read the bars

The scale has six rungs. Nothing is at rung 6 yet — this library is pre-launch, and rung 6
(external replications) can only come after other people run it.

1. coherent idea
2. design with pre-registered kill-gates
3. mechanics proven (harness, negative controls, deterministic re-run)
4. measured at scale (campaigns, confidence intervals)
5. product-integrated (library + surface + tests)
6. field-adopted (external replications)

`[████████░░] 5/6 — product-integrated` therefore reads: *idea → design → mechanics → scale
measurement → shipped in the library behind a surface, with tests; not yet replicated externally.*

## Where each capability is served

| Feature | library | `sg mcp` | dequantizer `serve` | dequantizer `mcp` |
|---|---|---|---|---|
| F1 low-quant repair | ✓ | `ask` / `hint` / `propose` | ✓ (OpenAI endpoint) | ✓ `ask` / `hint` / `propose` |
| F2 zoom | ✓ (bricks) | — (known gap, see F2) | — | — |
| F3 task memory | ✓ | `state_recall` / `plan_sync` | — | — |
| F4 think mode | ✓ | `propose` | — | `propose` |
| F5 critical mind | ✓ (C9) | `critique` | — | `critique` |
| F6 rooms | ✓ | `lattice_load` | rooms CLI | `lattice_load` |
| F7 substrate | ✓ (the engine itself) | — | — | — |

[skynet-dequantizer](https://github.com/9pings/skynet-dequantizer) is the ready-made appliance over
this library (an OpenAI-compatible local endpoint + `.sgc` rooms); everything else ships here.

---

## F1: Low-quant repair

`[████████░░] 5/6 — product-integrated` · missing rung: external replications (post-launch).

A menu of *certified* method shapes steers a heavily-quantized model's output, recovering most of
what compression broke — at zero big-model calls at runtime.

**Measured.** SQL, covered queries: low-quant 8→**63 %** (high-quant reference 46→92 %), N=201 ·
finance tables, traffic view: 7→**62 %** (20→78 %), N=120 · **zero big-model calls at runtime** ·
the forge held **0 false admissions** across 3 datasets × 2 forge models, and every stock ships
with a sha256 validation dossier.

**Limits (state them).** The guarantee is **at admission, not at execution**: at use time the stock
*orients* the model; a suggestion is not a correctness proof. A runtime "trusted answers"
cross-agreement tier was tested and **refuted** — it was removed. Forge yield is a per-domain
parameter, and amortization is a property of the domain's stereotypy.

**How to use it, simply:**

```bash
sg serve --frontier-model <path.gguf> --store ./stock.json    # OpenAI-compatible → http://127.0.0.1:4747/v1
# point ANY OpenAI client's baseURL at it — a covered query is served from the verified stock
# at 0 frontier calls; the same lanes exist as MCP tools: ask + hint (SOFT) / propose (HARD)
```

**In plain terms.** A heavily-compressed model is like a typist with worn-out keys: most sentences
come out mangled. The stock is a phrasebook of formulas that were *verified before being let in*;
when a request matches one, the model only has to fill in the blanks instead of improvising the
whole formula — and if nothing matches, the system says so instead of guessing.

---

## F2: Piece-by-piece zoom on big tasks

`[███████░░░] 4/6 — measured at scale` · missing rungs: rung 5 needs turnkey packaging — an MCP
tool exposing the zoom (the known product gap) and givens plumbing generalized beyond per-domain
wiring; rung 6 = external replications (post-launch).

The task becomes a typed DAG; each piece is served with only its bounded neighbourhood (parent
goal + resolved inputs + what to produce) — the model never sees the whole.

**Measured.** Cross-domain at N=200/domain (560 tasks total): math word problems 16→**52 %**
(×3.25 [2.4–4.8]), financial-table QA 20→**50 %** (×2.54 [1.96–3.5]), bootstrap CIs · where the
lone model collapses, the pieces hold: deep tasks **0/33 whole vs 10/33 decomposed** · compound
~20-operation "monster" tasks: whole-context floors at **0/20 across 3 configs**, a hierarchical
2-level split reaches **73 % of sections** · robustness-to-form proven: the scaffold gain holds
across 4 wordings (K-paraphrase harness).

**Limits (state them).** The zoom pays **iff the task exceeds whole-task capacity** — it is neutral
inside that capacity (measured on simple lookups). The small model is **not** the task cutter
(measured limit). The givens plumbing (the injected base facts) is per-domain — hence "not
turnkey yet". And no MCP tool exposes this capability today.

**How to use it, simply:**

```js
const { createPlanLoop } = require('skynet-graph').combos;
const { numberGivens, seedOf } = require('skynet-graph/lib/authoring/givens');
const loop = createPlanLoop({ decompose, serveLeaf });   // both injected — see lib/authoring/
const { answer, refused } = await loop.run(task, { givens: seedOf(numberGivens(task)) });
```

The bricks live in `lib/authoring/`: `dag-decompose` (the typed cutter prompt + router),
`context-project` (the bounded projection; `stratComplete` is the stratified rendering that held on
the monster tasks), `givens` (the typed base-fact front door), `leaf-io` (typed leaf output or a
typed refusal — never carried garbage).

**In plain terms.** This is how a person works a file too big to hold in their head: a sticky-note
plan on the side, then one piece at a time, with only the two or three earlier results that piece
actually needs. The engine holds the plan and the results; the model only ever sees one sticky
note's worth of context.

---

## F3: Task memory that reopens

`[████████░░] 5/6 — product-integrated` (+ shipped demo) · missing rung: external replications
(post-launch).

Task state is typed facts with provenance under truth maintenance (JTMS): when a premise drifts,
its consequences retract in cascade, and a "done" step reopens itself with the reason attached.

**Measured.** A drifted premise retracts consequences in cascade and re-derives **selectively at 0
model calls**; a withdrawn value **reopens its dependent tasks with the reason** · crash-replay is
**bit-identical at 0 calls** · bounded-context recall **100 % at 894 constant tokens/call** vs 50 %
at 4 286 for a carry-everything baseline (PoC) · typed reuse: **6 calls vs 24**, with **12/12
correct on drift vs 0/12** for retrieve-nearest (stale).

**No market equivalent found**: task-reopen on premise drift was checked twice against the market —
no agent tool reopens a task whose premise drifted.

**How to use it, simply:**

```js
const g = Graph.fromDirs({ concepts: './concepts', seed });
g.pushMutation({ $$_id: 'report', revenue: 913 });   // the premise drifts (an erratum lands)
// every fact derived from the old value retracts in cascade and re-derives selectively — 0 model calls
```

Over MCP: `state_recall` reads the certified task state; `plan_sync` mirrors the graph plan — REOPEN
included — onto the host's own task list. The shipped replay is `examples/integrated-demo` (no GPU).

**In plain terms.** Think of a spreadsheet where deleting one cell greys out every formula that used
it — with the reason attached — instead of leaving stale numbers standing. Ordinary agent to-do
lists only ever tick boxes; this one un-ticks a box the moment the fact it rested on falls.

---

## F4: External think mode

`[████████░░] 5/6 — product-integrated` · missing rung: external replications (post-launch).

The model proposes; the graph refuses with the reason and enumerates the admissible options
(tested through its own gate, never guessed); the model revises — bounded, with honest refusal.

**Measured.** One dialogue round: 17/24 → **24/24** at **zero false admissions** · a forced write is
recorded **UNTRUSTED**, never admitted · honest refusal on over-constrained input.

**How to use it, simply:**

```bash
claude mcp add sg -- node bin/sg mcp --frontier-model <path.gguf> --stock ./methods.sgc
# HARD lane: `propose {shape}` → admitted through the gate, or refused with the reason + gate-tested
# options; `force:true` → recorded UNTRUSTED, never admission. SOFT lane: `hint` (advisory menu).
```

Also wired in the dequantizer's `mcp` surface.

**In plain terms.** Like a chess coach who never moves the pieces for you: when you propose an
illegal move it says exactly *why* it is illegal and lists the legal ones, and you choose again.
Crucially, the coach cannot be bullied — a forced move is written down as untrusted, never played.

---

## F5: External critical mind

`[████████░░] 5/6 — product-integrated` (library + MCP, promoted 2026-07-13; the campaign numbers
themselves sit at rung 4 — measured) · missing rungs: form-robustness testing of the entry
templates, then external replications (post-launch).

C9: a question is split into declared viewpoints, each established through a **witness gate** over
a statement pool; missing theses are generated *anchored to pool witnesses only*; everything lands
in a typed ledger; the verdict is certification-aware — mechanical only where measurement says it
can be.

```
     your statements ("PRO: …" / "CON: …")        your viewpoints (optional)
                  │                                      │
                  ▼                                      ▼
   [statement POOL] ────► [declared VIEWPOINTS] ────► [WITNESS GATE]
    no input? model-        no input? model-named       a point is established only
    brainstormed —          — frame DECLARED            with a witness from the pool
    frame FREE                                                │
                                                              ▼
   [anchored GENERATION of missing theses] ──► [typed LEDGER] ──► [VERDICT]
    drafted only from pool witnesses;           every entry        mechanical at count margin ≥ 3
    0 fabrication across negative controls      carries why        (≥ 2 on a certified perimeter);
                                                                   below → counts + honest UNDECIDED
```

**Measured.** Disciplined piece-by-piece argument coverage **77 % vs 58 %** whole-context (48
arguments) · with a **certified perimeter**, weighing decisions go 12/24 → **24/24** (self-believed
coverage measured at ~106 % — the perimeter is what closes the illusion) · anchored generation of
missing theses: **0 fabrication across all negative controls** · anti-injection ledger: **8/8
retracted**, with JTMS cascade · **the measured decidability bound**: a verdict is mechanical at
count margin **≥ 3** (free/declared frames) or **≥ 2 on a certified perimeter** (24/24); below the
bound the output is counts + coverage + an honest **UNDECIDED** — never a fake weighing.

**Refuted and kept on the page** (tested, failed, removed from the claims): graded/prevalence
weighting under the precision cap; goal-criteria weighting for a low-quant judge (2 forms);
low-quant self-audit (3 forms).

**Limits (state them).** The entry templates (pool brainstorm, viewpoint naming) are not yet
form-robustness-tested; on FREE frames, coverage is relative to the pool — and the payload says so.

**How to use it, simply:**

```js
const cm = Graph.combos.createCriticalMind({ ask });
const r  = await cm.run({ topic, statements, viewpoints });   // ledger + per-side synthesis + verdict|UNDECIDED
```

Over MCP (both `sg mcp` and the dequantizer's `mcp`): the `critique` tool. Its **iteration
contract**: OPEN points and an UNDECIDED verdict are a *typed data request* — the host gathers real
statements (web, docs, its own context) and calls `critique` again with `statements`; the frame
upgrades to MATERIAL and the margin can move honestly.

**In plain terms.** A debate moderator with one strict rule: no viewpoint counts unless it can
produce a witness statement actually on the table. Missing sides get drafted — but only from what
is on the table, never invented. And when the count is too close to call, it says "undecided"
instead of picking a winner, because that is what its own measurements say it can decide.

---

## F6: Local .sgc rooms

`[████████░░] 5/6 — product-integrated` · missing rung: external replications (post-launch).

Shareable certified-stock mini-repos: export a room, hand it over, import it — every load goes
**through the engine gates** (never a raw write). sha256 dossiers; no catalog, no subscription, no
egress by default.

**How to use it, simply:**

```bash
skynet-dequantizer rooms list|import|export|freeze     # your own shareable stock mini-repos
# in this repo, the MCP counterpart is `lattice_load` — learning through the version-gated
# admission; there is NO direct-write tool.
```

**In plain terms.** Like sharing a folder of sheet music instead of subscribing to a streaming
service: a room is a small file of verified method stock you can freeze, checksum, and hand to a
colleague — and whatever comes in still has to pass the same admission gate as everything else.

---

## F7: The versionable reasoning substrate

`[████████░░] 5/6 — product-integrated` · missing rung: external replications (post-launch).

Use 1, standalone, no LLM required: a rule-driven knowledge graph with declarative concepts and
stabilization to a fixpoint. Every revision is snapshotted, which gives the control you have over
*code*, applied to *belief*:

- `rollbackTo(rev)` — rewind to any past revision, concept rules included;
- `diffRevisions(a, b)` — see exactly which beliefs changed between two points;
- `fork` / `merge` — branch a sub-world and merge back only a snapped interface;
- native cascading retraction — a falsified premise un-casts itself and its consequences.

**No direct market equivalent found** for git-like control over belief state (rollback / diff /
fork / merge on *what the system currently holds true*, rules included) — stated as a position we
could not find matched, not as a grand claim.

**How to use it, simply:**

```js
const revA = g.getCurrentRevision();
g.pushMutation(/* … grow the belief state … */);
g.diffRevisions(revA, g.getCurrentRevision());   // exactly which beliefs changed
g.rollbackTo(revA);                              // rewind data AND rules
```

**In plain terms.** Git for beliefs: every state of "what the system currently holds true" is a
commit. You can diff two states to find where a conclusion went wrong, roll back to before a bad
fact landed, or branch a what-if world and merge back only its conclusion.

---

## The integrated demo

`[████████░░] 5/6 — product-integrated` (ships in this repo) · missing rung: external replications —
which is exactly what the replay is for.

All the capabilities above, assembled on one continuous run: a **9.5 GB quant** works a real
annual-report analysis end-to-end — typed plan, per-step gated admission with cell-level
provenance, an erratum retracting and re-deriving selectively at 0 calls, a withdrawn value
reopening its tasks, crash-replay bit-identical.

**How to run it, simply:**

```bash
node examples/integrated-demo/run.js --replay   # 7 checks, deterministic — no model, no GPU
```

This is **the public verifiable**: the replay re-verifies its 7 checks bit-for-bit on any machine,
with no model and no GPU. Details and the live-run instructions: `examples/integrated-demo/README.md`.
