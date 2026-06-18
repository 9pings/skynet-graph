# Aspect — Cognition & gestion de contexte : l'orchestrateur à contexte resettable

> Étude critique, datée **mai 2026**. Périmètre strict : **cognition / ingénierie de contexte**. La thèse évaluée est précise : *le graphe typé EST l'état de travail de l'agent ; le prompt n'est qu'une **vue rendue à profondeur variable** du graphe (pas un transcript cumulatif) ; et l'orchestrateur est **à contexte resettable** — il peut vider sa fenêtre à volonté et reconstituer une vue fraîche depuis le graphe, parce que l'état durable vit dans le graphe, pas dans l'historique.*
> Sources primaires lues : `App/Graph.js`, `App/objects/Concept.js`, `App/objects/Entity.js`, `App/tasks/stabilize.js`, `concepts/common/*`, `doc/doc.md`, et `aetheris-graph/providers/travels/Skypicker.js`. L'analyse-moteur de `doc/*-study.md` est tenue pour fiable mais son **cadrage et son verdict ne sont PAS repris**. Les autres aspects (coordination multi-agents, calcul incrémental, modèle de programmation) sont traités ailleurs — je n'y touche pas.

---

## 0. Verdict d'intérêt sous cet aspect

**Intérêt RÉEL et au-dessus de la moyenne du bruit ambiant, mais sur un mécanisme précis et borné : le *reset propre*. Confiance : moyenne-haute (~68 %).**

