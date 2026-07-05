# LOG — Roadmap #2 : le LAB d'apprentissage des restrictions (le wedge défaisance, PRICÉ)

> **La question** : apprendre les restrictions sélectionnelles des slots par candidate-elimination —
> S = LGG(positifs) sur un treillis déclaré, négatifs SEULEMENT si blame-localisés — et **pricer le wedge**
> (Laurie avait re-pricé les négatifs : accélérateur + frein, PAS nécessité logique). Protocole confronté :
> `../../sota/2026-07-03-restriction-learning-lab-laurie.md` (8 verdicts, dont le FATAL 8a : sans DIVERGENCE
> entre l'oracle d'admission-positive et le contrat de blame, le wedge n'existe pas). Claim =
> **dynamics-to-a-known-target** ; la découverte-in-the-wild n'est PAS revendiquée ici.

## Le dispositif (déterministe, zéro GPU, zéro moteur — la RÈGLE d'apprentissage est l'objet testé)

- **learn-core.js** : treillis `isa` POSET déclaré (multi-parents ⇒ join NON-unique → **coupes parallèles**,
  la version-space §9 « parallèle=sûr », collapse par évidence — self-checks verts) ; S=LGG par join ;
  négatifs = exclusions (jamais de G énumérée) ; optimisme à horizon doublant, un positif vérifié désscelle.
  L'admission pendant l'APPRENTISSAGE : seuls les sorts BLOQUÉS refusent (hard evidence d'abord) — S est
  l'ARTEFACT appris (le gate du dispatch d'après), pas un filtre du stream (le gater affamerait l'apprenant
  de l'évidence qui le généralise — et violerait le compte exact « A ne freine jamais »).
- **stream-lab.js** : 2 treillis (b≥3 feuilles sous chaque coupe-cible + la paire multi-parents genre/topic) ×
  3 permutations × ρ∈{0,.1,.3} ; **deux atomes d'oracle DIVERGENTS** (succès superficiel permissif — un mauvais
  filtre matche des lignes par accident = le FAUX-POSITIF qui soulève la LGG de A — vs contrat profond par-slot
  localisant) ; 2 canaux de bruit **corrélés-rare** : N1 = faux-échec non-localisable sur la 1re occurrence de
  chaque sorte rare (∝1/freq) ; N2 = wrong-blame flippé vers la sorte BONNE-RARE de l'autre slot. L'apprenant
  ne lit QUE les atomes pass/fail (jamais la table de types — 8c).
- 4 arms sur streams IDENTIQUES : **A** = LGG-seul · **B** = +négatifs blame-localisés (veto du positif sur
  violation profonde ; non-localisé → JETÉ) · **C** = +tout-échec-négatif partout (le contrôle UNSOUND) ·
  **D** = B + optimisme.

## RESULTS — 126/126 checks pré-enregistrés PASS, sur les 18 cellules, par-cellule jamais moyenné

Les quatre dynamiques prédites, toutes mesurées dans chaque cellule :

1. **Le WEDGE existe et vaut exactement L_bad − |premières-expositions|** : A over-gen = **16** (toutes les
   arrivées bad — A ne freine jamais) vs B = **8** à ρ=0 (une exposition inévitable par (facette × sorte bad),
   la borne théorique atteinte). Le prix de la défaisance-comme-frein : **−50 % d'erreurs de sur-généralisation**
   sur ce stream, à sur-resserrement NUL (B onGood = 0 = A à ρ=0).
2. **A CONVERGE — au MAUVAIS point-fixe** (la correction 8b de Laurie, mesurée) : S_filter(A) = `["column"]`
   dans TOUTES les cellules (soulevé par les faux-positifs superficiels) ; **S_filter(B) = `["categorical"]`**
   (la cible) partout. Le wedge n'est pas « A n'apprend pas », c'est « A apprend TROP LARGE sans frein ».
3. **C s'auto-scelle, de façon monotone, sur les rares** : C onGood = 2-14 refus de tâches BONNES (concentrés
   sur les sortes rares que N1 a frappées — la signature live), jamais récupérés. B à ρ=0 : 0. L'asymétrie Q2
   (sur-généralisation s'auto-corrige, sur-resserrement non) rendue visible.
4. **B(ρ) dégrade sous wrong-blame ET D récupère, à prime visible** : à ρ>0, B scelle des bonnes-rares
   (onGood 3) ; D finit avec ≤ scellées (2-3) au prix de **extraMounts=2 + over-gen 5-6 vs 4** — l'assurance
   n'est pas gratuite (Laurie 5), et à ρ=0 D ≡ B (la prime ne se paie que s'il y a quelque chose à assurer sur
   ce stream court — les re-visites des bads n'atteignent pas l'horizon).

