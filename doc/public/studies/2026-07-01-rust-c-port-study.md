# Should the engine core be ported to Rust or C? — a fresh confrontation

*Single-axis critical study: does the engine core (`lib/graph/`), or part of it, warrant a port to Rust
or C (native N-API addon / WASM / hybrid)? We judge the **strategic case** for a port, not
implementation hygiene. This study **confronts** the prior art
`doc/WIP/studies/aspect-port-c-wasm.md` (written ~2026-06-22, pre-industrialization: it cites
`.layers.json`/webpack and "107 tests / 194 ms" — both now obsolete) with the code as it stands on
`master`, 2026-07-01, and asks whether anything that has **moved since** changes its verdict. It does
not — three of the moves **sharpen the "no" and make it decisive**.*

---

## 0. Verdict + confidence

**Do NOT port the core to Rust or C. Not for speed, not now, and — critically — the one thing that has
changed since the prior study makes "no" *stronger*, not weaker.** The prior study already established the
dominant fact (the workload is I/O-bound; the core is a sub-1 % Amdahl term; a naïve WASM port can be
*slower* than JS). That fact still holds on the current code, and three independent developments since
have removed the last hypothetical props from under a port:

1. **The project just SHED its toolchain — a port would REINTRODUCE it as a regression.** Industrialization
   removed layer-pack/webpack/Babel/React; the library is now **pure CommonJS with no build step**
   (`package.json` `scripts` = `test` only; `node lib/...` and `node --test` run the source directly).
   When the prior study was written a build already existed, so "a port adds a toolchain" was a *marginal*
   cost. Now it is the **loss of a hard-won, load-bearing property**: real line numbers when debugging the
   JTMS, browser-loadability, trivial auditability of AGPL source. Any Rust→WASM (cargo + `wasm-bindgen`)
   or N-API (`node-gyp`/`prebuildify`) path makes a compiled binary a *mandatory* build artifact again.
   This is the sharpest fresh argument and it is decisive.

