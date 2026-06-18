# Étude critique de faisabilité — Réorienter skynet-graph en moteur serveur de roadmaps enrichies par IA

> Étude indépendante, datée mai 2026. Lecture du code réel (skynet-graph + aetheris-graph) et ancrage dans l'état de l'art 2024-2026. Posture critique assumée : l'objectif n'est pas de valider l'idée mais de dire honnêtement si elle vaut le coup.

---

## 0. Verdict en tête

**Recommandation : THIN-LAYER, pas BUILD. Confiance : moyenne-haute (~75 %).**

Concrètement : **ne pas** repartir de ce moteur comme socle d'un produit IA, mais **ne pas le jeter non plus**. L'idée centrale — un graphe-blackboard qui possède la concurrence, la cohérence et la traçabilité pendant qu'une couche IA "sculpte" et que des règles symboliques garde-fou rétractent les états incohérents — est **conceptuellement juste et même validée par la recherche 2025-2026** (revival des architectures blackboard, neurosymbolique anti-hallucination, mémoire-graphe temporelle type Graphiti/Zep). Mais **presque chacune de ses briques différenciantes existe déjà, en mieux, dans des outils matures et financés** (LangGraph pour l'orchestration durable, Graphiti/Zep/Letta pour la mémoire-graphe, LATS/ToT pour la recherche spéculative). Le delta réellement défendable de skynet-graph — la **rétraction réactive automatique pilotée par des règles déclaratives** (`ensure`/uncast en cascade) — est réel mais **étroit**, et le coût pour l'amener au niveau production (supprimer `new Function`, casser le mono-thread de mutation, ajouter scores/vecteurs, gérer la non-convergence sous LLM) est élevé pour un avantage de niche.

Le bon move : extraire **l'idée** (garde-fou symbolique rétractable + substrat structuré) et l'implémenter comme une **fine couche de validation/contraintes au-dessus de LangGraph + un store mémoire-graphe existant**, plutôt que de remettre en état un moteur de 2016-2021 conçu pour un autre problème (routing voyage).

Les 3 arguments critiques qui portent ce verdict sont en §4 et résumés en fin de document.

---

## 1. Faisabilité technique

### 1.1 Ce qu'il faut réellement construire

Le moteur actuel sait déjà faire le squelette de l'idée. La preuve est dans `aetheris-graph/providers/travels/Skypicker.js` : un provider lit le contexte du scope (`originNode:Position`, `TimeStep`, `TimePeriod`), appelle une API externe async, et **renvoie un template de mutation qui crée des branches `Theoric`** (nouveaux nodes/segments + path-descriptors avec prix/horaires). C'est **structurellement identique** à l'« Expander » LLM proposé : remplacer `Skypicker::getFlights` par `AI::proposeSteps` est, sur le papier, un changement de provider, pas d'architecture. Le pattern `OpenPath`/`OpenDest`/`Undefined` (`autoCast:false`) confirme que l'expansion déclenchée explicitement par l'agent est déjà le design d'origine, et `SplitOpenDest` montre le fan-out (un segment → N candidats) déjà présent.

Donc le « build » minimal pour un PoC est modeste. Mais le **build production** réclame de traiter une liste de points durs dont certains sont structurels :

