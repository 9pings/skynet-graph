# Apprentissage de bibliothèque défaisable : des méthodes typées à contrats d'exécution qui se désapprennent à la dérive

**Nathanael Braun** · skynet-graph · 2026-06-29

---

## Résumé

Les agents LLM réutilisent leur travail passé via une mémoire *floue* — la recherche (RAG), le raisonnement à
partir de cas (CBR) et les bibliothèques de compétences en prose — qui rappelle par similarité de surface et n'a
aucune notion d'une prémisse devenant fausse. Lorsque le monde dérive d'une manière qui ne modifie pas la requête
elle-même, ces mémoires continuent de servir une réponse *périmée*. Nous présentons l'**apprentissage de
bibliothèque défaisable** : une bibliothèque apprise de *méthodes* typées et composables, chacune portant un
**contrat d'exécution défaisable**. Une méthode est supposée à la composition, **vérifiée à l'exécution** et —
lorsque sa postcondition induite échoue — **rétractée avec attribution de blâme** (un désapprentissage JTMS),
après quoi la bibliothèque est révisée chirurgicalement plutôt que jetée. La structure typée qui rend une méthode
canonicalisable rend aussi sa réutilisation *amortissable* et sa composition *vérifiable sur les seuls contrats*,
à contexte par appel borné. Nous évaluons les affirmations sur un moteur réel à base de règles, cohérent par JTMS,
en isolant chaque mécanisme (simulateur déterministe pour le modèle, plus une confirmation sur modèle réel). Les
constats : (E2) sous une invalidation de prémisse externe en cours de flux, les mémoires par rappel seul
(RAG / CBR / compétences en prose) servent du **périmé** (0 des cas de dérive), tandis que *tout* cache doté d'un
crochet d'invalidation récupère — ce qu'un **contrat typé déclaratif** ajoute à un rappel d'invalidation codé à la
main, c'est une éviction *sélective* et principielle (re-vérifier la post ; n'évincer que ce qui est violé), plus la
généralité et la sûreté de composition ; le tout à contexte par appel borné, confirmé sur un modèle local en réel.
(E1) le **transfert structurel** inter-problèmes est correct et gratuit sur les instances apparentées tenues à
l'écart tandis que l'ablation sans transformation est non saine — et le seul nombre d'appels ne peut les
distinguer, seule la vérification de sûreté le peut. (E3) une vérification de composition « boîte fermée » coïncide
avec la réalité « boîte ouverte » sur chaque paire évaluée (aucun faux-admis), et chacune des trois barrières de
sûreté est porteuse. (P4) l'amortissement est un **gradient** de la fraction canonicalisable, la sûreté
tient à chaque couverture, et amortir *au-delà* est non sain par construction. Aucun mécanisme n'est nouveau (JTMS,
contrats-à-blâme, apprentissage de bibliothèque, révision de théorie, empreintes de logique de séparation) ; la
contribution est leur **composition** en une bibliothèque de méthodes apprises réalisant un *désapprentissage
principiel et sélectif à la dérive*, ce que les mémoires d'agents par rappel seul ne font pas — borné par un
plafond K1 mesuré.

---

## 1. Introduction

Un agent qui résout de nombreux problèmes apparentés devrait devenir moins coûteux et plus fiable avec le temps.
La voie dominante aujourd'hui consiste à mémoriser et rappeler : stocker des solutions ou compétences passées,
retrouver la plus proche pour un nouveau cas, la réutiliser ou l'adapter. La génération augmentée par recherche
[Lewis et al. 2020], le raisonnement à partir de cas et les bibliothèques de compétences en prose comme Voyager
[Wang et al. 2023] partagent cette forme — et le même angle mort. Ils rappellent par similarité de *surface* et ne
représentent pas une *prémisse devenue fausse*. Quand le monde change d'une manière qui ne change **pas** la
requête — une réglementation se durcit, un fait est audité et trouvé faux, une politique est révoquée — la réponse
en cache reste le plus proche voisin, et elle est toujours servie. La mémoire est périmée avec assurance.

Les bibliothèques statiques (programmes appris, macro-opérateurs, compétences distillées [Ellis et al. 2021;
Bowers et al. 2023]) ont le problème inverse : saines à l'apprentissage, elles ne savent pas *désapprendre*. Aucun
mécanisme ne fait en sorte que l'arrivée d'un fait contradictoire rétracte une réutilisation auparavant justifiée.

Nous soutenons que l'ingrédient manquant est un **contrat typé défaisable** attaché à chaque unité réutilisable.
Empruntant aux contrats logiciels avec blâme [Findler & Felleisen 2002] et à la vérification graduelle [Bader,
Aldrich & Tanter 2018], une méthode déclare ce qu'elle lit, ce qu'elle écrit, ce qu'elle exige et ce qu'elle
garantit — sur un alphabet de faits *typé*. La garantie d'une méthode *apprise* est une hypothèse induite : elle
est donc **supposée** à la composition, **vérifiée** à l'exécution et **rétractée avec blâme** en cas de
violation. La rétractation est une opération de maintien de la vérité [Doyle 1979; de Kleer 1986] : la clôture de
dépendance de la prémisse falsifiée s'effondre et aucune croyance fausse n'est servie ; la bibliothèque est
ensuite révisée en *spécialisant* la précondition fautive, non en supprimant la méthode.

