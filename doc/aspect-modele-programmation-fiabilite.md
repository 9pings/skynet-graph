# Aspect — Modèle de programmation & fiabilité

*Évaluation critique de skynet-graph comme substrat pour construire un agent long-horizon sous forme d'une **bibliothèque de paires concept↔prompt déclaratives + maintenance de vérité**, comparé à (i) l'orchestration impérative de graphe et (ii) la capacité dans-les-poids. Aspect cadré : modèle de programmation, fiabilité, cohérence, auditabilité. Hors-périmètre (autres études) : cognition/contexte, coordination multi-agents, calcul incrémental pur.*

> Note de méthode : je n'évalue PAS l'hygiène d'implémentation (`new Function`/eval, mono-thread, absence de détection de cycle, âge du code). Ces points sont trivialement remplaçables et hors-sujet. Je juge le **modèle fonctionnel** : faits typés + règles déclaratives `require`/`assert`/`ensure` + provider + stabilisation forward-chaining + rétraction réactive en cascade + mutations rejouables.

---

## 0. Verdict + confiance

**Verdict : le modèle est correct sur le PLAN — et c'est exactement là que se situe sa valeur défendable et sa limite.** Le triptyque (faits typés rejouables) + (règles déclaratives avec rétraction réactive `ensure`/uncast) + (forward-chaining à ordre émergent) est, littéralement, un **JTMS câblé sur un planificateur** (Doyle 1979 ; de Kleer 1986). Pour la classe de logique que skynet-graph traite déjà — **dérivations nettes, cohérentes, monotones-par-justification, auditables** — c'est un meilleur modèle de programmation que (i) l'orchestration impérative de graphe (LangGraph), parce que la *cohérence sous changement* y est une propriété structurelle et non du code de rollback écrit à la main, et que (ii) la capacité dans-les-poids, parce qu'un LLM ne maintient aucun invariant de cohérence entre deux tours.

**MAIS** : dès que l'action ou la décision est un **jugement flou** (le cas du repurposing IA : « est-ce complexe ? », « faut-il splitter ? », « est-ce un bon score ? »), le modèle ne fait que *router et estampiller* le jugement du LLM — il ne le fiabilise pas. La rétraction réactive garantit la cohérence du **graphe de faits**, pas la vérité des faits produits par le provider-LLM. Le système est donc un **excellent système de maintenance de vérité pour des dérivations dont la vérité vient d'ailleurs**, et un système quelconque pour produire ces vérités.

**Confiance : élevée (≈0.8)** sur le diagnostic « JTMS-sur-plan = bon pour le dérivable, neutre pour le flou ». **Moyenne (≈0.55)** sur la question stratégique « est-ce un meilleur modèle de programmation d'agent en 2026 » — parce que la réponse dépend d'une variable qui bouge vite (combien de la « planification » migre dans les poids des reasoning models), et que le coût d'authoring/maintenance de la bibliothèque de concepts est non-borné et non démontré ici.

---

## 1. Affordances uniques (génératif — dérivées du modèle, sans se borner à l'existant)

Je dérive d'abord ce que le modèle *rend possible*, indépendamment de ce que skynet-graph fait aujourd'hui.

**A1 — Rétraction réactive fin-grain comme primitive de premier ordre.**
Quand une précondition tombe (`ensure` faux), la conséquence se rétracte, *et ses conséquences se rétractent en cascade*, avec exécution des `cleaner`. C'est `Entity.unCast` → uncast récursif des `_openConcepts` enfants (`Entity.js:193-247`), déclenché par les watchers posés en `updateApplicableConcepts` (`Entity.js:88-118`) via `static_ensure` (`Entity.js:18-27`). **L'affordance** : un agent peut écrire « ce sous-but n'est valide QUE TANT QUE cette hypothèse tient » et obtenir gratuitement la *défaisance* — l'invalidation propagée et déterministe — sans écrire une seule ligne de logique de nettoyage. C'est l'inverse exact de TodoWrite (une case cochée ne se décoche jamais toute seule) et plus fin que le checkpoint LangGraph (qui rejoue un état entier, pas la conséquence précise d'une prémisse tombée).

**A2 — Ordre d'exécution émergent par dépendances de données, pas séquencé.**
Aucun concept ne dit « après X, fais Y ». Un concept ne devient applicable que quand ses `require` sont *présents dans les faits* (`Concept.isApplicableTo`, `Concept.js:205-228` : un require non résolu pose un watcher `follow` et exclut le concept). `Distance` ne se calcule pas « après » l'aéroport : il se calcule **quand** `originNode:Position` ET `targetNode:Position` existent (`Edge/Distance.json`). **L'affordance** : on programme un agent en déclarant *des conditions de déclenchement sur l'état*, et le plan se réordonne tout seul quand les faits arrivent dans le désordre (typique de l'async/du tool-use réel). Un graphe impératif fige cet ordre dans des arêtes ; ici l'ordre est recalculé à chaque point-fixe.

