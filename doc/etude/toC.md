# Aspect — Porter le moteur skynet-graph en C ou en WASM ?

*Évaluation critique mono-axe : le **port du cœur** du moteur (match de règles + cascade de rétraction
JTMS + évaluateur d'expressions + (dé)sérialisation) vers C, WASM, ou Rust→WASM, vu sous l'angle du
ratio valeur/risque. On juge le **bien-fondé stratégique** d'un port, pas l'hygiène d'implémentation
courante (mono-thread, balayage naïf, migration ESM en cours — hors-sujet, transitoire ou trivialement
remplaçable). Cognition/contexte, calcul incrémental pur et modèle de programmation sont traités dans
les autres études (`aspect-calcul-incremental.md`, `aspect-modele-programmation-fiabilite.md`) et
volontairement écartés ici. La charge de travail (agentique, pilotée par LLM) et le modèle du moteur
sont posés comme acquis — on ne les re-litige pas.*

---

## 0. Verdict + confiance

**Ne porte PAS le cœur en C/WASM POUR LA VITESSE — c'est résoudre le mauvais goulot.** La charge est
**I/O-bound, pas CPU-bound** : pour une charge agentique, le wall-clock est dominé par la latence des
appels modèle (100 ms à plusieurs secondes par appel), tandis que le cœur — match de règles + cascade
`ensure`/uncast + évaluation d'expressions jsep + sérialisation — s'exécute en **sub-milliseconde**.
Mesure empirique sur ce dépôt : les **107 tests** (stabilisation incluse, providers stubés, **aucun LLM
dans la boucle**) settlent en **`duration_ms` ≈ 194 ms cumulés** (node:test), wall-clock total ~1 s
avec le démarrage du process. Le cœur représente **bien moins de 1 % du wall-clock** d'un agent réel.
C'est l'analogue exact du « terminaison ≠ économie » de l'étude calcul-incrémental et du « cohérence ≠
vérité » de l'étude fiabilité : ici, **« vitesse du cœur ≠ vitesse de l'agent »**. Par Amdahl, accélérer
un composant qui pèse <1 % du temps total plafonne le gain global sous 1 % — un effort de réécriture
massif pour un speedup invisible. C'est le constat dominant et il est solide.

**MAIS** — et c'est la nuance qui empêche un « non » paresseux — il existe de **vraies** raisons de
porter qui n'ont **rien à voir avec la vitesse** : portabilité edge/navigateur, hermeticité/sandbox
capability-secure, densité mémoire (plus de sous-graphes par instance), et embarquabilité dans des hôtes
non-JS (Python/Go/Rust). Sur ces axes, un port a une valeur défendable. **Et la prémisse-clé du projet
les rend tractables :** si *tous* les providers deviennent génériques (template de concept → appel
modèle → faits typés en retour) et sont poussés au **bord** derrière une interface uniforme, le cœur
devient un **kernel pur et hermétique** (graphe de faits typés + matching + cascade + sérialisation,
**zéro closure hôte à l'intérieur**) avec une frontière I/O **étroite et message-shaped**. C'est
précisément la condition qui distingue « un cœur portable » d'« un cœur intransportable ». Et le
template générique de concept est lui-même une **IR (représentation intermédiaire) agnostique au
langage** — ce qui découple le langage-du-cœur du langage-des-providers, et **atténue l'urgence de
porter** (le format générique est *déjà* l'artefact cross-langage).

**Si** un besoin réel edge/navigateur/multi-tenant/embed-non-JS se matérialise : **préfère Rust → dual
natif+WASM** au C à la main (mémoire sûre sur un graphe pointer-heavy, `wasm-bindgen` pour la frontière,
et si tu veux l'incrémental *bien fait*, salsa/Adapton sont *déjà* en Rust). Et porte **seulement le
kernel pur**, providers restant au bord.

**Confiance :**
- **élevée (0,85)** sur « porter pour la vitesse = gadget Amdahl » (charge I/O-bound, mesure locale,
  littérature convergente esbuild/LLM-latence) ;
- **moyenne-élevée (0,7)** sur « la généricisation des providers est la condition *sine qua non* de la
  portabilité, et le template générique = IR portable » (déduit du code : aujourd'hui les providers sont
  des **closures hôte** appelées au milieu du cast — `providers[ns][fn](graph, concept, scope, argz,
  cb)`, Concept.js:172 ; donc le cœur *actuel* n'est PAS portable, et la prémisse est exacte) ;
- **moyenne (0,55)** sur l'**ampleur réelle** des bénéfices edge/densité — aucun requirement edge n'est
  posé aujourd'hui (R&D active, modèle mouvant : cf. `HANDOFF.md`), donc on parle d'options futures, pas
  de besoins présents ; le « réel » est conditionnel.

---

## 1. Affordances uniques (génératif — ce qu'un port *rend possible*, indépendamment du besoin actuel)

Ce qu'un cœur C/WASM *permet structurellement*, dérivé du modèle et non borné à l'existant :

**A1 — Deploy-anywhere : edge, navigateur, multi-tenant sandboxé.** Un kernel WASM tourne sur les
edge runtimes (Fastly Compute = vrai runtime WASM/Wasmtime ; Cloudflare Workers = isolats V8 qui
exécutent aussi du WASM), en navigateur (sans Node), et en bac à sable multi-tenant. Pour l'objectif de
**scalabilité/distribution** (dispatcher des sous-graphes `fork()` sur d'autres instances), un cœur
portable = on co-localise le raisonnement avec la donnée ou l'utilisateur, on instancie des sous-graphes
au plus près. C'est l'affordance la plus défendable. Un cœur Node-only ne l'a pas.

**A2 — Hermeticité / déterminisme du déclenchement / capability-security.** Un kernel WASM **pur** (tout
l'I/O au bord, imports-only par construction : « un module ne peut pas s'échapper du bac à sable sans
passer par les API appropriées » — webassembly.org/docs/security) donne une **sémantique de
déclenchement reproductible** dans un sandbox capability-secure (WASI : « démarre sans autorité
ambiante, ne fait que ce que l'hôte accorde explicitement » — wasi.dev). Cela renforce directement
l'auditabilité « Git for reasoning » (U6 de `MODELISATION.md`) et prolonge la discussion
hermétisme/Bazel de `aspect-calcul-incremental.md` : un cœur pur *est* hermétique au sens Bazel ; le
non-déterminisme (LLM, réseau) vit **entièrement** au bord, exactement là où il doit être. La rétraction
JTMS et la cascade deviennent **rejouables bit-à-bit** indépendamment de l'hôte.

**A3 — Densité mémoire / scale horizontal.** Une arène C/WASM pour le graphe de faits (records `_etty._`
en mémoire linéaire packée plutôt qu'objets JS sur le heap V8 + overhead par-objet du GC) → **plus de
sous-graphes par instance**, donc plus de densité de scale horizontal. Pour un substrat censé tenir
« une path live par source d'info × sous-paths par problème actif » (le régime standing/`ActiveProblem`,
MODELISATION §N10), la densité mémoire devient un vrai levier de coût d'infrastructure.

**A4 — Embarquabilité multi-langage.** Un cœur C/WASM s'embarque dans des hôtes **Python, Go, Rust,
Java, .NET…** (via N-API/`napi-rs` pour Node, ou Wasmtime/Extism comme plugin universel pour tout hôte),
pas seulement Node. Cela élargit la portée « bibliothèque » du moteur : un moteur de raisonnement
embarquable dans un service Python ou un binaire Go, sans réimplémenter le JTMS. Le **template générique
de concept** (l'IR) est ce qui rend ça cohérent : l'hôte parle providers dans *son* langage, le kernel
parle faits typés dans *le sien*, la frontière est l'IR.

**A5 — Parallélisme de sous-graphes (nuancé, faible gain).** La boucle est mono-thread JS, couplée à
l'event-loop (`setTimeout`-driven, stabilize.js / `_loopTF`). Un cœur natif *pourrait* threader la
stabilisation de **sous-graphes indépendants** (les `fork()` sont déjà des graphes isolés — candidat
naturel au parallélisme data-isolé). **Mais** : (i) la charge est I/O-bound, donc le parallélisme du
*cœur* ne déplace pas le goulot (les appels LLM, eux, parallélisent déjà au niveau hôte sans toucher au
cœur) ; (ii) les threads WASM sont limités — pas d'instruction de spawn en core WASM (« la création de
threads est déléguée à l'embedder »), shared memory via `SharedArrayBuffer` exigeant l'isolation
cross-origin (COOP/COEP), et `wasi-threads` est désormais *legacy* (successeur `shared-everything-threads`
en Phase 1, non shippé mi-2026). **Affordance réelle mais marginale** : le parallélisme utile (appels
modèle concurrents) ne nécessite **pas** un port — il se fait au bord, en JS, aujourd'hui.

> **Honnêteté générative.** A1–A4 sont de vraies affordances *structurelles* d'un port. Mais aucune
> n'est un *besoin posé* du projet aujourd'hui (pas de requirement edge/navigateur/embed-non-JS dans
> `HANDOFF.md`). Ce sont des **options futures à valeur conditionnelle**, pas des gains présents. A5 est
> à moitié un gadget (le parallélisme qui compte est déjà au bord).

---

## 2. Confrontation nommée + tableau

On confronte le port C/WASM aux **alternatives qui visent les mêmes objectifs** (scale, portabilité,
perf) sans payer le coût d'une réécriture du cœur.

**C natif (FFI/N-API).** Vitesse maximale, mais : perte de l'écosystème JS (l'event-loop, les deps
`jsep`/`deepmerge`/`shortid`, le tooling), gestion mémoire **manuelle** d'un graphe **dynamique
pointer-heavy** (`_objById`, `refMap`, `_followersByConceptName`, cast/uncast récursif — Entity.js) =
quasi-réimplémenter un GC, risque mémoire élevé (use-after-free sur rétraction en cascade = cauchemar).
Pour embarquer dans Node, N-API est ABI-stable et mûr (`napi-rs` v3, 2025, prod chez SWC/Rspack/Oxc),
**mais la frontière n'est pas gratuite** : `bun:ffi` mesure N-API à 2–6× plus lent qu'un FFI natif
optimisé, plus le fardeau manuel de gestion mémoire/handle-scopes. **C à la main sur un graphe dynamique
= le pire choix : tout le risque mémoire, sans la portabilité WASM ni la sûreté Rust.**

**WASM (depuis C/Rust/AssemblyScript).** Portable, sandboxé, near-native. **MAIS le coût de
franchissement de frontière JS↔WASM est le piège central pour CE moteur.** Le bord effectful = les
**providers**, appelés **fréquemment** (chaque `applyTo` d'un concept à provider traverse la frontière :
JS lit le scope → appelle le provider → renvoie un mutation-template → le cœur l'applique). Or :
(i) seuls les nombres traversent à coût nul ; **strings/objets/JSON doivent être copiés/sérialisés dans
la mémoire linéaire** (« pour passer des strings… il fallait les transformer en tableau de nombres et
inversement » — Mozilla Hacks 2019) ; (ii) le marshaling est « un coût omniprésent payé à la frontière
même quand les appels sont rapides » (Mozilla Hacks 2026) ; (iii) microbenchmark : wrapper la donnée en
JsValue ≈ **14× plus lent** que l'accès pointeur brut (wasm-bindgen #2741). Le moteur échange des
**mutation-templates JSON** à chaque apply — exactement le cas pathologique. **Si chaque concept-apply
traverse la frontière avec marshaling JSON, l'overhead peut DOMINER, voire rendre le port plus LENT que
le JS pur** — précisément le constat d'Evan Wallace sur esbuild-wasm : « la version WebAssembly est
beaucoup, beaucoup plus lente que la native… souvent un ordre de grandeur (10×) ». Le **seul** moyen de
neutraliser ce risque : la prémisse-clé — providers génériques au bord, frontière **message-shaped à
gros grain** (un RPC de template par appel modèle, pas un aller-retour JS↔WASM par micro-opération).

**Rust → dual natif+WASM (le chemin moderne « write once »).** C'est ce qu'on **recommande si on porte**.
Mémoire **sûre** sur un pointer-graph (pas de GC manuel à écrire, l'ownership gère cast/uncast),
`wasm-bindgen` gère la glue (strings/structs/closures), un seul code-base cible **natif ET WASM**. La
filière a fait ses preuves sur exactement ce profil de réécriture JS→systems-lang : **SWC** (17–20×
Babel, adopté par Next.js 12), **Ruff** (10–100× les linters Python), **Biome** (ex-Rome, >96% compat
Prettier), **Oxlint** (50–100× ESLint). Bonus décisif : **salsa** (le framework de calcul incrémental de
rust-analyzer, red-green algorithm) et **Adapton** (PLDI 2014) sont **tous deux en Rust** — si tu veux
l'incrémental demand-driven *industriel* (cf. `aspect-calcul-incremental.md`), tu l'as quasi-gratis en
portant vers Rust, au lieu de le réimplémenter en JS. **Réserve d'honnêteté** : le rustwasm WG a été
sunset (org archivée sept. 2025), `wasm-pack` est stale (dernière release mai 2024) ; mais
`wasm-bindgen` reste très actif (v0.2.125, juin 2026) et les cibles `wasm32-*` sont Tier-2 healthy. La
filière *langage* est saine ; le tooling *communautaire* a perdu son groupe central.

**AssemblyScript (TS-like → WASM).** Friction de portage faible *en apparence* (syntaxe proche du TS du
moteur), **mais immature** : 0.x après ~9 ans (jamais 1.0), GC **maison** en mémoire linéaire (n'a
**pas** adopté WasmGC pourtant shippé fin 2023 — Chrome 119/Firefox 120), closures non implémentées,
équipe ~2 mainteneurs bénévoles, adoption concentrée Web3. **À écarter** pour un cœur sérieux : on
hériterait d'un GC immature pour gérer l'arène du graphe, et l'écosystème ne suit pas.

**Alternatives au port (les vrais concurrents — viser le même objectif sans réécrire le cœur) :**

- **(a) Optimiser l'algo de matching en JS (Rete/TREAT/PHREAK).** **Le plus gros gain algorithmique
  disponible**, et il n'exige aucun port. Le matching actuel est un **balayage naïf** `O(objets ×
  concepts-ouverts)` par cycle (MODELISATION §2.3, « pre-Rete/naive »), pas une maintenance incrémentale
  de réseau de jointures. Rete (Forgy 1982) « sacrifie la mémoire pour la vitesse », stocke les
  appariements partiels, et est « plusieurs ordres de grandeur » plus rapide que le naïf, **indépendant
  du nombre de règles**. **Preuve directe que le langage n'est pas le levier : CLIPS est écrit en C et
  repose quand même sur Rete** — un langage rapide ne dispense PAS du matching incrémental. Drools a même
  dépassé Rete avec **PHREAK** (lazy, goal-oriented) en jugeant l'eagerness de Rete coûteuse à l'échelle.
  Si la stabilisation devenait un jour le goulot (elle ne l'est pas aujourd'hui, cf. §0), **l'algo bat le
  langage d'un ordre de grandeur, à coût et risque bien moindres qu'un port.**
- **(b) `worker_threads` / `cluster` pour scaler.** Pour la densité/parallélisme de sous-graphes
  isolés, scaler le moteur JS via `worker_threads` est **bien moins cher** qu'un port — et c'est
  d'ailleurs la direction « live/standing » déjà sur la roadmap. Chaque worker = un graphe ou un pool de
  `fork()`. Time-to-value immédiat, zéro risque de régression du JTMS.
- **(c) Artefact single-file (esbuild/bundle).** Pour *expédier* le moteur (le rendre embarquable,
  léger, deploy-friendly) sans port, un bundle single-file via esbuild suffit. Couvre une partie de
  l'objectif « bibliothèque embarquable » sans toucher au langage. (N.B. le build actuel est layer-pack/
  webpack ; un artefact esbuild serait un gain de simplicité orthogonal.)

| Option (datée) | Objectif visé | Effort | Gain réel | Risque de régression | Time-to-value | Verdict |
|---|---|---|---|---|---|---|
| **Rester JS + Rete/TREAT/PHREAK** | Vitesse du cœur | Moyen | **Ordre de grandeur** sur le match (si jamais goulot) | Moyen (réécrire le matcher) | Moyen | **Le vrai levier perf** — mais le cœur n'est pas le goulot |
| **Rester JS + worker_threads/cluster** | Scale/densité/parallélisme | Faible | Réel (scale horizontal, sous-graphes isolés) | **Faible** | **Immédiat** | **Le scale sans le risque** (P5) |
| **Rester JS + bundle esbuild** | Embarquabilité/deploy | Très faible | Modéré (artefact propre) | Très faible | Immédiat | Quick-win orthogonal |
| **Rust → dual natif+WASM (kernel pur)** | Edge/embed-non-JS/densité/hermeticité | **Élevé** | Réel **SI** besoin edge/embed posé | **Élevé** (réécrire JTMS+stabilize) | Lent | **Le bon chemin SI on porte** — après généricisation providers |
| **WASM depuis C** | idem | Élevé | idem, **moins sûr** | **Très élevé** (mémoire manuelle + frontière) | Lent | À éviter (Rust domine) |
| **C natif (N-API)** | Vitesse max | Élevé | Vitesse mais I/O-bound ⇒ invisible | Très élevé | Lent | **Gadget Amdahl** + risque mémoire |
| **AssemblyScript** | Port « facile » | Faible-moyen | Faible (GC/écosystème immatures) | Moyen | Moyen | À écarter |

---

## 3. Réel vs redondant / gadget

**Réel (valeur défendable d'un port) :**
- **Portabilité edge/navigateur/multi-tenant (A1)** et **embarquabilité multi-langage (A4)** : un kernel
  WASM tourne là où Node ne tourne pas, et s'embarque où Node ne s'embarque pas. C'est un *vrai*
  élargissement de surface de déploiement, pas un confort.
- **Hermeticité/capability-security (A2)** : un cœur pur WASM, tout l'I/O au bord, *est* hermétique et
  sandboxé — un renfort réel de l'auditabilité et de la sécurité multi-tenant, aligné sur la discussion
  Bazel de l'étude incrémentale.
- **Densité mémoire (A3)** : si/quand l'empreinte par sous-graphe devient la limite de scale, une arène
  packée est un vrai levier de coût.
- **Le constat structurel le plus important** : **la prémisse-clé est correcte et load-bearing.** Le cœur
  *actuel* n'est PAS portable (providers = closures hôte au milieu du cast). La **généricisation des
  providers** transforme le cœur en kernel pur à frontière étroite — *c'est elle*, pas le port, qui crée
  la portabilité. Et le **template générique = IR portable** déjà cross-langage. Donc : le travail à
  haute valeur est **la généricisation + la définition de l'ABI de template**, *avant et indépendamment*
  de tout port — et ce travail est utile **même si on ne porte jamais**.

**Redondant / déjà couvert autrement (pas un edge du port en soi) :**
- **Le scale/parallélisme** est couvert, bien moins cher, par `worker_threads`/`cluster` sur le moteur
  JS (sous-graphes isolés). Le port n'est pas requis pour scaler horizontalement.
- **L'embarquabilité légère** est partiellement couverte par un bundle esbuild single-file.
- **L'accélération du matching** (le seul vrai gain CPU disponible) est un problème **algorithmique**
  (Rete/PHREAK), résolu *en JS*, pas un problème de langage. Porter en C sans changer le balayage naïf
  garderait le même algo O(objets×règles) — on déplacerait un mauvais algorithme dans un langage rapide.

**Gadget / risque de survente :**
- **« Le C/WASM est plus rapide » comme motivation** est le gadget central, **réfuté par Amdahl** : la
  charge est I/O-bound (latence LLM ≫ stabilisation sub-ms ; 107 tests en ~194 ms sans LLM). Accélérer
  <1 % du wall-clock plafonne le gain sous 1 %. C'est l'analogue « vitesse du cœur ≠ vitesse de l'agent »
  des verdicts des autres études. **Et le piège est plus vicieux que neutre** : un port WASM *naïf* (sans
  frontière à gros grain) peut être **plus lent** que le JS, par le coût de marshaling JSON à chaque
  concept-apply (cf. esbuild-wasm 10× plus lent, JsValue 14× plus lent — §2).
- **Porter maintenant** est prématuré : le modèle du moteur **bouge encore** (R&D active, self-mod et
  authoring déclaratif tout juste mécaniquement complets — `HANDOFF.md`). Figer un moteur en exploration
  dans un cœur natif = geler une cible mouvante (K3 ci-dessous).
- **« MOE/MOE Graph en WASM pour la perf »** : aucun rapport avec WASM ; le différenciateur du moteur est
  le JTMS+incrémental (cf. les deux autres études), pas le langage d'implémentation.

---

## 4. Conditions de succès & killer risks

**Conditions de succès (là où un port vaut son coût) :**
1. **Un besoin edge/navigateur/multi-tenant *réel et posé*** — pas hypothétique. Tant qu'aucun
   requirement « tourner au edge / en navigateur / sandboxé multi-tenant » n'existe, le port résout un
   problème que personne n'a.
2. **Un besoin d'embed dans un hôte non-JS** (service Python/Go/Rust qui doit raisonner sans
   réimplémenter le JTMS) — l'argument A4, le plus susceptible de devenir réel pour une bibliothèque.
3. **La densité/empreinte mémoire devient la limite de scale** — le régime standing/`ActiveProblem` à
   grande échelle pourrait l'atteindre ; pas avant.
4. **ET — condition *sine qua non* transverse — les providers sont DÉJÀ génériques.** Sans la
   généricisation complète (frontière I/O = RPC de template générique propre, message-shaped, à gros
   grain), la **surface de port est énorme** (il faudrait porter aussi tout l'effectful, ce qui est
   absurde) **et** le port serait dominé par l'overhead de frontière (K1). La prémisse-clé n'est pas un
   *nice-to-have* : c'est le **prérequis dur** qui rend le port tractable *et* performant.
5. **ET le modèle du moteur est stabilisé** — on ne porte pas une cible en exploration active.

**Killer risks :**
- **K1 — Overhead de frontière JS↔WASM pour des providers fréquents (le risque dominant et spécifique).**
  Les providers traversent la frontière à *chaque* concept-apply, en échangeant des mutation-templates
  **JSON**. Strings/objets exigent un copy+transcodage UTF-16↔UTF-8 dans la mémoire linéaire ; le
  marshaling est « un coût omniprésent même quand l'appel est rapide » (Mozilla 2026) ; JsValue ≈ 14×
  l'accès brut. **Si la frontière reste fine-grain, l'overhead DOMINE — le port peut être plus lent que
  le JS** (esbuild-wasm : 10× plus lent). *Mitigation : la prémisse-clé* — frontière message-shaped à
  gros grain (un RPC de template par appel modèle), providers au bord, kernel pur dedans. Sans elle, K1
  tue le port.
- **K2 — Graphe dynamique pointer-heavy + marshaling JSON vs mémoire-linéaire/no-GC.** Le cœur est un
  graphe d'objets dynamiques (`_objById`, `refMap`, watchers, cast/uncast récursif) + une sérialisation
  `JSON.stringify` des records `_etty._`. Le modèle WASM MVP est une **mémoire linéaire sans GC natif**
  (le langage apporte son allocateur/GC). Réimplémenter l'arène du graphe + la (dé)sérialisation à la
  frontière = **gros effort**, et c'est *exactement* le terrain où Rust gagne (ownership ≈ GC-free safe)
  et où C perd (mémoire manuelle sur rétraction en cascade = use-after-free). WasmGC (shippé fin 2023)
  *aide* si on cible un langage GC, mais ajoute sa propre complexité. **Mitigation : Rust, jamais C ;
  garder la sérialisation au bord (l'hôte JSONifie, le kernel travaille sur l'arène).**
- **K3 — Figer une cible mouvante.** Porter **gèle** un moteur encore en R&D active (self-mod, authoring
  déclaratif, régime standing — tout juste posés). Chaque évolution du modèle devrait alors être
  re-portée. **Mitigation : ne porter qu'APRÈS stabilisation du modèle** ; d'ici là, le format générique
  (l'IR) capture déjà la portabilité conceptuelle sans figer l'implémentation.
- **K4 — Régression d'un JTMS+stabilisation subtil.** Le HANDOFF §3 documente **15 gotchas durement
  acquis** (self-flag obligatoire sous peine de re-fire infini ; `$$` double pour les refs globales ;
  arrays REPLACE sur update → `{__push}` race-free ; `assert` vs `ensure` defeasance ; chemins de
  rétraction « fiables vs flaky » ; re-entrancy mid-stabilize ; apply-ceiling backstop…). Réécrire la
  cascade `ensure`/uncast + la boucle `_loopTF` + l'évaluateur d'expressions dans un autre langage =
  **fort risque de réintroduire chacun de ces bugs**, dont plusieurs ont coûté de vrais cycles de debug.
  **Mitigation : porter sous filet de la suite de tests (107 verts) comme oracle de caractérisation —
  mais le risque résiduel reste élevé sur les comportements subtils non couverts.**

---

## 5. Recommandation étagée (opiniâtre)

1. **NE porte PAS pour la vitesse.** Jamais. Charge I/O-bound ⇒ gadget Amdahl ⇒ gain <1 %, risque de
   régression du JTMS, et risque réel de port *plus lent* (frontière). Si un jour le cœur devient le
   goulot (il ne l'est pas), le levier est **algorithmique en JS (Rete/TREAT/PHREAK), pas le langage** —
   CLIPS-en-C le prouve.
2. **En attendant un besoin réel, capture la scalabilité sans porter :** moteur **JS + `worker_threads`/
   `cluster`** (scale/densité de sous-graphes isolés, la direction live/standing déjà prévue) **+
   artefact esbuild single-file** (embarquabilité/deploy). C'est **l'essentiel de la valeur de scale,
   sans le risque de réécriture.**
3. **Fais le travail qui crée la portabilité — *avant et indépendamment* de tout port :**
   **généricise complètement les providers** (template de concept → appel modèle → faits typés) et
   **définis l'ABI du template générique** (l'IR). Ce travail est utile en soi (uniformise l'effectful,
   renforce le canonicalization barrier K1 de l'étude incrémentale), et il est le **prérequis** de
   n'importe quel port futur. **L'IR de template est déjà l'artefact portable** — ce qui à la fois
   renforce le chemin « porte le kernel pur, garde les providers au bord » *et* atténue l'urgence de
   porter (le format est déjà cross-langage).
4. **SI — et seulement si — un besoin réel edge/navigateur/multi-tenant/embed-non-JS se matérialise, ET
   le modèle moteur est stabilisé, ET les providers sont déjà génériques :** réimplémente **SEULEMENT le
   kernel pur** (match + cascade `ensure`/uncast + `expr.js` + serialize) en **Rust → dual natif+WASM**,
   derrière l'ABI de template, **providers restant au bord** (JS/hôte). Préfère Rust au C (mémoire sûre
   sur le pointer-graph, `wasm-bindgen` pour la frontière, salsa/Adapton en Rust si tu veux l'incrémental
   industriel). Frontière **message-shaped à gros grain** (un RPC de template par appel modèle) pour
   neutraliser K1. Filet de la suite de tests comme oracle.

**En une phrase :** le port n'est ni un « oui » ni un « non » — c'est un **« pas maintenant, pas pour la
vitesse, pas en C, et seulement le kernel pur derrière une frontière générique »** ; le travail qui en
crée la valeur (généricisation des providers + IR de template) doit être fait *de toute façon*, et il
rend le port à la fois *possible* et *moins urgent*.

---

## 6. Sources (datées)

**Amdahl / nature I/O-bound de la charge (le constat dominant)**
- Mesure locale (ce dépôt, 2026-06-22) : `npm test` → **107/107 verts, `duration_ms` ≈ 194 ms** (node:test,
  stabilisation incluse, providers stubés, aucun LLM dans la boucle). Wall-clock total ~1 s avec démarrage process.
- Amdahl's law — borne du speedup par la fraction non accélérée — https://en.wikipedia.org/wiki/Amdahl%27s_law (consulté 2026-06)
- Latence dominée par l'inférence LLM (100 ms–s par appel) : ordre de grandeur établi, cf. analyses de coût/latence
  des agents dans `aspect-calcul-incremental.md` (prompt caching −85% latence sur longs prompts, Anthropic) —
  https://platform.claude.com/docs/en/build-with-claude/prompt-caching

**Coût de frontière JS↔WASM & marshaling (K1)**
- Lin Clark, *Calls between JavaScript and WebAssembly are finally fast*, Mozilla Hacks, **2018-10-08** —
  https://hacks.mozilla.org/2018/10/calls-between-javascript-and-webassembly-are-finally-fast-%F0%9F%8E%89/
- *WebAssembly Interface Types: Interoperate with All the Things!*, Mozilla Hacks, **2019-08-21** (seuls les
  nombres traversent à coût nul ; strings/objets = copie dans la mémoire linéaire) —
  https://hacks.mozilla.org/2019/08/webassembly-interface-types/
- *Making WebAssembly a first-class language on the Web*, Mozilla Hacks, **2026-02-26** (« le marshaling est un coût
  omniprésent payé à la frontière même quand les appels sont rapides » ; −45% durée DOM-update en retirant la glue) —
  https://hacks.mozilla.org/2026/02/making-webassembly-a-first-class-language-on-the-web/
- wasm-bindgen issue #2741, **2021-12-19** (microbenchmark : `Vec<JsValue>` ≈ 14× l'accès pointeur brut ;
  informel, l'auteur flag son incertitude) — https://github.com/rustwasm/wasm-bindgen/issues/2741
- V8 blog, *Speculative Optimizations for WebAssembly*, **2025-06-24** (l'overhead administratif d'appel domine pour
  les petits callees ; inlining à travers la frontière JS↔WASM en projet) — https://v8.dev/blog/wasm-speculative-optimizations

**Modèle mémoire WASM, WasmGC, threads (K2, A5)**
- WebAssembly.org FAQ — mémoire linéaire, pas de GC en core WASM — https://webassembly.org/docs/faq/
- V8 blog, *A new way to bring GC languages to WebAssembly* (WasmGC), **2023-11-01** —
  https://v8.dev/blog/wasm-gc-porting ; Chrome 119 (2023-10-31, https://developer.chrome.com/blog/wasmgc),
  Firefox 120 (2023-11-21)
- WebAssembly/threads Overview (Phase 4 ; pas de spawn en core, délégué à l'embedder) —
  https://github.com/WebAssembly/threads/blob/main/proposals/threads/Overview.md
- WebAssembly/wasi-threads README (désormais **legacy** ; successeur `shared-everything-threads` en Phase 1) —
  https://github.com/WebAssembly/wasi-threads ; https://github.com/WebAssembly/shared-everything-threads
- MDN *SharedArrayBuffer* (réactivation post-Spectre exige COOP/COEP), maj **2026-02-10** —
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer

**Rust → WASM, edge runtimes, salsa/Adapton (le chemin recommandé)**
- *wasm-bindgen* (actif, v0.2.125, **2026-06-12**) — https://github.com/wasm-bindgen/wasm-bindgen
- *Sunsetting the rustwasm GitHub org*, Inside Rust Blog, **2025-07-21** (WG sunset ; wasm-pack stale) —
  https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org/
- Cibles WASI Rust : `wasm32-wasip1`/`wasm32-wasip2`, Rust 1.78, **2024-04-09** —
  https://blog.rust-lang.org/2024/04/09/updates-to-rusts-wasi-targets/ ; wasip2 Tier-2, **2024-11-26** —
  https://blog.rust-lang.org/2024/11/26/wasip2-tier-2/
- *salsa* (incrémental de rust-analyzer, red-green ; v0.27.0 **2026-06-04**) — https://github.com/salsa-rs/salsa ;
  port rust-analyzer→salsa 3.0 terminé **2025-03-17** — https://salsa-rs.github.io/salsa/overview.html
- Adapton, *Composable, Demand-Driven Incremental Computation*, PLDI 2014 (impl. Rust `adapton.rust`, dormante depuis 2019) —
  https://github.com/Adapton/adapton.rust
- Fastly Compute (vrai runtime WASM/Wasmtime, ex-Lucet <50µs d'instanciation) — https://docs.fastly.com/products/compute ;
  *Announcing Lucet*, **2019-03-28** — https://www.fastly.com/blog/announcing-lucet-fastly-native-webassembly-compiler-runtime
- Cloudflare Workers (isolats V8 exécutant aussi du WASM), *Native Rust support*, **2021-09-09** —
  https://blog.cloudflare.com/workers-rust-sdk/ ; WASI on Workers, **2022-07-07** — https://blog.cloudflare.com/announcing-wasi-on-workers/
- WASI 0.2 / Preview 2 (basé sur le Component Model), Bytecode Alliance, **2024-01-25** —
  https://bytecodealliance.org/articles/WASI-0.2 ; *The Road to Component Model 1.0*, **2026-06-08** —
  https://bytecodealliance.org/articles/the-road-to-component-model-1-0
- Component Model + WIT (l'IR/IDL agnostique au langage) — https://component-model.bytecodealliance.org/

**Exemples de ports JS→Rust/WASM & contre-exemple esbuild-en-Go**
- SWC : *Performance Comparison of SWC and Babel*, **2020-01-31** — https://swc.rs/blog/perf-swc-vs-babel ;
  Next.js 12 (« compilation Rust 17× plus rapide que Babel »), **2021-10-26** — https://nextjs.org/blog/next-12
- Ruff (Astral) : « 10–100× plus rapide que Flake8/Black » — https://github.com/astral-sh/ruff ;
  *Ruff: a fast Python linter*, LWN, **2023-04** — https://lwn.net/Articles/930487/
- Biome (ex-Rome) : *Announcing Biome*, **2023-08-29** — https://biomejs.dev/blog/announcing-biome ;
  >96% compat Prettier, **2023-11-27** — https://biomejs.dev/blog/biome-wins-prettier-challenge
- Oxlint/OXC : « 50–100× ESLint », stable 1.0 juin 2025 — https://oxc.rs/
- **esbuild (contre-exemple Go, anti-WASM) :** FAQ *Why is esbuild fast?* (Go natif, parallélisme, mémoire partagée
  entre threads) — https://esbuild.github.io/faq/ ; Getting Started (« la version WebAssembly est beaucoup, beaucoup
  plus lente que la native… souvent un ordre de grandeur (10×) ») — https://esbuild.github.io/getting-started/ ;
  Evan Wallace, HN #22336284, **2020-02-15** (« Go compilait ~100× plus vite que Rust et tournait ~10% plus vite… GC sur
  un autre thread ») — https://news.ycombinator.com/item?id=22336284 ; GitHub issue #189, **2020-06-20** —
  https://github.com/evanw/esbuild/issues/189

**AssemblyScript (à écarter)**
- *The AssemblyScript Book* (variante de TS, GC maison en mémoire linéaire, closures non implémentées) —
  https://www.assemblyscript.org/introduction.html ; status — https://www.assemblyscript.org/status.html
- RedMonk, *Wasm's Identity Crisis*, **2025-10-17** (WasmGC shippé érode la niche d'AssemblyScript) —
  https://redmonk.com/kholterhoff/2025/10/17/wasms-identity-crisis/

**Algorithme de matching (l'alternative au port — Rete/TREAT/PHREAK)**
- Forgy, C.L., *Rete: A Fast Algorithm for the Many Pattern/Many Object Pattern Match Problem*, **Artificial
  Intelligence 19(1):17–37, 1982**, DOI 10.1016/0004-3702(82)90020-0 — https://en.wikipedia.org/wiki/Rete_algorithm
  (sacrifie la mémoire pour la vitesse ; indépendant du nombre de règles ; « plusieurs ordres de grandeur » vs naïf)
- Miranker, D.P., *TREAT: A Better Match Algorithm for AI Production Systems*, **AAAI-87, août 1987, pp. 42–47** (ne
  stocke pas les beta-memories ; moins de mémoire ; « >50% plus rapide que Rete » sur 5 programmes OPS5) —
  https://aaai.org/papers/00042-aaai87-008-treat-a-better-match-algorithm-for-ai-production-systems/ ;
  nuance de l'auteur (« même complexité Big-O, les constantes décident ») — https://www.cs.utexas.edu/~miranker/treator.htm
- Drools **PHREAK** (lazy, goal-oriented ; « plus classé comme une implémentation Rete »), Drools 6, **2013-11** —
  https://docs.drools.org/latest/drools-docs/drools/rule-engine/index.html ;
  Drools ReteOO — https://docs.jboss.org/drools/release/6.2.0.CR2/drools-docs/html/HybridReasoningChapter.html
- **CLIPS écrit en C, repose quand même sur Rete** (preuve que le langage ≠ le levier ; 6.4.2, **2025-01-27**) —
  http://www.clipsrules.net/ ; Riley, *The CLIPS Implementation of the Rete Pattern Matching Algorithm* —
  https://www.semanticscholar.org/paper/e887c508641ce29150e31bb7a303aeb7c4010f5e

**Embedding natif (Node N-API / FFI — A4)**
- Node-API (ABI-stable, Stability:2 ; insule des changements de moteur JS) — https://nodejs.org/api/n-api.html
- napi-rs (Rust via Node-API ; v3, **2025-07-07** ; prod SWC/Rspack/Oxc) — https://github.com/napi-rs/napi-rs ;
  https://napi.rs/blog/announce-v3
- Bun FFI docs (« bun:ffi ~2–6× plus rapide que le FFI Node.js via Node-API » → la frontière N-API a un coût mesurable) —
  https://bun.com/docs/api/ffi

**WASM sandbox / capability-security (A2)**
- WebAssembly Security (sandbox, imports-only) — https://webassembly.org/docs/security/
- WASI.dev (capability-based, pas d'autorité ambiante) — https://wasi.dev/
- Wasmtime (runtime embeddable) — https://docs.wasmtime.dev/ ; Extism (plugins WASM cross-langage) — https://extism.org/

---

## Code / docs lus

- **Docs du modèle (le stable, comme indiqué) :** `doc/MODELISATION.md` (le modèle + roadmap ; §2.3
  « pre-Rete/naive », §N10 régime standing), `doc/HANDOFF.md` (§3 les 15 gotchas JTMS — base du K4 ;
  ledger des rungs build), `CLAUDE.md` (architecture, providers host-opt-in, expr.js safe), `doc/API.md`
  (contrat provider `(graph, concept, scope, argz, cb)` → mutation-template ; canonicalization barrier
  `facts`/`prose` ; fork/merge). Études sœurs pour le ton/structure : `doc/aspect-calcul-incremental.md`,
  `doc/aspect-modele-programmation-fiabilite.md`.
- **Cœur chaud (structure haut-niveau ; code en cours de réorg ESM — non commenté ici) :**
  `lib/graph/Graph.js` (boucle `_loopTF`/stabilize L293-330 `setTimeout`-driven ; `serialize` L362-389 =
  `JSON.stringify` des records `_etty._` ; `mount` ; `getRef` L471+ = pointer-chase scalaire sur
  `_objById`/`refMap` ; `pushMutation` ; `_providers` host-wired), `lib/graph/expr.js` (évaluateur jsep
  safe : interprétation d'AST avec callback `resolve(ref)`, accès `constructor`/`__proto__` bloqué ;
  blocage WASM cité du `new Function` qu'il remplace), `lib/graph/tasks/stabilize.js` (balayage des
  `_unstable` ; `_stabilizing` re-entrancy bracket), `lib/graph/objects/Concept.js` (`applyTo` L123-212 :
  appel provider `providers[ns][fn](graph, concept, scope, argz, cb)` au milieu du cast — **la frontière
  I/O actuelle = closure hôte**, le point central du verdict ; apply-ceiling backstop), `lib/graph/objects/
  Entity.js` (cast/uncast récursif, watchers — le pointer-graph dynamique du K2). Structure build :
  `package.json` (deps : jsep/deepmerge/is/intersect/shortid ; React = peer-dep d'une couche composant
  séparée), `.layers.json` (layer-pack/webpack → bundle JS).
- **Vérif empirique (Amdahl) :** `npm test` → 107/107 verts, `duration_ms` ≈ 194 ms (2026-06-22).