La même structure typée procure deux propriétés supplémentaires. D'abord, la réutilisation **amortit** : une
méthode dont l'applicabilité et les effets sont entièrement typés a une clé canonique stable, donc les cas
récurrents éludent l'appel au modèle. Ensuite, la composition est **vérifiable sans ouvrir la boîte** : deux
méthodes se composent sainement si et seulement si, sur les clés typées que l'une écrit et l'autre lit, la
postcondition de la première implique la précondition de la seconde — une vérification décidable sur un alphabet
fini [O'Hearn, Reynolds & Yang 2001; Reynolds 2002] qui permet à un superviseur de porter des *contrats*, pas des
corps, gardant le contexte par appel borné.

Cette puissance est bornée par une unique contrainte honnête que nous appelons **K1** : seule la structure typée,
canonicalisable, amortit ; un composant de décision véritablement en prose reste dans le modèle. Nous en mesurons
la conséquence plutôt que de la masquer.

Nous employons *apprentissage de bibliothèque* au sens établi de DreamCoder et Stitch [Ellis et al. 2021; Bowers
et al. 2023] — induire des méthodes typées réutilisables à partir de traces par abstraction — non au sens d'un
ajustement statistique de paramètres ; on pourrait tout aussi bien parler d'*induction de méthodes*. La nouveauté
ici n'est **pas** l'induction (qui relève de l'état de l'art) mais le **contrat défaisable** qui permet de
*désapprendre* une méthode induite. Le changement est de l'ordre du flot de contrôle : là où une mémoire par
similarité fait `requête → retrouver → réutiliser`, la nôtre fait
`requête → retrouver-le-contrat → vérifier → exécuter → contrôler → rétracter → spécialiser`. Le suffixe
contrôler-et-rétracter — absent de la recherche, du CBR et des bibliothèques de compétences — fait toute la
différence, et c'est lui que les expériences isolent.

**Contributions.** (1) Le cadrage des méthodes d'agent réutilisables comme **non-terminaux typés à deux faces dotés
d'un contrat d'exécution défaisable**, et la boucle supposer / vérifier / rétracter-blâmer / réviser qui se
désapprend à la dérive. (2) Une évaluation reproductible, isolant les mécanismes, sur un moteur réel — la mémoire
par rappel seul ne peut pas désapprendre tandis qu'un contrat typé déclaratif récupère la dérive *sélectivement,
généralement, sûrement-en-composition* (E2, simu + réel, avec une référence Invalidant équitable) ; transfert
structurel sain que le seul nombre d'appels ne certifie pas (E1) ; aucun faux-admis sur les compositions évaluées,
chacune des trois barrières ablée (E3) ; amortissement en gradient de la fraction canonicalisable (P4). Nous
explicitons ce que chaque expérience établit ou non (petit n, simulateur déterministe, modèle réel unique).

---

## 2. Approche

### 2.1 L'objet : une méthode à deux faces

Une **méthode** est, pour son appelant, une boîte noire unique dotée d'un contrat typé ; à l'intérieur, c'est une
ou plusieurs *productions* qui la réalisent (séquence, branchement, map, fold). Formellement c'est un non-terminal
de remplacement d'hyperarêtes [Habel 1992; Drewes, Kreowski & Habel 1997] à sélection conditionnée par
précondition [Erol, Hendler & Nau 1994]. Nous tenons deux régimes séparés par *intention de conception* (nous ne
prouvons pas la décidabilité ici) : la **grammaire des méthodes** (sélection, paramétrage, composition) est
*censée* rester décidable via un rang de montage bien fondé et un petit ensemble d'invariants de typage —
l'existence d'un plan HTN récursif est indécidable en général [Erol, Hendler & Nau 1996], ce qui justifie la
restriction au fragment bien fondé — tandis que l'**exécution** sur des données de taille d'exécution est une
couche explicitement bornée par un budget (« carburant »), Turing-complète. Le lien à la définissabilité en logique
monadique du second ordre [Courcelle 1990] est offert comme motivation de la *traitabilité possible* des
vérifications grammaticales, non comme un théorème établi ici ; une preuve de décidabilité est laissée en travaux futurs.

### 2.2 Le contrat : un triplet de séparation défaisable

Une méthode déclare une **empreinte de lecture**, une **empreinte d'écriture**, une **précondition** sur ce
qu'elle lit, une **postcondition** sur ce qu'elle écrit et une **étiquette d'effet**. La composition sous état
partagé est le problème du cadre [McCarthy & Hayes 1969] ; nous le levons par une discipline d'empreintes issue de
la logique de séparation [O'Hearn, Reynolds & Yang 2001; Reynolds 2002] sur l'alphabet typé fini — le régime
traitable, sans aliasing. Pour une méthode *apprise* la postcondition est une hypothèse induite : **supposée à la
composition, vérifiée à la stabilisation, rétractée avec blâme en cas de violation** [Findler & Felleisen 2002;
Bader, Aldrich & Tanter 2018]. Le moniteur d'exécution est le JTMS [Doyle 1979], et le résultat est une sûreté
*éventuelle* (non statique) — précisément le désapprentissage qui manque aux références floues.

### 2.3 Le pipeline et le plancher K1

Une formulation humaine est typée en un but ; une méthode est sélectionnée et composée sur contrats ; les cas la
traversent ; les traces distillent (anti-unification [Plotkin 1970] ; filtrées par MDL comme dans
DreamCoder/Stitch [Ellis et al. 2021; Bowers et al. 2023]) en de nouvelles méthodes typées ; la dérive rétracte.
Le repli universel est le **plancher de micro-tâches** : tout ce qui ne se réduit pas à une méthode typée en cache
se réduit à une micro-tâche qu'un petit modèle traite aisément. Ainsi un contrat *manquant* coûte un appel modèle
bon marché (un gradient de coût gracieux), et un contrat *faux* est rattrapé par la vérification d'exécution — les
deux modes de défaillance dégradent respectivement le coût et déclenchent le désapprentissage, jamais une erreur
silencieuse.

---

## 3. Mise en œuvre

Tous les mécanismes sont réalisés sur un moteur existant de graphe de faits typés à base de règles, cohérent par
JTMS, à concepts déclaratifs et stabilisation par chaînage avant, sans modification de son cœur hormis une option
de requête additive et rétrocompatible. La clé de mémoïsation typée est le condensé de canonicalisation du moteur ;
le vérificateur de contrat défaisable (implication à la composition sur domaines abstraits, une assertion de
postcondition à l'exécution, et trois barrières de sûreté) et la transformation de transfert structurel
(relativiser-au-stockage / lier-au-rejeu) sont des bibliothèques hôtes au-dessus du moteur. Un exécuteur de cas qui
fait tourner les méthodes validées de façon durable à l'échelle est un artefact d'ingénierie connu (un réseau de
workflow [van der Aalst 1998] sur un magasin durable, dans la lignée d'AWS Step Functions Distributed Map [AWS
2022], du cache de contenu de Prefect, et de DBOS [Skiadopoulos et al. 2022]) ; notre vue-croyance se situe
au-dessus.

Le cycle de vie défaisable — **supposer → vérifier → contrôler → rétracter → spécialiser** — est tout le
mécanisme, en correspondance un-à-un avec les fonctions du moteur qu'il appelle :

```
select(but):                                    # SUPPOSER (à la composition)
    M ← bibliothèque.match(but.faits_typés)     #   clé typée ; un échec retombe au plancher de micro-tâches
    supposer M.contrat                          #   checkCompose : post(préc.) ⊨ pre(M) ; escalade, jamais faux-admis

apply(M, cas):                                  # VÉRIFIER + CONTRÔLER (à l'exécution)
    clé ← digest(cas.prémisse_typée)            #   clé canonique K1
    si memo.has(clé) : retourner memo[clé]      #   amortir un cas typé récurrent
    sortie ← run(M, cas)                        #   sinon dériver (appel modèle / sous-graphe)
    si non assertPost(M.contrat, sortie) :      #   la post tient ? + G1 complétude-de-cadre + G2 oracle-d'effet
        quarantaine(cas) ; blâmer(M.contrat)    #   ne jamais valider une mauvaise sortie
        retourner
    memo[clé] ← sortie ; retourner sortie

on ingest(fait):                                # RÉTRACTER + SPÉCIALISER (dérive)
    pour e dans memo t.q. e dépend de fait :     #   JTMS : re-vérifier chaque post affectée face au nouveau fait
        si non satisfies(e.contrat.post, e.faits ∪ {fait}) :
            rétracter(e) ; blâmer(e.contrat)     #   désapprendre : évincer l'entrée invalidée + attribuer le blâme
    bibliothèque.réviser(blâme) : pre ← spécialiser(pre)  #   reviseOnBlame (CEGIS) : restreindre la pre, sans supprimer
```

Le suffixe contrôler-et-rétracter est la seule partie absente d'une mémoire par similarité, et c'est exactement
celle que les expériences isolent.

---

## 4. Expériences

### 4.1 Dispositif

Les expériences tournent sur le moteur réel ; le modèle fonctionne soit comme **simulateur déterministe** (un
oracle parfait de la règle *courante* étant donné uniquement ce que révèle l'invite de chaque bras — toute péremption
et tout coût proviennent donc du mécanisme du bras, non d'une erreur du modèle), soit comme **modèle local réel**
(`qwen36-q2-vram`). Un constructeur d'invite partagé rend le contexte par appel comparable entre bras. Chaque
exécution comparative est conditionnée par un **auto-test du banc** : sous le simulateur le bras naïf doit être
parfaitement correct, sinon l'instrumentation est cassée et l'exécution est avortée — réponse directe à un bug
antérieur où un bras obtenait 0/24 alors que ses nombres d'appels et de temps semblaient corrects. Tous les
résultats simulés sont déterministes au rejeu. **Précision de fidélité :** E1 et E3
**instancient le moteur complet** (graphe + stabilisation + JTMS) ; E2, P4 et E5 **isolent les fonctions** réelles
du moteur (`digest`, `satisfies`, `canonValue`) depuis un banc, sans la boucle de stabilisation — nous ne
prétendons pas qu'E2 exerce la rétractation JTMS native (il la ré-implémente sur le même prédicat réel). Sept bras
partagent une interface : **Naïf**, **Long-contexte**, **RAG**, **CBR** (clé typée, sans re-vérification),
**Compétence** (prose à la Voyager), **Invalidant** (la référence ÉQUITABLE : cache à clé typée + un rappel grossier
codé à la main qui jette toute une classe auditée à l'événement d'audit — un crochet d'invalidation mais pas de
contrat typé) et **Struct** (la bibliothèque typée au contrat défaisable — re-vérifie la post par entrée, n'évinçant
que ce qui est violé). Le bras Invalidant existe pour séparer « possède un mécanisme d'invalidation » de « possède
un contrat défaisable typé ».

### 4.2 E2 — défaisance à la dérive (le test décisif)

Un domaine d'approbation typé (N = 80, deux classes auditées ; l'exécution réelle utilise N = 48, une classe
auditée) avec une invalidation de prémisse *externe* en cours de flux : un audit de conformité marque une classe
non conforme, faisant basculer ses cas auparavant approuvés vers le refus. L'audit n'est **pas un champ
d'enregistrement** — il est exogène — donc un cache par rappel seul retrouve le même enregistrement inchangé et sert
sa réponse pré-audit. Résultats simulés :

| bras | appels | exactitude globale | **exactitude à la dérive** | contexte/appel max |
|---|---|---|---|---|
| **Struct** (contrat typé) | **26** | **1.00** | **1.00** | **290** |
| Invalidant (crochet, sans contrat) | 28 | 1.00 | 1.00 | 290 |
| Naïf | 80 | 1.00 | 1.00 | 290 |
| Long-contexte | 80 | 1.00 | 1.00 | 2062 |
| RAG | 48 | 0.95 | 0.00 | 290 |
| CBR (clé typée, sans re-vérification) | 24 | 0.95 | 0.00 | 290 |
| Compétence (prose) | 80 | 0.95 | 0.00 | 297 |

La lecture est triple. **Les mémoires par rappel seul (RAG / CBR / Compétence) servent du périmé** — le
rappel seul ne récupère pas, l'audit n'entrant jamais dans leur chemin de réutilisation. **La récupération exige un
mécanisme d'invalidation**, et l'Invalidant comme Struct en ont un, donc tous deux atteignent 1.00. Ce que le
**contrat défaisable typé ajoute au rappel codé à la main**, c'est (i) la **sélectivité** — Struct re-vérifie la
post par entrée (`satisfies`) et n'évince que les 2 classes *violées* (approve), là où le rappel jette grossièrement
des classes entières (4 entrées) et paie les re-dérivations supplémentaires (26 vs 28 appels) ; (ii) la
**généralité** ; (iii) la **sûreté de composition** (§4.4). L'exécution réelle (`qwen36-q2-vram`, N = 48) reproduit
ceci : RAG/CBR/Compétence 0.00 ; Invalidant 14 appels / 1.00 ; Struct 13 appels / 2,8 s / 1.00 / ctx 278 vs
Long-contexte 1304. L'affirmation défendable n'est donc pas « seul Struct récupère » mais « la mémoire par rappel
seul ne sait pas désapprendre, et un contrat typé déclaratif fournit la récupération de façon sélective, générale et
sûre en composition ».

### 4.3 E1 — amortissement et transfert structurel

Un domaine de décomposition structurelle (une méthode qui *crée* un sous-graphe avec des identifiants d'objets),
sur le **moteur complet**. Partition : entraînement, **apparentés tenus à l'écart** (mêmes transitions typées,
espaces d'identifiants frais) et **nouveau tenu à l'écart**. C'est un contrôle d'**existence-et-sûreté sur un petit
ensemble** (2 apparentés, 1 nouveau), **pas un taux de population** : avec la transformation relativiser/lier,
*toutes* les instances apparentées tenues à l'écart transfèrent à 0 appel et **sainement**, la transition nouvelle
paie (pas de faux rejeu), totaux 3 appels contre 5 pour la référence sans cache. L'ablation sans transformation (un
cache de contenu plat) « touche » les problèmes apparentés mais rejoue le *mauvais espace d'identifiants* — **non
sain**. Le point est qualitatif : une métrique fondée sur le seul nombre d'appels classe le cache plat à égalité
avec la transformation (les deux éludent) ; **seule la vérification de sûreté** distingue une réutilisation saine
d'un rejeu dans le mauvais espace d'identifiants. (Étendre cela à un *taux* de transfert sur de nombreuses méthodes
est un travail futur.)

### 4.4 E3 — sûreté de composition

En composant des paires de méthodes sur leurs seuls contrats typés (boîte fermée) et en comparant au résultat
moteur boîte ouverte (sur le **moteur complet**), la décision boîte fermée **coïncide avec la réalité sur chaque
paire évaluée, sans faux-admis** — le vérificateur n'accepte jamais à tort ; les paires sous-déterminées ou
hors-fragment *escaladent* (vers une micro-tâche) plutôt que d'admettre. C'est démontré sur un petit ensemble
construit à la main (3 paires couvrant sain / non-sain / escalade ; une 4ᵉ ajoute le cas oracle) : une
**démonstration d'existence** de la sûreté, **pas un taux** de faux-admis de population. Chacune des trois
barrières est porteuse sur un exemple dédié : retirer la complétude de cadre manque une écriture non déclarée ;
retirer l'étiquette d'effet admet silencieusement un effet externe non vérifié ; retirer la détection de cycle
d'empreintes admet un cycle couplé rétractable. La décision ne lit que l'empreinte partagée, jamais le corps ; le
vérificateur lui-même (entailment par domaines abstraits, sain-mais-incomplet) est l'artefact le plus développé et
plutôt sous-évalué ici. (Un corpus plus grand, non trié à la main, est un travail futur.)

### 4.5 P4 — le plafond de couverture K1

Sur une charge mixte (fraction *p* entièrement typée ; le reste portant un composant en prose qui prime sur la
règle typée), l'appartenance à K1 étant décidée par la **vraie** barrière de canonicalisation, l'amortissement est
un **gradient en couverture** (approbation : 0 → 19 → 44 → 69 → 94 % élidé à p = 0/0,25/0,5/0,75/1 ; tri : 0 → 22 →
47 → 72 → 97 %). L'exactitude de Struct est **1.00 à chaque couverture** — la fraction non typée est un *coût* de
micro-tâche, jamais une *falaise* de sûreté. Une variante gloutonne qui mémoïse les enregistrements porteurs de
prose sur leur clé typée chute à une exactitude égale à la fraction propre : **amortir au-delà de la fraction
canonicalisable est non sain**, donc le plafond K1 est une *frontière de sûreté*, pas une optimisation manquée. Le
résultat tient sur les deux domaines et est déterministe. Nous sommes explicites : c'est une **illustration
construite**, pas une mesure sur charge réelle — nous *fixons* p et *définissons* les enregistrements en prose pour
primer sur la règle typée, donc « amortir au-delà de K1 est non sain » découle par construction. Ce qu'elle établit,
c'est la *forme* (amortissement proportionnel à la couverture) et la sûreté à chaque niveau ; la fraction
canonicalisable d'un corpus réel est dépendante du domaine et non mesurée ici.

### 4.6 E5 — passage à l'échelle et coût par mécanisme

Un contrôle de **coût de bookkeeping**, pas une affirmation sur le passage à l'échelle de la partie difficile :
sur un espace typé de 200 classes avec un audit unique, quand la longueur du flux N croît de 1 320 à 20 320
(l'*ensemble des classes* est fixe ; aucune nouvelle méthode, aucun modèle) :

| N | appels Struct | appels / N | appels Naïf | bibliothèque (mémo) | évincés à la dérive |
|---|---|---|---|---|---|
| 1 320 | 202 | 0,153 | 1 320 | 200 | 2 |
| 5 320 | 202 | 0,038 | 5 320 | 200 | 2 |
| 20 320 | 202 | 0,010 | 20 320 | 200 | 2 |

Le nombre d'appels de Struct reste **constant** (le nombre borné de classes distinctes plus les re-dérivations de
dérive), donc le taux d'appels par enregistrement tend vers zéro tandis que Naïf reste à un ; la **bibliothèque est
bornée** par le nombre de classes, indépendamment de N ; et un événement de dérive **ne rétracte que les classes
invalidées** (2 évictions sur une bibliothèque de 200 entrées — O(invalidé), pas O(bibliothèque)). Les coûts par
opération sont faibles : la canonicalisation est ≈ 0,5–3,5 µs/appel (l'écart = chauffe JIT — ~3,5 µs à froid à
N=1 320, ~0,5 µs à N=20 320), et une passe d'éviction de dérive ≈ 0,5 ms sur toute la bibliothèque. Le contenu
honnête est étroit : le bookkeeping typé ne devient pas le goulet d'étranglement quand le flux croît. Il ne teste
**pas** le passage à l'échelle dans la dimension qui compte — une bibliothèque croissante de méthodes *distinctes*,
un corpus réel, ou un modèle réel sur tous les bras — laissé en travaux futurs.

---

## 5. Travaux apparentés

**Recherche et mémoire de cas.** RAG [Lewis et al. 2020] et CBR rappellent par similarité de surface/plongement et
réutilisent-ou-adaptent ; ils ne peuvent représenter une *prémisse devenant invalide*, donc un changement exogène
qui laisse la requête inchangée laisse la réponse en cache retrouvable et périmée (E2). Les bibliothèques de
compétences comme Voyager [Wang et al. 2023] stockent des compétences en *prose* sans prémisse typée défaisable,
donc une compétence périmée reste applicable et doit être ré-appliquée par le modèle — coût sans exactitude (notre
bras Compétence). Notre prémisse typée vit dans la croyance, donc quand elle tombe la dérivation se rétracte (JTMS)
et la bibliothèque restreint la méthode.

**Mémoire des agents LLM.** Les systèmes de mémoire d'agents récents gèrent *ce qu'il faut garder et rappeler* bien
plus finement que le RAG ordinaire — le contexte virtuel à étages de MemGPT/Letta [Packer et al. 2023], le tampon
épisodique de réflexion verbale de Reflexion [Shinn et al. 2023], et la recherche structurée par graphe comme
GraphRAG [Edge et al. 2024]. Mais ils rappellent et réutilisent par pertinence, récence ou similarité et, à notre
connaissance, aucun ne représente une *prémisse typée dont la falsification rétracte une réutilisation antérieure*.
Ils sont complémentaires plutôt que concurrents : un contrat défaisable pourrait se placer sous chacun d'eux comme
couche de rétractation. Une comparaison directe ajustée face à ces systèmes est l'évaluation suivante la plus
nette (§6).

**Long contexte.** Porter tout l'historique par appel est correct mais en O(N) de contexte par appel (E2 : 2062
contre 290) sans réutilisation structurelle.

**Apprentissage de bibliothèque / EBL.** DreamCoder [Ellis et al. 2021] et Stitch [Bowers et al. 2023] font
croître une bibliothèque par abstraction (anti-unification / MDL [Plotkin 1970]) ; l'EBG spécialise à partir d'une
seule preuve. Ils apprennent *quoi* réutiliser mais n'attachent aucun contrat d'exécution défaisable qui se
désapprend à la dérive ; nous ajoutons ce contrat et sa révision pilotée par le blâme.

**Contrats, blâme, vérification graduelle.** Les contrats d'ordre supérieur avec blâme [Findler & Felleisen 2002]
et la vérification graduelle/hybride [Bader, Aldrich & Tanter 2018] sont la lignée de notre discipline
supposer/vérifier/rétracter-blâmer ; nous l'appliquons aux méthodes *apprises*, en routant le blâme vers une
révision de bibliothèque plutôt qu'une erreur.

**Composition : grammaires de graphes, HTN, logique de séparation.** Une méthode est un non-terminal HRG à deux
faces [Habel 1992; Drewes, Kreowski & Habel 1997; Courcelle 1990] à sélection HTN conditionnée par précondition
[Erol, Hendler & Nau 1994] ; l'existence d'un plan HTN récursif est indécidable [Erol, Hendler & Nau 1996], donc
la grammaire reste décidable par un rang de montage bien fondé tandis que l'exécution est explicitement bornée par
budget. La composition saine sous état partagé est le problème du cadre [McCarthy & Hayes 1969], levé par une
discipline d'empreintes de logique de séparation [O'Hearn, Reynolds & Yang 2001; Reynolds 2002] sur un alphabet
typé fini (E3).

