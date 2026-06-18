ok mais# Skynet-graph comme substrat d'agent : graphe typé + rétraction réactive + vues rendues

> Étude critique générative, datée **mai 2026**. Cadrage corrigé : le graphe n'est pas un moteur de recherche spéculative (ToT/LATS), c'est **l'état mental persistant et structuré d'un agent type Claude Code** — le prompt devient une *vue rendue à profondeur variable* d'un graphe d'état, pas un transcript cumulatif. Lecture du code réel (skynet-graph + aetheris-graph) et ancrage dans l'état de l'art 2025-2026. La partie « analyse-du-moteur » de `doc/ai-roadmap-feasibility-study.md` est reprise comme acquise ; son **cadrage de cas d'usage (expansion spéculative massive) est ignoré** — verdict et banc d'essai re-forgés ici.

---

## 0. Verdict en tête (cadrage corrigé)

**Recommandation : THIN-LAYER, avec un noyau à BUILD-from-scratch (ne pas réutiliser le moteur historique tel quel). Confiance : moyenne-haute (~70 %).**

Pour CE cadrage — le graphe comme **mémoire de travail externalisée + plan-of-record auto-cohérent** d'un agent long-horizon — l'idée est nettement plus juste que dans l'étude précédente, parce qu'elle joue sur la **vraie** force différenciante du moteur et pas sur sa faiblesse. Le triptyque **graphe typé + rétraction réactive (`ensure`/uncast en cascade) + vues rendues (`getChildPath`/`queryMaps`/`getPaths`)** adresse frontalement le problème n°1 des agents de 2026 : le *context rot* (Chroma, 2025) et la saturation de fenêtre. Là où Claude Code répond par compaction lossy + TodoWrite + filesystem, et où Letta répond par tiers mémoire auto-édités, **personne n'offre la primitive précise « quand un fait change, rétracter automatiquement et en cascade les sous-plans qui en dépendaient, de façon déterministe, sans relecture globale »**. Cette primitive est, conceptuellement, un **JTMS (justification-based truth maintenance system)** câblé sur un plan-graphe — une antériorité IA symbolique solide (de Kleer 1986) que le monde LLM redécouvre.

MAIS : (1) la valeur tient à **trois primitives**, pas au moteur de concepts complet — le système de hiérarchie de concepts JSON, le forward-chaining grammatical, la sync master/replica voyage sont du **surplus** pour ce cas. (2) Le bloqueur `new Function`/eval est ici **aggravé** : si du texte LLM atteint un `assert`/`ensure`/`queryMaps`, c'est une RCE. (3) « Vue rendue = zoom-out » reste une **compression lossy** qu'il ne faut pas survendre comme magique. (4) La capacité de planification migre dans les poids (reasoning models) : tout ce qui pilote *le raisonnement* par des règles statiques est du travail que le modèle a déjà absorbé — le moteur ne doit garder que le rôle **garde-fou / mémoire structurée vérifiable**, pas « générer le plan ».

Donc : **garder l'âme (3 primitives), jeter la dette (moteur 2016-2021 mono-auteur, eval-based, non testé).** Réécrire un noyau minimal « typed-graph + JTMS-retraction + rendered-views » et le poser comme couche d'état au-dessus d'un harnais d'agent (Claude Code SDK / LangGraph), pas l'inverse.

Les 2 critiques les plus dures sont en §5. Le détail porte-le verdict en §1-§4.

---

## 1. Cartographie générative des usages (à partir des affordances)

Méthode : je pars des affordances vérifiées dans le code, j'en **dérive** les familles d'usage qu'elles ouvrent (génératif), puis je critique chacune (réel / redondant / gadget) avant le tableau classé.