**Dynamique non-prévue, consignée honnêtement** : à ρ>0, B over-gen DESCEND (8→4) — un mauvais scellement
(la bonne-rare flippée) REFUSE collatéralement les événements bad qui portent cette sorte sur l'autre slot :
un faux-blame peut « protéger » par accident tout en gonflant l'over-narrow. Artefact de dynamique réel, à
garder en tête pour la lecture des métriques live (les deux compteurs doivent TOUJOURS être lus ensemble).

## Verdict

**Le wedge défaisance est PRICÉ, dans le cadre honnête** : les négatifs blame-localisés achètent (i) le
contrôle-G (la cible tenue vs le point-fixe trop large), (ii) −50 % d'over-gen transitoire, (iii) zéro
sur-resserrement — MAIS uniquement si le blame est localisé (C montre le prix du non-localisé) et avec
l'optimisme comme assurance payante contre le faux-blame (D). « Le drift est le maître » tient — précisément
au sens re-pricé : le maître ACCÉLÈRE et FREINE un apprenant qui convergerait de toute façon, trop large.

## NEXT (le rung live, gates Laurie 7 pré-enregistrés)

Découverte AUTONOME du frame depuis les traces live du modèle : (i) **gate de stabilité d'émission SÉPARÉ et
préalable** (emittability/FactsDigest par-step — instable ⇒ « seam cassé », jamais « indécouvrable ») ;
(ii) épisodes ∩ seed-de-déclaration (t6/t8) = ∅ ; (iii) pré-report verbatim du frame découvert. Scope :
frame-EXISTENCE (2-4 épisodes), pas le niveau de restriction. + Item ouvert flaggé (8d) : le crédit POSITIF
composite doit se localiser comme le blame (`postFrom` côté succès) — probe séparé.

---

## LE RUNG LIVE (live-discover.js, 3 cycles, gates Laurie 7) — VERDICT : PARTIEL, avec la bonne décomposition du problème

**G2 PASS** (épisodes t7/t9 ⟂ seed t6/t8, valeurs mutuellement disjointes). **G1, cycle 1 (brut)** : émission
per-step **INSTABLE** sur les deux épisodes — le modèle émet LE MÊME plan à deux granularités
(`[agg,agg,check,emit]` vs `[filter+agg,filter+agg,check,emit]`), reliées EXACTEMENT par le digram
`(filter,aggregate)` du GO-gate, et fuit des mots d'OPÉRATION (« sum », « larger ») dans `value` hors des
steps filtrants. Verdict G1 honoré : « seam instable », pas « indécouvrable ».

**Cycle 2 (patch 1 — le CANON STRUCTUREL)** : fold digram `[filter(f,v), aggregate] → aggregate(f,v)` +
whitelist fail-closed des faits (filter/agg seulement, valeur ∈ vocab de la donnée). **⇒ SHAPE post-canon
STABLE sur les deux épisodes, reproduit sur 2 process-runs** — le digram de compress.js, inutile pour
l'élision, est LOAD-BEARING comme canon de structure (la barrière de canonicalisation appliquée à la
STRUCTURE, avec une équivalence apprise par le système lui-même).

