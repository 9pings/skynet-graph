# Aspect : Calcul incrémental & économie des appels LLM

Étude critique mono-axe. Périmètre : le **modèle fonctionnel** vu sous l'angle du calcul incrémental / self-adjusting computation appliqué à des nœuds de calcul chers et effectful (appels LLM = providers). On juge la *logique* et la *valeur des affordances*, pas l'hygiène d'implémentation (`new Function`/`eval`, mono-thread, absence de détection de cycle, âge du code = hors sujet, trivialement remplaçables). Cognition/contexte, coordination multi-agents et modèle de programmation sont traités dans les autres études et volontairement écartés ici.

---

## 0. Verdict + confiance

**Le mécanisme central est réel et non trivial : skynet-graph est, structurellement, un moteur de calcul incrémental *demand-driven* où les nœuds de calcul sont des appels LLM. Un provider ne (re)tire que si une dépendance trackée (`require`/`follow`/`ensure`) change ; son résultat est gravé en faits typés ; même contexte d'entrée → pas de ré-appel. C'est exactement le pattern Adapton/Salsa/IVM, mais transposé d'un coût "CPU" à un coût "token + latence + effet de bord", où l'incrémentalité a une valeur économique bien plus grande.** La convergence n'y repose pas sur le déterminisme de *sortie* du LLM mais sur le déterminisme du *déclenchement* (forward-chaining jusqu'au point fixe). C'est un cadrage juste et défendable.

**MAIS** : l'edge économique est réel *uniquement* sur la classe d'inputs que le modèle sait canoniquement adresser — des **faits plats typés stables** (clé de mémo discrète, exacte). Dès que l'input d'un nœud-LLM est lui-même une sortie LLM variable (prose, plan, résumé), la clé de mémo se fragmente (quasi-doublons sémantiques), le cache rate, et l'incrémentalité s'évapore. Le système hérite donc du **clivage exact-match vs semantic-cache** que toute la littérature 2024-2026 documente. De plus, **terminaison ≠ économie** : la mémoïsation tue le *redondant*, pas la *taille de l'arbre productif* ni le coût d'*exploration* (le vrai poste de dépense d'un agent).

**Confiance : élevée (0,8)** sur la nature du mécanisme et le clivage exact/sémantique (code lu + littérature convergente). **Moyenne (0,55)** sur l'ampleur réelle du gain en charge agentique réelle (pas de benchmark ; dépend entièrement de la part d'inputs canonicalisables).

---

## 1. Affordances uniques (génératif — dérivé du modèle, pas borné à l'existant)

Ce que le modèle *permet* structurellement, indépendamment de ce qui existe déjà :

**A1 — Mémoïsation de l'effet, pas seulement de la valeur.** Le provider est gravé en faits (`pushMutation` du résultat sur le scope, `Concept.js:147`). Un nœud-LLM coûteux (un appel à 3 \$ de tokens, ou un appel à une API payante type vol/POI) n'est rejoué que si son contexte suivi bouge. La clé de mémo n'est pas le prompt textuel mais **l'ensemble des `require`/`follow` trackés** (`Entity.js:88-129`). C'est une mémoïsation *par dépendances*, pas *par hash de prompt* — plus fine que LangChain cache (clé = prompt+params).

**A2 — Invalidation en cascade *à la demande* via `ensure`.** `ensure` (`Entity.js:18-27`, `static_ensure`) rétracte le concept *et ses enfants* quand sa précondition tombe, ce qui réinvalide en chaîne les nœuds-LLM dépendants. C'est de la **change-propagation négative** : on ne re-raisonne pas tout, on *défait* précisément la sous-arborescence dont une prémisse a disparu. Affordance : un **re-planning partiel** natif — changer un fait d'entrée (date, budget, contrainte) ne réinvalide que les calculs qui en dépendaient transitivement.

**A3 — Frontière d'invalidation explicite et inspectable.** Les arêtes de dépendance sont matérialisées (`_followersByConceptName`, `_watchers`, `refMap`). On peut, en principe, *montrer* pourquoi un appel LLM a été (re)tiré ou évité — une **traçabilité de cache** que les agents "re-raisonne-tout-à-chaque-tour" n'offrent pas.

