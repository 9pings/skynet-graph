# Learned concepts — training a population at the fixpoint

> **Status: optional / shelved advanced track.** This subsystem (a tiny gate×update NN trained at the
> fixpoint) is a premature, narrow accelerator — a solution looking for a deployed hot-spot, and it does
> **not** replace an LLM. The mainline Use-2 path is [concept-as-graph.md](concept-as-graph.md) (methods +
> contracts + the durable executor); this stays shelved until a proven recurrent + structured + high-volume
> sub-task justifies it. The work is real, tested, and de-risked — revisit it then. Documented here for completeness.

> **Audience:** a fresh reader (AI or human) who knows what the engine is (a rule-driven graph that
> stabilizes typed-fact concepts to a fixpoint — see [architecture.md](architecture.md)) and wants to
> understand the **learning** subsystem under `lib/authoring/`. Everything here is **host-side and
> ZERO-CORE** — it does not touch `lib/graph/`. The full R&D trail (with the per-step measurements
> "F1…F9") is in [doc/WIP/experiments/2026-06-26-dynamic-concepts/LOG.md](WIP/experiments/2026-06-26-dynamic-concepts/LOG.md);
> this doc is the durable summary.

## 1. The question

Concepts are normally **hand-authored** declarative rules. Authoring and maintaining a good concept
corpus is the dominant cost (see the README's "Concept strategy is WIP"). The open bet of this
subsystem: can a concept be **learned** — a small neural net instead of a hand-written rule — and can
a *population* of such concepts be **trained, grown, and distilled** so the system improves **without
human iteration**?

The project's two-level model already names the object (see the HANDOFF preamble): a concept is a
**local neighbourhood operator**, provably the same thing as an **MPNN layer** on a restricted
fragment, with a **hard cast = a quantized activation**. So a *population of concepts run to a
fixpoint* **is a quantized, equilibrium Graph Neural Network**. Training it is therefore a known
(if subtle) problem — and that is exactly what this subsystem does.

## 2. The pieces (and how they compose)

```
  equilibrium.js   the MATH: gradient through a fixpoint (DEQ / implicit differentiation)
        │
  concept-net.js   the SUBSTRATE: a population of gate×update concept-units, trained with equilibrium
        │            ├── train / grad / loss      learn the population at its fixpoint
        │            ├── evolve                    grow the FORM by success (utility/MDL gate)
        │            ├── bakePopulation            BRIDGE: a frozen population → real engine concepts
        │            └── unrollPopulation          serve a CYCLIC population on the engine (unrolled)
        │
  lifecycle.js     the KNOB: plasticity p∈[0,1] — plastic=train/explore, frozen=serve/deterministic
  llm.js / ste.js  plasticity wired into real providers (LLM temperature / NN exploration noise)
```

### 2.1 `equilibrium.js` — gradient through a fixpoint (DEQ)

The engine's stabilization is a **Picard iteration** `z_{t+1} = F(z_t, θ)` driven to a fixpoint
`z* = F(z*, θ)`, where `θ` are the learnable weights inside concept-nets. To train `θ` we need
`dL/dθ` **without differentiating through the iteration** (which would be deep, memory-hungry, and
unstable). The trick (Almeida/Pineda 1987; Deep Equilibrium Models, Bai-Kolter-Koltun 2019) is to
differentiate the **fixpoint condition** itself:

```
solve the adjoint   (I − J_z)^T u = ∇_z L      at z*      (J_z = ∂F/∂z, one sweep)
then                dL/dθ = J_θ^T u                        (J_θ = ∂F/∂θ, one sweep)
```

- Well-posed iff the iteration **contracts** (spectral radius `ρ(J_z) < 1`) — the same condition that
  makes the forward fixpoint exist and be unique. As `ρ → 1` everything slows (forward sweeps, the
  Neumann backward depth, the gradient norm all scale `~1/(1−ρ)`). The engine's **apply-cap is the
  exact analogue of the Neumann truncation depth**.
- The **hard cast** (a step function) is handled by a **straight-through estimator (STE)**: hard
  forward, smooth (sigmoid-derivative) backward — consistent with the canonicalization barrier (a
  discrete cast at inference, continuous only during offline training).
- API: `solveFixpoint` (Picard), `implicitGrad` (the adjoint solve — `direct` or `neumann:K`),
  `spectralRadius` (the regime instrument), `numJac` (finite-difference Jacobians of one sweep).

Proven on a minimal **genuinely-cyclic** 2-fact model (a DAG would make implicit==unrolled, vacuous):
the implicit gradient matches finite-difference to `<1e-4`; **training converges** (loss `0.047→8e-9`);
the cycle is load-bearing (a fixed-depth unroll can't represent the fixpoint map); the `ρ→1` regime is
mapped (19 forward sweeps at ρ=0.3 → 419 at ρ=0.95). This module is a **differentiable mirror** of the
stabilization — the real engine stays discrete; a trained net is baked back via the bridge.

### 2.2 `concept-net.js` — a population of concept-units

A **concept-unit** is exactly the shape you'd sketch: a NN that decides **whether to cast** (the gate)
× a NN that **generates the value** it writes (the update):

```
contribution of unit i to its target fact  =  gate_i(ctx) · update_i(ctx)
gate_i   = σ(W^g_i·ctx + b^g_i)     cast decision   (hard = step at inference, STE backward)
update_i = σ(W^u_i·ctx + b^u_i)     the value cast
ctx      = z[ unit_i.inputs ]       the facts the unit reads — the WIRING / the FORM
```

Many units may target the same fact (their contributions **sum** — a mixture); one-unit-per-fact is the
special case (a ring/chain). The population is run to a fixpoint and trained end-to-end with §2.1.
Builders: `ringPopulation` (a cycle), `chainPopulation` (a DAG), `widePopulation` (K parallel units →
a readout). `train` / `grad` / `loss` do the learning.

Measured: the population gradient matches finite-difference; **training scales** across 2→6 units
without collapse (loss → `1e-10…1e-19`); a hard-cast (STE) population trains; a small population can
**distil** a bigger one's input→output map (3 units reproduce a 6-unit map).

### 2.3 `lifecycle.js` (+ `llm.js` / `ste.js`) — the plasticity knob

Every concept carries one scalar, its **plasticity `p ∈ [0,1]`** — the unified creativity/learning
knob. `p=1` plastic (learning on / high creativity), `p=0` frozen (deterministic, memo-perfect spine),
`{plastic, probationary, frozen}` is just the banding of `p`. The **same** `p` modulates very different
providers: an `LLM::complete` concept's **temperature** (`llm.js`) and an STE mini-NN concept's
**exploration noise** (`ste.js`). Consolidation is Complementary-Learning-Systems annealing: a concept
is born plastic and `p` decays toward 0 as its reliability is proven. **Discipline (K1):** plasticity
*modulates a provider*; it is **never** a fact that gates applicability (a continuous gate would churn
the memo). This is the train↔serve switch: **plastic = train, frozen = serve.**

### 2.4 The bridge — `bakePopulation` / `unrollPopulation` (train offline, serve in the engine)

A frozen, trained population is **baked back into real engine concepts**: each unit becomes a concept
`{ require, provider }` whose provider does the hard gate × update with the frozen weights, writes its
target fact + its self-flag, and the `require` keys on the producer unit's self-flag — so the
population **cascades in stabilization** to a terminal state. This is the frozen *serve* regime made
concrete (the multi-unit analogue of `ste.js#createNet`).

- **Acyclic** populations cascade directly (verified: a frozen `chain(3)` reproduces its mirror
  fixpoint through real stabilization to `<1e-9`).
- **Cyclic** populations can't be baked directly — the `require` graph would be a producer cycle with
  **no entry point** (it deadlocks), and the engine won't natively iterate a value-feedback loop. So
  `unrollPopulation(pop, N)` **unrolls** the fixpoint to depth `N` (Picard) into an acyclic DAG of `N`
  weight-tied stages, which bakes normally. The depth-`N` readout → the true fixpoint as `N` grows
  (`~ρ^N`); verified on the real engine (a `ring(3)` unrolled to N=6 reproduces the fixpoint to `<1e-9`).

### 2.5 `evolve` — the form grows by success

`evolve` grows a population one unit at a time and keeps a larger form **only while the added unit earns
its keep** — loss must improve past a `margin` (a utility/MDL gate, the continuous cousin of
`abstraction.js`). Growth stops at the parsimonious size that fits the task (too few underfit, the right
size fits, more don't pay for themselves). Verified: a teacher needing more capacity makes a 1-unit form
underfit → it grows → then a utility gate stops it; a 1-unit-sufficient task stays at 1 (Occam).

## 3. Honest limits (read before relying on this)

- **It is a *mirror*, plus a serving bridge.** Training happens in the differentiable mirror; the real
  engine is discrete. The bridge serves a frozen result; the engine does not train.
- **Topology matters (finding #24).** A *chain* of gate×update units **collapses in depth** — each fact
  squashes into `[0,1]`, so the next sigmoid runs near-linear and depth adds no expressivity (deep-GNN
  over-smoothing). Use **width**, not depth, for capacity.
- **Cyclic serving is *unrolled*** (finding #25), N× the concepts — not an engine-internal feedback loop.
- **STE depth/variance** is only validated at moderate depth; deep stacks of hard casts are unmeasured.
- **Heterogeneous concepts** — an `LLM::complete` or a deterministic rule is **not differentiable**, so
  it stays frozen / off-gradient. The gradient only reaches the NN-backed units. This is a *Mixture of
  Reasoners*, not a uniform net.
- **Distillation** is shown on a scalar-input toy; capacity/generalisation at scale is open.

## 4. File map · demos · tests

| File | Role |
|---|---|
| `lib/authoring/equilibrium.js` | DEQ: `solveFixpoint`, `implicitGrad`, `spectralRadius`, `numJac` |
| `lib/authoring/concept-net.js` | the population: `make/ring/chain/wide/unrollPopulation`, `train`, `grad`, `loss`, `evolve`, `bakePopulation` |
| `lib/authoring/lifecycle.js` | the plasticity ledger `p∈[0,1]` (CLS annealing) |
| `lib/providers/llm.js`, `lib/authoring/ste.js` | plasticity wired into a real provider (temperature / noise) |
| `examples/poc/equilibrium.js` | DEQ convergence + the ρ→1 regime + STE, narrated |
| `examples/poc/concept-population.js` | a population: train → scale 2→6 → evolve form → distil |
| `examples/poc/concept-bridge.js` | a frozen population served in the real engine |
| `examples/poc/plasticity.js` | one knob p → LLM temperature + NN noise, annealing plastic→frozen |
| `tests/unit/equilibrium*.test.js`, `tests/unit/concept-net*.test.js`, `tests/integration/concept-net-*.test.js` | the proofs |

Run a demo: `node examples/poc/concept-population.js` (or `concept-bridge.js`, `equilibrium.js`,
`plasticity.js`). Run the proofs: `npm test`.

## 5. Where this sits in the roadmap

This realizes the `#12`/`#13` line (grammar induction / crystallization) on its *continuous* side: the
discrete crystallization tools (`mine` → `abstraction` MDL gate → `crystallize`/`consolidate`) distil a
recurring sub-derivation into one typed production; this subsystem learns and serves concepts as trained
NN populations. They share the **memo-stability discipline** (a learned output must not leak onto a
snapped gate/memo surface — `memo-stability.js`). The open frontier: an engine-internal feedback loop
(no unroll), deeper/heterogeneous topologies, a self-training loop (the population observes episodes and
trains itself), and non-toy distillation. See the live ledger in [doc/WIP/HANDOFF.md](WIP/HANDOFF.md).