**Cycle 3 (patch 2 — le MERGE de consensus inter-phrasings, la thèse redondance de l'owner)** : les faits
manquants d'un phrasing comblés par l'autre, conflit → vide (fail-closed). **⇒ la complétude des faits
par-slot reste flaky** (run 3 : le slot 0 de t9 vide dans LES DEUX phrasings — rien à merger) → la
cristallisation refuse (« no admissible » : le skeleton diffère par les clés de faits présentes). Caveat
transverse : les émissions varient AUSSI entre process-runs (non-déterminisme GPU inter-process, memo
intra-process seulement — le caveat RUN-3 documenté).

**LA CONCLUSION D'ARCHITECTURE (le vrai livrable du rung)** : le contraste est net — le MÊME modèle a extrait
ces MÊMES params **20/20 à l'INTAKE** (Probe #1, prompt d'extraction dédié) mais ne les émet pas fiablement
PENDANT le décompose. La division du travail du Probe #1 est donc la bonne AUSSI pour la découverte :
- le DÉCOMPOSE fournit la **SHAPE** — stable post-canon (démontré ici) ;
- l'INTAKE fournit les **PARAMS** — stable en extraction dédiée (démontré au Probe #1) ;
- la découverte de frame = shape canon-foldée + params placés par rôle aux positions `aggregate` → la trace
  ainsi composée cristallise et la LGG troue (le chemin du self-test, dont chaque pièce est maintenant
  certifiée séparément). **À composer au prochain rung — plus aucun élément n'est incertain, il reste le
  câblage.**

Fichiers : `live-discover.js` (les 3 gates, le canon, le merge) · `RESULTS-discover.json` (dernier run).

---

## LE RUNG-2 (live-discover-2.js) — VERDICT : **FRAME DISCOVERED ≡ DECLARED** (le câblage shape × params tient au premier coup)