**Révision de théorie et de croyances (le voisin le plus proche).** `reviseOnBlame` — spécialiser une précondition
apprise à partir d'un contre-exemple plutôt que supprimer la méthode — relève de la **révision de théorie** d'une
base de règles *apprise* : EITHER [Ourston & Mooney 1994] et FORTE [Richards & Mooney 1995] révisent des théories
Horn sur des exemples contradictoires, exactement notre étape blâme→spécialiser ; la contraction/révision d'un
ensemble de croyances est l'**AGM** [Alchourrón, Gärdenfors & Makinson 1985]. Nous ne revendiquons aucun nouvel
opérateur de révision ; notre apport est opérationnel — attacher la révision à une *bibliothèque de méthodes typée,
composable, canonicalisable* à contrat d'exécution, de sorte qu'amortissement, vérification de composition et
désapprentissage partagent une représentation. Un relecteur de cette communauté lira à juste titre ce travail comme
de la révision de théorie habillée d'un contrat typé ; nous le positionnons ainsi.

**Maintien de la vérité.** Le mécanisme de désapprentissage est un JTMS [Doyle 1979; de Kleer 1986] : une prémisse
rétractée se propage à sa clôture de dépendance, ne servant aucune croyance fausse — la défaisance qui manque aux
références.

**Exécution durable et réseaux de workflow.** Un cas est un marquage 1-sûr non coloré sur un réseau de workflow
[van der Aalst 1998] ; l'exécuteur durable qui fait tourner les méthodes validées à l'échelle est un artefact connu
[AWS 2022; Prefect; Skiadopoulos et al. 2022]. Notre vue-croyance se situe au-dessus ; nous ne réinventons pas la
plomberie.