La thèse centrale — *hard-reset de la fenêtre + reconstitution d'une vue typée à la demande* — est une réponse **bien posée** au problème n°1 des agents long-horizon de 2026 (le *context rot* mesuré par Chroma ; « le contexte est une ressource finie à rendement marginal décroissant » selon Anthropic, sept. 2025). Et elle l'attaque par un angle que l'industrie valide mais implémente *plus mollement* : externaliser l'état durable et **ne ramener dans la fenêtre que ce dont on a besoin, quand on en a besoin** (le « just-in-time retrieval » d'Anthropic, le « filesystem-as-memory » de Letta).

Ce que skynet-graph ajoute de propre n'est PAS « l'état hors fenêtre » (banal en 2026) ni « la vue à budget » (Aider l'a fait en 2023). C'est **la nature de l'état rendu** : un état **typé, structurellement cohérent et auto-maintenu**, dont la vue est une *requête* (`getChildPath`/`queryMaps`/`getRef`) et non un *résumé*. Conséquence directe et différenciante pour cet aspect : **un reset n'est plus une perte d'information mais une re-projection sans perte de l'état durable** — parce que ce qui doit survivre n'a jamais vécu dans le transcript.

MAIS trois réserves dures, développées en §3-§4 : (1) **rendre une vue reste une compression lossy** — on déplace le problème « quoi garder ? » de la compaction vers la *politique de rendu*, qui est absente du code ; (2) **le reset perd l'implicite** — le raisonnement non encore réifié en faits typés (hypothèses, « pourquoi on a écarté B ») s'évapore au reset, exactement le reproche frontal de Cognition (« la défaillance se ramène toujours à du contexte manquant ») ; (3) **qui décide la profondeur/sélection de la vue** est *le* problème dur, et le moteur le délègue silencieusement.

---

## 1. Ce que les affordances permettent d'unique (génératif)

Je pars des affordances vérifiées dans le code, j'en dérive ce qu'elles ouvrent *sous l'angle cognition/contexte*, sans me borner à l'existant.

**Affordances vérifiées (code), pertinentes pour cet aspect :**
- **État durable hors transcript** : tout l'état vit dans `_objById` (faits plats dans `Entity._`, `Graph.js mount` l.353-418), sérialisable à tout instant (`serialize` l.321-348). Le prompt n'est nulle part une structure de premier ordre du moteur — c'est exactement le point : **le moteur n'a pas de transcript**, il a un état.
- **Vue = requête, pas résumé** : `getChildPath(origin, …)` rend *la tranche de plan courante* (l.1440-1513) ; `getPaths(from,to)` rend tous les chemins entre deux nœuds (l.1522-1616) ; `queryMaps`/`selectMaps` sélectionnent par prédicat (l.1650-1708) ; `getRef` résout un chemin relatif depuis un focus (l.430-506). Quatre projecteurs, chacun paramétrable par **focus** et **filtre**.
- **Profondeur variable native** : `getChildPath` a un paramètre `forceNoTheoric`/`including` qui **déplie ou non les sous-chemins théoriques** (l.1465-1473) — autrement dit un *contrôle de zoom* structurel : montrer le plan au niveau « jalons » ou déplié étape par étape.
- **Reconstitution déterministe** : reconstruire une vue à partir de l'état est une opération **pure et reproductible** (mêmes faits → même vue), au contraire d'un résumé de compaction qui dépend du modèle et du moment.
- **Cohérence avant rendu** : `stabilize` (forward-chaining jusqu'au point fixe, `tasks/stabilize.js`) garantit qu'on ne rend jamais une vue d'un état à moitié dérivé — et la **rétraction réactive** (`ensure`→`unCast` cascade, `Entity.js` l.18-27 / l.193-247) garantit qu'un fait devenu faux a déjà disparu de l'état *avant* qu'on le projette dans le prompt.
- **Réintégration structurée des sous-agents** : un sous-agent exécute un path et réinjecte son résultat **comme faits typés** via `pushMutation` (le pattern réel est dans `Skypicker.js` : un provider renvoie un template de mutation `Theoric:true` + nodes/segments). Le résultat n'est pas un blob texte à recoller, c'est une mutation adressable.

### Usages dérivés (sous l'angle cognition uniquement)

**C1 — Le reset comme primitive de premier ordre, pas comme dernier recours.**
Dans les harnais 2026, vider la fenêtre (`/clear`) est *destructif* et la compaction (`/compact`) est *lossy* : on les subit quand on heurte 95 % de la fenêtre. Ici, l'orchestrateur peut resetter **quand il veut, sans angoisse**, parce que l'état n'était pas dans la fenêtre. *Affordance unique :* le reset devient une opération **cheap et idempotente** — « je jette ma fenêtre, je re-rends `getChildPath(focus, depth)`, je continue ». C'est la différence entre *oublier* (compaction) et *défocaliser puis re-regarder* (re-projection). **Réel — c'est le cœur de la thèse.**

**C2 — Vue adaptative à la tâche, pas au budget restant.**
Comme la vue est une requête, on peut rendre des vues *différentes* selon le sous-but : « le sous-plan courant déplié » pour exécuter, « tous les jalons » pour planifier, « tous les nœuds portant le fait X » pour vérifier un invariant. *Affordance unique :* le contenu du prompt suit **la structure de la tâche**, pas la chronologie de la conversation ni l'espace qu'il reste. **Réel.**

**C3 — Pas de dérive de résumé sur l'horizon long.**
La compaction itérée dégrade : résumé de résumé, oubli silencieux d'un fait *encore vrai*. La re-projection ne dérive pas : un fait encore présent dans l'état réapparaît à l'identique au tour 200 comme au tour 2. *Affordance unique :* **invariance temporelle de la mémoire de travail** pour tout ce qui a été réifié en faits. **Réel mais conditionnel** (cf. §3 : seulement pour ce qui *a été* réifié).

**C4 — Le reset comme purge active des distracteurs.**
Chroma (2025) montre que le *distractor interference* — du contenu plausible mais hors-sujet dans la fenêtre — dégrade activement. Un transcript accumule mécaniquement ces distracteurs (vieux tool-results, fausses pistes explorées). Le reset+re-projection **élimine par construction** tout ce qui n'est pas dans la vue courante. *Affordance unique :* la propreté du contexte n'est pas une discipline (microcompact, snip) mais une **conséquence structurelle** du fait que la vue est régénérée. **Réel — angle peu exploité ailleurs.**

**C5 — Mémoire de travail *typée et requêtable*, pas un sac de notes.**
Le « structured note-taking » d'Anthropic et le filesystem de Letta externalisent l'état… en fichiers libres (markdown, jsonl). Skynet-graph l'externalise en **état typé avec invariants** : on peut interroger « toutes les étapes Stay sans VendorStep » (`selectMapsId(["Stay"],["VendorStep"])`, vu dans `pushPath` l.1334) — une requête structurée impossible sur un sac de notes sans re-parsing LLM. *Affordance unique :* la mémoire externe est **machine-vérifiable et machine-requêtable**, pas seulement re-lisible. **Réel — c'est le delta le plus net de cet aspect.**

---

## 2. Confrontation aux systèmes nommés

### 2.1 vs compaction / auto-compact de Claude Code

C'est le concurrent frontal de la thèse. Claude Code gère la fenêtre finie par un **système à trois étages** (microcompact qui purge les tool-results périmés sans appel modèle ; full-compact qui résume tout via un appel modèle dédié ; session-memory-compact qui réutilise des notes pré-extraites), auto-déclenché vers ~95 % de la fenêtre (ClaudeLog/Morph, 2026).

- **Nature.** Les trois étages sont des **compressions d'un transcript** : on part de « tout ce qui a été dit » et on réduit. La re-projection part de « l'état actuel » et on **rend**. Différence *de nature*, pas de degré : la compaction répond « qu'est-ce que je peux jeter de ce qui a été dit ? », la re-projection répond « qu'est-ce que je dois montrer de ce qui est vrai ? ».
- **En quoi le reset bat la compaction.** (a) **Pas de dérive** : la compaction itérée résume des résumés ; la re-projection régénère depuis la source (C3). (b) **Pas d'oubli silencieux d'un fait encore vrai** : la compaction peut élider un fait toujours pertinent ; tant qu'il est dans l'état typé, la vue peut le ramener. (c) **Coût du reset ≈ nul côté modèle** : vider la fenêtre est gratuit, alors que le full-compact coûte *un appel modèle*. Le microcompact d'Anthropic « purge sans appeler le modèle » va dans le même sens — mais il ne purge que des *tool-results périmés*, pas n'importe quel distracteur ; le reset+re-projection est plus radical (C4).
- **En quoi la compaction reste devant.** (i) **Zéro build, zéro typage requis** : la compaction marche sur n'importe quelle conversation, sans qu'on ait à modéliser l'état en graphe typé. (ii) **Elle préserve l'implicite** que la re-projection perd : un bon résumé garde « on a écarté l'approche B parce que… », alors que la re-projection ne montre que ce qui a été réifié en faits (cf. §3, critique dure). (iii) **Maturité** : c'est en production, éprouvé, tandis que la « politique de rendu » de skynet-graph n'existe pas.

**Synthèse :** le reset bat la compaction *sur la dérive et la propreté*, perd *sur l'implicite et le coût de mise en place*. Le delta n'est net que si **l'état utile est massivement réifiable en faits typés** — sinon on re-projette un squelette et on reperd le reste par compaction de toute façon.

### 2.2 vs sous-agents à contexte isolé (Anthropic) et la critique de Cognition

Anthropic (sept. 2025) recommande des sous-agents à **fenêtre propre** qui renvoient un résumé condensé (1-2k tokens) à l'orchestrateur. Skynet-graph fait *mieux sur un point* : le sous-agent ne renvoie pas un **résumé texte** à recoller à la main, il renvoie une **mutation typée** réintégrée dans l'état et **rendue cohérente par stabilisation** (avec rétraction des branches que ce résultat invalide). La réintégration est *structurée*, pas *narrative*.

Mais Cognition (« Don't Build Multi-Agents », juin 2025) porte le **coup le plus dur à la thèse**, et il vise précisément le reset : *« la défaillance se ramène presque toujours à du contexte manquant »*, et leur règle n°1 est *« partager le contexte, et partager les traces complètes des agents, pas seulement des messages individuels »*. Or **le reset jette précisément la trace complète.** Si l'orchestrateur reset puis re-projette une vue typée, il reconstitue *l'état* mais pas *la trajectoire qui y a mené* — les hypothèses implicites, les essais écartés, le « pourquoi ». C'est l'angle mort exact que Cognition désigne. La réponse de skynet-graph ne peut être que : **réifier aussi la justification en faits typés** (`_origin`, `pathDescriptor`, des nœuds « décision » portant le rationale). C'est possible mais (a) ça gonfle l'état, (b) ça suppose que l'agent sache d'avance quoi réifier — un pari fort.

### 2.3 vs MemGPT/Letta (paging mémoire) et sleep-time compute

MemGPT/Letta traite la fenêtre comme une **mémoire virtuelle** (core/recall/archival, paging RAM↔disque par jugement du LLM). C'est la **même intuition que la thèse** — l'état durable vit dehors, on page dedans à la demande. Deux différences nettes :

- **Qui maintient la cohérence.** Letta page et **édite la mémoire par jugement du modèle** ; skynet-graph maintient la cohérence par **règles déterministes** (`ensure`/uncast). Pour la *mémoire de travail d'un plan à invariants*, le déterministe est plus sûr ; pour la *mémoire épisodique/conversationnelle*, le jugement du LLM est plus souple. Axes complémentaires.
- **Le benchmark de Letta tranche un point gênant.** « Is a Filesystem All You Need? » : sur LoCoMo, un agent + **simple filesystem** atteint 74 % et **bat des outils mémoire spécialisés** (Mem0 68,5 %), et conclut que *« les outils simples sont plus susceptibles d'être dans les données d'entraînement et donc mieux utilisés »* et que *« les graphes de connaissances peuvent gêner en étant plus durs à comprendre pour le LLM »*. **C'est un avertissement direct contre skynet-graph** : un état *typé et structuré* peut être un handicap si l'agent doit apprendre à le requêter, là où un fichier plat « passe » sans friction. La sophistication structurelle (C5) est un atout *seulement si* l'agent l'exploite mieux qu'un sac de notes — non garanti.

**Sleep-time compute** (Letta, avr. 2025) est le complément naturel de la thèse, pas un concurrent : un agent « sommeil » transforme du *raw context* en *learned context* hors ligne (~1/5 des tokens, +~15 % de réponses correctes). Appliqué ici : **la stabilisation/dérivation peut tourner en sleep-time** pour pré-cuire l'état (pré-calculer les branches, pré-réifier les justifications) afin que la re-projection au réveil soit riche *et* bon marché. C'est l'angle le plus prometteur pour atténuer la critique « le reset perd l'implicite » (§3) : réifier *pendant le sommeil* ce que le reset jetterait.

### 2.4 vs repo-map d'Aider (le précédent direct de « vue rendue à budget »)

Aider (oct. 2023) construit une **vue d'un graphe de symboles à budget de tokens** : tree-sitter extrait def/ref, PageRank classe par importance, recherche binaire ajuste au `map_tokens`. **C'est exactement « vue rendue, pas transcript », et c'est antérieur, mature, et en production.** La leçon qu'Aider impose à skynet-graph est dure : *le problème dur de la vue, ce n'est pas la navigation, c'est le ranking + le budget.* Skynet-graph sait **naviguer** (`getChildPath`, `getPaths`) et **filtrer** (`queryMaps`), mais **n'a ni score de pertinence ni budget de tokens** — l'applicabilité est booléenne (`isApplicableTo`), pas pondérée. Donc la primitive « rendre une vue » est là, mais **la moitié qui compte vraiment pour la cognition — décider *quoi* montrer dans un budget fini — est absente.** Avantage résiduel sur Aider : la vue n'est pas read-only (carte de code) mais **mutable et auto-cohérente** (un plan vivant qui se rétracte). Aider rend une carte ; skynet-graph rendrait un plan vivant — *s'il avait le ranking d'Aider*.

### 2.5 Tableau comparatif (axe cognition / gestion de contexte)

| Axe | skynet-graph (reset + re-projection de vue typée) | Claude Code (transcript + compaction 3 étages) | MemGPT/Letta (paging mémoire) | Aider repo-map | sleep-time compute |
|---|---|---|---|---|---|
| **Contexte = ?** | **Vue rendue d'un état typé** (requête, focus+filtre+profondeur) | Transcript compacté + notes + fichiers | Tiers mémoire pagés (core/recall/archival) | Vue de symboles à budget, **read-only** | Learned context pré-cuit hors ligne |
| **Le reset est…** | **Primitive cheap, idempotente, non destructive** | `/clear` destructif ; `/compact` lossy ; subi à ~95 % | Paging implicite par le LLM | N/A | N/A |
| **Anti-context-rot** | Re-projection ≠ résumé : pas de dérive ; purge les distracteurs par construction | Compaction lossy (micro/full/session) | Paging par jugement LLM | Ranking PageRank + budget | Réduit le contexte brut en amont |
| **Préserve l'implicite / la trace** | **Faible** : seul le réifié survit au reset (angle mort Cognition) | **Bon** (un bon résumé garde le « pourquoi ») | Moyen (dépend de l'auto-édition) | N/A | Bon (réifie en sommeil) |
| **Qui décide *quoi* montrer** | **Non résolu** : pas de ranking ni budget (delta manquant vs Aider) | Heuristiques de compaction matures | Le LLM | **PageRank + recherche binaire au budget** | Politique de pré-cuisson |
| **Mémoire requêtable structurée** | **Forte** (typée, `queryMaps`, invariants) | Faible (markdown/jsonl) | Moyenne (blocs) | Moyenne (graphe symboles) | — |
| **Risque « structure = handicap »** | **Réel** (cf. Letta : filesystem > KG) | Nul | Faible | Faible | — |
| **Coût de mise en place** | **Élevé** (modéliser l'état en graphe typé + écrire la politique de rendu) | **Nul** (adopter) | Faible (adopter) | Faible (adopter) | Moyen |
| **Maturité** | Quasi nulle (PoC) | Très haute | Haute | Haute | Émergente |

**Où le reset+re-projection bat vraiment l'existant :** un créneau net — **état de travail dense, fortement structuré et à invariants durs, sur horizon très long, où la dérive de résumé et l'accumulation de distracteurs sont le mode de panne dominant**. Là, « jeter la fenêtre et re-rendre un état typé cohérent » bat « résumer un transcript qui dérive ». Partout ailleurs, filesystem-as-memory + compaction font aussi bien pour zéro build, et le typage peut même nuire (Letta).

---

## 3. Réel vs redondant / gadget

**Réel et différenciant (à garder) :**
- **Le reset propre comme primitive (C1).** Vrai delta cognitif : transformer le reset de « dernier recours destructif » en « opération de routine bon marché » change la façon de piloter un agent long-horizon. Personne ne l'offre *aussi proprement*, parce que personne d'autre n'a fait du « l'état durable n'est jamais dans la fenêtre » une garantie *structurelle* plutôt qu'une discipline.
- **Mémoire de travail typée et requêtable (C5).** La vue est une requête sur un état vérifiable, pas un re-parsing d'un sac de notes. Delta réel sur Claude Code/Letta — *sous réserve* que l'agent exploite la structure (cf. risque Letta).
- **Invariance temporelle + purge des distracteurs (C3+C4).** Conséquences gratuites de la re-projection, qui adressent deux mécanismes précis du context rot mesuré par Chroma.

**Redondant (déjà fait, mieux ou plus simple, ailleurs) :**
- **« État hors transcript » en soi.** Banal en 2026 : structured note-taking (Anthropic), filesystem (Letta), CLAUDE.md, memory-bank. Ce n'est pas le delta — le delta est *la nature typée/cohérente* de l'état, pas le fait qu'il soit dehors.
- **« Vue rendue à budget ».** Aider l'a fait en 2023, avec le morceau qui manque ici (ranking + budget). Survendre la « vue rendue » de skynet-graph comme nouveauté serait faux.
- **Paging à la demande.** MemGPT depuis 2023.

**Gadget / survendu (à ne pas claironner) :**
- **« Reconstruction sans perte ».** Faux en l'état : la re-projection est **lossy par sélection** (on choisit focus+filtre+profondeur). On n'a pas supprimé la compression, on l'a **déplacée** de « résumer le passé » vers « choisir la vue » — et ce second problème n'est pas résolu dans le code (pas de ranking). Dire « le reset ne perd rien » est un *gadget rhétorique*.
- **« Le point-fixe garantit la cohérence de la vue ».** Vrai pour des providers déterministes ; avec des providers LLM, la stabilisation n'est plus une convergence déductive mais une boucle bornée par budget — la cohérence rendue est celle des *invariants écrits*, pas une cohérence sémantique globale.

---

## 4. Conditions de succès & killer risks

**Conditions de succès (cumulatives) :**
1. **L'état utile doit être massivement réifiable en faits typés.** Si 80 % de ce qui compte est de l'implicite (intuitions, rationale, nuances de formulation), le reset le jette et on retombe sur la compaction. Le créneau est : *plans/tâches à structure dure*.
2. **Il faut écrire la politique de rendu absente.** `renderView(focus, depth, filter) → contexte compact`, avec **ranking de pertinence et budget de tokens** (à emprunter à Aider : PageRank-like sur le graphe de plan + recherche binaire au budget). Sans elle, la thèse n'a qu'une moitié de sa primitive.
3. **Réifier la justification, pas seulement les faits.** Pour survivre au reset, le « pourquoi » doit devenir des nœuds/faits (décisions, alternatives écartées, hypothèses) — idéalement pré-cuits en **sleep-time compute**. Sinon, critique Cognition fatale.
4. **L'agent doit savoir requêter l'état typé aussi bien qu'il lit un fichier plat.** Sinon le bénéfice de C5 s'inverse (Letta : KG < filesystem).

**Killer risks (sous cet aspect) :**

1. **Le reset perd l'implicite — l'angle mort exact de Cognition.** *« La défaillance se ramène à du contexte manquant ; partagez les traces complètes, pas les messages. »* Le reset jette la trace. Si la justification n'est pas réifiée *avant* le reset, l'orchestrateur re-projeté agit sur un état cohérent mais **amnésique de ses propres raisons** — il peut re-proposer une piste déjà écartée, ou « ré-ouvrir » une décision close. C'est le risque n°1, et il est *intrinsèque* à la thèse, pas un défaut d'implémentation.

2. **La compression n'a pas disparu, elle a changé de nom — et le code ne la fait pas.** « Rendre une vue » suppose de décider focus/profondeur/filtre dans un budget fini : c'est *le* problème dur de la cognition d'agent (le ranking d'Aider), et `getChildPath`/`queryMaps` ne le résolvent pas (applicabilité booléenne, pas de score, pas de budget). Tant que la politique de rendu n'est pas écrite, **« reset + re-projection » est une promesse, pas un mécanisme** — et le moindre mauvais choix de vue rejoue le context rot (un fait crucial hors de la vue = « lost », un fait hors-sujet dedans = distracteur).

**Risques secondaires :** la structure typée comme handicap si l'agent la requête mal (Letta) ; coût cognitif de modéliser tout état utile en graphe (friction d'adoption) ; non-déterminisme LLM qui transforme la stabilisation en boucle bornée (la « cohérence rendue » se limite aux invariants explicites) ; tentation de re-projeter trop large « pour ne rien perdre », ce qui annule le bénéfice anti-rot.

**Dé-risquage minimal (1 spike) :** sur une tâche à 30+ étapes dépendantes, comparer à budget de tokens égal (a) transcript + compaction Claude Code, (b) reset + `getChildPath`+`queryMaps`, en mesurant : tokens injectés, **faits encore vrais oubliés**, **décisions re-rouvertes par amnésie** (le test décisif du risque n°1), et le **coût d'écrire le ranking**. Si (b) n'est pas nettement moins lossy *une fois la justification réifiée et le ranking écrit*, la thèse cognitive ne paie pas son build.

---

## 5. Sources (datées)

Context rot / fenêtre finie :
- Chroma, *Context Rot: How Increasing Input Tokens Impacts LLM Performance* (2025) — https://research.trychroma.com/context-rot ; toolkit https://github.com/chroma-core/context-rot
- Anthropic, *Effective context engineering for AI agents* (29 sept. 2025) — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (compaction, structured note-taking, sous-agents, just-in-time retrieval ; « contexte = ressource finie à rendement décroissant »)

Compaction Claude Code (concurrent frontal du reset) :
- *what-is-claude-code-auto-compact*, ClaudeLog (2026) — https://claudelog.com/faqs/what-is-claude-code-auto-compact/
- *Claude Code Compact: /compact, Micro Compact*, Morph (2026) — https://www.morphllm.com/claude-code-compact
- *Compaction*, Claude API Docs — https://platform.claude.com/docs/en/build-with-claude/compaction
- *Automatic context compaction*, Claude Cookbook — https://platform.claude.com/cookbook/tool-use-automatic-context-compaction

Sous-agents & critique « contexte manquant » :
- Cognition, *Don't Build Multi-Agents* (juin 2025) — https://cognition.ai/blog/dont-build-multi-agents (« share context, share full agent traces, not just individual messages »)

MemGPT/Letta & filesystem-as-memory :
- *MemGPT: Towards LLMs as Operating Systems* / Letta — https://www.letta.com/blog/agent-memory
- Letta, *Benchmarking AI Agent Memory: Is a Filesystem All You Need?* — https://www.letta.com/blog/benchmarking-ai-agent-memory (filesystem 74 % > Mem0 68,5 % LoCoMo ; « les KG peuvent gêner »)
- *Mem0 vs Letta vs MemGPT 2026* — https://tokenmix.ai/blog/ai-agent-memory-mem0-vs-letta-vs-memgpt-2026

Sleep-time compute (complément du reset) :
- Letta, *Sleep-time Compute* (avr. 2025) — https://www.letta.com/blog/sleep-time-compute ; repo https://github.com/letta-ai/sleep-time-compute

Vue rendue à budget (précédent direct) :
- Aider, *Building a better repository map with tree sitter* (oct. 2023) — https://aider.chat/2023/10/22/repomap.html

Code lu (sources primaires) :
- skynet-graph : `App/Graph.js` (`getChildPath` l.1440-1513, `getPaths` l.1522-1616, `queryMaps`/`selectMaps` l.1650-1708, `getRef` l.430-506, `serialize` l.321-348, `mount` l.353-418), `App/objects/Entity.js` (`static_ensure` l.18-27, `unCast` l.193-247), `App/objects/Concept.js` (`isApplicableTo` booléen l.205-228), `App/tasks/stabilize.js`, `concepts/common/*`, `doc/doc.md`
- aetheris-graph : `providers/travels/Skypicker.js` (provider → mutation typée `Theoric:true`)
- Analyse-moteur tenue pour fiable (cadrage/verdict NON repris) : `doc/graph-agent-substrate-study.md`, `doc/ai-roadmap-feasibility-study.md`
