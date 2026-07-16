# Plugins

A **plugin** is a self-contained bundle `{ concepts, providers, JS, .sgc }` that the engine resolves into a
bootable graph config. The engine and its loaders stay plugin-agnostic; the plugin subsystem
(`lib/plugins/`) is the only surface that knows plugins exist. Design rationale and the core/plugin line
live in the repo's model notes; this page is the practical contract.

Reach it via the facade: `require('skynet-graph').plugins` (`resolvePlugins`, `loadPlugin`, `loadPlugins`,
`definePlugin`, `lintPluginDeps`) — plus `require('skynet-graph').definePlugin` at the top level for plugin
authors.

## The manifest — `sg-plugin.json`

Most of a plugin's manifest is *derived* from its concept-map (`deriveManifest`), so the hand-written file is
small — identity + what the resolver must check:

```jsonc
{
  "name": "critical-mind",            // plugin identity == its npm package name
  "version": "0.1.0",
  "tier": 1,                          // 0 = grammar + .sgc only (safe by construction); 1 = has JS providers (trust)
  "description": "…",
  "concepts": ["dialectic"],          // concept set(s) mounted from concepts/<set>/
  "providerNamespaces": ["Dialectic"],// namespaces this plugin CLAIMS (a second claimer is refused)
  "entrypoints": {
    "providers": "./providers.js",    // Tier-1 only — exports { Ns: { fn } } (static; factory-built providers stay out)
    "factories": { "createCriticalMind": "./factory.js" }   // packaged assemblies ("combos" = legacy alias, read until 2.0)
  },
  "deps": [{ "name": "reason-kernel", "range": "^1.0.0" }]  // npm package names + semver ranges
}
```

Standard directory layout:

```
<plugin>/
  sg-plugin.json
  package.json                 (npm-published plugins — see distribution below)
  concepts/<set>/…             one concept set per name in `concepts`
  providers.js                 Tier-1 only
  factory.js                     optional Graph.factories.* factory
  index.js                     npm-published plugins — the auto-export (see below)
```

## Two ways to load

The resolver is the one genuinely new piece; everything downstream (conceptSets + `dmerge`, `register`,
grammar-graph collisions, `.sgc` pack) already exists.

`resolvePlugins(pluginObjects)` → `{ order, conceptMap, conceptSets, providers, combos }`. Wire the result
exactly as a host does by hand: `Graph._providers = cfg.providers; new Graph(record, { conceptSets:
cfg.conceptSets, … }, cfg.conceptMap)`.

### 1. Local / dev — a `plugins/` folder

Point the file loader at each plugin directory; deps resolve as siblings in the same call:

```js
const { loadPlugins } = require('skynet-graph').plugins;
const cfg = loadPlugins(['./plugins/reason-kernel', './plugins/critical-mind']);
```

`loadPlugin(dir)` turns one directory into a plugin object; `loadPlugins(dirs)` loads each and resolves them
together. Use this while developing in-tree.

### 2. Distribution — plugins as npm packages

A published plugin is an **npm package whose `index.js` exports its plugin object** via `definePlugin`, so a
consumer just requires it:

```js
// @scope/critical-mind/index.js
module.exports = require('skynet-graph').definePlugin(__dirname, [
  require('reason-kernel'),          // a dependency the plugin require()s and CARRIES as an object
]);
```

```js
// a host
const criticalMind = require('@scope/critical-mind');
const cfg = require('skynet-graph').plugins.resolvePlugins([criticalMind]);
```

The key idea (and the reason the resolver never touches the network): **npm + node's `require` do all
fetching and resolution.** A plugin `require`s its dependencies and *carries them as objects*;
`resolvePlugins` **flattens** that object graph — collecting every carried dependency transitively, deduping
by name (two different versions of one plugin is a hard error, never a silent clobber) — and only then runs
the same topo-sort / semver / namespace-claim / merge it runs for the sibling path. Both paths converge on
the same resolved config.

`definePlugin(dir, depObjects)` is `loadPlugin(dir)` plus that carriage. It checks the carried set against
`sg-plugin.deps` at author time: every declared dependency must be carried (catches a forgotten `require`),
and every carried object must be declared (catches a stray one). A no-dependency plugin is simply
`definePlugin(__dirname)`.

Publish to npm **and** GitHub (`npm i github:user/repo`). Two manifests coexist by design: `package.json`
(npm) and `sg-plugin.json` (plugin); `sg-plugin.deps` are npm package names. `lintPluginDeps(dir)` checks
that `sg-plugin.deps ⊆ package.json` dependencies (∪ peer ∪ optional) — a plugin dependency npm never
installs would `require`-fail at load.

## Dependencies — the precise cycle rule

`deps` (with semver ranges) are topologically ordered so a dependency initialises before its dependent. The
**JS init order must be a DAG** — an init cycle is refused. But **grammar cross-references may be mutual**: a
fact produced in A and read in B *and vice-versa* is fine, because the merged concept-map is order-free (the
runtime tests applicability by watchers, not by load order). A shared kernel read both ways is the normal
case, not an error.

## Two tiers of trust

- **Tier-0 — grammar + `.sgc`, no JS.** The concept DSL (`require`/`assert`/`ensure`) is a compiled
  expression evaluator over graph facts, not a JS `eval`: no I/O, no filesystem. Worst case is a malformed
  grammar (caught by `validate` at author time) or an oscillation (caught by the apply-cap → `divergent`).
  A Tier-0 plugin can run without trusting its author.
- **Tier-1 — JS providers/combos.** In-process JS is full power; trust is required. The honest mitigation is
  the tier split: push as much capability as possible into Tier-0 grammar, and keep Tier-1 for genuinely new
  providers (a new tool, a scoring backend, a search driver).