**Affordances vérifiées (code) :**
- État typé `Node`/`Segment`/`Document`, data flat dans `_` (`Entity.js` l.40, `Graph.js mount`). → mémoire structurée adressable.
- Règles déclaratives `require`/`assert`/`ensure`/`provider`/`applyMutations`/`autoCast` (`Concept.js init` l.30-82, `doc/doc.md`), castées par forward-chaining via `updateApplicableConcepts` (`Entity.js` l.60-183).
- **Rétraction réactive** : `static_ensure` (`Entity.js` l.18-27) recâble un watcher sur chaque ref d'un `ensure` ; quand la condition tombe → `unCast` (l.193-247) qui supprime la clé, **dé-caste récursivement les concepts enfants** (l.220-222) et lance les `cleaner` (l.225-239). Exemples réels : `must_StayOrMove.json` (`ensure: $Undefined && $TimePeriod.end.type=='+INF'`), `can_AddFlyTo.json` (`ensure: $TimePeriod.duration.days > 3`).
- Providers async **concurrents** (`Concept.applyTo` → `flow.wait()/release()`, l.115-160) mais mutations **sérialisées** (`pushMutation` + `_mutationThreadRunning`/`_mutationThread`, `Graph.js` l.832-837).
- **Vues rendues** à profondeur/sélection variable : `getChildPath` (rend la tranche courante d'un plan, l.1440-1513), `getPaths` (tous chemins entre 2 nœuds, l.1522-1616), `queryMaps`/`selectMaps` (sélection par prédicat, l.1650-1708), `serialize` (l.321-348), `getRef` (résolution de chemin relatif, l.430-506). → « rendre une tranche du graphe » au lieu d'un transcript.
- Blackboard + sync master/replica (`pushAtomicUpdates`, `cfg.pushToMaster`, `isMaster`).
- Mutations sérialisables + révisions (`this._revs[revNum]`, `getRevisionsRange`) → replay/audit/time-travel.
- API publique = surface d'outils agent : `castConcept`/`unCastConcept`/`pushMutation`/`pushPath`/`getPaths`/`getChildPath`/`queryMaps`/`serialize`.
- Limites : pas de détection de cycle (`getChildPath` *logge* « This graph have loops » l.1463 sans l'empêcher) ; applicabilité **booléenne** (pas de score) ; règles statiques (mount-time) ; `new Function`/eval pervasif (`Concept.js` l.62, `Entity.js` l.121/373, `Graph.js queryMaps`/`getChildMatching`) ; thread mutation mono-fil ; pas de provider LLM ni de similarité vectorielle.

### Usages dérivés

**U1 — Contexte-OS / mémoire de travail rendue en vues (le cas central).**
Le graphe est la RAM+disque de l'agent ; chaque tour de boucle, on **rend une vue** (le sous-plan courant via `getChildPath`, les items pertinents via `queryMaps`) au lieu d'empiler le transcript. *Affordance unique :* la vue est une **requête sur un état vivant**, pas un résumé figé — on peut zoomer (profondeur) et filtrer (prédicat) sans réécrire l'historique. *Fit :* très bon — c'est exactement le remède au context rot. *Nouveauté :* moyenne (Letta fait « OS de mémoire » ; Aider fait « vue à budget de tokens »), mais la combinaison vue-typée + rétraction est neuve. *Réel.*

**U2 — Plan-of-record long-horizon auto-cohérent (JTMS sur un plan).**
Le plan est un graphe de nœuds-étapes/segments-transitions ; les `ensure` encodent les invariants (« étape B invalide si la ressource de A est consommée ») ; quand un sous-agent réintègre un résultat qui casse une précondition, la branche **se rétracte toute seule en cascade** + cleaners. *Affordance unique :* rétraction **structurelle, fine-grain et déterministe** d'un plan partiel — un JTMS, pas un rollback de checkpoint (gros grain) ni une invalidation sémantique probabiliste (Graphiti). *Fit :* excellent. *Nouveauté :* haute pour le monde LLM (redécouverte du truth-maintenance). *Réel — c'est LE delta.*

**U3 — Coordinateur blackboard multi-agents sur état structuré partagé.**
Plusieurs sous-agents lisent/écrivent le même graphe ; `pushMutation` sérialisé garantit la cohérence sous fan-out ; les `ensure` arbitrent les contributions incohérentes. *Affordance unique :* blackboard **typé avec garde-fou symbolique** + atomicité native. *Fit :* bon. *Nouveauté :* le revival blackboard 2025 (arXiv 2507.01701, 2510.01285) implémente le blackboard avec des **agents LLM qui décident de contribuer**, pas avec des règles symboliques d'arbitrage — l'angle symbolique est différenciant mais à contre-courant. *Réel mais niche.*

**U4 — Couche de garde-fou / contraintes rétractables sur sorties LLM.**
Indépendamment de la mémoire : un validateur déclaratif où chaque contrainte est un `ensure` ; une sortie LLM qui viole une contrainte ne déclenche pas une erreur, elle **rétracte les faits dépendants** et laisse l'état dans un point cohérent réduit. *Affordance unique :* contrainte = règle vivante avec rollback dépendantiel automatique. *Fit :* bon en domaine régulé (cf. « Ontology-Constrained Neural Reasoning »). *Nouveauté :* moyenne-haute. *Réel mais étroit.*

**U5 — Store de trace auditable / replayable (time-travel de dérivation).**
`_revs` + mutations sérialisables → on peut prouver *comment* et *quand* chaque branche a été dérivée, rejouer, forker. *Affordance unique :* l'unité d'audit est la **mutation typée** + sa dérivation (`_origin`, `pathDescriptor`), pas un diff texte. *Fit :* correct. *Nouveauté :* faible — LangGraph checkpointing + LangSmith le font déjà, en prod. *Redondant.*

**U6 — Édition collaborative temps-réel d'un plan partagé (humain + agents).**
La sync master/replica était conçue pour ça (édition voyage collaborative). *Fit :* plausible mais hors-scope agent-de-code. *Nouveauté :* nulle (CRDT/Yjs, Liveblocks). *Gadget pour ce cadrage.*

**U7 — DSL de workflow déclaratif « auto-ordonnancé ».**
L'ordre d'exécution est **dérivé des dépendances** (`require`), pas codé. *Affordance unique :* élégance déclarative réelle. *Critique :* sur un agent, l'ordre n'est pas le problème dur ; le contrôle de budget/pruning l'est, et le booléen ne l'exprime pas. *Surplus / gadget* ici (vrai ailleurs).

### Tableau classé

| # | Usage | Affordance unique | Fit | Nouveauté réelle | Coût de build | Verdict |
|---|---|---|---|---|---|---|
| **U2** | Plan-of-record auto-cohérent (JTMS) | Rétraction structurelle cascadée déterministe d'un plan partiel | **Excellent** | **Haute** (truth-maintenance redécouvert) | Moyen (réécrire le noyau JTMS proprement) | **Build le noyau — c'est le delta** |
| **U1** | Mémoire de travail rendue en vues | Vue = requête typée sur état vivant (zoom/filtre), pas résumé figé | **Très bon** | Moyenne | Moyen | **Build (couplé à U2)** |
| **U4** | Garde-fou / contraintes rétractables sur LLM | Contrainte = règle vivante à rollback dépendantiel | Bon (régulé) | Moyenne-haute | Faible-moyen | Thin-layer ciblé |
| **U3** | Blackboard multi-agents symbolique | Blackboard typé + arbitrage `ensure` + atomicité | Bon | Moyenne (à contre-courant du blackboard-LLM) | Moyen | Niche réelle |
| **U5** | Trace auditable / replay | Audit par mutation typée + dérivation | Correct | Faible | Faible | Redondant (LangGraph/LangSmith) |
| **U7** | Workflow auto-ordonnancé | Ordre dérivé des dépendances | Faible (ici) | Faible | — | Surplus pour ce cadrage |
| **U6** | Co-édition temps-réel | Sync master/replica | Hors-scope | Nulle | — | Gadget ici |

**Lecture :** la valeur se concentre sur **U2+U1** (le cas central, indissociables : la rétraction n'a de sens que parce que l'état est rendu en vues et muté en direct). U4/U3 sont des spin-offs réels mais étroits. U5/U6/U7 sont couverts ailleurs ou hors-sujet.

---

## 2. Faisabilité du cas central (U1+U2)

### 2.1 Ce qu'il faut réellement construire

Le squelette existe. `aetheris-graph/providers/travels/Skypicker.js` prouve le pattern : un provider lit le scope (`originNode:Position`, `originNode:TimeStep`), appelle une API async, **renvoie un template de mutation** qui crée des branches (`Theoric:true`, nodes/segments + path-descriptors). Pour le cas agent :

- **Provider LLM** : `AI::proposeSteps` à la place de `Skypicker::getFlights` → un sous-agent renvoie des étapes comme mutations. Trivial à écrire (le contrat provider est `(graph, concept, scope, argz, cb) → cb(err, mutationTpl)`).
- **Couche « tools-as-graph-API »** : exposer `getChildPath`/`queryMaps`/`castConcept`/`pushMutation` comme outils de l'agent (function calling). C'est de la plomberie de schéma.
- **Renderer de vue** : fonction `renderView(focus, depth, filter) → markdown/JSON compact` au-dessus de `getChildPath`+`getPaths`+`getRef`. À écrire mais facile — c'est la pièce maîtresse du cas central et elle est absente aujourd'hui (le moteur sait *naviguer*, pas *rendre un contexte LLM*).
- **Boucle agent** : choisir une branche → déléguer à un sous-agent → réintégrer (`pushMutation`) → stabiliser → la rétraction `ensure` nettoie les branches invalidées → re-rendre la vue. Le `stabilize` + watchers font déjà la cohérence ; il manque la boucle de décision (LLM) au-dessus.

**PoC : quelques semaines.** **Production : réécriture partielle.** Points durs :

| Point dur | Sévérité (ce cadrage) | Contournable ? | Coût |
|---|---|---|---|
| `new Function`/eval sur `assert`/`ensure`/`queryMaps`/`getChildMatching` | **Rédhibitoire — aggravé** : ici du **texte LLM** peut atteindre un prédicat (l'agent propose des conditions) → RCE/injection + CSP impossible | Oui : parser + interpréteur du mini-langage de refs (sandbox, pas d'`eval`) | Moyen, **prérequis absolu** |
| Vue = compression **lossy** | **Moyen, à ne pas survendre** : zoomer/filtrer perd de l'info ; choisir *quoi* rendre est le vrai problème (comme le ranking d'Aider) | Oui : politique de rendu (profondeur adaptative, pertinence) — mais c'est du travail de fond, pas gratuit | Moyen |
| Applicabilité **booléenne** (pas de score) | **Moyen** : on ne peut pas dire « branche à 0.7 » nativement ; choisir quelle branche suivre est externe au moteur | Oui : score = donnée + `assert` de seuil ; ranking dans le LLM/un module externe | Faible en hack, mais le ranking sort du moteur |
| Thread mutation **mono-fil** | **Faible-moyen ici** (vs « expansion massive » de l'ancienne étude) : la réintégration séquentielle de sous-agents est *souhaitable* pour la cohérence ; le goulot n'apparaît qu'à très fort fan-out | Souvent inutile de paralléliser | Faible |
| Pas de **similarité vectorielle** | **Moyen** : dédup de branches LLM quasi-dupliquées, retrieval de mémoire pertinente | Provider d'embeddings + store externe | Moyen (le store fait alors le gros) |
| Pas de **détection de cycle** | **Moyen** : un LLM peut reproposer A→B→A | visited-set + garde dans `pushMutation`/`getChildPath` | Faible |
| **Non-déterminisme LLM** vs point-fixe | **Moyen** : « stabiliser jusqu'au point fixe » suppose des providers déterministes ; un LLM rend la stabilisation = épuisement de budget, pas convergence déductive | Budgets + idempotence des réintégrations | Moyen, à assumer |
| Règles **statiques** (mount-time) | **Faible** : les invariants de cohérence sont souvent stables ; l'adaptativité vient des poids du LLM, pas des règles | — | Faible |
| Pas de provider LLM ; tests non fonctionnels ; code mono-auteur 2016-2021 | Dette | Oui | Moyen (remise en état) |

### 2.2 Le point dur conceptuel : la rétraction réactive tient-elle sous LLM ?

C'est **le** sujet, et la réponse est nuancée-positive — à condition de bien séparer les rôles :

- La **rétraction** (`ensure` → uncast cascade) repose sur une vérité **booléenne et déterministe** : « la précondition est-elle vraie ? ». Tant que les *invariants* sont écrits en dur (par l'humain/le concepteur) et que les *faits* qu'ils testent sont des données posées par mutations, **la rétraction reste un JTMS propre et déterministe**, même si les faits ont été produits par un LLM. C'est exactement le point fort : on neuralise la *génération de faits*, on garde le *raisonnement de cohérence* symbolique. C'est la séparation neurosymbolique que prône la littérature anti-hallucination 2025-2026.
- Ce qui **ne tient pas** sous LLM, c'est l'idée de « point-fixe déductif » : avec un provider génératif, la boucle de stabilisation n'est plus une convergence, c'est une **boucle bornée par budget**. Il faut l'assumer (cap de profondeur, cap d'expansion, idempotence). Mais pour le cas central — *réintégrer des résultats de sous-agents et nettoyer ce qui devient invalide* — ce n'est pas bloquant : chaque réintégration est un pas, la rétraction est réactive à ce pas, on ne cherche pas un point-fixe combinatoire.
- **Risque réel :** si on laisse le LLM *écrire les `ensure`* (les règles, pas les faits), on perd le déterminisme ET on ouvre l'injection eval. **Garde-fou de design :** les règles sont humaines/auditées ; le LLM ne produit que des faits/mutations de données, jamais des prédicats exécutés.

**Verdict faisabilité :** le cas central est **faisable et bien fondé**, à condition de (a) supprimer `eval`, (b) écrire le renderer de vue, (c) interdire au LLM d'écrire des prédicats, (d) assumer « boucle bornée » et non « point-fixe ». Aucun de ces points n'est insurmontable, mais (a) et (b) sont du vrai build.

---

## 3. Confrontation honnête à l'existant (sans s'y borner)

### 3.1 Le triptyque bat-il transcript+compaction+todos+fichiers (Claude Code) ?

**Sur la cohérence du plan : oui, nettement. Sur le reste : pas évident.**

- **Compaction (Claude Code).** Le stack natif gère le context rot par 5 stratégies de réduction (budget reduction, snip, microcompact, context collapse, auto-compact — Claude Cookbook, 2026) : toutes sont des **compressions lossy d'un transcript**. La vue rendue (U1) est différente *en nature* : ce n'est pas « résumer ce qui a été dit », c'est « rendre l'état actuel ». Avantage réel : pas de dérive du résumé, pas d'oubli silencieux d'un fait encore vrai. **Mais** : (i) la vue est *aussi* lossy (on choisit quoi montrer) ; (ii) Claude Code n'a pas besoin d'un graphe typé pour la plupart des tâches — le filesystem + TodoWrite suffisent. Le delta n'apparaît que quand **les dépendances entre étapes sont denses et les invalidations fréquentes**.
- **TodoWrite.** C'est une todo-list plate, mutable, re-rendue à chaque tour — déjà « état, pas transcript » pour les tâches. Ce qui lui manque et que U2 ajoute : **les dépendances typées + la rétraction automatique**. TodoWrite ne « décoche » pas tout seul les tâches devenues impossibles ; un humain/agent doit le faire. C'est précisément là que le JTMS gagne.
- **Sous-agents.** Claude Code isole déjà les sous-agents dans leur propre fenêtre et ne réinjecte qu'un résumé (Chroma 2025, best-practices 2026) — c'est U3 sans le graphe. Le graphe ajoute la **réintégration structurée + l'invalidation en cascade** du résultat, ce que « renvoyer un résumé texte » ne fait pas.
- **CLAUDE.md / plan mode / filesystem.** Mémoire append-only, plan figé négocié, checkpoints `~/.claude/file-history` (Dive-into-Claude-Code, arXiv 2604.14228). Robuste, simple, **zéro coût de build**. Le graphe ne bat ça que si la cohérence dynamique du plan est le besoin dominant.

### 3.2 vs Letta/MemGPT (l'antériorité la plus proche)

Letta = thèse « LLM gère ses propres tiers de contexte » (core/recall/archival, OS-like), #1 model-agnostic sur Terminal-Bench, cohérence sur 500+ interactions (Letta 2026). **C'est la même intuition que U1** (l'agent gère son contexte) — mais Letta **édite la mémoire par jugement du LLM** (qualité = jugement du modèle), tandis que skynet-graph **maintient la cohérence par règles déterministes**. Donc : Letta gagne sur la mémoire *conversationnelle/épisodique* et l'adoption ; skynet-graph gagne (potentiellement) sur la **cohérence structurelle vérifiable d'un plan**. Ce sont deux axes complémentaires, pas un duel frontal — on pourrait poser le JTMS *au-dessus* de Letta.

### 3.3 vs Aider repo-map (le précédent direct de « vue, pas transcript »)

Aider construit une **vue d'un graphe (symboles) à budget de tokens** : tree-sitter extrait def/ref, PageRank classe, recherche binaire ajuste au budget (`map_tokens`) — aider.chat 2023, DeepWiki 2025. **C'est U1 appliqué au code, et c'est antérieur et mature.** La leçon qu'Aider impose à skynet-graph : *le problème dur de la vue, c'est le ranking/budget*, pas la navigation. Skynet-graph sait naviguer (`getChildPath`) mais **n'a ni ranking ni budget** — il faudrait les ajouter, et c'est exactement ce qu'Aider a déjà résolu côté code. Avantage résiduel du graphe : la vue n'est pas read-only (repo-map) mais **mutable et contrainte** (le plan évolue et se rétracte). Aider rend une carte ; skynet-graph rend un plan vivant.

### 3.4 vs Graphiti/Zep, LangGraph (mémoire & orchestration)

- **Graphiti/Zep** (arXiv 2501.13956) : KG **bi-temporel**, invalidation d'arêtes par **conflit sémantique/temporel** (« mais pas discard », préserve l'historique). C'est une rétraction *probabiliste/sémantique* sur de la **mémoire de faits** ; skynet-graph fait une rétraction *déterministe/structurelle* sur un **plan en construction**. Pour la mémoire, Graphiti gagne (retrieval, P95 ~300 ms, prod). Pour « décaster un sous-plan quand une précondition tombe », Graphiti ne fait pas ça.
- **LangGraph 1.0** (oct. 2025) : durable execution, checkpointing ACID, time-travel, rollback. Mais le rollback est **par checkpoint (gros grain)** : on revient à un état antérieur entier. Le JTMS de skynet-graph **rétracte sélectivement les seuls faits dépendants** sans rembobiner le reste. Delta réel et défendable — mais étroit.

### 3.5 Tableau comparatif (cadrage corrigé)

| Axe | skynet-graph (U1+U2) | Claude Code (transcript+compaction+todos+fs) | Letta/MemGPT | Aider repo-map | Graphiti/Zep | LangGraph 1.0 |
|---|---|---|---|---|---|---|
| **Contexte = ?** | **Vue rendue d'un état typé** (zoom/filtre, mutable) | Transcript compacté + todos + fichiers | Tiers mémoire auto-édités (OS-like) | Vue (carte de symboles) à budget de tokens, read-only | Sous-graphe retrieved (sémantique+temporel) | State + checkpoints |
| **Anti-context-rot** | Vue ≠ résumé : pas de dérive ; mais **lossy aussi** | Compaction lossy (5 stratégies) | Paging mémoire par le LLM | Ranking PageRank + budget | Retrieval ciblé | Faible (state peut gonfler) |
| **Cohérence du plan** | **JTMS : rétraction cascadée déterministe** | Manuelle (todos ne se décochent pas seuls) | Jugement du LLM | N/A (lecture) | Invalidation sémantique (mémoire, pas plan) | Rollback checkpoint gros grain |
| **Typage / structure** | **Fort** (Node/Segment/Document + concepts) | Faible (markdown/jsonl) | Moyen (blocs mémoire) | Moyen (graphe symboles) | Fort (KG) | Moyen (state schema) |
| **Délégation sous-agents** | Réintégration structurée + invalidation | Isolation + résumé texte | Sous-agents + mémoire partagée | N/A | N/A | Sous-graphes |
| **Audit / replay** | Révisions + dérivation typée | jsonl + file-history | Moyen | git | Validité temporelle | **Time-travel checkpoints** |
| **Coût de build** | **Moyen-élevé** (réécrire noyau, eval, renderer, ranking) | **Nul (adopter)** | Faible (adopter) | Faible (adopter) | Faible (adopter) | Faible (adopter) |
| **Maturité** | Quasi nulle (1 auteur, non testé) | Très haute | Haute | Haute | Haute | Très haute |
| **Sécurité** | **`eval` = RCE si texte LLM atteint un prédicat** | OK | OK | OK | OK | OK |

**Où le triptyque bat vraiment l'existant :** un seul créneau net — **plan long-horizon à dépendances denses où des résultats de sous-agents invalident fréquemment des branches déjà élaborées, et où il faut que l'invalidation soit automatique, déterministe et fine-grain** (pas un rollback global, pas une décision LLM faillible). Partout ailleurs, c'est redondant avec plus simple.

---

## 4. Build vs thin-layer vs adopt — et « bon substrat ou surplus ? »

### 4.1 Skynet-graph est-il le bon substrat ?

**Le moteur complet est un surplus ; le noyau (3 primitives) est le bon substrat.** Démonstration par soustraction de ce qui ne sert pas le cas central :
- La **hiérarchie de concepts JSON** + forward-chaining « grammatical » : conçue pour enrichir des chemins de voyage par règles métier. Pour un agent, les invariants utiles sont peu nombreux et plats ; la machinerie hiérarchique est du poids mort.
- La **sync master/replica voyage**, les `bagRefManagers`/`db:` : spécifiques à l'app d'origine.
- Le **mono-thread de mutation** : utile (cohérence), mais réimplémentable trivialement.
- Ce qui **reste indispensable et différenciant** : (1) état typé adressable, (2) **watchers + `ensure`/uncast cascade = JTMS**, (3) vues rendues (`getChildPath`/`queryMaps`/`getRef`). ~3 primitives, réécrivables proprement en bien moins que les ~1700 lignes denses, eval-based, non testées de `Graph.js`.

Donc : **ne pas réutiliser le moteur historique comme socle.** En extraire le *design* du JTMS + vues, le réécrire (eval-free, typé, testé) comme module d'état, et le **poser au-dessus** d'un harnais d'agent existant.

### 4.2 Les trois options

- **(i) BUILD le moteur historique tel quel** : non. Code daté, mono-auteur, non testé, eval-RCE, surdimensionné pour le besoin. On paierait la dette d'un problème (routing voyage) sans rapport.
- **(ii) THIN-LAYER + noyau réécrit (recommandé)** : le harnais (Claude Code SDK ou LangGraph) porte la boucle agent, les sous-agents, la durabilité ; **un module « typed-plan + JTMS-retraction + rendered-views » réécrit** porte l'unique delta (U2+U1) ; un store mémoire (Letta/Graphiti) porte le retrieval/embeddings si besoin. On garde l'âme, on jette le moteur.
- **(iii) ADOPT pur** : si les invariants du plan sont « de bon sens » et difficiles à formaliser, ou rares — alors structured outputs + quelques validators + TodoWrite + sous-agents suffisent, et le JTMS est du poids mort. **C'est le cas par défaut pour la plupart des agents de code génériques.** Le JTMS ne se justifie que si la **densité de dépendances dures** est haute.

### 4.3 Où le fine-tuning/RL rend le scaffolding inutile — et inversement

- **Les poids tuent l'échafaudage** sur la *capacité de planification brute* : décomposer, proposer des étapes, s'auto-corriger. Les reasoning models internalisent ToT/ReAct (PILOT arXiv 2601.19917 ; débat « To Scaffold or Not to Scaffold », laminar.sh janv. 2026). Mettre la *logique de planification* dans des règles JSON statiques rejoue une bataille déjà gagnée par le modèle. → **Le moteur ne doit pas « générer le plan ».**
- **Le scaffolding reste indispensable** là où il faut des **garanties externes vérifiables** que les poids ne fournissent pas : invariants durs, rétraction déterministe, état partagé cohérent, audit. C'est précisément U2/U4 — mais c'est un rôle de **garde-fou/mémoire**, étroit, pas « le cerveau ». Et même « To Scaffold or Not to Scaffold » concède : certains problèmes (garanties, état partagé) **ne se dissolvent pas** dans les poids. Le JTMS est de ceux-là.

Synthèse : **laisser le modèle planifier ; n'utiliser le noyau que comme contrainte/mémoire structurée vérifiable et auto-cohérente.** Tout le reste du moteur est, pour ce cadrage, soit redondant soit obsolète.

---

## 5. Killer risks

1. **`new Function`/eval + texte LLM = RCE, et c'est aggravé par ce cadrage.** Dans le cas voyage, les prédicats venaient de JSON statiques de confiance. Dans un agent, la tentation est de laisser le LLM *paramétrer* des conditions/queries (`queryMaps`, `getChildMatching`, `assert`) — et toute chaîne LLM qui atteint `new Function` est une exécution de code arbitraire, CSP impossible, injection triviale. **Tueur sécurité tant que l'eval n'est pas remplacé par un interpréteur sandboxé ET que la règle « le LLM ne produit jamais de prédicat exécuté » n'est pas tenue par design.**

2. **Le delta est réel mais étroit, et le substrat historique est un piège de coût.** L'unique avantage défendable (rétraction structurelle cascadée d'un plan partiel) ne paie que dans un créneau précis (dépendances denses, invalidations fréquentes, exigence de déterminisme/audit). Hors de ce créneau, TodoWrite + sous-agents + compaction de Claude Code, ou Letta/Graphiti, font aussi bien pour zéro build. Le risque : investir des semaines à remettre en état un moteur de 2016-2021 (eval, mono-thread, cycles, ranking absent, vues non rendues, zéro test, mono-auteur) pour **rattraper l'existant** et n'en sortir qu'un avantage de niche. *Tueur économique si le besoin réel n'est pas dans le créneau.*