2. **The one place native genuinely helped, the project already reached native — via the platform, with
   zero port.** The durable checkpoint store (`lib/durable/checkpoint-store.js`) uses **SQLite (C)** through
   the built-in **`node:sqlite`** (Node 22+), lazy-required, no FFI to maintain, no toolchain, no AGPL
   entanglement. This is a live counter-precedent: the real bottleneck the engine hit was **durable
   persistence I/O**, not graph CPU (Amdahl vindicated by the repo's own evolution), and when native
   *did* pay, the platform provided it without anyone porting a line of `lib/graph/`.

3. **The thesis crystallized *against* CPU.** the project's design notes now state outright the win is
   "amortization of recurrent typed methods … LLM-call/token elision + drift-robustness + auditability,
   **not CPU speed**." The DLL paper, the C-contract, and the durable executor all double down on
   elision/auditability. A CPU-motivated port is no longer merely Amdahl-weak — it is **off-thesis**.

**The single real JS perf item — `fork` deep-copies the whole graph per case (`Graph.js:2438`,
`JSON.parse(this.serialize().graph)` + full re-mount) — a port would NOT fix.** It is an
*algorithm/copy-strategy* problem, not a language problem (the Rete lesson applied to memory: move a bad
copy strategy into a fast language and it copies faster while staying O(graph) per fork). The fix is a
**structural-sharing / copy-on-write fork in JS** (Okasaki 1998; Bagwell HAMT 2001; immer/Clojure
persistent maps). That is the bounded first step — and it is *not* a port.

**Confidence:**
- **very high (0.9)** on "don't port for speed" — I/O-bound workload, re-measured locally, converging
  literature, and now the project's own stated thesis;
- **high (0.85)** on "a port would regress the no-build property the project deliberately won" — directly
  from `package.json` + the industrialization record;
- **high (0.8)** on "the real perf item is `fork` deep-copy and its fix is COW-in-JS, not a port" —
  read directly from `fork`/`serialize`/`mount`;
- **medium (0.6)** on the magnitude of any *future* edge/embed benefit — still no such requirement is
  posed (`HANDOFF.md`); conditional, as the prior study held.

---

## 1. Is there a real problem? (profile-by-reasoning + fresh measurement)

**Where does CPU actually go?** Four candidate hotspots, judged against the LLM/provider wall-clock:

- **Stabilization fixpoint (`_loopTF` → `stabilize.js` → `Entity.specialize` → `Concept.applyTo`).** The
  match is a **naïve object sweep**, self-documented (`MODELISATION.md` §2.3: "pre-Rete/naive",
  `O(objects × open-concepts)` per cycle). But it is **demand-scoped**: `updateApplicableConcepts`
  (`Entity.js:98`) sweeps only `_unstable` objects against *their currently-open* concepts
  (`_mapOpenConcepts`, a per-object tree frontier), not all objects × all concepts. With **11 concepts**
  in the shipped `common` set, the fan-out is trivial. This is not a hotspot at any plausible near-term
  scale, and if it ever became one the lever is **algorithmic in JS (Rete/TREAT/PHREAK), not the
  language** — CLIPS is written in C and *still* needs Rete (Forgy 1982; Miranker 1987). A native port
  that kept the naïve sweep would just run a bad algorithm in a fast language.

- **Expression eval (`expr.js`).** A jsep-parsed AST walked by a small tree-interpreter (`evalNode`),
  per `assert`/`ensure`/query. Each expression is tiny (a handful of nodes); the AST is parsed once at
  compile and cached in the compiled closure. Sub-microsecond. Not a hotspot. (Its real reason to exist
  is **safety** — it replaced `new Function` to close an RCE surface and *unblock* WASM/CSP — not speed;
  note that motivation is orthogonal to porting.)

- **Ref resolution (`getRef`, `Graph.js:521`).** A scalar pointer-chase over `_objById`/`refMap` — a few
  property reads per walked segment. Cheap. Not a hotspot.

- **`fork` deep-copy (`Graph.js:2438`).** `fork(seed)` with no seed does `JSON.parse(this.serialize()
  .graph)` — `serialize()` is `JSON.stringify` over every `_etty._` record — then `new Graph(record,…)`
  **reconstructs every Entity and re-stabilizes**. This is **O(graph size)** in serialize + parse +
  object reconstruction + a full JTMS re-cast pass, paid **per fork**. In a fork-per-case regime (the
  master-loop / sub-agent sandbox pattern) this is the one genuine, named CPU/allocation cost. **This is
  the real problem — and it is a JS data-structure problem, not a language problem.**

**Fresh measurement (2026-07-01, this repo, `node --test`, no LLM in the loop):**
`753 tests, 752 pass, 0 fail, duration_ms ≈ 3695` (wall ≈ 3.7 s). This is **7× the prior study's 194 ms
— and yet it strengthens the Amdahl point**, because the growth is *not* graph CPU: the suite now
includes the durable executor's **real `node:sqlite` disk I/O and crash-resume simulations**. The
heaviest *single* graph test ("synthesis reactively in-stabilization, bottom-up") is **57 ms**; the vast
majority settle in **sub-ms to low-ms**. A single LLM call is **100 ms – several seconds**. Per
agent-turn, the entire graph core remains **well under 1 %** of wall-clock. Amdahl's law bounds any
core-only speedup below that ceiling. **The CPU is not the bottleneck; durability and model latency are —
and neither is addressed by porting `lib/graph/`.**

> **Honest exception.** If a workload ever forks thousands of cases per second (no such workload exists
> today), `fork`'s O(graph) copy could dominate. That is the *only* profile under which a native kernel
> is even worth discussing — and §5 shows the JS fix should be tried and measured *first*, because a port
> would inherit the same O(graph) copy.

---

## 2. Options matrix

We weigh each option on the axes this engine actually cares about: **interop cost, determinism risk,
no-build compatibility, browser story, maintenance/AGPL cost.**

**(a) No port — optimize in JS.** Structural-sharing / copy-on-write `fork` (§5) attacks the one real
perf item directly; Rete/PHREAK is on the shelf if matching ever becomes a hotspot (it isn't). Zero
interop cost, zero determinism risk beyond ordinary review, keeps no-build + browser + trivial
auditability. **The default and the recommendation.**

**(b) WASM kernel (Rust `wasm-bindgen` / AssemblyScript).** Runs in browser + node + edge, sandboxed.
**But the JS↔WASM boundary is the pathology for *this* engine:** the provider frontier is called **per
concept-apply, mid-cast**, handed the **live `graph` and `scope` Entity** (`Concept.js:213`
`providers[p[0]][p[1]](graph, me, scope, argz, cb)`). Only numbers cross the boundary free; strings/objects
must be copied/transcoded into linear memory (Mozilla Hacks 2019/2026), and wrapping data as `JsValue` is
~14× a raw pointer read (wasm-bindgen #2741 [memory, verify]). A per-apply JSON round-trip can make the
port **slower than pure JS** — exactly Evan Wallace's esbuild-wasm result ("~10× slower than native").
AssemblyScript is separately disqualified (0.x after ~9 years, home-grown GC, closures unimplemented).
Determinism risk: **high** (reimplementing `taskflow.js` + the JTMS cascade). No-build: **broken**
(cargo + `wasm-bindgen`/`wasm-pack`). Browser: the only option that *keeps* it — but only if the frontier
is first made message-shaped (not done, see §3).

**(c) Native N-API addon (`napi-rs` / `neon`).** Node-only. **Kills the browser story** and the no-build
property (`node-gyp`/`prebuildify`, per-platform prebuilt binaries). N-API is ABI-stable and mature
(prod at SWC/Rspack/Oxc), but the boundary is not free (`bun:ffi` measures N-API ~2–6× a raw FFI). Buys
raw CPU we don't need (I/O-bound). Determinism + memory risk: **very high** if C (manual memory over a
cyclic, cascade-retracting graph = use-after-free country). **Amdahl gadget + regression of two
properties.** Reject.

**(d) Full rewrite (core → Rust/C).** Rejected unless *all* of: a posed edge/embed-non-JS requirement,
a **stabilized model** (it is still in active R&D — self-mod, authoring, durable executor all recent),
**and** a genericized, message-shaped provider ABI (not built). None hold. The prior study's `HANDOFF`
§3 gotcha list (self-flag-or-re-fire, `$$` global refs, `{__push}` race-freedom, `assert`/`ensure`
defeasance, mid-stabilize re-entrancy, apply-ceiling backstop) is now **larger** — findings run past #38
— so the characterization-oracle burden of a faithful rewrite has grown, not shrunk.

**(e) Hybrid — only the hot kernel native, JS orchestration.** The intellectually honest "if we ever
port" shape (prior study's recommendation): keep providers + orchestration in JS, move only a *pure*
kernel behind a coarse, message-shaped ABI. **But the only kernel with a real cost is `fork`'s
copy+re-mount, and that is best fixed in JS first (§5).** There is no *other* pure hot kernel worth
extracting. So even the hybrid reduces to "(a) first."

| Option | Objective | Interop cost | Determinism risk | No-build kept? | Browser kept? | AGPL/maint | Verdict |
|---|---|---|---|---|---|---|---|
| **(a) JS: COW-fork (+Rete if ever)** | Fix the real item | none | low | ✅ | ✅ | trivial (source) | **Do this** |
| (b) Rust→WASM kernel | Edge/browser/embed | **high (per-apply boundary)** | high | ❌ (cargo) | ✅* | binary artifact | Only if edge *posed* ∧ ABI first |
| (c) N-API (napi-rs/neon) | Max CPU | medium | very high (C) / high (Rust) | ❌ | ❌ | prebuilt binaries | **Amdahl gadget — reject** |
| (d) Full core rewrite | Everything | very high | very high | ❌ | ✅* | large | Reject-unless (none hold) |
| (e) Hybrid hot-kernel | Only the copy kernel | high | high | ❌ | ✅* | binary | Collapses into (a) |

\* Browser/embed benefit is *conditional* on first making the provider frontier unidirectional +
message-shaped — work that is valuable independently and **still not done** (§3).

---

## 3. The determinism & memory-model constraint (what breaks crossing native)

Three properties of the core are load-bearing, and each is hostile to a native boundary:

**Object identity is the graph.** The JTMS cascade is a recursive walk over a **live, cyclic object
graph** keyed by identity: `_objById`, `refMap`, `_watchers`, `_mappedConcepts`, and `_openConcepts`.
`unCast` (`Entity.js:235`) recursively un-casts `c._openConcepts` (line 259), re-arms watchers via
`getRef(..., follow=true)`, and splices `_mapsByConcept`. Watchers/followers are *pointers to objects*.
In linear WASM/C memory you must reimplement this as an arena + a handle table + your own retraction
cascade — and manual memory over a **cascade-retracting cyclic graph** is precisely where C earns
use-after-free bugs. Rust helps (ownership ≈ GC-free safety) but a cyclic graph forces `Rc<RefCell>` or
arena-indices, surrendering much of the borrow-checker's value. **This is K2, and it has not changed.**

**The sequenced taskflow is the determinism spine.** `taskflow.js` (247 LOC, vendored, zero-dep) is a
lock/release/followers semaphore whose exact semantics the loop depends on. `{__push}` fan-in is
**race-free precisely because** it happens at apply-time on the single mutation thread (`Entity.js:346`
comment). All mutations flow through this one sequenced path (a standing hard constraint — never
out-of-band `set()`). A native reimplementation must reproduce the ordering *bit-for-bit*, including the
P2 `flow.wait()/release()` balance gotcha (`Concept.js:199-236`) that already cost a real debug cycle.
Pure downside risk; no upside (it is not a hotspot).

**The provider frontier is bidirectional and fine-grained — the prior study's sine-qua-non is still
unmet.** The return path is clean data (`cb(err, mutationTemplate)`), but the provider is *handed the
live graph* and reads the *live `scope` Entity* mid-cast. To port the kernel you must first invert this
into a **unidirectional, coarse, message-shaped RPC** — serialized scope snapshot in, mutation-template
out, one round-trip per model call, not per micro-op — so K1 (boundary marshaling) cannot dominate.
Verified on the current code: providers are **still host closures** (`createLLMProvider({ ask }) → { LLM:
{ complete } }`, `providers[ns][fn](graph, me, scope, argz, cb)`). The genericization the prior study
named as the *prerequisite* for any port **has not happened**. Encouragingly, the *contract* has moved
toward it (the canonicalization barrier `prompt.facts`, the C0 intake `lib/providers/intake.js` with its
`IntakeStatus∈typed|partial|untyped` gate, the C-contract): the **generic concept template is already a
language-agnostic IR**. That IR *is* the portable artifact — which both enables a future kernel port
*and* reduces its urgency (the cross-language boundary already exists at the template level, without
touching `lib/graph/`).

---

## 4. What actually moved since the prior study (and why it hardens the "no")

The prior study's structure and verdict survive intact. The deltas since 2026-06-22 all cut the *same*
way:

- **Industrialization → no-build (§0.1).** The prior study could not make the "reintroduces a mandatory
  toolchain = regression" argument, because a build (`.layers.json`/webpack) still existed then. Post-
  industrialization it is the strongest single argument against (b)/(c)/(d).
- **The durable executor + `node:sqlite` (§0.2).** New since the prior study. It is the empirical answer
  to "where does native pay?" — durability, reached via the platform, no port. It also relocates the real
  engineering bottleneck away from graph CPU entirely.
- **The thesis text (§0.3).** the design notes' explicit "not CPU speed" did not exist in the
  prior study's frame; it converts the Amdahl argument from *an analyst's inference* into *the project's
  own stated value proposition*.
- **The gotcha/finding ledger grew** (past #38). K4 (regression risk of a faithful rewrite) is larger.
- **The AGPL relicense** (sole author, repo public). A binary native addon is *legal* but *less
  auditable* than visible CJS source — mild friction with the "Git for reasoning / auditability" pillar
  the whole arc leans on. A no-build source library is the most auditable possible shipping form.

Nothing that moved argues *for* a port; several moves argue against.

---

## 5. The bounded first step + kill-gate

**Do NOT port. Instead, fix the one measured-plausible hotspot in JS: a structural-sharing /
copy-on-write `fork`.**

- **What.** Replace `fork`'s `JSON.parse(serialize())` + full re-mount with a **copy-on-write layer over
  `_objById` / `_etty._`**: the child shares the parent's record objects and cast-state until it first
  writes, at which point only the touched records are cloned (path-copying). Because every mutation
  already flows through the one sequenced `pushMutation` path, a COW interception point is well-defined
  and determinism is preserved. Forking from a *stable* snapshot can also copy the settled cast-state so
  the child starts stable and only re-stabilizes on divergence — eliding the full re-cast pass too. This
  is the classic persistent-data-structure move (Okasaki 1998; Bagwell HAMT 2001; Clojure persistent
  maps; immer's structural sharing in JS). It is **zero-core-risk-relative-to-a-port**, keeps no-build +
  browser, and is exactly the kind of "lift the existing machinery, don't add a language" the R&D
  methodology mandates.

- **Kill-gate (before *any* native work is even reconsidered):**
  1. **Measure `fork` on a real fork-per-case workload** (the master-loop / sub-agent regime). If
     `fork` copy+re-mount is **not** a dominant term of a real run's wall-clock, stop — there is no
     problem, and a port is unjustifiable. (Current expectation, given 11 concepts and sub-ms
     stabilization: it is not yet dominant.)
  2. **If it *is* dominant, build the COW/structural-sharing fork in JS and re-measure.** A persistent-
     structure fork should turn O(graph) per fork into O(divergence). If that closes the gap — **done, no
     port.**
  3. **Only if COW-fork in JS *still* leaves an unavoidable O(graph) copy dominating a real workload**
     does a native *arena for the record store* become a candidate — and even then, **only the copy
     kernel, behind the message-shaped template ABI, providers staying in JS, Rust not C**, and only after
     the model is stabilized and an edge/embed requirement is actually posed. That is a distant,
     triple-gated contingency, not a plan.

**One sentence.** The port question answers itself the moment you look at the profile and the
`package.json`: the CPU is a sub-1 % Amdahl term, the real cost is a JS copy strategy that a port would
inherit rather than cure, and the project just *paid to remove* the exact toolchain a port would drag
back — so **optimize `fork` with structural sharing in JS, port nothing, and let `node:sqlite` remain the
proof that when native truly pays, the platform already delivers it.**

---

## 6. Sources (author/year/system; reuse of the prior study's dated list where already verified there)

**This repo (primary, read 2026-07-01):**
- `package.json` (scripts = `test` only; deps `jsep`/`deepmerge`/`shortid`/jsep-plugins — **no build**).
- `lib/graph/Graph.js` — `_loopTF` (L309), `serialize` (L385), `getRef` (L521), `fork` (L2415:
  `JSON.parse(this.serialize().graph)` + `new Graph`), `merge` (L2452).
- `lib/graph/objects/Concept.js` — `applyTo` (L144): provider frontier
  `providers[p[0]][p[1]](graph, me, scope, argz, cb)` mid-cast + P2 flow-balance (L199-236).
- `lib/graph/objects/Entity.js` — `unCast` recursive cascade (L235-286), `specialize` (L291),
  `updateApplicableConcepts` (L98), `{__push}` race-freedom note (L346).
- `lib/graph/tasks/{taskflow.js (247),stabilize.js (58)}`; `lib/graph/expr.js` (jsep tree-interpreter,
  RCE-safe, "hard blocker for WASM" was the *old* `new Function`).
- `lib/durable/checkpoint-store.js` — `node:sqlite` `DatabaseSync`, lazy-required (L326), "Node 22+".
- `lib/providers/{llm.js,intake.js}` — providers still host closures; `IntakeStatus∈typed|partial|
  untyped` C0 gate; the generic template = language-agnostic IR.
- the design notes ("… not CPU speed"); `doc/MODELISATION.md` §2.3 ("pre-Rete/naive",
  `O(objects × open-concepts)`); `doc/WIP/HANDOFF.md` §3 (gotcha ledger, findings past #38).
- **Fresh measurement:** `node --test` → 753 tests, 752 pass, 0 fail, `duration_ms ≈ 3695`, wall ≈ 3.7 s
  (includes real `node:sqlite` disk I/O + crash-resume sims; **no LLM**). Heaviest single graph test
  57 ms; most sub-ms to low-ms.

**Prior art confronted:** `doc/WIP/studies/aspect-port-c-wasm.md` (2026-06-22, pre-industrialization).
Its verdict — "don't port for speed; genericize providers + define the template ABI first; *if ever*,
Rust → dual native+WASM, pure kernel only, providers at the edge, coarse message-shaped frontier" —
is **reaffirmed and hardened**. Its full dated source list (Amdahl; Forgy 1982 *Rete*, AI 19(1):17-37;
Miranker 1987 *TREAT*, AAAI-87; CLIPS-in-C-still-Rete; Drools PHREAK; Mozilla Hacks JS↔WASM marshaling
2019/2026; wasm-bindgen #2741 JsValue ~14× [flagged informal]; V8 wasm speculative-optimizations 2025;
esbuild-in-Go / WASM-10×-slower, Evan Wallace 2020; `wasm-bindgen` v0.2.x active / rustwasm WG sunset
2025; salsa/Adapton in Rust; SWC/Ruff/Biome/Oxc as JS→Rust ports; Fastly Compute / Cloudflare Workers
WASM; WASI 0.2 Component Model + WIT as the IR; napi-rs v3 / Node-API; `bun:ffi` N-API 2–6×;
AssemblyScript status) is **incorporated by reference** and not re-derived.

**Fresh citations for the JS-first recommendation (§5):**
- Okasaki, C. *Purely Functional Data Structures*, Cambridge Univ. Press, **1998** — path-copying /
  persistent structures = O(change) not O(size) per version.
- Bagwell, P. *Ideal Hash Trees* (HAMT), EPFL tech report, **2001** — structural-sharing maps.
- Hickey, R. — Clojure persistent data structures / structural sharing [memory, verify exact talk].
- immer (Weststrate) — copy-on-write via structural sharing in JS [memory, verify].
- `node:sqlite` `DatabaseSync` — Node 22+ built-in (experimental) [memory: landed ~Node 22.5, verify].
- `structuredClone` (HTML spec; Node 17+) — a faster deep-copy than JSON round-trip *if* full copy is
  ever kept, but strictly inferior to COW for `fork` [memory, verify Node version].

---

## Code / docs read

`package.json`; `lib/graph/Graph.js` (`_loopTF`, `serialize`, `getRef`, `fork`/`merge`);
`lib/graph/objects/{Concept.js (applyTo/provider frontier), Entity.js (unCast/specialize/
updateApplicableConcepts/set), Node.js, Segment.js, PathMap.js}`; `lib/graph/tasks/{taskflow.js,
stabilize.js}`; `lib/graph/expr.js`; `lib/durable/checkpoint-store.js`; `lib/providers/{llm.js,
intake.js, index.js}`; the design notes; `doc/MODELISATION.md` §2.3; the local R&D ledger;
`doc/WIP/studies/aspect-port-c-wasm.md` (the prior art); `doc/WIP/methodology-rd-and-test.md`.
Empirical: `node --test` full suite, 2026-07-01.
</content>
</invoke>