**Le câblage de la conclusion d'architecture du rung-1, mesuré** : le décompose fournit la SHAPE (post-canon),
l'intake fournit les PARAMS (le prompt d'extraction Probe-#1), le placement met (a, b) dans l'ordre de mention
aux 2 positions `aggregate` de la shape — la trace composée ne consomme QUE des sorties du modèle (les golds ne
servent qu'aux gates G2 et au report de transparence). Protocole pré-enregistré dans l'en-tête du script.

**Les gates, tous PASS (run de référence 2026-07-03, ~2 min GPU, 8 calls)** :
- **G0 — le fold est APPRIS, plus déclaré** : `compress.js#foldSubpaths` (l'objectif MDL ΔL du GO kill-gate)
  sur les 23 variantes de shapes RUN-8 capturées (diag-freq.log) + deux contraintes déclarées (a≠b : plier la
  répétition effacerait des slots ; fact-safety : a∈factKinds ⇒ b∈factKinds — un fold n'efface jamais une
  position porteuse de faits) ⇒ **exactement `(filter→aggregate)` admis** (ΔL −59.3, support 30) — les 7
  autres digrams rejetés. Le canon du rung-1 est maintenant DÉRIVÉ du corpus du système par la lib elle-même.
  [Critique §3, 1 cycle : mon gate v1 (« le fold mappe une variante observée sur une autre ») était trop
  strict — la variance de granularité co-occurre avec la variance de QUEUE dans ce dump (le finding RUN-8
  lui-même) ; l'admission MDL est le critère déjà GO-validé, pas un critère inventé.]
- **G2** : t7/t9 ⟂ seed t6/t8, valeurs mutuellement disjointes (pending/overdue ⟂ Stark/Wayne).
- **G1a** : shape post-canon **STABLE ×2 épisodes ×2 phrasings** — `[aggregate,aggregate,check,emit]` partout
  (et reproduite sur 2 process-runs : le run pré-fix vocab lisait les mêmes shapes — le caveat GPU
  cross-process ne s'est pas manifesté ici).
- **G1b** : params **exact ×2 épisodes** entre phrasings (la brique `canon.js#snapToVocab` en barrière ;
  compteurs expliqués : t7 kept 4 ; t9 kept 2 + **2 OOV véridiques — « Stark » n'existe pas dans la donnée**
  (vocab client = Globex/Initech/ACME/Wayne), le corpus a fait de t9 un compare à côté zéro ; l'OOV est gardé
  brut, le chemin honnête). Transparence : extraction == gold sur les 2 épisodes (jamais une entrée).
- **Crystallisation ADMISE** (le refus « no admissible » du cycle-3 disparaît : les faits placés depuis
  l'intake sont complets par construction) · LGG stable · **slots découverts ≡ déclarés Probe-#1** :
  `aggregate#0.field/.value, aggregate#1.field/.value` (G3 verbatim avant comparaison) · spend structurel
  eval 2 / expand 2 (le prix de première dérivation, seeds justifiés).

**La lecture** : la découverte AUTONOME de frame est fermée au niveau EXISTENCE — le caveat « frame déclaré »
du Probe #1 tombe : le même pipeline (shape canon-foldée × params intake placés par rôle) produit le frame
depuis les émissions live SEULES, via le MÊME chemin crystallize→LGG que le self-test. La division du travail
Probe-#1 est validée aussi en découverte, et le canon structurel est désormais une brique lib
(`lib/authoring/canon.js`, commit `2fcc335`) dont le fold est miné+admis par MDL, plus déclaré à la main.

**Caveats** : N=2 épisodes, UN frame (compare), UN domaine-schéma ; claim d'EXISTENCE (pas un taux) ; le
niveau de restriction (sortes/coupes) reste celui du lab déterministe — le rung suivant est l'ÉCHELLE
POPULATION (direction owner). Fichiers : `live-discover-2.js` · `RESULTS-discover-2.json`.

---

## LE PROBE 8d (credit-probe.js) — VERDICT : le crédit POSITIF exige la MÊME localisation que le blame — PRICÉ (108/108, 18 cellules)

**La question (Laurie 8d, le dual flaggé au lab)** : un succès global crédité à TOUS les slots d'un composite
sur-généralise-t-il ? **La divergence qui fait exister le wedge (l'analogue 8a)** : les succès « côté-zéro »
— PASS global alors qu'un slot n'a PAS été exercé (filtre à 0 lignes, le gagnant reste juste par l'autre
côté). Signature réelle : le t9 Stark/Wayne du rung-2 (« Stark » absent de la donnée).

**Le dispositif** (déterministe, zéro GPU ; 2 treillis × 3 streams × 3 permutations, comptes exacts par
cellule via un oracle d'attente INDÉPENDANT — pure inspection du stream + garanties de design, jamais le
learner) : arms P-glob (succès crédite les 2 slots) vs **P-loc (crédite les rôles rendus par la brique lib
`attributeSlotCredit`** — provenance `slotPostFrom`, le même chemin canon que le blame) ; blame-gate B actif
dans les deux ; streams POISON (le côté-zéro porte une sorte BAD) / PREMIUM (il porte une sorte BONNE rare —
la face duale) / CONTROL (sans côté-zéro).

**Les résultats (tous exacts, pré-enregistrés)** :
- **POISON** : P-glob admissions non-vérifiées = #côté-zéro ; S(slot1) lift à `column` (trop large) ; og = les
  bads couverts après le poison (0/1/2 selon la permutation — l'oracle les prédit depuis l'ordre seul).
  **P-loc : 0 partout, endpoint = la coupe d'évidence.** Le canal blame est ARM-INVARIANT (mêmes blocked) —
  le poison du crédit ne se rattrape PAS par le blame sur ce stream.
- **PREMIUM (la face duale, obligatoire — og et lag se lisent ensemble)** : la localisation a un PRIX réel
  mais TRANSITOIRE — lag(P-loc) = +1 arrivée non-couverte par événement côté-zéro-bon (l'évidence refusée),
  endpoints ÉGAUX dès la première évidence exercée.
- **CONTROL** : sans côté-zéro les arms sont bit-identiques (le wedge exige la divergence — vérifié).
- Critique §3 en route (1 cycle) : l'oracle v1 omettait le lag de démarrage-à-froid du seed (arm-invariant) —
  le learner était juste, l'attente était fausse ; corrigé par la machine 3-états dérivée des garanties.

**Lib** : `parametric.js` (commit `a047f1a` + `a1cd88a`) — slotBindings/mountParametric PROMUS (3 réutilisations)
+ `slotPostFrom`/`attributeSlotBlame` (l'unanimité, le gate) + `attributeSlotCredit` (le dual per-atom —
asymétrie délibérée documentée : un atome vérifié est une évidence directe pour SON rôle ; un échec est une
disjonction de causes). `canonAtom` exporté d'adapt.js (source unique du canon d'atome). 9 tests unitaires ;
selftest Probe-#1 re-passé vert sur la délégation.