Risques secondaires : « vue rendue » survendue alors qu'elle est lossy (le vrai travail est le ranking/budget, déjà résolu par Aider) ; pas de détection de cycle face à un LLM qui boucle ; la capacité de planification migrant dans les poids dévalue toute logique mise en règles statiques ; bus-factor (mono-auteur, non documenté en anglais).

---

## 6. Reco finale & dé-risquage minimal

**Reco : THIN-LAYER avec noyau réécrit. Ne pas faire du moteur historique le socle ; en extraire le design JTMS + vues, le réécrire proprement, le poser au-dessus d'un harnais existant. N'y aller que si le besoin est dans le créneau « dépendances denses + invalidations fréquentes + déterminisme/audit ».**

Plan de dé-risquage ordonné, qui tranche pour pas cher :

1. **Spike « le delta JTMS existe-t-il vraiment ? » (1-2 j).** Prendre une tâche agent à contrainte dure (« étape B impossible si la ressource X de A est consommée par une étape réintégrée par un sous-agent »). L'implémenter (a) en Claude Code natif : TodoWrite + sous-agents + 1 validator qui re-décide ; (b) avec la rétraction `ensure`/uncast. **Si (a) suffit proprement → ADOPT, stop.** Si (b) produit une invalidation cascadée que (a) ne sait faire que par re-prompting fragile → delta confirmé.

