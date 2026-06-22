# Plan — Industrialisation Skynet-Graph

**Branche :** `refactor/industrialize-v1` (off `feat/moe-graph-v1-phase0`).
**But :** transformer le moteur (R&D mécaniquement terminé, #10+#11, 107 tests) en
**bibliothèque industrialisable** : autonome, débogable, scalable horizontalement.

Filet de sécurité : **les 107 tests doivent rester verts à chaque phase**. Baseline :
Node v24.14.0, `npm test` = 107/107.

## Décisions (2026-06-22)
- **Taskflows** → shim vendored zero-dep (`taskflow.js`), API identique. ✅ fait (P1).
- **Build/exec** → **ESM natif, zéro transpile au runtime** (priorité : debug + exec
  autonome). `node lib/...` et `node --test` tournent en direct. Bundle 1-fichier
  *optionnel* (esbuild à la demande, seulement si un worker doit recevoir un artefact
  unique — sinon on expédie l'arbo + loader de dossiers). Suppression layer-pack + babel.
- **Distribution** → **worker process réel ce tour-ci** : snapshot JSON (`pack/unpack`)
  + proxy des providers vers le parent (les closures non sérialisables).

## Constats qui dictent le plan
- taskflows = code de l'auteur, ~260 LoC, contrat exact connu ; les 107 tests l'épinglent.
- Source = **mixte ESM/CJS** ; **React non utilisé** (peer-dep fantôme) ; **un seul
  webpack-isme** (`__non_webpack_require__` pour l'`App/db` hôte, déjà fallback `require`
  + échappatoire `cfg.bagRefManagers`) ; `package.json main` pointe vers un `dist/Comp.js`
  inexistant.
- **La frontière master/client est DÉJÀ du JSON pur** (`{baseRev,parent,tpl}` ⇄
  `{atoms,token}`). Seules les *closures câblées par l'hôte* (providers, bagRefManagers,
  callbacks, conceptMap) ne traversent pas un process. **Insight : « charger
  concepts/providers depuis des dossiers » = le mécanisme de réhydratation d'un worker.**
  Une brique, deux usages.
- Pack complet pour expédier = `serialize()` + `_serializeConceptTree()` (déjà écrit pour
  le rollback N6) + refs de dossiers providers.

## Arborescence cible
```
lib/
  graph/        moteur (ex-App/) : Graph.js, expr.js, objects/*, tasks/*, index.js
  providers/    geo, llm, canonicalize, verify, index   (opt-in hôte)
  sg/           CLI + outillage : cli.js (run/trace/show/concepts/errors), trace.js
  authoring/    validate, author, supervise, loop, clock, concepts-loader
  utils/        taskflow.js, runtime.js (__SERVER__ flag)
  runtime/      distribution : transport.js, pack.js, worker.js
examples/       run-basic, run-prompt, run-problem (démos, non shippées)
bin/sg          shim CLI → lib/sg/cli.js
concepts/  tests/   données + tests (boot repointé)
```

## Phases (chaque phase verte avant la suivante)
- **P1 — Vendoriser taskflow.** ✅ `App/tasks/taskflow.js`, dép retirée. 107/107.
- **P2 — Réorg (déplacement `git mv` vers `lib/`, CJS+babel conservés).** Repointer les
  références cross-arbre (tests→boot, _lab→../App|../providers|../concepts). 107/107.
- **P3 — ESM natif + dé-webpack.** Convertir `lib/**` en ESM (`import/export`, extensions
  `.js`), `"type":"module"`, retirer `__non_webpack_require__`, babel-register, layer-pack,
  lpack-react, react. Fixer `main`/`exports`/`scripts`. Build esbuild optionnel. 107/107
  sous `node --test` natif (sans babel).
- **P4 — API autonome + CLI.** `Graph.fromDirs({concepts, providers})` + loaders de
  dossiers ; `bin/sg run --concepts ./c --providers ./p`. (= substrat de réhydratation.)
- **P5 — Worker process.** `pack()/unpack()` snapshot complet + interface `Transport` +
  spawner worker_threads/child_process + proxy providers vers le parent.

## Hors-périmètre (R&D, autre chantier)
Plafond R&D ouvert : corpus de concepts à vocabulaire humain ; superviseur = concept à
meilleur modèle ; stratégies plurielles ; boucle réactive multi-tentatives + mémoire de
stratégie ; experts probatoires. Primitives core optionnelles : agrégation `count`/`all`,
lint cycles négatifs (Tarjan-SCC), reaper de fraîcheur autonome. Capstone régime live (N10).
