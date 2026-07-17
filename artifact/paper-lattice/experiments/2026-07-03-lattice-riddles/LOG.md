# LOG — les DEVINETTES CIBLÉES du treillis (directive owner : « cibler les prompts pour tester des parties spécifiques »)

> La famille balle/trou proposée par l'owner (« mets la balle JAUNE dans le trou en étoile/carré/rond »)
> opérationnalisée en test unitaire PROMPT-LEVEL des restrictions sélectionnelles — l'entrée du chantier
> treillis (roadmap #3), branchée sur le loop d'apprentissage (roadmap #2). `riddle-probe.js` + RESULTS.json.

## Le design (4 variantes × 6 instances, chacune isole UN mécanisme)

- **V1 facette-distracteur** : la couleur saillante mais non-pertinente — le système doit clé sur l'axe FORME.
- **V2 isa-profondeur-2** : la prose ne nomme que le sous-type (bille/morceau de sucre) — insoluble sans les
  arêtes `marble ⊑ ball ⊑ round` : le treillis est LOAD-BEARING par construction.
- **V3 aucun-match** : pyramide vs étoile/carré/rond — le canal honnête `impracticable`+hint ; tout match
  rendu = hallucination.
- **V4 produit d'axes** : deux trous RONDS de tailles différentes — la forme seule est ambiguë, la taille
  discrimine (treillis-unique-vs-produit-d'axes, en acte).

Arms : **SYS** (intake typé → match déterministe par le treillis déclaré — le modèle n'est que l'extracteur) ·
**ABLATED** (arêtes du kind retirées, canal treillis PUR → doit échouer fermé, puis APPRENDRE l'arête :
mount optimiste (l'assurance D du lab) + verify oracle + crédit LOCALISÉ au trou vérifié (la discipline 8d)
→ re-match) · **DIRECT** (le modèle répond seul — la baseline). Prose paraphrasée par le modèle (jamais ma
surface), memo durable, oracle = treillis déclaré + facettes (circularité assumée et dite : le probe mesure
la DIVISION extraction × match × fail-closed × apprentissage, pas la connaissance brute).

## RÉSULTATS (2026-07-03 soir, ~72 calls, memo-isés) — après 3 cycles de critique

| variante | SYS | ABLATED (treillis pur) | DIRECT |
|---|---|---|---|
| V1 facette-distracteur | **6/6** | fail-closed 6/6 → appris+résolu 6/6 | 5/6 |
| V2 isa-profondeur-2 | **6/6** | fail-closed 6/6 → appris+résolu 6/6 | 6/6 |
| V3 aucun-match | **6/6 impracticable, 0 hallucination** | (pas de gold — 0 par construction) | 6/6 |
| V4 produit d'axes | **6/6** | fail-closed 6/6 → appris+résolu 6/6 | 5/6 |

**Les 3 cycles de critique (chacun = un finding de design, la valeur du prompt ciblé)** :
1. **La barrière canon manquait à l'intake devinette** — la paraphrase varie la surface du kind
   (« die »↔« dice ») ; fix = `canon.js#snapToVocab` contre le vocabulaire du treillis (la leçon h6
   « already paid », même brique). V1 1/6 → 3/6.
2. **Deux trous diagnostiques** : « sphere » = trou de COUVERTURE du treillis (le front ring-thésaurus) ;
   « star-shaped token » = trou de SCHÉMA (la facette `object.shape` explicite manquait). Fix : axiome +
   facette. V1 → 6/6. Les 3 échecs étaient tous FAIL-CLOSED (jamais un mauvais trou).
3. **Le fallback explicite naïf a tué l'ablation** (le modèle écrit `shape=round` pour une balle même
   « not stated » — sa connaissance fuit par l'extraction, le treillis cessait d'être load-bearing) ;
   fix = la DOCTRINE EN COUCHES du dispatch : **isa AUTORITAIRE quand le kind est connu, l'explicite en
   fallback sur OOV seulement** ; l'arm ablaté mesure le canal strict.

**La lecture** : DIRECT 22/24 — le modèle seul répond presque aussi bien ; la valeur du chemin typé n'est
PAS la connaissance brute, c'est (a) **0 hallucination structurelle** + le refus typé (V3), (b) le match
DÉTERMINISTE auditable/mémoïsable (K1), (c) **l'apprenabilité** : 18/18 arêtes manquantes apprises par
mount-optimiste + crédit localisé — le loop restriction-learning du lab, fermé sur de vrais prompts.
Caveats : N=6/variante (existence), treillis jouet déclaré, le compteur `extract` sous-lit (il ne crédite
pas les récupérations canon/fallback — diagnostic seulement).

**NEXT** : étendre la famille (V5 exception défaisable « balle dégonflée » ; profondeur-3 ; coref « la
mets-tu dans le même trou que la précédente ? ») ; brancher les arêtes apprises sur le `registry` défaisable
{source, confiance} (aujourd'hui : un objet local) ; le volume (la famille devinette dans le corpus POP-1).

---

## PROBE-2 (même soir) — CONSTANCE (instances fraîches + TRANSPOSITION) & DÉFAISANCE : tout tient

> `riddle-probe-2.js` + RESULTS-2.json. Un re-run nu eût été memo-tautologique (dit et évité) ; le re-test
> réel = instances FRAÎCHES (i=6..11, nouveaux tirages) + la TRANSPOSITION de domaine (animaux/enclos —
> aquarium/volière/terrarium, isa truite⊑poisson⊑aquatique) + le V5 défaisable avec son GARDE-FOU de
> vacuité (modificateurs bénins en contrôle — le mécanisme doit discriminer, pas apprendre « modif ⇒ none »).

| cellule | SYS | ABL (fc→learn) | DIRECT |
|---|---|---|---|
| shapes V1-V4 FRAIS (24) | **24/24** | 24/24 → 24/24 | 20/24 |
| shapes V5-défaisable (3) | **3/3 rétractés** | — | **1/3, 2 HALLUCINATIONS** |
| shapes V5-bénin (3) | **3/3 montés** | 3/3 → 3/3 | 3/3 |
| animals V1-V4 TRANSPOSÉ (24) | **24/24** | 18/18 → 18/18 | 16/24 |

- **La CONSTANCE est confirmée** : mêmes nombres sur tirages frais ET sur un domaine entièrement transposé
  (54/54 SYS, 0 hallucination, 45/45 arêtes apprises par le circuit optimiste+crédit-8d).
- **La défaisance (l'intuition owner) : CONFIRMÉE** — « deflated football » : DIRECT pattern-matche
  balle→rond 2/3 (hallucination à travers le modificateur) ; le chemin typé extrait la condition 3/3, la
  DÉFAIT (deflated ⊘ round) et rétracte proprement 3/3 ; les bénins (wet/shiny/brand-new — survivant en
  synonymes « damp/gleaming/fresh ») ne défont RIEN 3/3 — la discrimination est réelle, pas un « tout
  modificateur → none ».
- **Caveat d'oracle animals-V3, dit avec le chiffre** : DIRECT 0/6 « hallucinations » sur la fougère —
  fern→terrarium est PLAUSIBLE-monde (les fougères vivent en terrarium !) ; l'oracle déclaré dit « enclos
  animaliers » → none. L'avantage du chemin typé ici = la FIDÉLITÉ à l'ontologie déclarée
  (contrôlabilité/gouvernance), pas l'intelligence brute.
- **2 cycles de critique (probe-2)** : (1) la paraphrase synonym-hop les mots de SORTE des deux côtés
  (« round »→« circular » côté TROUS — V4 0/6 et un bénin cassés par la même racine) → fix = alias de RING
  dans le treillis + UNE seule voie de résolution des mots de sorte (les noms de trous passent par le même
  chemin isa/ring que les kinds) ; à volume ces alias doivent être APPRIS (registry/retractRingAlias), pas
  autorés. (2) mon scoring DIRECT de V4 était cassé des deux côtés (run-1 trop généreux — forme sans
  taille ; run-2 naïf trop sévère) → l'enum des DESCRIPTIONS réelles + normalisation d'alias.

**⇒ La revendication pratique (formulée prudemment)** : sur cette famille, à N=54+24, deux domaines,
tirages frais — le chemin typé fait **exactement ce que le modèle direct ne sait pas faire** : refus typé
sans hallucination (no-match ET défaisance), fidélité à l'ontologie déclarée, apprentissage localisé des
arêtes manquantes — à extraction égale portée par le même modèle. C'est une preuve d'EXISTENCE sur un
treillis jouet déclaré ; la générale attend le volume (POP-1) et le registry appris.

---

## G1a — la baseline DIRECT reasoning-ON (rb=1024, v2 post-fix troncature) : 40/54, et un FINDING d'oracle

> `direct-reasoning-arm.js` + RESULTS-direct-reasoning.json. Critique v1 (1 cycle) : maxTokens 400 <
> thoughtTokens 1024 → le thinking mangeait le budget, contenu VIDE — l'arm v1 mesurait la troncature
> (vérifié sur le memo), jamais reporté. v2 : maxTokens 1600, thinking engagé (3.6 s/call).

| cellule | rbON | rb0 | SYS |
|---|---|---|---|
| shapes V1 | **6/6** (répare le 4/6) | 4/6 | 6/6 |
| shapes V2 | 4/6 | 4/6 | 6/6 |
| shapes V3 no-match | **1/6, 5 « hallu »** | 6/6 | 6/6 |
| shapes V4 | 6/6 | 6/6 | 6/6 |
| **V5-défaisable** | **2/3, 1 hallu** | 1/3, 2 hallu | **3/3** |
| V5-bénin | 3/3 | 3/3 | 3/3 |
| animals V1/V2/V4 | 6+6+6 /18 | 16/18 | 18/18 |
| animals V3 no-match | 0/6, 6 « hallu » | 0/6, 6 | 6/6 |

---

## LE PROBE-CLIQUET (ratchet-probe.js) — le baseline #3 FERMÉ au niveau existence : la porte tient, le cliquet naïf drift

> UNGATED (« le modèle écrit l'arête », admise telle quelle) vs GATED (deux dents : LOCALISATION — un
> épisode confondu ne peut pas admettre une arête kind-level, l'évidence n'est pas attribuable kind-vs-
> condition, la 8d appliquée à la généralisation positive ; VÉRIFICATION — mount optimiste + verdict avant
> admission). 2 domaines × 3 ordres, memo durable, oracle = gold déclaré (circularité dite).

| cellule ×3 ordres | UNGATED | GATED |
|---|---|---|
| arêtes FAUSSES admises | **6/6 cellules** (pyramid→square · fern→terrestrial — l'ontologie plausible-monde du modèle ABSORBÉE) | **0 partout** |
| dégât aval SILENCIEUX (0 call, sans correction possible — la signature NELL) | 1-2/cellule, robuste à l'ordre | 0 (résiduel 1 sur 2 cellules = le ring-CONDITION, ci-dessous) |
| prime | — | +2-3 calls (quarantaines, refus, 1 retry) |
| amortissement | ≤1 proposition/kind ✓ | idem ✓ (les arêtes correctes s'admettent et servent pareil) |

- **Canal (i) poison-par-instance-confondue : VIDE** (le 27B propose ball→round malgré le contexte
  dégonflé) — reporté tel quel, par pré-enregistrement. Canal (ii) divergence-de-spec : TIRE (pyramide,
  fougère). Canal (iii) découvert en route : sparrow→terrestrial hors-contexte (erreur modèle vraie),
  corrigée par le contexte d'épisode.
- **3 cycles de critique en course, chacun un finding** : (1) « category » lu TAXONOMIQUE par le modèle
  (truite=poisson ∉ enum → none 5/5) — le prompt de proposition doit parler la langue de la FACETTE
  (habitat/shape-category) ; (2) **3e reproduction du grammar-collapse RUN-2** : l'enum grammaire contraint
  écrase les propositions sur 'none' (gecko/trout corrects SANS grammaire) — prompt-only au touchpoint
  sémantique, la règle maison re-confirmée sur un canal neuf ; (3) la défaisance manquait au chemin de
  réponse du harnais (partagée entre arms — le delta reste l'admission).
- **Le dégât résiduel GATED (1, 2 cellules) expliqué exactement** : « melted » → « **liquefied** » à la
  paraphrase → le défaiseur rate (vocabulary miss) → l'arête CORRECTE répond sur une instance
  exceptionnelle. **La 4e occurrence du même besoin en une soirée** (die/dice · circular/round ·
  category/habitat · liquefied/melted) : le ring d'alias APPRIS (G4) est l'enabler systémique, évidencé
  sur 4 axes indépendants (kinds, noms-de-trous, mots-de-facette, conditions-défaiseuses).
- **⇒ Pour le papier : le baseline crucial « le modèle écrit l'arête » est fermé au niveau existence** —
  le cliquet naïf absorbe l'ontologie du modèle et la propage silencieusement ; la porte (localisation +
  vérification) admet zéro arête fausse en tenant le même taux de réponses, à prime bornée. Pour
  l'architecture : le fallback-déduction fonctionne (les arêtes correctes du modèle s'admettent et
  s'amortissent) — le cliquet, pas la moyenne.


**La lecture honnête (le finding vaut plus que le score)** : le thinking RÉPARE les cellules de
connaissance (V1 6/6, défaisable 1/3→2/3) mais les « hallucinations » V3 sont en réalité des réponses
**PLAUSIBLES-MONDE qui violent l'ontologie DÉCLARÉE** — vérifié verbatim : la pyramide-pensée répond
« square » (une pyramide canonique a une BASE CARRÉE — elle rentre base-première !) comme la fougère répond
« terrarium ». Le rb0 6/6 « none » sur shapes-V3 était juste-pour-de-mauvaises-raisons (pattern-matching
superficiel). ⇒ **Le contraste propre n'est PAS « le modèle hallucine » : c'est « le modèle (surtout
pensant) suit la plausibilité-monde ; le chemin typé suit la SPEC déclarée » — mesuré dans les deux sens.**
Conséquences papier : (i) les cellules V3 (et partiellement V5 — une balle dégonflée SE FOURRE dans un trou
rond) ont des oracles CONTESTABLES → durcir le design no-match (objets sans échappatoire plausible / trous
sans le carré face à la pyramide) AVANT tout claim externe ; (ii) le benchmark externe à oracle vérifiable
(**DeFAb**) devient encore plus central (G-EXT) — c'est exactement pourquoi il existe ; (iii) le claim
gouvernance/fidélité-spec sort RENFORCÉ (il est vrai dans les deux régimes de raisonnement), le claim
« refus sans hallucination » se reformule « refus fidèle-à-la-spec ».

---

## G4 — LE RING D'ALIAS APPRIS : l'arc complet (protocole → confront → 5 cycles → VERT ×3 ordres)

> `PROTOCOL-G4-alias-ring.md` (pré-enregistré, amendé pré-run, 5 patches Laurie pliés) ·
> `sota/2026-07-03-alias-ring-g4-laurie.md` (0 FATAL · 1 SOUND · 5 PATCH) · `alias-ring-probe.js` +
> RESULTS-alias-ring.json (traces par-épisode incluses) · lib : commits `dfce0a8` (decideRingAdmission +
> creditRingAlias) et `41d5875` (doctrine blame). Le NEXT #1 du HANDOFF, et le G4 du plan papier.

**Le circuit** : OOV exogène (`snapToVocab` — la prose SOURCE porte la variante ; l'intake extrait les
surfaces VERBATIM, le ring canonicalise, pas le modèle — patch V6) → proposition modèle context-free
facet-worded sans grammaire → **intervention contrefactuelle PER-UNIT** (exacte, 0 call — le matcher est
déterministe : u admissible ssi verdict(P) ∧ ¬verdict(P∖{u}), scoré treillis-pur fallback-OFF — patch V2)
→ admission PROVISOIRE (`mergeRingProposals`, via='learned:llm', support=1) → CONFIRMATION à support≥2
(`creditRingAlias` sur ré-usages vérifiés — patch V1) → blame localisé ∧ sans-OOV-co-présent →
`retractRingAlias`.

| ×3 ordres (stables) | GATED (la porte) | UNGATED (admet la proposition) |
|---|---|---|
| admits | exactement les **6 spec-vrais** produits par le flux | les mêmes 6 **+ 3 POISON** |
| alias FAUX admis / confirmés | **0 / 0** | **3** (aperture/cavity/hole→round), jamais retirés |
| résolution (ok/refus-typé/faux) | **13 / 2 / 0** | 13 / 0 / **2** |
| dégât aval silencieux | 2 (comptés, blame-quarantainés) | 2 + ring empoisonné persistant |
| coût | 14 propositions/arm (≤1 par (clé,token)), re-props évitées 6-7 | idem |

- **La porte confirme {die→dice · circular→round · sphere→ball} (+circularhole selon l'ordre)** — dont DEUX
  alias que personne n'a plantés (sphere→ball, circularaperture→round : la paraphrase les a produits toute
  seule) ; provisoires at-risk : liquefied→melted (l'attrition de paraphrase a mangé les ré-expositions),
  circularaperture. Bénins moist/damp/gleaming : 0 admis (no-proposal/vacuous). deflated in-vocab : 0 call.
- **LE CANAL SPONTANÉ-FAUX A TIRÉ — pas où on l'avait planté** : waterlogged→? = VIDE (le modèle répond
  « neither », honnête — reporté tel quel, 8a) ; mais le modèle mappe **aperture/cavity/hole → round**
  (plausibilité-monde : un « trou » générique est prototypiquement rond ; oracle INCONTESTABLE — la spec ne
  dit nulle part qu'une aperture est ronde). UNGATED les absorbe ×3 ordres → 2 réponses fausses + poison
  permanent = **la signature NELL au grain vocabulaire, LIVE** ; GATED les refuse (failed-verify/vacuous/
  quarantaine). À résolution ÉGALE (13==13), la porte convertit les réponses fausses en refus typés.
- **Les 5 cycles de critique (chacun un finding, méthodo §3)** : C1 une proposition nulle comptait comme
  pending → quarantaine gonflée (bug d'instrument) ; C2 l'intake open-vocab met la COULEUR dans `condition`
  → dé-confound déterministe par soustraction de la facette color déclarée ; C3 la paraphrase synonym-hop
  TOUT (round→circular partout, ball→sphere, damp→moist) → la quarantaine multi-pending auto-scellait →
  **l'intervention per-unit** (le mécanisme β que Laurie a nommé au V3) la remplace, quarantaine réservée
  aux cellules non-attribuables ; C4 la découverte OOV doit être SANS court-circuit (un trou de kind
  masquait un trou de hole-name → un alias correct échouait son verify contre un gap invisible) ; C5 un
  épisode à OOV co-présent a une cause INCONNUE → blame inadmissible (sans quoi sphere→ball, correct,
  oscillait admis↔retracté sous l'attrition des trous — la dent du ratchet appliquée au blame, gravée au
  docstring `attributeSlotBlame`).
- **Contrôle déterministe 12/12** (0 GPU) : le trou V1 (confond) est RÉEL et l'enveloppe le borne
  (provisoire→blame→retract→de-lock) ; per-unit admet le load-bearing et refuse l'épisode-vacuous ;
  verdict(P) faux ∧ multi → quarantaine ; le masking-fallback est démasqué par le scoring strict ; stripColor.
- **Lecture pour le papier (cadrage Laurie V6/V3)** : G4 = la porte à attribution-localisée appliquée
  INCHANGÉE au grain vocabulaire-de-surface — **unification** treillis+vocabulaire sous UNE porte
  (attribution-unique ∧ verify ; deux mécanismes duaux : provenance structurelle α / ablation
  contrefactuelle β — G4 emploie les deux), soundness RÉCUPÉRABLE (pas d'admission), le ring cible la
  variance EXOGÈNE de la prose source (les faits émis par le modèle sont déjà canonicalisés par le prompt
  fort — la doctrine maison sert de foil sinon). Existence : N=15 épisodes ×3 ordres, un domaine, treillis
  jouet déclaré, oracle=gold (circularité assumée : on mesure la DYNAMIQUE d'admission).
- **Caveats exacts** : attrition paraphrase 5/15 (comptée, jamais silencieuse — le canal réaliste) ;
  UNGATED ok==GATED ok sur CE flux (la porte coûte 0 disponibilité ici parce que les épisodes détruits
  étaient insolubles pour les deux) ; eq4/eq6 = la taille de classe d'équivalence des kinds (diagnostic —
  le prior sémantique choisit dans la classe) ; `confirmed` reste défaisable (rétractable sur blame propre).


---

## ORACLES DURCIS (G1a fermé) — V3h sans échappatoire · V5h remap positif : les cellules du claim

> `oracle-hardening-probe.js` + RESULTS-oracle-hardening.json (protocole + attendus pré-enregistrés dans
> l'en-tête). Répond au finding G1a : « les hallu V3 sont plausibles-monde ; V5-none est contestable » —
> AVANT tout claim externe. Arms SYS / DIRECT-rb0 / DIRECT-rbON (mêmes paraphrases memo-servies).

| cellule durcie | SYS | rb0 | rbON | lecture |
|---|---|---|---|---|
| V3h-shapes (pyramide, carré RETIRÉ) | **6/6 none** | 6/6 | 6/6 | les « hallu » V3 S'EFFONDRENT — c'était l'oracle, PAS le modèle (pré-enregistré, confirmé) |
| V3h-animals (fougère, terrarium RETIRÉ) | **6/6 none** | 4/6, **2 hallu** | 4/6, **2 hallu** | il RESTE 2/6 vraies hallucinations spec-INDÉPENDANTES aux deux régimes — la cellule refus-typé du papier, non-vacuous et incontestable |
| V5h-remap (deflated: round→FLAT SLOT, gold POSITIF) | **9/9** (6 rétracte+remappe · 3 bénins→rond, vacuité tenue) | 3/9 | 3/9 | DIRECT = « round one » 5/6 deflated (+1 none) **aux deux régimes** — le pattern-match À TRAVERS le modificateur sur une tâche positive à deux choix ; ses 3 = les bénins seuls |

- **Ce que ça donne au papier** : (a) le claim refus-typé s'assoit sur V3h-animals (aucune échappatoire,
  le modèle hallucine quand même 2/6, SYS 0) ; (b) V3h-shapes recadre honnêtement l'ancien V3 (oracle
  artifact — dit tel quel, ça CRÉDIBILISE) ; (c) V5h montre la modifier-blindness du modèle sur un gold
  world-FAVORED (une balle plate passe par une fente — pas logiquement forcé, dit avec la nuance : le
  claim dur reste V3h) et la face REMOUNT de la défaisance (rétraction → re-dérivation par l'arête remap,
  pas seulement le refus).
- **1 cycle de critique (le 5e axe du phénomène 4-axes, sur un domaine NEUF)** : la paraphrase réécrit
  « flat slot » → « RECTANGULAR slot » (même référent) → la fente irrésoluble → 5 SYS wrong au run-1.
  Fix = alias autoré rectangular→flat (concern séparé : ici on durcit l'oracle ; à volume c'est le ring
  G4 qui apprend cet alias — la démonstration existe déjà, cross-ref §G4). + compteur cond-survie corrigé
  (survie = condition EXTRAITE non-vide, pas le mot de surface exact — les bénins synonym-hoppent).
- Caveats : N=6-9/cellule (existence) ; V5h gold world-favored (pas logiquement forcé) ; le remap est
  implémenté au harnais (la face re-dérivation) — la version moteur = defeater + arête alternative, natif.

---

## G5-RAG — l'ontologie déclarée EN CONTEXTE (l'arm qui justifie le matcher déterministe)

> `rag-ontology-arm.js` + RESULTS-rag-ontology.json — les MÊMES 54 tâches probe-2, mêmes paraphrases
> memo-servies ; le prompt porte l'ontologie COMPLÈTE (taxonomie + trous + exceptions + la règle du plus
> bas dérivable) marquée « authoritative — answer STRICTLY from it ». Répond à l'objection reviewer
> « donnez juste le treillis au modèle ».

| cellule | RAG-ctx | DIRECT-nu | SYS |
|---|---|---|---|
| V1/V2/V4 (connaissance, ×2 domaines) | 36/36 | 32/36 | 36/36 |
| V5-défaisable + bénin | 6/6 | 4/6 (2 hallu) | 6/6 |
| **V3 no-match shapes** | **0/6 (3 hallu + 3 format-cassé)** | 6/6 | 6/6 |
| **V3 no-match animals** | **3/6 (3 hallu)** | 0/6 (6 hallu) | 6/6 |
| **total** | **45/54** | 42/54 | **54/54** |

- **Lecture (vérifiée sur les réponses brutes)** : l'ontologie en contexte RÉPARE les cellules de
  connaissance (V1/V2 4/6→6/6 ; V5-défaisable 1/3→3/3 — l'exception fournie suffit) **mais ne sécurise
  PAS les cellules refus/fidélité** — deux modes d'échec distincts : (i) le contexte INDUIT du bavardage
  de dérivation qui casse la discipline d'enum (pyramide : 3× récitation « Based on the provided
  ontology… » — la famille grammar-collapse au 4e canal : du contexte ajouté au touchpoint sémantique →
  narration au lieu de réponse) ; (ii) la plausibilité-monde SURVIT au contexte autoritaire (fougère →
  « terrestrial » 3/6 alors que l'ontologie fournie dérive none). Les échecs résiduels du RAG sont
  concentrés EXACTEMENT sur les cellules du claim (a) — refus typé/fidélité-spec.
- **Pour le papier** : même à ontologie fournie, le modèle n'est pas un évaluateur fiable de sa propre
  ontologie ; le matcher déterministe est justifié sur la CORRECTION des cellules gouvernance — en PLUS
  des coûts structurels du RAG-ctx dits avec le chiffre : 1 call/épisode À VIE (zéro amortissement — SYS
  memoïse K1 à 0 call), zéro audit, zéro apprenabilité localisée. Honnêteté : RAG 45 > DIRECT 42 au total
  — le contexte aide EN MOYENNE ; le claim porte sur OÙ il échoue, pas sur la moyenne.

---

## G3 — VOLUME + STATS + 3e DOMAINE : n=24/cellule ×3 domaines, IC exacts — SYS 300/300

> `volume-probe.js` + RESULTS-volume.json. Instances FRAÎCHES (offsets neufs), 3e domaine de transposition
> = PRISES/FICHES (europlug⊑roundpin…, défaiseur « bent » world-aligné — la leçon oracles-durcis),
> IC Clopper-Pearson 95 % exacts par cellule. ~900 calls, memo durable.

| total (16 cellules) | SYS | DIRECT-rb0 |
|---|---|---|
| **TOTAL n=300** | **300/300 [99–100 %]** | 245/300 [77–86 %] |

Cellules saillantes : animals-V3 no-match DIRECT **0/24 (24 hallucinations)** — la divergence-de-spec à
volume ; V5-défaisable DIRECT 1/3 et 0/3 (hallu à travers le modificateur, les DEUX domaines à défaiseurs) ;
plugs-V2 DIRECT 12/24 (le modèle ignore les broches d'un Schuko/shaver plug — le treillis déclaré non) ;
SYS : 24/24 partout, hallucinations 0.

**3 cycles de critique (le domaine VIERGE a payé — chacun un finding réel)** :
1. **`snapToVocab` : containment AMBIGU → OOV (fix lib `e76ee2e` + test de régression)** — « plug »
   (hypernyme de tous les kinds) se snappait sur le PREMIER hit du vocab et ÉCRASAIT la catégorie explicite
   correcte (doctrine isa-autoritaire) → wrong-mounts ; et le 12/24 pré-fix de V2 était du
   right-for-wrong-reasons (le mis-snap accidentellement correct pour 2 kinds/4). Unique → snap ; ambigu →
   OOV fail-closed + l'ensemble candidat reporté (un futur désambiguïseur/ring).
2. **Kinds multi-mots × l'heuristique d'intake « one word »** : « US plug » s'extrayait en « plug » (le
   discriminant vit dans le modificateur) → `kindHint` par domaine dans le schéma d'intake (le hint fait
   partie de la DÉCLARATION du domaine — additive, memo-compatible).
3. **Scoring par IDENTITÉ de trou, jamais par index** : l'intake extrait parfois un SOUS-ENSEMBLE des trous
   (paraphrase « which socket is compatible… ») → le mount était sémantiquement JUSTE et compté faux par
   décalage d'index — tous les résidus plugs étaient cet artefact (vérifié par trace).

**Lecture** : la constance tient à volume avec IC serrés ; le déficit DIRECT est concentré sur les cellules
du claim (no-match/défaisance/connaissance-de-treillis) ; et l'onboarding d'un domaine VIERGE produit
exactement les classes d'échec que l'architecture prévoit (vocabulaire de surface → ring/canon ; jamais un
mauvais mount silencieux après fix du snap ambigu). Caveats : V5 reste n=3/cellule (existence) ; DIRECT
plugs-V2 mesure la connaissance-monde du 27B, pas sa discipline ; kindHint/scoring = instrument, dits.

---

## 2026-07-04 — CAMPAGNE CROSS-MODÈLE (dé-confondeur mono-modèle du papier)

**Motif.** Le papier ne tourne que sur un Qwen. On rejoue le protocole live **§6–§7 à l'identique** sur 6
modèles locaux (zéro download, ≤30 Go, un à la fois en 32 Go VRAM), pour attaquer le confond mono-modèle
directement. Isolation : `OUT_SUFFIX` par modèle (`RESULTS-*<sfx>.json` — artefacts du papier intacts) ;
memo durable **partagé, clé = basename modèle** → appels frais non-colliants par modèle. Runner :
`run-all-models.sh` (scratchpad). Un **fix lib** a été nécessaire : `local-host.js#finalizeGrammarOutput`
faisait un `JSON.parse` non-gardé de la sortie sous-grammaire — une complétion tronquée à `maxTokens` finit
en milieu de chaîne → **crash de tout le run** (vu sur Gemma-Q2, GGUF verbeux/buggé) ; dégradé en texte brut
(fail-closed) → un modèle verbeux coûte un épisode fail-closed, pas un crash (commit `5c18808`, 7/7 tests
local-host verts). Invisible sur Qwen (reste dans le budget) — déjà un finding cross-modèle.

**Provenance du backend (auditée, car un llama.cpp "turboquant" de thetom existe ailleurs).** Le `node_modules`
de skynet-graph tourne le **llama.cpp OFFICIEL `ggml-org` b9842** (node-llama-cpp 3.19.0, prebuilt CUDA, chemins
de build GitHub-CI, extraction npm propre). Vérifié au **niveau du process vivant** (`/proc/<pid>/maps` : toutes
les `.so` llama/ggml chargées viennent du `node_modules` local, AUCUNE de `_perso/c&c`) ; `LD_PRELOAD` /
`LD_LIBRARY_PATH` vides. Le build turboquant de thetom vit **isolé dans `_perso/c&c/app.dist/llama-build.atomicbot/`**
(projet séparé). **KV cache = F16/F16 pleine précision** (inspection runtime : `model._defaultContextKvCacheKeyType
= GgmlType.F16`) — **pas de turbo-quant KV**. Donc les résultats ne sont pas confondus par la quantization du
cache. (MTP : *mergé* dans b9842 — le binaire gère `n_layer_nextn`/`nextn.shared_head_norm` pour QWEN35 — mais
node-llama-cpp 3.19 n'a **aucun** predictor MTP/nextn côté JS (grep `dist/` = 0 hit ; seuls draft-model +
input-lookup existent), donc l'embarqué n'engage PAS l'accélération MTP ; elle passerait par le serveur llama.cpp
c&c via `makeOpenAIAsk` — arme non-embarquée, hors protocole du papier.)

**Table finale (6 modèles) — volume §6.4 · DeFAb-pur §7.3 · porte §6.5 :**

| modèle (famille, quant) | vol-SYS | vol-DIRECT | shapes/V3 (soundness) | DeFAb-pur | porte : arêtes-fausses GATED |
|---|---|---|---|---|---|
| qwen-Q2_K (papier, Qwen) | **300/300** | 245/300 | 24/24 (0 faux) ✓ | 30/35 | **0** |
| qwen-IQ2_XXS (2-bit) | 259/300 | 213/300 | 24/24 (0 faux) ✓ | 30/35 | **0** |
| qwen-Q6_K | 292/300 | 232/300 | 24/24 (2 faux ailleurs) | 30/35 | **0** |
| gemma-4-31B-UD-Q2 (Google) | 245/300 | 198/300 | **0/24 (24 faux)** ✗✗ | 30/35 | **0** |
| ministral-8B-Q8 (Mistral) | 200/300 | 200/300 | 12/24 (12 faux) ✗ | 30/35 | **0** |
| phi-4-Q4 (Microsoft) | 241/300 | 231/300 | **0/24 (24 faux)** ✗✗ | 30/35 | **0** |

`qwen-paper` (mémo-servi) **rejoue le papier bit-exact** (300/300·245/300 = artefact) → harnais fidèle.

**Trois couches, sensibilité-modèle OPPOSÉE :**

1. **Décideur déterministe = model-invariant PAR CONSTRUCTION (confirmé).** DeFAb `structurel-pur` **30/35
   identique aux 6 modèles / 4 familles** ; DeFAb-L2 374/374 partout ; lab §5 (126/126, 108/108) + contrôle
   porte 12/12 = code pur. Seuls l'extraction (`sysExt`) et le tie-break touchent le modèle.
2. **La PORTE (arêtes/alias) = multi-famille probante.** **0 arête fausse GATED aux 6 modèles.** Chaque
   famille ÉMET du poison (toutes proposent `pyramid→square`, `fern→terrestrial` + leurs extras ; qwen-IQ2
   en émet **plus**, 12, la porte tient quand même à 0). Le poison est **le MÊME across familles** ⇒ biais-monde
   **universel**, pas un tic de Qwen — la forme forte de (c′).
3. **La soundness end-to-end de l'EXTRACTION (SYS fail-closed, zéro mauvaise monture) = Qwen-spécifique.**
   Qwen tient 24/24 à **tous** les quants (jusqu'à 2-bit) ; **gemma ET phi-4 cassent 0/24 (24 mauvaises
   montures, UNIQUEMENT sur shapes/V3, fail-closed partout ailleurs)** ; ministral casse à moitié (12/24).

**CORRECTION d'attribution (le finding qui compte).** Lecture intermédiaire (avant phi-4) : « le break de gemma
est packaging-spécifique (GGUF buggé/UD-turbo), le quant-ladder Qwen prouve que ce n'est pas le quant. »
**phi-4 réfute la partie packaging** : modèle Microsoft PROPRE et compétent (DIRECT 231/300 > gemma), il casse
shapes/V3 **à l'identique** (0/24, 24 faux, *seulement là*). Deux familles propres échouent la même cellule de
la même façon. Donc : **ni quant** (Qwen-IQ2 2-bit tient), **ni packaging** (phi-4 propre casse) → la soundness
fail-closed sur shapes/V3 est **Qwen-spécifique**. Pipeline (prompt d'extraction + règles canon) **développé sur
Qwen** ⇒ hypothèse la plus probable = **sur-ajustement de l'extraction/canon à Qwen** — menace de validité externe
réelle, à DIRE dans le papier. (Le quant dégrade la **couverture** de façon **fail-closed** — Qwen-IQ2 259/300,
**0 mauvaise monture**, perte concentrée sur le domaine dur plugs ; jamais la soundness.)

**Réponse nette à « on n'a des chiffres probants qu'avec des Qwen ? »** : la **contribution** (porte + décideur)
est probante **sur 4 familles** ; c'est la **soundness d'extraction end-to-end** qui est Qwen-bornée (précondition
« extracteur compétent + non sur-ajusté », que gemma/phi-4/ministral servent à DÉFINIR, pas la porte). Le
multi-famille renforce la généralité *à travers les extracteurs*, **pas** *à travers domaines/tâches* (limite §8
inchangée).

**Timing (à consigner — la lenteur est le coût de la BASELINE LLM, pas du système).** Bras rbON (raisonnement)
= le poste lent : Qwen-Q6 **11,7 s/appel** génuine (42 appels ≈ 8 min) ; gemma/ministral rbON = 1,5–3,5 s/appel
(faux thinking). SYS steady-state = **mémo-servi ≈ 0 s** (le bras raisonnement de qwen-paper a rejoué en 0 s,
tout caché). ⇒ « pas utilisable à cette durée » vise le baseline LLM-par-épisode, **précisément ce que le chemin
typé élide** (amortit à 0 appel). À mettre explicitement dans le papier.

Détails + synthèse des 4 agents critiques → `docs/WIP/reviews/2026-07-04-lattice-growth-paper-review.md`.
Follow-on MoE en cours (gemma-26B-A4B-Q6 : gemma-*famille* à Q6 casse-t-il aussi shapes/V3 ? ; Qwen3.6-35B-A3B :
l'avantage Qwen tient-il en MoE + bras raisonnement RÉEL).

### CORRECTION (même jour) — le break shapes/V3 n'était PAS un Qwen-overfit, c'était un BUG D'UNE LIGNE

Trace mémo (GPU-free) sur les 3 extracteurs : Qwen extrait `category:""` pour « pyramid » (obéit au « "" si non
énoncé ») → `derived=null`, `explicit=null` → **impracticable ✓** ; **gemma ET phi-4 extraient `category:"square"`**
(plausibilité-monde : une pyramide a une base carrée) → `derived=null` mais le chemin non-strict **retombait sur
`explicit`** → mount dans le trou carré → HALLUCINATION, les 6/6. Cause = `matchHoles` violait **sa propre doctrine
§3 P4** (« les facettes explicites ne servent que de repli pour les kinds HORS-VOCABULAIRE ») : le repli explicite
tirait aussi pour les kinds *in-vocab*. Qwen y échappait par chance (il laissait `""`).

**Fix (1 ligne, = la doctrine)** : `const kindOOV = !Object.keys(D.isa).includes(kind); cat = derived || (strict ?
null : (kindOOV ? explicit : null));` — repli explicite SEULEMENT si le kind est OOV.

Rejeu mémo-servi (déterministe, 0 GPU), volume, avant→après :

| modèle | shapes/V3 avant | shapes/V3 après | total-SYS avant→après · wrong-mounts |
|---|---|---|---|
| qwen-paper / iq2 / q6 | 24/24 ✓ | 24/24 ✓ | inchangé (0 régression) |
| gemma | 0/24 (24 faux) | **24/24 (0 faux)** | 245→**269** · **24→0** |
| ministral | 12/24 (12 faux) | **24/24 (0 faux)** | 200→**212** · 14→2 |
| phi-4 | 0/24 (24 faux) | **24/24 (0 faux)** | 241→**265** · **24→0** |

**Conclusion CORRIGÉE (rétracte le "Qwen-overfit / menace de validité externe" ci-dessus).** Après le fix, la
**soundness SYS fail-closed (0 mauvaise monture) tient sur les 4 familles** — Qwen/Google/Mistral/Microsoft. Les
TROIS couches généralisent : décideur (DeFAb-pur 30/35), porte (0 arête fausse), **ET** soundness fail-closed
(0 wrong mount). Seule la **couverture** varie par modèle (Qwen 300 > phi 265 > gemma 269 > ministral 212) =
capacité d'extraction pure, dégradation **gracieuse fail-closed**, jamais non-saine. Le bug ne se voyait QUE via
un extracteur non-Qwen (Qwen le masquait) — le run cross-modèle l'a fait surgir : c'est un finding pour le papier
(corriger le matcher pour matcher sa doctrine énoncée). `matchHardened` (oracle-hardening §6.3) avait le même repli
→ **patché+confirmé pareil** : V3h-shapes **0/6→6/6 les 3 casseurs** (gemma/ministral/phi), Qwen inchangé 6/6.
Résidus V5h-remap (gemma 5/9, ministral 7/9 ; phi/qwen 9/9) = vraie capacité d'extraction du défaiseur (remap),
PAS le bug explicite — dégradation gracieuse, à part.

Le **keystone §6.2 (riddle-probe-2) rejoué -fix confirme identiquement** : gemma V3 0/6→6/6 (total 41→47),
ministral 3/6→6/6 (24→27), phi-4 0/6→6/6 (47→53), Qwen inchangé. Les 3 probes touchés par le fix (keystone §6.2,
oracle-hardening §6.3, volume §6.4) sont donc tous rejoués + consignés. Fichiers `RESULTS-*<model>-fix.json` sur disque.

**Follow-on MoE : ARRÊTÉ délibérément (non consigné).** Après la résolution du bug matcher, sa question d'origine
(« gemma-*famille* vs gemma-Q2 ? ») est caduque ; + modèles sur HDD mécanique lent (`/mnt/s`) + disque quasi-plein.
Reste sur disque : gemma-26B-A4B-Q6 partiel (5 probes, matcher BUGGÉ pré-fix, pas de defab/volume) + Qwen-A3B jamais
lancé. Données incomplètes et non-comparables → NON analysées, NON consignées (à supprimer, ou à re-lancer proprement
sur SSD si on veut les 2 points MoE — mais faible valeur marginale).

### 2026-07-04 (après-midi) — les 3 points MoE / petit-modèle (matcher fixé, SSD) : la table passe à 9 modèles

Reprise du NEXT (a) : suite complète rejouée pour **Qwen3.5-35B-A3B-Q4** (MoE ~3B actifs, rb=1024, les 4
probes du matin étaient déjà post-fix — seuls les 5 manquants ont couru) et **gemma-3-12b-it-Q4** (petit
gemma *clean*, 6.8 Go, rb=1024, 9 probes) ; **Coder-30B-A3B-Q4** (rb=0) était complet du matin. Un modèle à
la fois, memo durable clé-basename, runner scratchpad `run-moe-campaign.sh`. ~25 min GPU au total.

| modèle | vol-SYS | vol-DIRECT | shapes/V3 (soundness) | DeFAb-pur | porte : arêtes fausses GATED (UNGATED absorbe) |
|---|---|---|---|---|---|
| Coder-30B-A3B-Q4 (Qwen MoE, rb0) | 252/300 | 168/300 | 24/24 ✓ (0 faux) | 30/35 | **0** (5) |
| Qwen3.5-35B-A3B-Q4 (Qwen MoE, rb1024) | 271/300 | 192/300 | 24/24 ✓ (0 faux) | 30/35 | **0** (3) |
| gemma-3-12b-Q4 (Google 12B, rb1024) | **79/300** | 50/300 | 24/24 ✓ (0 faux) | 30/35 | **0** (**30**) |

**Lecture.** Les 3 couches tiennent aux nouveaux extrêmes (9 modèles au total maintenant) :
1. **Décideur** : DeFAb structurel-pur **30/35 identique** (9/9 modèles) ; L2 sym **374/374** (3/3 nouveaux).
2. **Porte** : 0 arête fausse partout — et le point saillant : gemma-12b UNGATED absorbe **30** arêtes
   fausses (10 de dégât aval) là où GATED tient **0/0** ; plus l'extracteur est faible, plus la porte paie.
   Ring d'alias : les 3 nouveaux à **0 poison réel admis, 0 dégât** ; gemma-12b ne sait pas proposer
   (`no-proposal` ×11 → refus typés purs, res 6 ok/15 refus/0 faux — fail-closed intégral) ; les
   `wrongAdmits` de coder/qwen35 (`circle→round`, coder `liquid→melted`) sont des **variantes
   valides-selon-la-spec non créditées par le gold strict planté** (l'artefact E.3 du review — damage 0
   partout le confirme ; le fix de protocole « créditer les synonymes inventés spec-valides » reste à faire).
3. **Soundness fail-closed** : 0 mauvaise monture sur keystone/volume/V3h aux 3 nouveaux points, à
   n'importe quelle couverture — gemma-12b s'effondre à **79/300 de couverture avec zéro monture fausse et
   zéro arête fausse** = la dégradation gracieuse fermée-sur-échec dans sa forme la plus pure.

**Nuances honnêtes (à porter au papier §7.4)** :
- **L'écart de gouvernance sur le REFUS se rétrécit avec la capacité** : qwen35-A3B DIRECT fait 6/6 sur les
  deux cellules V3h durcies (0 hallu, deux régimes) — le contraste refus n'est plus universel chez les
  modèles récents. MAIS la **ré-dérivation défaisable** reste aveugle au modificateur (V5h-remap DIRECT 1/9
  vs SYS 9/9) et DeFAb garde les pertes sur-générales (rb0 29/35, rbON 27/35 vs SYS 34/35) — les cellules
  porteuses du claim restent porteuses.
- **Résidu V5h-remap sur extracteurs faibles** : coder SYS 3/9 (6 faux, attrition défaiseur 6/9) ;
  gemma-12b SYS 0/9 (9 faux, condition VUE 9/9 → le résidu est la re-dérivation/extraction de trous, pas la
  détection du défaiseur — à tracer mémo si on veut l'attribution fine). Le « 0 mauvaise monture » se scope
  donc aux cellules refus/volume ; le résidu remap est compté, rapporté à part, jamais silencieux.
- Coder (modèle code) : DeFAb sysSym **35/35** (résout 5/5 tie-breaks !) mais sysExt 14/35 (copie JSON
  faible) et DIRECT bas partout (168/300) — un extracteur-décideur spécialisé, pas un généraliste.

Fichiers : `RESULTS-*.{qwen-coder-moe,qwen35-moe-a3b,gemma12b}.json` (lattice-riddles + defab-gext).
**⇒ La question MoE-vs-dense est close : l'architecture (MoE, 3B actifs) ne casse aucune couche ; la taille
(12B) ne casse que la couverture. La table E.4 du review + le §7.4 du papier passent à 9 modèles.**