2. **Spike « vue rendue vs compaction » (1 j).** Comparer, sur un plan à 30+ étapes dépendantes, (a) transcript + compaction Claude Code, (b) vue rendue via `getChildPath`+`queryMaps`. Mesurer tokens injectés, fidélité (faits encore vrais oubliés ?), et **coût du ranking** (que le moteur n'a pas — l'emprunter à Aider : tree-sitter/PageRank-like sur le graphe de plan). **Si la vue n'est pas significativement moins lossy à budget égal → U1 ne justifie pas le build.**

3. **Lever `new Function` (prérequis, pas optionnel).** Écrire le parser/interpréteur sandboxé du langage de refs. Sans ça : pas de prod, et test grandeur nature de l'appétit de maintenance. Poser dès maintenant l'invariant de design : **le LLM ne produit que des faits/mutations de données, jamais de prédicats exécutés.**

4. **Go/no-go.** Si delta confirmé (1) + vue gagnante (2) + appétit de maintenance (3) → réécrire le noyau minimal `typed-plan + JTMS + rendered-views` (eval-free, testé) et l'intégrer comme module d'état d'un agent Claude-Code-like / LangGraph. Sinon → adopter l'existant, archiver skynet-graph comme **source d'inspiration conceptuelle** (le JTMS-sur-plan est une bonne idée même si le code ne survit pas).