| Point dur | Sévérité | Contournable ? | Coût |
|---|---|---|---|
| `new Function`/eval pervasif (Concept.js l.62, Entity.js, Graph.js `queryMaps`/`getChildMatching`) | **Rédhibitoire en prod** | Oui — écrire un parser + interpréteur pour le mini-langage de refs | Moyen, mais c'est un prérequis bloquant (CSP, sandbox, injection via texte LLM) |
| Thread de mutation **mono-fil** (`_mutationThreadRunning`, queue `_mutationThread`) | **Élevé** sous "expansion massive parallèle" | Partiellement — providers concurrents OK, mais l'application des mutations sérialise | Élevé : c'est le cœur de la cohérence ; le paralléliser = réécrire la garantie d'atomicité |
| Convergence/point-fixe sous **non-déterminisme LLM** | **Élevé** | Oui mais artificiellement — budgets, profondeur max, dedup sémantique | Moyen ; mais casse l'élégance "stabilise jusqu'au point fixe" (cf. §1.2) |
| Pas de détection de cycle (`getChildPath` *logge* "This graph have loops" mais ne l'empêche pas) | **Élevé** avec un LLM qui peut reproposer A→B→A | Oui — détection de cycle + visited-set | Moyen |
| Applicabilité **booléenne** (pas de score/proba) | **Moyen** | Oui — stocker le score comme donnée et router via `assert` de seuil | Faible en hack, mais le "ranking" devient externe au moteur, pas natif |
| Aucune opération **vectorielle/similarité** native | **Moyen** | Oui — provider d'embeddings + store externe ; dedup de branches via cosinus | Moyen ; mais alors le store vectoriel fait le gros du travail, pas le graphe |
| Règles **statiques** (chargées au mount, pas d'apprentissage runtime) | **Faible→Moyen** | Pas dans le moteur ; l'adaptation vient des prompts/poids du LLM | Faible si on accepte que l'IA, pas les règles, porte l'adaptativité |
| Pas de provider LLM inclus | Faible | Trivial à écrire | Faible |
| Tests non fonctionnels, `__SERVER__` injecté au build, pas de validation de schéma des concepts | Moyen (dette) | Oui | Moyen (remise en état) |

**Verdict faisabilité :** un PoC est faisable en quelques semaines. Une **base production-grade** demande de re-traiter eval, mono-thread, cycles et convergence — soit une réécriture partielle d'un code de ~1700 lignes très dense, peu testé, daté, à un seul auteur. Ce n'est pas insurmontable, mais on reconstruit alors une grande partie de ce que LangGraph 1.0 (oct. 2025) offre déjà testé en prod (checkpointing ACID Postgres, durable execution, reprise après crash, human-in-the-loop, time-travel).

### 1.2 Le point dur conceptuel : le point-fixe casse-t-il sous LLM ?

C'est **le** vrai sujet. Le moteur repose sur une hypothèse de forward-chaining : on tire les règles jusqu'à ce qu'il n'y ait plus rien d'applicable → état stable. Cette hypothèse est **propre quand les providers sont déterministes** (une API géo renvoie toujours la même distance). Avec un Expander LLM :

- Le même contexte peut générer des sous-roadmaps **différentes** à chaque appel → le "point fixe" n'est plus un invariant, c'est un point d'**épuisement de budget**. On ne stabilise pas, on **s'arrête**. C'est philosophiquement différent et il faut l'assumer : la boucle de stabilisation devient une boucle de recherche bornée (beam/ToT), pas une convergence déductive.
- Sans budget strict, l'expansion spéculative diverge (combinatoire). La recherche 2025 le dit clairement : ToT/recherche arborescente explose en tokens, et le choix branching-factor/pruning est non trivial (cf. Token-Budget-Aware Reasoning, ACL 2025 ; Budget-Aware Value Tree Search, arXiv 2603). Et le système multi-agent d'Anthropic consomme **~15× les tokens** d'un chat, avec **80 % de la variance de perf expliquée par l'usage de tokens**. Donc "expansion MASSIVE et PARALLÈLE" est le mode **le plus cher** qui existe — la discipline de budget n'est pas un nice-to-have, c'est la survie économique du système.

**Bonne nouvelle :** le garde-fou symbolique (`require`/`ensure` qui rétractent automatiquement un état incohérent) est **exactement** ce que la littérature neurosymbolique 2025-2026 prône contre l'hallucination (KEA Explain, NELLIE, et surtout "Ontology-Constrained Neural Reasoning" arXiv 2604.00555 qui contraint les agents d'entreprise par une ontologie formelle). L'argument grounding/rétraction de skynet-graph **est réel et dans l'air du temps**. Le problème n'est pas l'idée — c'est qu'on peut l'obtenir sans ce moteur précis.

---

## 2. Gains vs l'existant + tableau comparatif

### 2.1 Est-ce que ça réinvente LangGraph + un moteur de règles ?

**En grande partie, oui.** La couche déclarative de "concepts" (require/assert/ensure/provider) est une jolie idée, mais face à LangGraph elle relève surtout de la **complexité accidentelle** pour ce cas d'usage :

- L'argument "l'ordre d'exécution est dérivé automatiquement des dépendances, pas codé" est **vrai** et **élégant**. Mais en pratique, sur un planning IA spéculatif, l'ordre n'est pas le problème dur — le problème dur est le **contrôle du budget, le pruning et le ranking**, que le déclaratif booléen de skynet-graph ne sait justement **pas** exprimer nativement (pas de scores). LangGraph, lui, expose explicitement des arêtes conditionnelles, du parallélisme contrôlé, des checkpoints, et laisse le ranking au code — moins "joli" mais plus opérationnel.
- La rétraction réactive (`ensure` → uncast en cascade + cleaners) **n'a pas d'équivalent direct trivial** dans LangGraph (qui rejoue/rollback via checkpoints, ce qui est plus grossier). **C'est le seul vrai delta défendable.** Voir §2.3.

### 2.2 Le "graphe-comme-mémoire/blackboard" bat-il Graphiti/Zep/GraphRAG/Letta/Mem0 ?

**Non, pas en l'état.** Et l'écart se creuse :

- **Graphiti/Zep** (arXiv 2501.13956, jan. 2025) font déjà un graphe de connaissances **temporel bi-temporel** avec intervalles de validité sur chaque arête et **invalidation automatique des faits obsolètes par détection de conflit** (sémantique + graphe). C'est *précisément* la promesse "rétraction réactive de faits incohérents" de skynet-graph — mais avec recherche sémantique native, latence P95 ~300 ms, et adoption industrielle. Skynet-graph fait la rétraction par règle booléenne ; Graphiti la fait par conflit sémantique. Pour de la mémoire d'agent, Graphiti gagne.
- **Letta (MemGPT)** et **Mem0** dominent les benchmarks de mémoire (LongMemEval, LoCoMo) ; skynet-graph n'a aucun benchmark et aucune notion de retrieval.
- **GraphRAG** (Microsoft) couvre le versant retrieval/communautés sur gros corpus.

Le seul angle où le graphe de skynet-graph reste pertinent : ce n'est **pas** une mémoire conversationnelle, c'est un **substrat de travail structuré et muté en direct** (working memory + blackboard de la tâche en cours), avec traçabilité par révision. Là, il rejoint le **revival blackboard 2025** (arXiv 2507.01701, 2510.01285) — qui montre +13 à +57 % vs master-slave/RAG. **MAIS** : ces papiers implémentent le blackboard avec des **agents LLM qui décident de contribuer**, pas avec un moteur de règles symboliques forward-chaining. La tendance de fond est "models propose, architectures dispose" : la **capacité migre dans les poids et les prompts**, le scaffolding se fait **plus léger**, pas plus structuré. Skynet-graph va à contre-courant en mettant beaucoup d'intelligence dans des règles JSON statiques.

### 2.3 Où est le delta défendable, s'il existe ?

Il existe, mais il est étroit. Le delta réel de skynet-graph sur l'état de l'art est la combinaison :

1. **Rétraction réactive fine-grain pilotée par règles déclaratives** : quand un fait change, les watchers auto-câblés (`follow`/`ensure`) ré-évaluent et **décastent en cascade** les concepts dépendants + leurs enfants, avec cleaners. LangGraph rollback par checkpoint (gros grain) ; Graphiti invalide par conflit sémantique (sur la mémoire, pas sur un plan en construction). Personne ne fait exactement "rétraction structurelle cascadée d'un plan partiel en cours quand une précondition tombe".
2. **Mutations sérialisables/atomiques + révisions + sync master/replica** comme primitive de premier ordre → auditabilité et reproductibilité du *comment* chaque branche a été dérivée.
3. **Séparation neurosymbolique nette** au point provider : sorties neurales → faits durs → règles symboliques. C'est propre.

Mais ce delta est **un détail d'implémentation séduisant, pas un fossé concurrentiel**. Il ne justifie pas de bâtir un produit sur un moteur non maintenu plutôt que d'ajouter une couche de validation à un stack mainstream.

### 2.4 Tableau comparatif

| Axe | skynet-graph (réorienté IA) | LangGraph 1.0 | Graphiti/Zep | Letta / Mem0 | LATS / ToT / GoT | Blackboard LLM 2025 (2507.01701) |
|---|---|---|---|---|---|---|
| **Orchestration** | Déclarative, ordre dérivé (élégant mais booléen, pas de contrôle de budget natif) | Impérative explicite, arêtes conditionnelles, parallélisme contrôlé, durable | N/A (couche mémoire) | Runtime d'agent (Letta) / add-on (Mem0) | Politique de recherche (sélection/expansion/eval/backprop) | Agents LLM postant sur shared memory |
| **Mémoire / état** | Graphe muté en direct + révisions ; pas de retrieval, pas de vecteurs | State + checkpointing ACID (Postgres), time-travel | KG temporel bi-temporel, invalidation par conflit, retrieval sémantique P95 ~300 ms | Tiers mémoire OS-like / memory layer, top LongMemEval | État partagé public/privé piloté par LLM |
| **Recherche / planning** | Expansion spéculative possible via providers `Theoric` + `pushPath` (commit/élagage) ; pas de scoring natif | À coder par-dessus (le graphe n'est pas un chercheur) | N/A | N/A | **Cœur de métier** : MCTS/beam, value-guided, SOTA HumanEval 92.7 % | Recherche distribuée par contribution d'agents |
| **Grounding / cohérence** | **Fort** : `require`/`ensure` bloquent et rétractent les états incohérents | Moyen (validators à coder, rollback gros grain) | Fort (conflit temporel sémantique) | Moyen | Faible nativement (l'évaluateur LLM peut se tromper) | Moyen-fort (vérif croisée d'agents) |
| **Auditabilité** | **Forte** : révisions, `_mappedConcepts`, dérivation traçable, `printStats` | Forte (traces, checkpoints, LangSmith) | Forte (validité temporelle des arêtes) | Moyenne | Faible (trace d'arbre, peu d'explication) | Moyenne (historique blackboard) |
| **Coût (runtime)** | Risque d'explosion si expansion massive ; mono-thread mutation = goulot | Maîtrisable, parallélisme borné | Faible (retrieval) | Faible-moyen | **Élevé** (orders-of-magnitude d'appels) | Élevé (multi-agent ~15× tokens) |
| **Effort de build** | **Élevé** (eval, mono-thread, cycles, scores, vecteurs, tests, code daté mono-auteur) | Faible (adopter) | Faible (adopter) | Faible (adopter) | Moyen (impl. ou lib) | Moyen |
| **Maturité écosystème** | **Quasi nulle** (1 auteur, 2016-2021, pas de tests, pas de comm.) | **Très haute** (Klarna, Replit, Elastic ; 1.0) | Haute (open-source, papier, prod) | Haute | Haute (ICML 2024, libs) | Émergente (papiers 2025) |

---

## 3. Intérêt réel & niche (2026)

### 3.1 Pour qui ça gagnerait vraiment ?

L'intérêt n'est **pas** générique. Il se concentre sur une niche précise où les avantages de skynet-graph cessent d'être redondants :

- **Domaines régulés / auditables à contraintes dures** (santé, finance, supply-chain, planification industrielle) où il faut prouver *pourquoi* une étape de roadmap a été retenue **et** garantir que toute proposition IA violant une contrainte est **automatiquement rétractée**, pas seulement loggée. Là, la rétraction structurelle cascadée + les révisions ont une vraie valeur que LangGraph n'offre pas out-of-the-box. C'est exactement le créneau de "Ontology-Constrained Neural Reasoning" (2026).
- **Roadmaps à contraintes structurelles fortes et vérifiables symboliquement** (dépendances dures entre étapes, invariants de cohérence) — pas du brainstorming libre. Si les contraintes sont surtout "de bon sens" et difficiles à formaliser, l'IA seule (reasoning model) fait mieux et le moteur est du poids mort.

### 3.2 Build / thin-layer / don't-build ?

- **(i) Construire ce moteur** : seulement si le delta "rétraction symbolique cascadée d'un plan partiel" est **le cœur de la proposition de valeur** ET qu'on a la rigueur d'investir dans eval-free, scoring, vecteurs et anti-divergence. Rarement justifié.
- **(ii) Thin-layer (recommandé)** : LangGraph porte l'orchestration durable + le budget + le parallélisme ; un store mémoire-graphe (Graphiti) porte la mémoire/retrieval ; et on réimplémente **uniquement le garde-fou rétractable** (l'idée vraiment originale de skynet-graph) comme un validateur de contraintes par-dessus le state LangGraph. On garde l'âme, on jette la dette.
- **(iii) Ne rien construire / adopter l'existant** : si la cohérence/contraintes peuvent être assurées par structured outputs + quelques validators, et le planning par un reasoning model + LATS, alors le moteur n'apporte rien de défendable. C'est le cas par défaut pour la plupart des produits "roadmap IA" génériques.

