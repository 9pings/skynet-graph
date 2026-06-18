# Aspect : Coordination multi-agents — skynet-graph comme *blackboard réactif*

> Étude critique, mai 2026. Périmètre : le **modèle de coordination** (N répliques à concept-sets hétérogènes dérivant des faits sur un état réactif partagé, fusion atomique dans le maître, rétraction réactive croisée). Hors périmètre, traité ailleurs : la cognition/contexte (`graph-agent-substrate-study.md`), le calcul incrémental et le modèle de programmation (`ai-roadmap-feasibility-study.md`). Hors sujet par consigne : hygiène d'implémentation (`new Function`, mono-fil, cycles, âge du code) — tout cela est trivialement remplaçable et n'entre pas dans le jugement.
>
> Le code a été lu directement (`App/Graph.js`, `App/objects/{Concept,Entity}.js`, `App/tasks/stabilize.js`, `concepts/common/*`, `doc/doc.md`, provider `aetheris-graph/.../Skypicker.js`). Les études `*-study.md` ont été consultées comme source mécanique fiable ; ni leur cadrage ni leur verdict ne sont repris.

---

## 0. Verdict + confiance

**Le modèle est une *bonne fondation de coordination* pour une classe étroite mais réelle de problèmes multi-agents : ceux où la coordination est *dérivée d'un état partagé typé* plutôt que *négociée par messages*.** L'idée porteuse n'est pas « des agents qui se parlent » mais « des agents qui ne se parlent jamais et observent/écrivent un même état dérivé, dont la cohérence est maintenue par re-dérivation automatique ». C'est un *blackboard réactif* avec invalidation transitive — et c'est précisément l'angle que la recherche 2025-2026 redécouvre (revival blackboard, arXiv 2507.01701 et 2510.01285) mais qu'aucun framework de production (CrewAI, AG2/AutoGen, LangGraph, OpenAI Agents SDK) n'incarne réellement : tous restent message-passing / handoff / state-dict mutable sans rétraction.

Le delta défendable tient en un mot : **invalidation croisée automatique**. Quand l'agent A retire un fait, toutes les branches que l'agent B avait dérivées de ce fait s'effondrent *sans que B ni un orchestrateur ne soient au courant ni n'aient à l'être*. Aucun des frameworks nommés ne fait ça ; tous le simulent par re-prompt, re-run, ou mediation agent.

**Mais** la promesse a un plafond dur et un point de rupture :
- **Plafond** : écritures sérialisées dans le maître (`_mutationThreadRunning` dans `pushMutation`, `Graph.js`) → la cohérence forte plafonne le débit ; ce modèle gagne en *cohérence/audit*, jamais en *scalabilité d'écriture*.
- **Rupture** : la rétraction réactive règle les conflits **structurels** (un fait disparaît → ses dépendants disparaissent) mais **PAS les conflits sémantiques** (deux agents écrivent deux faits typés *tous deux valides* mais mutuellement incohérents). Sur ce point précis, le système n'a pas de réponse native, et c'est exactement le mode d'échec n°1 documenté en 2025 (MAST, « conflicting objectives »).

**Confiance : moyenne-haute (≈70 %).** Haute sur la lecture du modèle et le positionnement vs l'existant (sources convergentes et datées). Plus basse sur l'extrapolation IA : aucune des deux apps (voyage 2016-2021, providers IA) n'a tourné avec des providers-LLM en concurrence réelle ; le comportement de la rétraction sous écritures LLM non-déterministes est inféré, pas observé.

---

## 1. Affordances uniques (génératif — dérivé des mécanismes, pas de l'existant)

On dérive ici la valeur de coordination des mécanismes réellement présents dans le code, sans se borner à l'usage voyage d'origine.