À ajouter dès qu'on dépasse le PoC, dans tous les cas : **ranking/budget de la vue** (le vrai cœur de U1, absent), score-as-data + `assert` de seuil, détection de cycle, dédup sémantique de branches (embeddings), discipline de budget (« boucle bornée », pas « point-fixe »).

---

## 7. Sources (datées)

Contexte d'agent / context rot / Claude Code :
- Chroma, *Context Rot: How Increasing Input Tokens Impacts LLM Performance* (2025) — https://www.trychroma.com/research/context-rot ; toolkit https://github.com/chroma-core/context-rot
- *Context engineering: memory, compaction, and tool clearing*, Claude Cookbook (2026) — https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
- *Dive into Claude Code* (arXiv 2604.14228, 2026) — https://arxiv.org/html/2604.14228v1 ; https://github.com/VILA-Lab/Dive-into-Claude-Code
- Best practices for Claude Code (2026) — https://code.claude.com/docs/en/best-practices
- Claude Code & Agent Memory: Best Practices for 2026 — https://orchestrator.dev/blog/2026-04-06--claude-code-agent-memory-2026/

Mémoire d'agent (vues, tiers, KG temporel) :
- Aider, *Building a better repository map with tree sitter* (oct. 2023) — https://aider.chat/2023/10/22/repomap.html ; Repository Mapping System (DeepWiki, 2025) — https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping-system
- Letta/MemGPT — https://www.letta.com/blog/memgpt-and-letta ; benchmarks 2026 — https://www.letta.com/blog/benchmarking-ai-agent-memory ; Mem0 vs Letta (2026) — https://vectorize.io/articles/mem0-vs-letta
- Zep/Graphiti, *A Temporal Knowledge Graph Architecture for Agent Memory* (arXiv 2501.13956, jan. 2025) — https://arxiv.org/abs/2501.13956 ; Graphiti (Neo4j, 2025) — https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/
- Cline Memory Bank — https://docs.cline.bot/features/memory-bank