### 3.3 Scaffolding vs fine-tuning/RL : où le poids tue l'échafaudage ?

- **Le fine-tuning/RL rend le scaffolding inutile** là où la *capacité de planning brute* est en jeu : décomposer un objectif, proposer des étapes plausibles, s'auto-corriger. Les reasoning models (o3 et successeurs) internalisent une bonne part de ToT/ReAct **dans les poids** ; "reasoning is all you need" pour beaucoup de tâches de planification (cf. arXiv 2511.05375). Mettre cette logique dans des règles JSON statiques, c'est rejouer une bataille que le modèle a déjà gagnée.
- **Le scaffolding reste indispensable** là où il faut des **garanties externes vérifiables** que les poids ne peuvent pas fournir : contraintes dures, auditabilité, état partagé concurrent cohérent, rétraction déterministe. C'est précisément le terrain de skynet-graph — mais c'est un terrain **étroit et de garde-fou**, pas le terrain "génère la roadmap".

Autrement dit : **laisser le modèle planifier, et n'utiliser le moteur que comme contrainte/mémoire structurée vérifiable.** Tout ce qui dans skynet-graph essaie de *piloter* le raisonnement par des règles est probablement du travail déjà absorbé par les poids en 2026.

---

## 4. Killer risks

1. **Redondance avec un écosystème mature et financé.** LangGraph (orchestration durable, 1.0 prod), Graphiti/Zep (mémoire-graphe temporelle avec invalidation), Letta/Mem0 (mémoire SOTA), LATS (recherche). Le risque n'est pas que skynet-graph soit mauvais — c'est qu'il soit **redondant à 80 %** avec des briques mieux testées, et que l'effort de remise à niveau serve surtout à rattraper l'existant. *Tueur si l'équipe est petite.*

