# PROTOCOLE PRÉ-ENREGISTRÉ — G4 : le ring d'alias APPRIS (2026-07-03)

> Le NEXT #1 du HANDOFF : remplacer les alias de ring AUTORÉS du harnais devinettes (die→cube,
> circular→round, spherical→round… posés à la main dans `DOMAINS.*.isa`) par un ring **appris du flux**
> via la MÊME porte localisation+vérification que les arêtes isa (ratchet-probe) et les slots (8d) —
> branchée sur le `registry` défaisable {source, confiance}. Évidence du besoin : 4 axes indépendants en
> une soirée — die/dice (kinds) · circular/round (noms de trous) · category/habitat (mots de facette) ·
> liquefied/melted (conditions défaiseuses). Le 3e axe (facette) est un fix de PROMPT-design (schéma
> d'intake), pas de ring — documenté, hors du circuit d'apprentissage ; les 3 autres sont le scope.

## Le claim testé

Les alias de surface (kind · nom-de-trou · condition-défaiseuse) s'apprennent en ligne, soundly :
0 alias faux admis (GATED), récupérable (blame localisé → `retractRingAlias`), amorti (ring-hit = 0 call
de proposition à la ré-occurrence), pendant que le foil UNGATED (« le modèle écrit l'alias ») absorbe la
plausibilité-monde du modèle — la signature NELL au grain VOCABULAIRE. C'est la version forte du claim (c)
du papier : le treillis ET son vocabulaire de surface se grandissent par la même porte.

## Setup

- **DOMAINS ablatés** : retirer de `shapes.isa` les entrées alias {sphere, die, circular, circle,
  spherical, rectangular} ; garder les VRAIES arêtes isa (marble⊑ball, ball⊑round, dice⊑cube…).
- **Registry hand-built, frozen v1** (le constructeur deriveRegistry exige un concept-tree que le harnais
  n'a pas — la déclaration directe des enums EST la déclaration du vocabulaire fermé) :
  `kind {enum: kinds déclarés}` · `holeName {enum: mots de trous + cats}` · `condition {enum: défaiseurs
  déclarés}` (les bénins ne sont PAS dans l'enum — un bénin aliasé à un défaiseur serait un FAUX admit).
- **Résolution UNE-VOIE** (doctrine probe-2) : token → `snapToVocab` (exact/containment) → ring registry
  (`specForKey` + `compileEnumMap`) → treillis isa. Vérifié : die/circular/liquefied sont bien OOV au
  containment (pas de sous-chaîne) — le ring est le seul chemin.
- **Variantes PLANTÉES dans la prose SOURCE** (contrôle du stream — les variantes venaient de la
  paraphrase au probe-2 ; ici on les plante pour contrôler l'exposition, ET la paraphrase modèle reste
  par-dessus comme canal de bruit réaliste, attrition comptée jamais silencieuse — discipline G5) :
  - kind : « die » ×3 épisodes (gold = trou square via dice⊑cube) ;
  - holeName : « circular one » ×3 (gold = ce trou pour une ball) ;
  - condition : « liquefied » sugarcube ×2 (gold = none — melted défait square) + « deflated » contrôle
    in-vocab (0 proposition attendue) ;
  - bénins OOV : « damp » ball · « gleaming » marble (garde-fou de vacuité) ;
  - « crescent one » comme nom de trou face à une ball (canal proposition-fausse spontanée : si le modèle
    mappe crescent→round c'est faux-vs-spec ; s'il dit neither, le canal est VIDE et reporté tel quel —
    discipline 8a du ratchet, jamais absorbé).

## La porte (3 dents, composée sur les briques lib)

1. **OOV** : `snapToVocab` verdict 'oov' sur un point de résolution typé — la frontière de couverture au
   grain vocabulaire.
2. **Proposition modèle** (1 call, prompt facet-worded — leçon ratchet ; PAS de grammaire — 3× le
   grammar-collapse RUN-2) : « does "liquefied" mean one of {deflated|melted}, or neither? ».
3. **Localisation + décisivité (0 call — le matcher est déterministe)** :
   (a) UN SEUL alias pending exercé dans l'épisode (le crédit 8d : atoms = alias, roles = ring key, via
   `slotPostFrom`/`attributeSlotCredit` — deux pending dans le même épisode ⇒ quarantaine des deux) ;
   (b) **décisivité contrefactuelle** [AMENDEMENT pré-run, avant construction — v1 exigeait l'unicité
   sur TOUS les membres ; cassé par construction : sur UN épisode les membres sont verdict-équivalents
   par classe de catégorie (die→dice, die→cube, die→sugarcube donnent le même trou square) — l'unicité
   auto-scellerait die/dice à jamais, le défaut C-arm au grain vocab] : le verdict épisode passe AVEC
   alias→membre-proposé et ÉCHOUE SANS alias — l'alias est LOAD-BEARING pour le succès (un bénin dont
   le no-alias passe aussi n'est PAS décisif → 0 admission, le garde-fou de vacuité). La discrimination
   INTRA-classe d'équivalence = le prior sémantique (la proposition) + l'enveloppe défaisable
   (support/retract) ; la taille de la classe d'équivalence est REPORTÉE (diagnostic, jamais un gate) ;
   (c) **concordance** : seul le membre PROPOSÉ est monté optimistiquement (le prior sémantique choisit
   dans la classe ; l'évidence vérifie — les deux organes du cliquet).
4. **Vérification** = le verdict épisode (oracle = gold déclaré — circularité assumée et dite, comme au
   ratchet : on mesure la DYNAMIQUE d'admission, pas la connaissance).
5. **Admission** → `mergeRingProposals` (confluence re-checkée, provenance {member, via:'learned:llm',
   support}) · **ré-usage vérifié** → `creditRingAlias` (support++ = la confiance) · **blame localisé**
   ultérieur → `retractRingAlias` (la récupérabilité, pas la fiabilité d'oracle — Rule-of-Three).

## Arms + métriques (×3 ordres de stream, jamais moyennées ; memo durable partagé)

- **GATED** (le circuit ci-dessus) vs **UNGATED** (admet la proposition telle quelle, la persiste).
- **Contrôle déterministe séparé (0 GPU)** : wrong-admit forcé → épisode suivant échoue → blame localisé
  → retract → recovery (l'enveloppe récupérable) ; non-décisif → quarantaine ; collision → confluence
  reject (+ retract → re-admit correct = le de-lock).
- Métriques exactes : alias faux admis (GATED = 0 attendu) · dégât aval silencieux (réponse fausse depuis
  un alias persisté, 0 call) · prime de la porte (propositions + refus + retries + quarantaines) ·
  amortissement (≤1 proposition par (token,key) et par arm ; ring-hit 0-call ensuite) · attrition
  paraphrase (variante perdue = tâche comptée à part) · déterminisme.

## PATCHES POST-CONFRONT (passe Laurie `sota/2026-07-03-alias-ring-g4-laurie.md` — 0 FATAL · 1 SOUND · 5 PATCH ; pliés AVANT construction)

1. **[V1 — le trou « confond d'épisode »]** La décisivité contrefactuelle établit la causalité au grain
   VERDICT, pas au grain sémantique : un facteur orthogonal que le placement halluciné reproduit fait passer
   les 3 dents (damp→deflated sur un gold=none orthogonal). ⇒ **admission à DEUX TIERS** : support=1 =
   PROVISOIRE (utilisé optimistiquement, chaque usage re-vérifié) ; **CONFIRMÉ à support≥2** sur épisodes
   dé-confondus ; bucket at-risk = « admis jamais ré-exercé ». Le claim de soundness porte sur les
   CONFIRMÉS ; la précondition « épisode dé-confondu » est NOMMÉE (le corpus planté l'assure par
   construction — dit, pas caché). La soundness vendue = RÉCUPÉRABLE, pas d'admission.
2. **[V2 — over-refusal par fallback]** La décisivité est scorée sur le canal TREILLIS-PUR (fallback
   explicite OFF — comme l'arm ablaté pour les arêtes) ; le fallback reste dans le chemin de RÉPONSE.
   Compteur « masking évité » (non-strict aurait refusé vacuous / strict admet) — sans lui le
   sous-apprentissage est invisible.
3. **[V4 — le foil UNGATED ne driftera pas live]** Canal planté = propositions CORRECTES ⇒ UNGATED==GATED
   dessus (démontre l'amortissement, pas le drift). Canal spontané-faux pré-enregistré POSSIBLEMENT-VIDE,
   reporté tel quel (8a) ; « crescent » REMPLACÉ par **« waterlogged » ball → deflated ?** (oracle
   incontestable : une balle détrempée garde sa forme). Le DRIFT se démontre sur le contrôle déterministe
   (+ DeFAb en G-EXT), jamais sur un oracle contestable (leçon G1a).
4. **[V5 — compteurs manquants]** Ajoutés : taux de RÉSOLUTION par arm (resolved/impracticable/wrong — lire
   le 0-false-admit CONTRE la couverture, le dual de « saves-calls-but-wrong ») · over-refusal · confond/
   jamais-ré-exercé · **memo-NÉGATIF durable** des tokens refusés + compteur de re-propositions évitées
   (sans lui l'invariant ≤1/(token,key) n'est vrai que pour les admis).
5. **[V6 — cadrage]** Le ring cible la variance **EXOGÈNE de la prose source** (die/circular/liquefied
   viennent du TEXTE) — pas les faits émis par le modèle, qu'un prompt closed-vocab canonicalise déjà
   (doctrine maison, qui servirait de foil sinon). Conséquence architecturale au probe : **l'intake G4
   extrait les formes de SURFACE verbatim (open-vocab) et le RING canonicalise** — la canonicalisation
   sort du modèle pour entrer dans l'objet auditable/rétractable. « Même porte 3 grains » se vend comme
   UNIFICATION d'invariant (attribution-unique ∧ verify), jamais identité d'implémentation (V3 SOUND :
   deux mécanismes duaux — provenance structurelle α / ablation contrefactuelle β ; G4 emploie les deux).

## Attendus pré-enregistrés

GATED **confirme** (support≥2, épisodes dé-confondus par construction) exactement {die→dice|cube (kind —
les deux sont spec-vrais et verdict-équivalents, le prior choisit), circular→round (holeName),
liquefied→melted (condition)} ; bénins damp/gleaming : 0 admis (vacuous), memo-négatif borne à ≤1
proposition chacun ; deflated : 0 proposition (in-vocab) ; waterlogged : canal spontané reporté
tel-qu'observé (possiblement vide ; si le modèle propose deflated → GATED refuse failed-verify, UNGATED
admet → dégât silencieux ×2). UNGATED == GATED sur les tokens plantés-corrects (l'amortissement, pas le
drift — pré-enregistré). faux-CONFIRMÉS GATED = 0 ; taux de résolution GATED ≥ UNGATED sur les cellules
sans canal faux. Prime GATED bornée (≤ #OOV propositions + refus). Si un attendu casse → protocole de
CRITIQUE §3 (méthode d'abord, repro minimal, patch borné ~1 cycle) avant tout verdict.