**A3 — Auditabilité native par construction, pas par instrumentation.**
Toute mutation est un atome estampillé-révision (`pushMutation`, `Graph.js:769+` ; `_revs[revNum] = {id, parent, bagRefs, tpl}`, `Graph.js:1129-1147`) et **rejouable** (`pushAtomicUpdates`/`getRevisionsRange`, `Graph.js:552-638`). **L'affordance** : « pourquoi l'agent a-t-il fait X ? » a une réponse *mécanique* — la révision qui a posé le fait, le concept qui l'a produit, et la chaîne de `require` qui rendait ce concept applicable. C'est un *journal de justifications*, pas un transcript à re-lire. Pour un domaine régulé (santé, finance, conformité), c'est la différence entre « le LLM a décidé » et « voici la dérivation ».

**A4 — Capacité comme donnée, pas comme code.**
La logique de planning vit dans des JSON (`concepts/common/*`) chargés et compilés en runtime (`Concept.init`, `Concept.js:30-82`). **L'affordance** : on peut ajouter/retirer/versionner une capacité d'agent sans toucher le moteur ni redéployer ; on peut avoir des *jeux de concepts par contexte* (`cfg.conceptSets`, et le pattern `autoCast:false` de `Edge/autoSearchPaths.json` qui n'active une famille de règles que sur demande explicite). C'est la promesse DSPy (« programme, ne prompte pas ») mais au niveau de la *structure de contrôle*, pas seulement du gabarit de prompt.

**A5 — Idempotence/convergence vers un point-fixe.**
La boucle de stabilisation rejoue jusqu'à ce que plus aucune règle ne tire (`_loopTF`, `Graph.js:268-290` ; `stabilize.js`). **L'affordance** : rejouer la même entrée converge vers le même état stable — propriété rare et précieuse pour un agent. Un LLM en boucle n'a aucune garantie de convergence ; un graphe impératif converge si et seulement si le développeur l'a codé.

**Synthèse génératif** : le modèle offre une primitive que ni l'orchestration impérative ni les poids n'offrent nativement — **la cohérence-sous-changement comme propriété du système** (défaisance + ordre émergent + journal de justifications + convergence). C'est la signature d'un JTMS. La valeur n'est pas « graphe » ni « règles » ; c'est *truth maintenance*.

---

## 2. Confrontation nommée

**LangGraph (graphes impératifs durables, checkpointing).** LangGraph 1.0 (oct. 2025) a une exécution durable et du « time-travel » par checkpoints. Mais c'est du **rollback gros-grain** : on revient à un *état de nœud entier* et on rejoue. LangGraph ne sait pas « la prémisse P est tombée, donc rétracte exactement les 3 faits qui en dépendaient et rien d'autre ». La cohérence sous changement y est du code applicatif à écrire. skynet-graph en fait une propriété structurelle. *Inversement*, LangGraph gagne massivement sur la maturité, la durabilité réelle (persistance, reprise après crash — que skynet-graph n'a pas au niveau production) et l'écosystème.

**Capacité dans-les-poids (reasoning models, RL agentique).** Le débat « To Scaffold or Not to Scaffold » (Laminar, 26 jan. 2026) tranche une partie : certains problèmes « se dissolvent » avec la capacité, d'autres non — notamment ceux qui exigent *interaction avec des choses qui ont leur propre horloge*, et ceux où coût/latence/modes de défaillance comptent même quand le modèle « pourrait » faire. Les poids ne maintiennent aucun invariant de cohérence entre tours : un LLM peut affirmer A au tour 3 et ¬A au tour 9 sans rétracter les conséquences de A. **C'est précisément le trou que comble un JTMS.** Mais la critique inverse est réelle : la recherche 2025-2026 (SFR-DeepResearch, ASTER, « Beyond pass@1 ») montre que la *planification long-horizon* migre dans les poids via RL ; le scaffolding qui *séquence le raisonnement* devient un corset. Le scaffolding qui *contraint la sortie et maintient l'état externe* (tool-use, vérification) reste utile.

**DSPy (programmation déclarative de prompts + optimisation).** DSPy déclare le *quoi* (signatures) et *optimise* les prompts/few-shots automatiquement. skynet-graph déclare le *quand* (préconditions de déclenchement) et le *comment écrire le résultat* (mutations typées) mais **n'optimise rien** : les `assert`/`require` sont écrits à la main et statiques. Complémentarité plus que rivalité : DSPy = couche prompt auto-optimisée ; skynet-graph = couche contrôle/état cohérent. Le risque : DSPy + un graphe d'état simple peut couvrir 80 % du besoin sans payer le coût conceptuel du JTMS.

**Guardrails / structured outputs / constrained decoding.** OpenAI (août 2024), Gemini (mai 2024), Anthropic (nov. 2025) garantissent la *forme* (JSON/grammaire valide) — pas la *cohérence inter-faits* ni la rétraction. Ils sont orthogonaux et complémentaires : on s'en sert pour fiabiliser l'écriture du provider-LLM en faits typés (le « comment écrire le résultat »), mais ils ne disent rien de « ce fait reste-t-il vrai ».

**Moteurs de règles (Drools/CLIPS/Datalog, Rete).** C'est **l'antériorité directe et la critique la plus dure**. Rete (Forgy 1974) + ReteOO (Drools) font exactement du forward-chaining incrémental avec assert/modify/**retract** en working memory, à l'échelle de millions de faits, avec partage de résultats partiels — là où la stabilisation de skynet-graph est un balayage naïf des objets instables. Datalog donne le même pouvoir déclaratif avec une sémantique formelle et une évaluation incrémentale (différentielle) prouvée. **Question dure : qu'apporte skynet-graph qu'un Drools/Datalog couplé à un LLM-as-provider n'apporterait pas mieux ?** Réponse honnête : surtout la *hiérarchie de concepts orientée graphe-de-domaine* et le couplage natif sync/replay — un confort de modélisation, pas un pouvoir expressif nouveau.

**JTMS/ATMS (Doyle 1979, de Kleer 1986).** C'est la *vraie* nature du système. JTMS = une justification par croyance, un seul contexte cohérent — ce que fait skynet-graph (`ensure` = justification ; uncast récursif = propagation de non-support). ATMS = labels d'assomptions, *plusieurs contextes en parallèle*. skynet-graph est un **JTMS, pas un ATMS** : il maintient UN état stable, il n'explore pas plusieurs mondes possibles simultanément. Pour un agent qui doit comparer des plans alternatifs (« et si je prends l'avion vs le train »), c'est une limite de fond — il faut forker le graphe, là où un ATMS labellise.

### Tableau comparatif

| Critère | skynet-graph (JTMS-sur-plan) | LangGraph (impératif durable) | Poids (reasoning model) | DSPy | Drools/Datalog | Guardrails/CD |
|---|---|---|---|---|---|---|
| **Rétraction fin-grain en cascade** | Oui, primitive (`ensure`/uncast) | Non (rollback gros-grain) | Non | Non | Oui (retract Rete) | Non |
| **Ordre d'exécution** | Émergent par données | Codé (arêtes) | Implicite/opaque | Codé | Émergent (agenda) | N/A |
| **Cohérence sous changement** | Propriété structurelle | Code applicatif | Aucune garantie | N/A | Propriété structurelle | Forme seule |
| **Auditabilité** | Native (révisions + justifications) | Checkpoints/traces | Transcript opaque | Traces de modules | Trace d'activations | Logs de validation |
| **Convergence/idempotence** | Point-fixe | Si codé | Non garantie | N/A | Point-fixe | N/A |
| **Produit le jugement flou** | Non (délègue au provider) | Non (délègue) | **Oui** | Optimise le prompt | Non | Contraint la forme |
| **Contextes multiples (et-si)** | Non (1 état ; fork manuel) | Branches manuelles | Échantillonnage | Non | Non (JTMS-like) | N/A |
| **Maturité/écosystème** | Prototype | Production | Production | Croissante | Mûr (20+ ans) | Production |
| **Coût d'authoring de la capacité** | Élevé (concepts JSON à la main) | Moyen | Faible (prompt) | Moyen | Élevé (règles) | Faible |

---

## 3. Réel vs redondant/gadget

**Réel (la valeur défendable) :**
- **La rétraction réactive en cascade (A1)** est le cœur réel et non-trivial. C'est ce qui n'existe ni dans LangGraph ni dans TodoWrite ni dans les poids. Sur le code, c'est *implémenté* (pas du vaporware) : watchers posés sur les refs des `ensure`, propagation récursive d'uncast, cleaners. C'est un vrai JTMS.
- **L'auditabilité par révisions rejouables (A3)** est réelle et directement monétisable dans les domaines régulés/auditables.
- **L'ordre émergent par `require` (A2)** est réel et bien adapté à l'async du tool-use.

**Redondant (déjà mieux fait ailleurs) :**
- Le **forward-chaining lui-même** est redondant avec Rete/Drools/Datalog, qui le font de façon incrémentale et prouvée. Réimplémenter un moteur de règles naïf en 2026 est difficile à justifier en soi.
- La **compilation `assert` → fonction** (`Concept.js:62-76`) recrée un mini-langage de règles que Datalog/CLIPS offrent avec une sémantique formelle.

**Gadget / sur-vendu dans le contexte agent-IA :**
- **« La logique de planning vit dans les règles, pas dans les poids »** est à moitié un gadget. Tant que l'*action* est un appel LLM dont la sortie est un jugement flou, la règle ne fait que *quand appeler* et *où ranger le résultat*. La règle n'a pas « la logique de dérivation » du jugement — elle a la logique d'*orchestration* du jugement. C'est utile, mais ce n'est pas « le raisonnement est dans les données ». Le pattern réel (`SkyPickerFlight.json` + `Skypicker.js`) le montre : la règle dit « si autoSearchPaths ET Theoric ET une date existe, appelle Skypicker » ; toute l'intelligence est dans le provider. Transposé au repurposing IA : « si complexité non-évaluée, appelle l'évaluateur-LLM » — la *décision* split/atomique reste dans les poids ; le graphe la *matérialise et la maintient*, il ne la *produit pas*.
- **Le repurposing comme « bibliothèque de paires concept↔prompt »** est élégant mais sa nouveauté est surestimée : c'est un *agenda d'outils conditionné par l'état* — proche d'un blackboard system (Hearsay-II, années 80) avec sources de connaissance LLM. La valeur additionnelle sur un blackboard classique = la rétraction réactive et le replay, pas le routage.

---

## 4. Conditions de succès & killer risks

**Conditions de succès (là où ce modèle gagne *vraiment*) :**
1. **Dérivations nettes et inter-dépendantes** où la cohérence importe : « si le vol est annulé, rétracte le séjour, les correspondances et le budget associé » — exactement le domaine d'origine. La valeur croît avec le *nombre d'invariants à maintenir entre faits*.
2. **Domaines régulés/auditables** où « montre la dérivation » est une exigence dure (conformité, santé, finance, juridique). Le journal de justifications est alors un livrable, pas une commodité.
3. **Environnements à arrivée asynchrone/désordonnée des faits** (tool-use multi-sources, sync collaboratif) où l'ordre émergent bat le séquençage impératif.
4. **Le jugement flou est encapsulé et rare** : le LLM est appelé en *provider* pour produire un fait typé, et la masse de la logique est de la *propagation de conséquences déterministe*. Ratio idéal : beaucoup de dérivation, peu de jugement.

**Killer risks (là où il perd / coule) :**
1. **K1 — Le corset sur le jugement flou.** Si la valeur de l'agent est dans la créativité/le jugement (rédaction, stratégie ouverte, exploration), encoder des `assert`/`require` statiques *brime* le modèle au lieu de l'aider. La recherche 2025-2026 montre la planification long-horizon migrant dans les poids (RL agentique) : un scaffolding qui *séquence le raisonnement* devient une dette qui vieillit mal. Mitigation : ne scaffolder que ce qui doit être *cohérent et auditable*, jamais ce qui doit être *intelligent*.
2. **K2 — Le coût d'authoring/maintenance de la bibliothèque de concepts.** QUI écrit les centaines de paires concept↔prompt, et qui les maintient quand le domaine ou le modèle change ? Le code montre des fichiers JSON denses, des refs en mini-langage (`$originNode:Position`), des `require`/`assert` couplés. C'est une **dette de spécification** non-bornée, écrite par des humains experts, non auto-optimisée (contrairement à DSPy). C'est le risque le plus sous-estimé : le modèle déplace la difficulté du « code impératif fragile » vers « ontologie de règles à maintenir » — pas évident que ce soit moins cher.
3. **K3 — La garantie de cohérence est sur le graphe, pas sur la vérité.** `ensure` garantit que *si* une prémisse est fausse la conséquence se rétracte ; il ne garantit pas que la prémisse (produite par un LLM) était vraie. Un fait halluciné mais syntaxiquement valide se propage proprement et se rétracte proprement — la rigueur du mécanisme peut donner une **fausse impression de fiabilité**. La fiabilité du système ≠ fiabilité des faits.
4. **K4 — Antériorité non-dépassée.** Si un Drools/Datalog (incrémental, mûr, formel) + LLM-as-tool + structured outputs couvre le besoin, réimplémenter un JTMS naïf est un coût net. Le modèle doit justifier ce qu'il apporte au-delà du confort de modélisation graphe-de-domaine + replay/sync.
5. **K5 — Un seul monde (JTMS, pas ATMS).** Pour un agent qui compare des plans alternatifs en parallèle, l'absence de contextes multiples force un fork manuel du graphe — coûteux et non-natif.

---

## 5. Sources (datées)

- **JTMS / ATMS — antériorité conceptuelle directe.** Reason maintenance / TMS, Wikipedia ; cours Forbus TMS (Northwestern, EECS 344, 2008) ; de Kleer, *An Assumption-Based TMS* (1986, via Semantic Scholar). JTMS = Doyle 1979 ; ATMS = de Kleer 1986. — consultés mai 2026.
  - https://en.wikipedia.org/wiki/Reason_maintenance
  - https://users.cs.northwestern.edu/~forbus/c44/Lectures/TMS%20Intro.pdf
  - https://www.semanticscholar.org/paper/An-Assumption-Based-TMS-Kleer/ed3f9263e936a879092ad7a2bf27e0f94089ccd8
- **Moteurs de règles / Rete — antériorité de l'ingénierie.** Rete (Forgy 1974), base de CLIPS/Jess/Drools/Soar ; ReteOO de Drools ; assert/modify/retract en working memory, matching incrémental. — Wikipedia Rete + docs Drools, consultés mai 2026.
  - https://en.wikipedia.org/wiki/Rete_algorithm
  - https://docs.drools.org/6.0.0.CR2/drools-expert-docs/html/ch01.html
- **LangGraph — orchestration impérative durable, checkpointing/time-travel.** LangGraph 1.0, oct. 2025 ; docs « Durable execution » (LangChain). Diagrid (2025) : « Checkpoints Are Not Durable Execution » — limite du rollback gros-grain.
  - https://docs.langchain.com/oss/python/langgraph/durable-execution
  - https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows
- **DSPy — programmation déclarative + optimisation de prompts.** Stanford NLP ; signatures/modules/optimizers ; « program, don't prompt ». Étude multi-cas arXiv 2507.03620 (2025).
  - https://dspy.ai/
  - https://arxiv.org/html/2507.03620v1
- **Structured outputs / constrained decoding.** OpenAI (août 2024), Gemini (mai 2024), Anthropic (nov. 2025) ; garantit la forme, pas la cohérence. arXiv 2503.24191 (2025) : surface d'attaque des sorties contraintes.
  - https://mbrenndoerfer.com/writing/constrained-decoding-structured-llm-output
  - https://arxiv.org/html/2503.24191v1
- **« To Scaffold or Not to Scaffold » — capacité-dans-les-poids vs échafaudage.** Laminar, 26 jan. 2026 (snippet via recherche ; URL renvoyant 404 au fetch le 25 mai 2026, citée d'après l'extrait de recherche) : problèmes qui « se dissolvent » avec la capacité vs ceux qui exigent interaction/ont leur propre horloge ; >45 % résolu en solo → ajouter des agents nuit.
  - https://laminar.sh/blog/2026-01-26-the-problems-that-wont-dissolve *(404 au fetch ; verbatim depuis l'index de recherche)*
- **Planification long-horizon migrant dans les poids (RL agentique).** SFR-DeepResearch (arXiv 2509.06283, 2025) ; ASTER (arXiv 2602.01204) ; « Beyond pass@1: A Reliability Science Framework for Long-Horizon LLM Agents » (arXiv 2603.29231). Tendance : la longueur de tâche fiable double 2023→2024→2025 ; tool-use/vérification réduit la cascade d'erreurs du raisonnement texte-seul.
  - https://arxiv.org/html/2509.06283v2
  - https://arxiv.org/pdf/2603.29231

---

*Code lu : `App/Graph.js` (pushMutation/révisions/stabilize loop), `App/objects/Concept.js` (isApplicableTo/applyTo/assert compilé), `App/objects/Entity.js` (updateApplicableConcepts/unCast récursif/static_ensure/watchers), `App/tasks/stabilize.js`, `concepts/common/*` (Edge, Distance, Travel, Stay, LongTravel). Pattern réel : `aetheris-graph/providers/travels/Skypicker.js` + `concepts/QueryBased/Edge/.../SkyPickerFlight.json` (provider async produisant des faits typés sous condition de règle).*