2. **Explosion de coût de l'expansion spéculative massive.** Le mode dominant choisi (ToT/beam/LATS massivement parallèle) est le plus cher qui existe (~15× tokens, 80 % de la variance de perf = tokens). Couplé au **thread de mutation mono-fil** qui sérialise l'application sous forte charge, on cumule le pire des deux mondes : on paye le fan-out LLM **et** on goulotte à l'intégration. *Tueur économique et de scalabilité si non maîtrisé dès le départ.*

3. **L'hypothèse de point-fixe ne tient plus sous LLM non-déterministe ; et la capacité migre dans les poids.** Le moteur a été pensé pour des providers déterministes ; un Expander génératif transforme la "stabilisation" en recherche bornée, ce qui dévalue l'élégance déclarative qui était l'argument de vente. En parallèle, la tendance 2026 ("models propose, architectures dispose", reasoning models) déplace l'intelligence vers les poids — donc plus on met de logique de planning dans des **règles statiques**, plus on construit une infra que le modèle rend obsolète. *Tueur de la thèse "le déclaratif de concepts est l'avantage".*

Risques secondaires : `new Function`/eval avec du texte LLM en entrée = **surface d'injection** ; absence de détection de cycle face à un LLM qui boucle ; code mono-auteur 2016-2021, non testé, non documenté en anglais = **risque de maintenabilité/bus-factor**.