**Maintenance incrémentale de vues.** DBSP [Budiu et al. 2023] / Materialize maintiennent des *valeurs* de façon
incrémentale ; notre objet est une croyance typée, *défaisable*, auditable, à rétractation JTMS sur des
enregistrements figés — un contrat différent (rétracter des dérivations et attribuer le blâme, non recalculer des
agrégats).

---

## 6. Menaces à la validité

**Simulateur vs modèle réel.** Le simulateur déterministe retire l'erreur du modèle pour isoler le *mécanisme* de
chaque bras — précisément ce que nous affirmons. Il rend la comparaison reproductible, et l'exécution **réelle**
E2 confirme le même ordre avec un vrai modèle, où la péremption est effectivement produite par le modèle suivant
une prose périmée ou un succès de cache. Le simulateur ne prétend pas prédire l'exactitude absolue en réel ;
exécuter plus de bras en réel (E1/E3/P4 sont des expériences de mécanisme moteur et utilisent le modèle comme
compteur d'appels) est un travail futur.

**La couverture K1 est paramétrée.** P4 *fixe* la fraction typée et la *mesure* via la vraie barrière ; les
affirmations non circulaires sont la **forme** (un gradient), l'**universalité de la sûreté** (1.00 à chaque
couverture) et la **frontière de sûreté** (l'amortissement glouton est non sain). La fraction canonicalisable
absolue d'une charge de production donnée est dépendante du domaine et n'est pas prétendue élevée partout.

**Force des références.** RAG/CBR/Compétence sont nos implémentations ; le bras **Invalidant** isole « possède un
crochet d'invalidation » de « possède un contrat typé », de sorte que l'affirmation est précise : la mémoire par
rappel seul ne **peut pas** récupérer, et un contrat typé déclaratif récupère de façon sélective/générale/sûre-en-
composition. Une RAG/CBR à invalidation-événementielle *ajustée* est essentiellement le bras Invalidant et devrait
égaler Struct sur l'exactitude à la dérive, ne différant que sur la sélectivité/généralité — un face-à-face que
nous laissons en travaux futurs.

**Nouveauté / positionnement.** Aucun mécanisme n'est nouveau ; le travail est une *composition* (JTMS,
contrats-à-blâme, apprentissage de bibliothèque, révision de théorie, empreintes de séparation), et `reviseOnBlame`
est de la révision de théorie. Nous le positionnons comme l'unification opérationnelle, non un nouvel algorithme.