**A4 — Composition de coûts hétérogènes dans un seul graphe de dépendances.** Le même mécanisme orchestre des nœuds gratuits (distance géo, `CommonGeo::Distance`), des API payantes (`Skypicker.getFlights`) et — par extension — des nœuds-LLM. L'incrémentalité s'applique uniformément ; le graphe devient un **plan d'exécution à coût pondéré** où le moteur ne touche que le delta.

**A5 — Idempotence convergente par construction.** Le point-fixe (`stabilize`/`_loopTF`, `Graph.js:268-290`) garantit que, à inputs constants, on atteint le *même* ensemble de faits sans re-tirer les providers déjà gravés. Affordance : **reproductibilité de la trajectoire** au niveau du déclenchement, là où un agent libre re-explore.

**A6 — Cache partageable et sérialisable.** L'état (faits + `bagRefs`) sérialise (`Graph.js:321-348`) et synchronise serveur/client. Le cache de calcul n'est pas un effet de bord process-local (cf. `InMemoryCache` LangChain) mais un **artefact de premier ordre, persistable et distribuable** — proche de l'esprit CAS/remote-cache de Bazel.

---

## 2. Confrontation nommée + tableau

**Self-adjusting computation (Acar, thèse CMU-CS-05-129, 2005) / Adapton (Hammer et al., *Composable, Demand-Driven Incremental Computation*, PLDI 2014).** C'est l'ancêtre direct du *mécanisme*. Adapton introduit les "demanded computation graphs" : la change-propagation n'a lieu que si le résultat est *demandé*, et la mémoïsation réutilise les sous-calculs sous mutation. skynet-graph est isomorphe à ce pattern (require = lecture trackée, follow/ensure = trace réinvalidable, stabilize = change-propagation). **Différence de fond, et c'est l'argument fort de skynet-graph :** Adapton/SAC mémoïsent du calcul *pur et bon marché* (CPU). Ici les nœuds sont *chers, non-déterministes et effectful* (tokens, latence, appels payants). L'incrémentalité a donc un **ROI qualitativement supérieur** — mais hérite d'un problème qu'Adapton n'a pas : la clé de mémo d'un nœud pur est triviale (les inputs), celle d'un nœud-LLM ne l'est que si ses inputs sont eux-mêmes des faits discrets.

**Salsa (salsa-rs ; rust-analyzer, fork `ra_ap_salsa`, travaux Salsa 3.0 fin 2024).** Même idée industrialisée : programme = ensemble de *queries* `K -> V` mémoïsées, recalcul uniquement quand les inputs changent. Pertinence directe : Salsa montre que ce modèle *passe à l'échelle en production* (IDE temps réel). Et il montre aussi le **coût caché** : le portage rust-analyzer→Salsa 3.0 a buté sur une régression mémoire — l'overhead de tracking des dépendances n'est pas gratuit. skynet-graph paie le même overhead (watchers, refMap) mais l'amortit d'autant mieux que le nœud évité est cher (un appel LLM ≫ un recalcul de type Rust).

**Differential dataflow / Materialize (timely+differential dataflow ; lignée DBSP, *VLDB Journal* 2025 ; écosystème pg_ivm/Feldera/Epsio).** L'IVM met à jour une vue *sur les writes* au lieu de recalculer *sur les reads*. C'est l'analogue "données" de skynet-graph côté "calcul/règles". Mais IVM exige une **algèbre relationnelle close** pour calculer le delta exact ; skynet-graph propage des deltas *non* algébriques (un provider LLM produit un sous-graphe arbitraire). Donc skynet-graph est plus expressif mais **ne garantit pas la minimalité du delta** comme DBSP : sa réinvalidation est correcte (par dépendances) mais potentiellement plus grossière.

**Prompt caching Anthropic (docs Claude API ; analyses 2025-2026).** C'est le concurrent le plus direct sur l'axe *économie LLM* — et il faut être honnête : il est redoutable et complémentaire, pas substituable. Modèle de coût : write 1,25× (TTL 5 min) ou 2× (TTL 1 h) l'input ; **read = 0,1× l'input (−90 %)**, latence −85 % sur longs prompts. **Différence cruciale :** le prompt caching cache le *préfixe d'entrée* (KV-cache du contexte) pour *abaisser le coût d'un appel qui a quand même lieu* ; skynet-graph **évite l'appel entier** quand les dépendances n'ont pas bougé. Les deux sont orthogonaux : skynet-graph décide *s'il faut appeler* ; le prompt caching décide *combien coûte l'appel* une fois décidé. Le vrai concurrent économique de skynet-graph n'est donc pas le prompt caching mais **"l'agent qui re-raisonne tout à chaque tour" + compaction** ; et là le TTL de 5 min/1 h du prompt caching est un *plafond de réutilisation* que skynet-graph n'a pas (ses faits gravés ne périment pas tout seuls).

