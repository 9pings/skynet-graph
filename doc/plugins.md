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
`reason-kernel` (the Ledger/Thought/Score kernel foundation) · `critical-mind` (C9, depends on
reason-kernel — the first real object-carried dep; the DEFAULT `createCriticalMind` is the full
concept-set GRAMMAR face — what `sg mcp critique` runs — with the measured imperative reference
exported one release as `createCriticalMindImperative`; parity is enforced scripted by
`critique-grammar-parity.test.js` and was re-measured live on GPU) · `self-consistency` and `refinement` (Tier-0 pure
grammar, kernel clients) · `planner` (C7 — grammar + projection engine + `createPlanLoop`) · `learning`
(the DLL toolkit + `createLearningLibrary`) · `forge` (dataset→certified stock, depends on learning) ·
`durable` (C2 — checkpoint executor + `createDurableRunner`) · `mixture-serve` (C8). Every one of them
passes `sg plugin validate` with zero errors — the suite enforces it (`tests/unit/plugin-cli.test.js`).