Orchestration / durabilité / time-travel :
- LangGraph durable execution (LangChain docs) — https://docs.langchain.com/oss/python/langgraph/durable-execution ; LangGraph 1.0 (oct. 2025) — https://medium.com/@romerorico.hugo/langgraph-1-0-released-no-breaking-changes-all-the-hard-won-lessons-8939d500ca7c ; repo — https://github.com/langchain-ai/langgraph

Truth maintenance / neurosymbolique / rétraction (antériorité du delta) :
- J. de Kleer, *An Assumption-based TMS / Problem solving with the ATMS*, Artificial Intelligence (1986) — https://www.sciencedirect.com/science/article/abs/pii/0004370286900822
- *Reason maintenance* (overview) — https://en.wikipedia.org/wiki/Reason_maintenance
- *When Do LLMs Admit Their Mistakes? Model Belief in Retraction* (arXiv 2505.16170, 2025) — https://arxiv.org/pdf/2505.16170

Planning long-horizon, scaffolding vs poids :
- *To Scaffold or Not to Scaffold: The Problems That Won't Dissolve* (laminar.sh, janv. 2026) — https://laminar.sh/blog/2026-01-26-the-problems-that-wont-dissolve
- PILOT, *Planning via Internalized Latent Optimization Trajectories* (arXiv 2601.19917, 2026) — https://arxiv.org/pdf/2601.19917
- *Task-Decoupled Planning for Long-Horizon Agents* (arXiv 2601.07577) ; ReAcTree (arXiv 2511.02424)