### A1 — Coordination *sans canal* : le partage EST le protocole
Dans le modèle, deux répliques ne s'échangent jamais de message. Elles écrivent des faits typés (`pushMutation`) ; la propagation passe par les `require`/`follow`/`ensure` (Concept.js, Entity.js `static_ensure`). La coordination émerge de la *forme de l'état*, pas d'un protocole conversationnel. **Affordance** : on supprime tout le surface-area « qui parle à qui, dans quel ordre, avec quel format de message » — la source de la majorité des bugs de coordination LLM (context collapse, ordering, désynchro). C'est le pari Linda/tuple-space (lire/écrire des tuples, pas s'adresser des pairs) ré-instancié avec typage et réactivité.

### A2 — Invalidation transitive croisée (le cœur génératif)
`ensure` = rétraction réactive (Entity.js `static_ensure` + `unCast` qui désinstalle watchers, supprime la clé, et **cascade sur les concepts enfants**). Conséquence multi-agent non triviale : si l'agent-A produit `Position` et l'agent-B en a dérivé une chaîne `Distance → LongTravel → SkyPickerFlight` (voir `Edge/Distance.json`, `LongTravel.json`, provider Skypicker), alors *invalider la prémisse de A rétracte automatiquement toute la production de B*. **Aucun framework nommé ne possède cela** : LangGraph re-run un sous-graphe sur edge conditionnel mais ne « dé-fait » pas des faits dérivés ; CrewAI/AutoGen/Agents-SDK n'ont aucune notion de dépendance entre sorties d'agents. C'est l'affordance qui justifie à elle seule l'étude.

### A3 — Spécialisation déclarative *vérifiable* (vs prompt+tools opaque)
Une réplique = un concept-set (`cfg.conceptSets`, `init` fait `dmerge` des sets). La capacité d'un agent est une **bibliothèque de règles inspectables** (préconditions `require`/`assert`, productions `applyMutations`/`provider`), pas un blob de prompt. Deux agents diffèrent par *quelles règles ils peuvent appliquer*, ce qui est statiquement analysable : on peut savoir, avant exécution, quels faits un agent est *capable* de produire et sous quelles conditions. C'est ce que la recherche blackboard 2025 appelle le « volunteer model » (les agents s'auto-sélectionnent sur leur expertise) — mais ici l'auto-sélection est *décidable par les préconditions*, pas par un LLM qui s'auto-évalue.

### A4 — Audit/provenance *gratuits* parce que structurels
Chaque mutation est estampillée révision (`this._rev++`, `this._revs[revNum]`), rejouable, attribuée à un parent/origine (`_origin`). La coordination produit un **journal d'événements typé et rejouable** par construction (event-sourcing implicite, cf. parenté avec Rama : depot append-only → PStates). Pour un système multi-agent, c'est la réponse native à « qui a écrit quoi, pourquoi, et qu'est-ce qui en dépendait » — la question que les frameworks conversationnels ne peuvent répondre qu'a posteriori via tracing best-effort.

### A5 — Topologie maître/répliques à *deltas filtrés*
Le modèle (doc.md ; `pushMutation` avec `cfg.isMaster`/`pushToMaster`, `pushAtomicUpdates`) prévoit que chaque réplique ne pousse au maître que les deltas qui la concernent et reçoit les révisions atomiques estampillées. C'est une topologie blackboard *partitionnée par capacité* : pas de full-mesh, pas de broadcast complet. Affordance : on scale le *nombre d'agents spécialisés* sans faire exploser le trafic de coordination (chaque agent ne voit que sa coupe de l'état).

### A6 — Convergence comme propriété, pas comme orchestration
La stabilisation (`stabilize.js`, `_loopTF`) est un point-fixe forward-chaining : on applique jusqu'à ce que plus aucune règle ne tire. La « fin de la coordination » est donc *détectable* (état stable) au lieu d'être décidée par un orchestrateur qui juge « c'est bon, on s'arrête ». Pour du multi-agent, « savoir quand le collectif a convergé » est un problème ouvert ; ici c'est un invariant du moteur.

> Dérivation honnête : A1, A2, A4, A6 sont des affordances *réelles du code*. A3 et A5 sont *présentes mais sous-exploitées* (le concept-set par contexte existe ; le filtrage de deltas par capacité est esquissé dans `pushMutation`/sync mais pas durci). Aucune n'a été exercée avec des agents LLM concurrents.

---

## 2. Confrontation nommée

### 2.1 vs les frameworks de production (CrewAI, AutoGen/AG2, LangGraph, OpenAI Agents SDK/Swarm)
Tous partagent un trait : **la coordination est un flux de contrôle / de messages, l'état est secondaire**.
- **CrewAI** : rôles + tâches séquentielles ; communication médiée par les *outputs de tâche*, pas d'état partagé mutable réactif, pas de checkpoint fin (DataCamp / Pockit, 2026).
- **AutoGen / AG2 (1.0 GA)** : group-chat conversationnel ; cohérence émergente du dialogue, *moins prévisible*, aucune invalidation de sorties passées.
- **LangGraph (v0.4)** : le plus proche d'un « état » — state-dict typé qui circule dans un graphe de nœuds, checkpoints, persistance. Mais l'état est *mutable et écrasé*, pas *dérivé avec rétraction* : changer une entrée amont ne rétracte pas automatiquement les faits avals déjà écrits ; il faut re-router/re-run explicitement. C'est de la ré-exécution, pas de l'invalidation déclarative.
- **OpenAI Agents SDK** : primitives Handoff + `context_variables` (DI grab-bag) + Sessions. Le handoff *transfère* le contexte ; il n'y a ni état dérivé partagé ni notion de dépendance entre productions d'agents.

**Où skynet-graph gagne** : invalidation croisée automatique (A2), convergence comme invariant (A6), audit structurel (A4). **Où il perd** : maturité, écosystème, tool-calling, human-in-the-loop, observabilité — tout est à construire ; les autres sont des produits.

### 2.2 vs le rapport multi-agent d'Anthropic (orchestrator-worker)
Point le plus instructif. Anthropic déclare **explicitement** : *« no peer-to-peer channel and no shared mutable state »* ; le lead agent tient l'état via un système de mémoire, les sous-agents ont chacun leur fenêtre de contexte (ByteByteGo / ZenML, 2025). Leur système bat le single-agent de 90,2 %. **C'est l'antithèse assumée du modèle skynet-graph.** Leur argument : l'état partagé mutable est une source de couplage et de fragilité ; mieux vaut isoler les contextes et agréger via un orchestrateur. **Critique dure qui en découle** : si une équipe qui a poussé le multi-agent LLM en production le plus loin a *choisi* de bannir l'état partagé mutable, le pari blackboard réactif doit justifier pourquoi *l'état dérivé typé avec rétraction* échappe aux problèmes qui ont fait fuir Anthropic. Réponse défendable : leur « shared mutable state » honni est un blob non-typé sans sémantique d'invalidation ; un état *dérivé, typé, monotone-puis-rétracté par règles* n'est pas le même objet. Mais c'est une thèse à prouver, pas un acquis.

### 2.3 vs blackboard revival (arXiv 2507.01701, 2510.01285v2 jan. 2026)
Convergence frappante : ces papiers (2025-2026) montrent qu'un blackboard LLM bat le paradigme master-slave de **+13 % à +57 %** en succès end-to-end, *précisément* parce que les agents s'auto-sélectionnent (volunteer model) au lieu d'être délégués par un contrôleur omniscient — ce qui « devient infaisable à l'échelle ». **skynet-graph est une instanciation *plus forte* de cette idée** : le blackboard des papiers stocke des *messages/inférences* (texte), celui de skynet-graph stocke des *faits typés avec dépendances et rétraction*. L'auto-sélection y est *décidée par préconditions* (A3), pas par auto-évaluation LLM. C'est un argument réel : la littérature valide la *direction*, skynet-graph propose une *forme plus disciplinée*. Réserve : ces papiers n'ont pas de rétraction non plus ; personne n'a montré que la rétraction réactive aide *plus* qu'elle ne nuit sous LLM.

### 2.4 vs tuple spaces (Linda / JavaSpaces) et Rama
- **Linda/JavaSpaces** : ancêtre direct de A1 (coordination par lecture/écriture d'un espace partagé, découplage spatial et temporel). skynet-graph ajoute *typage + réactivité + rétraction* à l'idée tuple-space. La dette intellectuelle est réelle et assumable ; le delta est la réactivité dérivée.
- **Rama (Red Planet Labs)** : depot append-only → topologies → PStates matérialisées. skynet-graph est un Rama *miniature et réactif* : `_revs` = depot, stabilize = topologie, faits = PStates. Rama scale (clone Twitter 100×) mais **n'a pas de rétraction ni de coordination multi-agent** — c'est du dataflow batch/stream. skynet-graph troque le scaling de Rama contre l'invalidation réactive. Honnêtement : si on voulait industrialiser A4/A5, on réécrirait probablement sur un substrat type Rama plutôt que sur le mono-maître actuel.

### 2.5 vs la couche de partage CRDT / local-first (Yjs, Automerge, ElectricSQL, Zero)
C'est ici que naît la **critique la plus dure**. Les CRDT garantissent la *convergence syntaxique* (tout le monde finit avec le même octet) — mais leur résolution de conflit est, je cite la littérature 2025, *« implicit, opaque to users, cannot be supervised, and non-native to application-specific semantics »* (Velt / iankduncan, 2025 ; arXiv 2602.19231 « Semantic Conflict Model »). **Or c'est exactement le trou de skynet-graph.** Son merge est *last-write-wins sérialisé* (`set` écrase `this._[key]`, `update` boucle des `set`) : deux agents qui écrivent deux faits contradictoires *tous deux valides* ne déclenchent **aucune** rétraction (la rétraction ne tire que si une *précondition* casse, pas si deux conclusions s'opposent). On hérite donc du *pire* des CRDT (résolution implicite et non-supervisée) **sans** en avoir la convergence distribuée prouvée. La rétraction réactive est orthogonale au conflit sémantique : elle ne le résout pas.

### Tableau

| Système (daté) | Unité de partage | Cohérence | Invalidation croisée | Conflit sémantique inter-agent | Spécialisation | Audit/provenance | Scalabilité écriture |
|---|---|---|---|---|---|---|---|
| **skynet-graph** | faits typés + dépendances | forte, sérialisée | **oui (rétraction transitive)** | **non native (LWW)** | déclarative (concept-set) | structurelle, rejouable | plafonnée (mono-maître) |
| CrewAI (2026) | outputs de tâche | flux séquentiel | non | non | rôles/prompts | tracing | n/a |
| AutoGen/AG2 1.0 (2025) | messages chat | émergente dialogue | non | non (mediation ad hoc) | prompts/tools | tracing | n/a |
| LangGraph v0.4 (2025) | state-dict mutable | checkpoints | non (re-run) | non | nœuds | checkpoints | moyenne |
| OpenAI Agents SDK (mars 2025) | contexte/handoff | transfert ctx | non | non | handoffs | tracing | n/a |
| Anthropic orch-worker (2025) | mémoire du lead | **pas d'état mutable partagé** | non (isolé) | géré par lead/agrégation | sous-agents+prompts | mémoire+ | élevée (parallèle isolé) |
| Blackboard LLM (2507/2510, 25-26) | messages/inférences | blackboard partagé | non | partiel (volunteer/control) | volunteer model | blackboard | moyenne |
| Linda/JavaSpaces | tuples | espace partagé | non | non | par template | faible | moyenne |
| Rama (24-25) | depot→PStates | event-sourcing | non | n/a (pas d'agents) | topologies | **fort (depot)** | **élevée** |
| CRDT/local-first (25) | doc répliqué | convergence éventuelle | non | **implicite/opaque** | n/a | causal/vector | élevée |

---

## 3. Réel vs redondant/gadget

**Réel (defensible) :**
- **Invalidation croisée transitive (A2)** : authentiquement absente partout ailleurs. C'est le seul mécanisme qui transforme « N agents qui écrivent » en « N agents dont les productions restent mutuellement cohérentes sans orchestrateur ». Non-gadget.
- **Convergence détectable (A6)** + **audit structurel (A4)** : réels et utiles ; mais *atteignables* aussi via event-sourcing (Rama) sans tout le reste — donc réels mais pas *uniques*.
- **Auto-sélection par préconditions (A3)** : réel et *supérieur* au volunteer-by-LLM des papiers blackboard, car décidable. C'est le gain le plus sous-estimé du modèle.

**Redondant / à interroger :**
- **« Spécialisation déclarative par règles » = vraiment plus que des agents à prompts/outils différents ?** En partie un repackaging. *Mais* un concept-set est *statiquement analysable* (on connaît les faits productibles et leurs gardes) là où un prompt+tools ne l'est pas. Le delta n'est pas « les agents diffèrent » (banal) mais « la différence est inspectable et compositionnelle ». Réel mais étroit — et nul si on ne construit pas l'outillage d'analyse.
- **Le maître/répliques à deltas filtrés (A5)** : bonne idée *théorique*, mais dans le code le sync est embryonnaire et le maître reste un goulot. Tant qu'il n'est pas durci, c'est une promesse, pas une affordance.

**Gadget / faux-ami :**
- **« La rétraction règle les conflits entre agents »** : faux. Elle règle les conflits *structurels* (prémisse retirée), pas *sémantiques* (deux conclusions valides opposées). Présenter la rétraction comme solution au merge multi-agent serait du marketing — c'est précisément le point où je refuse de suivre.

---

## 4. Conditions de succès & killer risks

### Conditions de succès
1. **Le problème doit être *dérivationnel*, pas *négociationnel*.** Le modèle gagne quand la coordination = « propager et invalider des faits » (enrichissement, pipelines d'analyse, planification contrainte, vérification croisée). Il perd quand elle = « négocier, voter, trancher des désaccords » — il n'a pas de protocole pour ça.
2. **Les faits doivent être *monotones-puis-rétractables*, pas *contradictoires-concurrents*.** L'idéal : chaque agent *ajoute* des faits dans une région typée distincte, les conflits ne surviennent que par *disparition de prémisse*. Dès que deux agents écrivent la *même* clé avec des valeurs concurrentes, il faut une couche de résolution sémantique que le moteur n'a pas.
3. **Débit modéré, cohérence/audit prioritaires.** Cas cibles : dizaines d'agents, écritures par secondes-minutes (recherche, due-diligence, génération de plans), pas milliers d'agents temps-réel.
4. **Outillage d'analyse statique des concept-sets construit** — sinon A3 reste théorique.

### Killer risks (par sévérité)
1. **(Critique) Conflit sémantique inter-agents non résolu.** Deux agents-LLM écrivent `Distance.inKm = 320` et `= 410` (ou pire, deux faits typés-différents mais incompatibles). LWW silencieux → incohérence non détectée → rétraction ne tire pas. C'est *le* mode d'échec n°1 du multi-agent 2025 (MAST taxonomy, mars 2025 ; « two agents think they own the same resource, making conflicting changes »). Sans couche de réconciliation (mediation agent, contraintes d'unicité, ownership par partition), le blackboard réactif *amplifie* le problème en le rendant invisible.
2. **(Critique) Goulot d'écriture sérialisé.** `pushMutation` sérialise (`_mutationThreadRunning` → file `_mutationThread`) et stabilize re-balaye les instables. Cohérence forte = débit plafonné = *ne scale pas en nombre d'écritures concurrentes*. Hors-sujet l'implémentation mono-fil ; mais le *choix de modèle* « écritures sérialisées dans le maître » est, lui, dans le périmètre, et c'est un plafond structurel.
3. **(Sérieux) Oscillation / non-terminaison sous écritures LLM non-déterministes.** Le point-fixe suppose la monotonie ; des providers-LLM qui réécrivent des faits différemment à chaque cycle peuvent faire osciller `ensure`/cast/uncast indéfiniment (cast → précondition d'un autre casse → uncast → re-cast…). La convergence (A6), atout sous règles déterministes, devient un risque sous LLM. À borner (budget de cycles, faits LLM gelés une fois écrits, séparation faits-bruts/faits-dérivés).
4. **(Sérieux) Coût de cohérence vs Anthropic.** Si le pattern gagnant est « isoler les contextes + agréger » (Anthropic, +90 %), l'état partagé réactif ajoute du couplage là où l'isolation gagnait. Risque de résoudre un problème que les meilleurs ont contourné.
5. **(Modéré) Repackaging non différencié.** Si l'outillage d'analyse statique des concept-sets n'est pas construit, « spécialisation déclarative » s'effondre en « prompts différents », et il ne reste qu'A2 pour justifier tout l'édifice — étroit.

### Dé-risquage minimal recommandé
- Imposer **ownership par partition** (un fait n'est inscriptible que par un concept-set) → supprime le risque 1 par construction, à coût d'expressivité.
- Séparer **faits-bruts (LLM, gelés)** et **faits-dérivés (règles, rétractables)** → borne le risque 3.
- Mesurer sur **un seul cas dérivationnel** (ex. vérification croisée multi-sources) si l'invalidation croisée bat un re-run LangGraph en *coût total* et en *cohérence* — c'est l'expérience qui tranche.

---

## 5. Sources (datées)

- DataCamp, *CrewAI vs LangGraph vs AutoGen* — comparatif état/message-passing. https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen (2025-2026)
- Pockit, *LangGraph vs CrewAI vs AutoGen — 2026 Guide* — state-dict, checkpoints v0.4, AutoGen 1.0 GA. https://pockit.tools/blog/langgraph-crewai-autogen-multi-agent-orchestration-guide/ (2026)
- ByteByteGo, *How Anthropic Built a Multi-Agent Research System* — « no shared mutable state », orchestrator-worker, +90,2 %. https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent (2025)
- ZenML LLMOps DB, *Building Production Multi-Agent Research Systems with Claude*. https://www.zenml.io/llmops-database/building-production-multi-agent-research-systems-with-claude (2025)
- OpenAI Agents SDK (docs) — Handoffs, context_variables, Sessions. https://openai.github.io/openai-agents-python/ ; Swarm (educational). https://github.com/openai/swarm (mars 2025)
- arXiv 2507.01701, *Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture*. https://arxiv.org/abs/2507.01701 (juil. 2025)
- arXiv 2510.01285, *LLM-Based Multi-Agent Blackboard System for Information Discovery in Data Science* — +13 % à +57 % vs master-slave, volunteer model. https://arxiv.org/abs/2510.01285 (v1 sept. 2025 ; v2 jan. 2026)
- notes.muthu.co, *Collaborative Problem-Solving with the Blackboard Architecture* (oct. 2025). https://notes.muthu.co/2025/10/collaborative-problem-solving-in-multi-agent-systems-with-the-blackboard-architecture/
- Red Planet Labs, *Rama programming model / dataflow / PStates*. https://redplanetlabs.com/programming-model ; https://redplanetlabs.com/docs/~/clj-dataflow-lang.html (2024-2025)
- AJ LaMarc, *Rama: a Storm is brewing*. https://www.ajlamarc.com/blog/2024-05-01-rama-storm/ (mai 2024)
- Velt, *CRDT Implementation Guide* (oct. 2025). https://velt.dev/blog/crdt-implementation-guide-conflict-free-apps ; Ian Duncan, *CRDT Dictionary* (nov. 2025). https://www.iankduncan.com/engineering/2025-11-27-crdt-dictionary/
- PowerSync, *Why Cinapse Moved Away From CRDTs For Sync* — limites pratiques, taille croissante. https://powersync.com/blog/why-cinapse-moved-away-from-crdts-for-sync (2025)
- arXiv 2602.19231, *Semantic Conflict Model for Collaborative Data Structures* — résolution implicite/opaque, non-supervisable. https://arxiv.org/pdf/2602.19231 (2026)
- Galileo, *Multi-Agent Coordination Gone Wrong* + *MAST failure taxonomy* (mars 2025) — « conflicting objectives », context collapse. https://galileo.ai/blog/multi-agent-coordination-strategies (2025)
- FutureAGI, *Why do multi-agent LLM systems fail — 2026 Guide*. https://futureagi.substack.com/p/why-do-multi-agent-llm-systems-fail (2026)

*Code interne lu : `App/Graph.js` (pushMutation, _revs, stabilize, isMaster/pushToMaster), `App/objects/Concept.js` (require/assert/ensure, applyTo/provider), `App/objects/Entity.js` (static_ensure, unCast cascade, set LWW), `App/tasks/stabilize.js` (point-fixe), `concepts/common/Edge/{Distance,Travel/LongTravel,Stay}.json`, `aetheris-graph/providers/travels/Skypicker.js` (provider → faits typés).*