---

## 5. Reco finale & prochaines étapes minimales pour dé-risquer

**Reco : THIN-LAYER.** Ne pas faire de skynet-graph le socle ; en extraire **l'unique idée différenciante** (garde-fou symbolique rétractable + substrat tracé) et la poser au-dessus d'un stack mainstream. Voici un plan de dé-risquage minimal, ordonné, qui tranche la question pour pas cher avant tout gros investissement :

1. **Spike "le delta existe-t-il vraiment ?" (1-2 jours).** Prendre un cas de roadmap à contrainte dure (ex : "étape B impossible si la ressource X de A est consommée"). L'implémenter (a) en pur reasoning model + structured outputs + 1 validator, (b) avec la rétraction réactive de skynet-graph. **Si (a) suffit, don't-build est tranché.** Si (b) apporte une rétraction cascadée que (a) ne sait pas faire proprement → le delta est confirmé.

2. **Mesurer le coût du mode massif sur un cas réel (1 jour).** Brancher un Expander LLM réel sur un segment frontière (remplacer `Skypicker::getFlights` par `AI::proposeSteps`), avec budget strict (profondeur max, cap d'expansion, cache contexte→génération). Compter tokens/latence pour 1 roadmap complète. Comparer à un baseline LangGraph+LATS. **Si le coût est rédhibitoire, le mode "massif parallèle" est à abandonner avant tout.**

3. **Lever le bloqueur `new Function` (prérequis, pas optionnel).** Écrire le mini-parser/interpréteur du langage de refs. Sans ça, rien n'est déployable en prod (CSP, injection). C'est aussi un bon test de l'appétit réel pour maintenir ce moteur.

4. **Décision go/no-go sur la base de 1-3.** Si delta confirmé + coût maîtrisé + appétit de maintenance → envisager la **couche fine** : LangGraph (boucle + budget + checkpoint) ⊕ Graphiti (mémoire/retrieval) ⊕ un module "contraintes rétractables" inspiré de `ensure`/uncast, **réécrit proprement**, pas le moteur historique. Sinon → adopter l'existant et archiver skynet-graph comme source d'inspiration conceptuelle.

Ce qu'il faut **ajouter** dès qu'on dépasse le PoC, dans tous les cas : scoring (champ donnée + assert de seuil), dedup sémantique de branches (embeddings), détection de cycle, et discipline de budget/convergence formalisée.

---

## 6. Sources

Recherche / planning au-dessus des LLM :
- Language Agent Tree Search (LATS), ICML 2024 — https://arxiv.org/pdf/2310.04406 ; repo https://github.com/lapisrocks/LanguageAgentTreeSearch
- Tree-of-Thoughts, panorama & critiques — https://www.emergentmind.com/topics/tree-of-thoughts-tot
- Token-Budget-Aware LLM Reasoning, ACL 2025 — https://aclanthology.org/2025.findings-acl.1274/ ; https://arxiv.org/pdf/2412.18547
- Budget-Aware Value Tree Search for LLM Agents (2026) — https://arxiv.org/pdf/2603.12634
- "Reasoning Is All You Need for Urban Planning AI" — https://arxiv.org/pdf/2511.05375

Orchestration d'agents :
- LangGraph (repo) — https://github.com/langchain-ai/langgraph ; produit — https://www.langchain.com/langgraph
- LangGraph 1.0 (oct. 2025), retours prod — https://medium.com/@romerorico.hugo/langgraph-1-0-released-no-breaking-changes-all-the-hard-won-lessons-8939d500ca7c
- Anthropic multi-agent research system (coût ~15× tokens, +90 % vs single-agent) — https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent
- "Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures" (2026) — https://arxiv.org/html/2604.03515v2

Mémoire d'agent / graphe :
- Zep: A Temporal Knowledge Graph Architecture for Agent Memory (jan. 2025) — https://arxiv.org/abs/2501.13956
- Graphiti (Neo4j blog ; repo) — https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/ ; https://github.com/getzep/graphiti
- État de la mémoire d'agent 2026 (benchmarks LongMemEval/LoCoMo) — https://mem0.ai/blog/state-of-ai-agent-memory-2026 ; https://www.letta.com/blog/benchmarking-ai-agent-memory

Neurosymbolique / grounding / contraintes :
- KEA Explain (hallucinations via KG) — https://neurosymbolic-ai-journal.com/system/files/nai-paper-908.pdf
- NELLIE (inference engine grounded) — https://arxiv.org/pdf/2209.07662
- "Ontology-Constrained Neural Reasoning in Enterprise Agentic Systems" (2026) — https://arxiv.org/pdf/2604.00555
- "Improving Rule-based Reasoning in LLMs using Neurosymbolic Representations" (2025) — https://arxiv.org/pdf/2502.01657

Blackboard (revival 2025) :
- "Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture" — https://arxiv.org/abs/2507.01701
- "LLM-Based Multi-Agent Blackboard System for Information Discovery" (oct. 2025, +13 à +57 %) — https://arxiv.org/abs/2510.01285

Code lu (local, sources primaires de l'évaluation) :
- `/mnt/wsl/WipDrive/_libs/various/skynet-graph/App/Graph.js`, `App/objects/Concept.js`, `App/objects/Entity.js`, `App/tasks/stabilize.js`
- `/mnt/wsl/WipDrive/_libs/various/skynet-graph/concepts/common/*` (Edge/Distance, Travel, LongTravel, Stay…)
- `/mnt/wsl/WipDrive/_libs/various/aetheris-graph/providers/travels/Skypicker.js` (pattern provider→branches `Theoric`)
- `/mnt/wsl/WipDrive/_libs/various/aetheris-graph/concepts/QueryBased/Edge/{OpenPath,OpenDest,Undefined,autoSearchPaths,...}` (pattern d'expansion réel, `autoCast:false`, fan-out `SplitOpenDest`)