Blackboard (revival 2025) :
- *Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture* (arXiv 2507.01701) — https://arxiv.org/abs/2507.01701
- *LLM-based Multi-Agent Blackboard System for Information Discovery* (arXiv 2510.01285, oct. 2025, +13 à +57 %) — https://arxiv.org/abs/2510.01285

Code lu (sources primaires) :
- skynet-graph : `App/Graph.js`, `App/objects/Concept.js`, `App/objects/Entity.js` (`static_ensure`/`unCast`/`updateApplicableConcepts`), `App/objects/PathMap.js`, `App/tasks/stabilize.js`, `concepts/common/*` (`Edge/Distance`, `Edge/Travel/LongTravel`), `doc/doc.md`
- aetheris-graph : `providers/travels/Skypicker.js` (provider→branches `Theoric`), `concepts/QueryBased/Edge/{OpenPath,OpenDest,Undefined,autoSearchPaths}` (`autoCast:false`, fan-out `SplitOpenDest`), `concepts/Server/Edge/Stay/{must_StayOrMove,can_AddFlyTo}.json` + `Client/Vertice/GeoLocPosition.json` (`ensure` réels)
- Étude antérieure (analyse-moteur fiable, cadrage ignoré) : `doc/ai-roadmap-feasibility-study.md`