## The invariant to protect

Every dependent keys on the **fact names** its dependency produces — the alphabet *is* the API. Freeze a
kernel's alphabet early and version it strictly; renaming a produced fact silently stops a dependent's
concepts from casting. `deriveManifest` makes the alphabet inspectable and diffable so this stays a
discipline, not a surprise.

## The tooling — `sg plugin`

```
sg plugin list [dir]              # enumerate a folder's plugins from their manifests (no code is run)
sg plugin validate <dir>          # load + lint ONE plugin (exit 0 = no errors)
sg plugin scaffold <name> [root]  # write a loadable skeleton package (Tier-0 by default)
```

`validate` checks what would break a consumer — an unloadable plugin, a lying dependency declaration
(`sg-plugin.deps` must be ⊆ `package.json` dependencies), structurally invalid grammar per set — and
surfaces the **derived cross-checks** (`deriveManifest`) as warnings: provider namespaces the grammar
actually references vs. the manifest's claims (an unclaimed namespace is legitimate when it is ambient —
`AI`/`LLM`/`Semiring` — or claimed by a dependency), claims nothing serves (usually factory-built
providers, supplied at run time), and fact collisions across the plugin's own sets (by design for
extension sets that share a spine, e.g. `loop`/`loop-reactive`).

## The bundled plugins

The repo ships its own capabilities as plugins under `plugins/` — they are the pattern to copy:
`reason-kernel` (the kernel foundation: the append-only Ledger + the k-ary margin gate, the generic
`Thought`, the `Score` band, the typed `Relation`, the `Mark` watched-mirror brick) · `critical-mind`
(C9, depends on reason-kernel — the first real object-carried dep; the DEFAULT `createCriticalMind`
is the full concept-set GRAMMAR face — what `sg mcp critique` runs — with the measured imperative
reference exported one release as `createCriticalMindImperative`; parity is enforced scripted by
`critique-grammar-parity.test.js` and was re-measured live on GPU) · the **strategy pack** (Tier-0
kernel clients unless noted): `self-consistency` (+ the `sg mcp` `self_consistency` tool) ·
`refinement` (two accept gates: score band / external binary verdict — the `reflexion` set) ·
`socratic` · `least-to-most` · `analogical` · `react-loop` · `tree-of-thoughts` and `mcts` (Tier-1:
state-in-graph + a thin deterministic search driver) · `planner` (C7 — grammar + projection engine +
`createPlanLoop`) · `learning` (the DLL toolkit + `createLearningLibrary`) · `forge`
(dataset→certified stock, depends on learning) · `durable` (C2 — checkpoint executor +
`createDurableRunner`) · `mixture-serve` (C8). Every one of them passes `sg plugin validate` with
zero errors — the suite enforces it (`tests/unit/plugin-cli.test.js`).

## The strategy catalog — one kernel, deposited sets

Thirteen reasoning strategies commonly shipped as isolated framework classes are covered here by
**one kernel + deposited concept sets** (a strategy is FILES you drop, not code you fork):

| Strategy | Here | Shape |
|---|---|---|
| Chain-of-Thought | a single ask (any factory) | trivial — no grammar needed |
| Decomposition | `concepts/_substrate` (C1) / `planner` (C7) | grammar + projection engine |
| Least-to-Most | `least-to-most` | Tier-0: emergent release chain + order guard |
| Adversarial Debate | `critical-mind` (C9) | the MEASURED one — grammar face default |
| Reflexion | `refinement` (set `reflexion`) | Tier-0: external binary verdict, bounded rounds |
| Iterative Refinement | `refinement` (set `refinement`) | Tier-0: K1 score band, bounded rounds |
| Self-Consistency | `self-consistency` (+ MCP tool) | Tier-0: snapped votes + the margin bound |
| Socratic | `socratic` | Tier-0: insight tallies + coverage counter-gate |
| Analogical | `analogical` | Tier-0: defeasible maps-to transfer (JTMS) |
| Meta-Router | `makeArchetypeRouter` (planner) | classify → dispatch by deposited children |
| ReAct | `react-loop` | Tier-0: live action worklist + 3 stops; tools = host |
| Tree-of-Thoughts | `tree-of-thoughts` | Tier-1: native cascade prune + beam driver |
| MCTS | `mcts` | Tier-1: stats-as-facts + deterministic UCB1 driver |

Honest scope: **the measured guarantees are C9's** (0-fabrication, the decidability bound, GPU-replayed);
the other sets are *expressible and structurally proven* (0-model tests, negative controls, replay
determinism), not LLM-benchmarked. Two standing rules: the kernel grows ONLY when a real client
demands a brick (Thought/decide ← self-consistency · Score ← refinement · Relation ← analogical ·
Mark ← tree-of-thoughts), and **no strategy ships a self-scoring path** — a score/critique/judgment
must come from an EXTERNAL source (judge model, oracle, test): the generator judging itself is the
measured, refuted self-audit.

Two authoring gotchas these plugins paid for (both linted/documented). (1) `Node`/`Segment` are the
pre-set ROOT FACTS of the concept system — concept trees ANCHOR on them via `require` (the
Vertice/Edge entry-point pattern, `require: "Node"`). Do not NAME a concept after a root fact while
giving it conditions: it maps the instant the object exists, before its late requires resolve, and
its children are silently never descended (the validator warns `engine-marker-name` on that exact
shape). (2) a cross-object gate must watch a FACT, not a concept flag (flags appear through `set()`
but vanish through a silent delete on uncast — mirror with the kernel's `Mark::set/unset` so
retraction cascades).