**LangChain LLM cache / GPTCache / semantic caching (GPTCache 2023 ; GPT Semantic Cache, arXiv 2411.05276, 2024 ; MeanCache, arXiv 2403.02694, 2024).** C'est ici que se joue la critique dure. LangChain cache exact-match : clé = (prompt, llm_string) — *déterministe mais fragile* (le moindre delta de prompt rate). GPTCache/semantic cache : clé = embedding + seuil de similarité τ — récupère les quasi-doublons mais **achète du hit-rate contre du false-hit** : sur 700 requêtes, GPTCache produit 233 faux positifs (MeanCache 89). **skynet-graph se range structurellement du côté exact-match**, mais avec une clé *meilleure que le prompt brut* : la clé est l'ensemble des **faits typés trackés**, pas le texte. Tant que les inputs sont des faits discrets (date, position, budget, ID), c'est un exact-match *propre et stable* — supérieur à LangChain. Mais dès que l'input tracké est une sortie LLM verbeuse, skynet-graph n'a **aucune canonicalisation sémantique** : il subira soit la fragmentation (exact-match qui ne hit jamais), soit devra rajouter une couche d'embedding et **réimporter tout le problème de false-hits de GPTCache**.

**Bazel (action cache + CAS, builds hermétiques ; EngFlow/BuildBuddy 2024).** Le meilleur analogue "système". Bazel ne réutilise un output que si la clé d'action (digest des inputs + métadonnées) matche, sous **hypothèse d'hermétisme** (mêmes inputs → mêmes outputs, pas de réseau, pas d'horloge). skynet-graph emprunte la même logique de clé-de-contenu, **mais ses nœuds-LLM violent frontalement l'hermétisme** : un LLM n'est pas déterministe, et un provider type Skypicker appelle le réseau. Conséquence : skynet-graph peut garantir le *déclenchement* déterministe (rejoue-t-on ?) mais **pas la reproductibilité de l'output gravé** (qu'a-t-on gravé ?). Bazel résout ça en interdisant le non-hermétique ; skynet-graph l'autorise et grave la première réponse comme vérité — choix pragmatique mais qui transforme le cache en *snapshot arbitraire*, pas en valeur reproductible.

| Système (daté) | Unité mémoïsée | Clé de mémo | Invalidation | Garantie | Coût évité | Limite vs skynet-graph |
|---|---|---|---|---|---|---|
| **skynet-graph** | Fait/sous-graphe produit par provider | Faits typés trackés (require/follow) | Cascade `ensure` à la demande | Déclenchement déterministe (pas l'output) | Appel LLM/API **entier** | Pas de canonicalisation sémantique ; delta non minimal |
| Adapton (2014) / SAC (2005) | Sous-calcul pur | Inputs du nœud | Change-propagation demandée | Résultat = recalcul complet | CPU | Nœuds purs/bon marché seulement |
| Salsa (2024, RA 3.0) | Query `K→V` | Clé typée K | Re-exécution si input change | Correction = from-scratch | CPU (analyse incr.) | Overhead mémoire prouvé en prod |
| Differential dataflow / Materialize / DBSP (2025) | Ligne de vue | Tuple relationnel | Delta algébrique exact | **Delta minimal** + cohérence | Recalcul de vue sur read | Exige algèbre relationnelle close |
| Prompt caching Anthropic (2025) | Préfixe de contexte (KV) | Hash du préfixe | TTL 5 min / 1 h | Identité du préfixe | **Coût** de l'appel (−90% read) | Ne supprime PAS l'appel ; expire au TTL |
| LangChain LLM cache (2024) | Réponse complète | (prompt, llm_string) exact | Aucune (clé change → miss) | Identité exacte du prompt | Appel entier | Fragile : tout delta de prompt rate |
| GPTCache / semantic (2024) | Réponse complète | Embedding + seuil τ | Aucune (lookup au moment de l'appel) | **Aucune** (false-hits ~33%) | Appel entier (quasi-doublons) | False-hits ; pas de modèle de dépendances |
| Bazel (2024) | Output d'action | Digest inputs (CAS) | Re-run si digest change | Hermétique → reproductible | Ré-exécution d'action | Interdit le non-déterministe/réseau |

---

## 3. Réel vs redondant / gadget

**Réel (edge défendable) :**
- **L'invalidation par dépendances trackées plutôt que par hash de prompt (A1, A2).** C'est strictement plus fin que LangChain cache et conceptuellement plus propre que GPTCache (pas de false-hits sur la partie discrète). Pour un agent dont l'état se décompose en faits typés, "ne rejouer que ce dont une prémisse a changé" est un *vrai* gain de coût et de latence, et un *vrai* re-planning partiel (A2) — chose que ni le prompt caching ni la compaction ne font (eux abaissent le coût d'un re-raisonnement complet, ils ne l'évitent pas).
- **L'orthogonalité avec le prompt caching.** skynet-graph décide *s'il faut appeler* ; Anthropic décide *combien coûte l'appel*. Empilés, ils se multiplient (appels évités × appels restants moins chers). Ce n'est pas redondant.
- **Le cache comme artefact sérialisable/distribuable (A6)** est un vrai différenciateur face aux caches process-local.

**Redondant / déjà fait ailleurs (pas un edge en soi) :**
- Le *mécanisme* incrémental lui-même est de l'état de l'art depuis 20 ans (SAC) et industrialisé (Salsa, Materialize, Bazel). skynet-graph **n'invente pas** le calcul incrémental ; il le *transpose* aux nœuds-LLM. La nouveauté est dans la *cible*, pas dans la *technique*.
- "Déterminisme du déclenchement" est exactement la garantie de Salsa/Bazel (rejoue-t-on ?). Bien cadré par la consigne, mais à ne pas survendre comme inédit.

**Gadget / risque de survente :**
- Présenter l'idempotence de la *trajectoire* comme une garantie de *reproductibilité* serait trompeur : l'output gravé d'un LLM n'est pas reproductible (non-hermétique, cf. Bazel). Le système est reproductible *au niveau du graphe de déclenchement*, pas *au niveau du contenu*.
- "Convergence/terminaison" ≠ "économie". Le point-fixe garantit qu'on *s'arrête* et qu'on ne rejoue pas le redondant ; il **ne dit rien sur la taille de l'arbre de calcul productif**. Un graphe qui, à inputs nouveaux, déclenche légitimement 400 appels LLM est "stable et non redondant" tout en étant ruineux. La mémoïsation optimise la *réutilisation*, jamais l'*exploration initiale*.

---

## 4. Conditions de succès & killer risks

**Conditions de succès (là où l'edge se matérialise) :**
1. **La majorité des inputs des nœuds-LLM sont des faits typés discrets** (dates, positions, budgets, IDs, énums) — pas de la prose LLM. C'est *la* condition. Le domaine d'origine (voyage : positions, périodes, distances) la remplit naturellement ; un agent de raisonnement libre sur du texte ne la remplit pas.
2. **Granularité des concepts assez fine** pour que l'invalidation `ensure` ne réinvalide pas tout le sous-graphe à chaque micro-changement (sinon on retombe sur le re-raisonnement complet).
3. **Charge dominée par la ré-exécution sur état partiellement modifié** (édition collaborative, re-planning sur contrainte changée, re-runs fréquents) — le régime où l'incrémental bat le from-scratch. Sur un one-shot, l'incrémental ne gagne rien (tout est cold).
4. **Coût unitaire du nœud évité élevé** (gros prompt, API payante). Plus le nœud est cher, plus l'overhead de tracking est amorti.

**Killer risks :**
- **K1 — Fragmentation de la clé de mémo (le risque dominant).** Si un nœud-LLM dépend (`require`/`follow`) d'un fait qui est lui-même une sortie LLM variable, deux exécutions "équivalentes" produisent des faits non identiques → la clé change → miss permanent → l'incrémentalité est nulle. Sans **canonicalisation sémantique** des sorties LLM (normalisation en faits discrets via extraction structurée stricte, JSON-schema, ou quantification), le modèle ne tient son edge que sur la fraction discrète des inputs. Et toute couche sémantique ajoutée réimporte les **false-hits de GPTCache** (~33%), qui dans un graphe à invalidation en cascade peuvent se *propager* (un faux hit grave un faux fait qui déclenche/inhibe d'autres concepts).
- **K2 — Terminaison sans économie.** La mémoïsation ne borne pas l'arbre productif. Le coût d'exploration (combien de branches le forward-chaining ouvre légitimement) est non maîtrisé par ce mécanisme ; il faut un budget/coût explicite par concept (absent du modèle actuel) sinon le graphe "stable" peut être économiquement catastrophique.
- **K3 — Cache empoisonné par non-hermétisme.** La première réponse LLM/API est gravée comme vérité et réutilisée tant que les dépendances ne bougent pas. Si cette réponse était mauvaise (hallucination, vol périmé, API qui a changé), le cache la **fige** et la propage — sans TTL implicite (contrairement au prompt caching qui expire en 5 min/1 h). Il manque une notion de *fraîcheur/expiration des faits gravés par provider*.
- **K4 — Overhead de tracking en régime de fort churn.** Si l'état change massivement à chaque tour, le coût de maintenance des watchers/refMap (cf. régression mémoire Salsa 3.0) peut dépasser le gain. L'incrémental n'est rentable que sous **petit delta / gros état stable**.

---

## 5. Sources (datées)

- Acar, U., *Self-Adjusting Computation*, thèse CMU-CS-05-129, mai 2005 — https://www.cs.cmu.edu/~rwh/students/acar.pdf
- Hammer, M. et al., *Adapton: Composable, Demand-Driven Incremental Computation*, PLDI 2014 — https://www.cs.tufts.edu/~jfoster/papers/cs-tr-5027.pdf
- Salsa — framework d'incrémentalisation à la demande (inspiré d'Adapton/rustc query system) ; portage rust-analyzer → Salsa 3.0 et régression mémoire, fin 2024 — https://github.com/salsa-rs/salsa ; https://hackmd.io/@salsa/B19OUlA71l ; https://rustc-dev-guide.rust-lang.org/queries/salsa.html
- Materialize / differential & timely dataflow ; *DBSP: automatic incremental view maintenance for rich query languages*, VLDB Journal, 2025 — https://materialize.com/blog/differential-from-scratch/ ; https://link.springer.com/article/10.1007/s00778-025-00922-y
- Anthropic — *Prompt caching*, docs Claude API (modèle de coût write 1,25×/2×, read 0,1×, TTL 5 min/1 h ; latence −85%) — https://platform.claude.com/docs/en/build-with-claude/prompt-caching ; analyse 2025-2026 https://artificialanalysis.ai/models/caching
- LangChain — LLM caching (InMemoryCache / SQLiteCache, clé exacte (prompt, llm_string)), docs 2024-2026 — https://python.langchain.com/v0.1/docs/integrations/llms/llm_caching/
- GPTCache — semantic cache pour LLM (exact + similarité) — https://github.com/zilliztech/GPTCache
- *GPT Semantic Cache: Reducing LLM Costs and Latency via Semantic Embedding Caching*, arXiv 2411.05276, 2024 (hit-rate 61,6–68,8%) — https://arxiv.org/abs/2411.05276
- *MeanCache: User-Centric Semantic Caching for LLM Web Services*, arXiv 2403.02694, 2024 (false-hits : MeanCache 89 vs GPTCache 233 / 700 requêtes) — https://arxiv.org/html/2403.02694
- Bazel — remote caching, action cache + CAS, hypothèse d'hermétisme/déterminisme — https://bazel.build/remote/caching ; EngFlow, *The Many Caches of Bazel*, mai 2024 — https://blog.engflow.com/2024/05/13/the-many-caches-of-bazel/
- Sur replanning/budget de tokens des agents (terminaison ≠ économie ; coût d'exploration) : *ARES: Adaptive Reasoning Effort Selection*, arXiv 2603.07915 ; *Token-Budget-Aware LLM Reasoning*, arXiv 2412.18547, 2024-2025 — https://arxiv.org/html/2412.18547v5
- Code lu : `App/Graph.js` (stabilize/_loopTF L268-290, pushMutation, serialize L321-348), `App/objects/Concept.js` (provider+mémoïsation L109-198, isApplicableTo/require L205-228), `App/objects/Entity.js` (watchers/follow/ensure L18-27, L60-183, L294-333), `App/tasks/stabilize.js`, `concepts/common/*` (Edge/Distance, Edge/Travel, Edge/Stay), `aetheris-graph/providers/travels/Skypicker.js`.