**Force des références (héritage).** RAG/CBR/Compétence sont nos implémentations ; une référence plus forte (p. ex. plonger
l'audit dans la clé) pourrait récupérer certains cas de dérive — mais seulement en traitant au cas par cas chaque
invalidation exogène, ce qui est exactement la défaisance que Struct fournit de façon générale. Le contrôle le
plus net est l'**ablation −contrat (CBR)**, identique à Struct hormis le contrat.

**Échelle et étendue.** Les expériences de mécanisme (E2–E4) utilisent un N modeste (≤ 80 par exécution E2) sur deux
domaines synthétiques à vérité-terrain connue ; E5 étend les mesures *déterministes* à N ≈ 20 k et une bibliothèque
de 200 méthodes (montrant que l'amortissement, la croissance bornée et la rétractation sélective tiennent, à coûts
par opération faibles). Ce qui reste un travail futur, c'est l'échelle avec un modèle *réel* et un corpus *réel* sur
un exécuteur durable, ainsi qu'une **comparaison directe ajustée face aux systèmes de mémoire d'agents modernes**
(MemGPT/Letta, Reflexion, GraphRAG) plutôt que les références internes au papier.

**La sûreté est éventuelle, non statique.** L'applicabilité d'une méthode apprise est indécidable en général
(Rice), donc la garantie est une sûreté éventuelle via un moniteur d'exécution porteur au-dessus d'une barrière à
la composition saine-mais-incomplète. Le moniteur doit tourner ; son absence réintroduit des faux-admis, comme le
montrent les ablations d'E3.

**Moteur unique / auteur unique.** Tous les résultats portent sur une seule implémentation ; une reproduction
indépendante sur un autre substrat renforcerait les affirmations structurelles.

---

## 7. Conclusion

La mémoire par rappel seul ne sait pas désapprendre ; les bibliothèques statiques sont saines mais figées. Une
bibliothèque apprise de méthodes typées dotée d'un **contrat d'exécution défaisable** obtient les deux : elle
amortit et compose sur la structure typée, et lorsqu'une prémisse dérive elle *rétracte avec blâme et révise* —
récupérant l'exactitude là où la recherche, le CBR et les bibliothèques de compétences servent du périmé. Nos
expériences l'isolent : le rappel seul ne récupère pas ; un crochet d'invalidation le peut ; et un contrat typé
*déclaratif* fournit cette récupération de façon sélective, générale et sûre-en-composition, à contexte par appel
borné, sur un moteur réel et confirmé sur modèle réel — borné par une fraction canonicalisable qui est elle-même
une frontière de sûreté. Chaque mécanisme relève de l'état de l'art (JTMS, contrats-à-blâme, révision de théorie,
apprentissage de bibliothèque, logique de séparation) ; la contribution est leur composition en une représentation
typée unique où amortissement, vérification de composition et désapprentissage coïncident. C'est, délibérément,
une synthèse d'ingénierie avec une propriété émergente testable — un désapprentissage principiel et sélectif —
plutôt qu'un nouvel algorithme ; nous pensons cette propriété digne d'être nommée et mesurée.

---

## Références

- C. E. Alchourrón, P. Gärdenfors, D. Makinson. *On the Logic of Theory Change: Partial Meet Contraction and Revision Functions.* Journal of Symbolic Logic 50(2):510–530, 1985.
- AWS. *Step Functions Distributed Map — A Serverless Solution for Large-Scale Parallel Data Processing.* AWS, 2022.
- J. Bader, J. Aldrich, É. Tanter. *Gradual Program Verification.* VMCAI 2018, LNCS 10747, p. 25–46.
- M. Bowers, T. X. Olausson, L. Wong, G. Grand, J. B. Tenenbaum, K. Ellis, A. Solar-Lezama. *Top-Down Synthesis for Library Learning.* POPL 2023 ; Proc. ACM Program. Lang. 7(POPL).
- M. Budiu, T. Chajed, F. McSherry, L. Ryzhyk, V. Tannen. *DBSP: Automatic Incremental View Maintenance for Rich Query Languages.* PVLDB 16(7):1601–1614, 2023.
- B. Courcelle. *The Monadic Second-Order Logic of Graphs I: Recognizable Sets of Finite Graphs.* Information and Computation 85(1):12–75, 1990.
- J. de Kleer. *An Assumption-based TMS.* Artificial Intelligence 28(2):127–162, 1986.
- J. Doyle. *A Truth Maintenance System.* Artificial Intelligence 12(3):231–272, 1979.
- D. Edge, H. Trinh, N. Cheng, J. Bradley, A. Chao, A. Mody, S. Truitt, J. Larson. *From Local to Global: A Graph RAG Approach to Query-Focused Summarization.* arXiv:2404.16130, 2024.
- F. Drewes, H.-J. Kreowski, A. Habel. *Hyperedge Replacement Graph Grammars.* In Handbook of Graph Grammars and Computing by Graph Transformation, Vol. 1 (G. Rozenberg, dir.), World Scientific, p. 95–162, 1997.
- K. Ellis, C. Wong, M. Nye, M. Sablé-Meyer, L. Morales, L. Hewitt, L. Cary, A. Solar-Lezama, J. B. Tenenbaum. *DreamCoder: Bootstrapping Inductive Program Synthesis with Wake-Sleep Library Learning.* PLDI 2021.
- K. Erol, J. Hendler, D. S. Nau. *UMCP: A Sound and Complete Procedure for Hierarchical Task-Network Planning.* AIPS 1994.
- K. Erol, J. Hendler, D. S. Nau. *Complexity Results for HTN Planning.* Annals of Mathematics and Artificial Intelligence 18:69–93, 1996.
- R. B. Findler, M. Felleisen. *Contracts for Higher-Order Functions.* ICFP 2002, p. 48–59.
- A. Habel. *Hyperedge Replacement: Grammars and Languages.* LNCS 643, Springer, 1992.
- P. Lewis, E. Perez, A. Piktus, F. Petroni, V. Karpukhin, N. Goyal, H. Küttler, M. Lewis, W. Yih, T. Rocktäschel, S. Riedel, D. Kiela. *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.* NeurIPS 2020.
- J. McCarthy, P. J. Hayes. *Some Philosophical Problems from the Standpoint of Artificial Intelligence.* Machine Intelligence 4, 1969.
- P. W. O'Hearn, J. C. Reynolds, H. Yang. *Local Reasoning about Programs that Alter Data Structures.* CSL 2001, LNCS 2142, p. 1–19.
- D. Ourston, R. J. Mooney. *Theory Refinement Combining Analytical and Empirical Methods.* Artificial Intelligence 66(2):273–309, 1994.
- C. Packer, S. Wooders, K. Lin, V. Fang, S. G. Patil, I. Stoica, J. E. Gonzalez. *MemGPT: Towards LLMs as Operating Systems.* arXiv:2310.08560, 2023.
- G. D. Plotkin. *A Note on Inductive Generalization.* Machine Intelligence 5:153–163, 1970.
- Prefect. *Caching* (mise en cache de résultat/tâche par clé de cache). Documentation Prefect 3.
- J. C. Reynolds. *Separation Logic: A Logic for Shared Mutable Data Structures.* LICS 2002, p. 55–74.
- B. L. Richards, R. J. Mooney. *Automated Refinement of First-Order Horn-Clause Domain Theories.* Machine Learning 19(2):95–131, 1995.
- N. Shinn, F. Cassano, A. Gopinath, K. Narasimhan, S. Yao. *Reflexion: Language Agents with Verbal Reinforcement Learning.* NeurIPS 2023.
- A. Skiadopoulos, et al. *DBOS: A DBMS-oriented Operating System.* PVLDB 15(1):21–30, 2022.
- W. M. P. van der Aalst. *The Application of Petri Nets to Workflow Management.* J. Circuits, Systems and Computers 8(1):21–66, 1998.
- G. Wang, Y. Xie, Y. Jiang, A. Mandlekar, C. Xiao, Y. Zhu, L. Fan, A. Anandkumar. *Voyager: An Open-Ended Embodied Agent with Large Language Models.* arXiv:2305.16291, 2023.

---

*Code & reproductibilité : le moteur et l'artefact d'expérience autonome sont publics sur
`github.com/9pings/skynet-graph` — `artifact/paper-dll/` (workload.js, arms.js, harness.js, e1-transfer.js,
e3-compose.js, p4-coverage.js, scale.js, measure-e2-live.js, F6-transfer.js) avec la suite déterministe
`tests/integration/paper-{harness,e1-transfer,e3-compose,p4-coverage,scale}.test.js` (`npm test`). L'E2 en réel
utilise un endpoint local compatible OpenAI (`qwen36-q2-vram`). Sous licence AGPL-3.0-or-later.*
