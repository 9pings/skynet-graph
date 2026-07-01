---
name: skynet-graph-skills/capability-gap-ideation
description: Use when exploring what a system or codebase could become — an open-ended "what could this solve / what should we build next" ideation pass on an existing system. Especially when ideas must be GROUNDED in the real code and the state of the art (not wishful), and when the point is to bridge desired OBJECTIVES to current CAPABILITIES — what is reachable now (and with what arrangement) versus what is genuinely missing.
author: NBraun - https://github.com/9pings
---

# Capability-gap ideation

## Le principe (le pont bidirectionnel)

Ce n'est **pas** un brainstorm libre. C'est un **pont entre deux rives**, et la rive porteuse est souvent
celle qu'on oublie :

- **Sens AVANT (le facile)** : partir du système → *quels problèmes / innovations pourrait-il résoudre ?* →
  en déduire les améliorations pertinentes.
- **Sens ARRIÈRE (le porteur — « voire surtout »)** : partir de **ce qu'on aimerait que ça fasse / des
  objectifs**, puis faire **le lien avec ce qu'on sait déjà faire** — en mettant en exergue, pour chaque
  objectif : **ce qui est ACCESSIBLE maintenant** (et **avec quel arrangement** : quel réglage, quelle
  discipline, quel primitif déjà présent), et **ce qui MANQUE** pour y arriver (à **profondeur raisonnable**,
  sans sur-concevoir).

Le tout **ancré dans le code réel** (pas le folklore) et **positionné par rapport à l'état de l'art**. C'est
un **exercice multi-lentilles, multi-agents**, consolidé dans un (ou des) markdown par un agent dédié.

## Quand l'utiliser / quand pas

- **Utiliser** quand on demande « qu'est-ce que ce système pourrait résoudre / devrait devenir ? », pour
  cadrer une roadmap, confronter des objectifs au possible, ou préparer une étude de faisabilité.
- **Ne pas** utiliser pour un choix d'implémentation déjà tranché (→ design/plan), ni pour un fait unique
  (→ une recherche ciblée), ni quand il n'y a pas de système réel à ancrer (l'ancrage code est obligatoire).

## La méthode

1. **Recueillir les OBJECTIFS d'abord.** Ce qu'on voudrait que ça fasse (capacités visées, cas d'usage,
   « le rêve »), pas seulement « quels problèmes ça résout ». Les objectifs sont l'entrée du pont.
2. **Ancrer dans le système réel.** Lire le code + les docs (`fichier:ligne`). Une idée non ancrée ne vaut
   rien — on raisonne sur ce qui existe, pas sur ce qu'on croit qui existe.
3. **Classer chaque objectif contre les capacités actuelles** (la mise en exergue) :
   - `[ACCESSIBLE]` — faisable maintenant tel quel.
   - `[ARRANGEMENT: …]` — accessible **moyennant** un réglage / une discipline / un assemblage de primitifs
     existants — **nommer l'arrangement**.
   - `[MANQUE: …]` — pas atteignable sans une brique nouvelle — **nommer le manque** à profondeur raisonnable
     (assez pour estimer l'effort, pas une spec).
4. **Lancer plusieurs LENTILLES en parallèle** (un agent par lentille — voir le catalogue). Chaque lentille
   regarde le même système sous un angle d'expert distinct et produit son propre md.
5. **Étiqueter honnêtement chaque claim** (la discipline qui rend l'exercice utile) :
   - `REAL` — un edge défendable, vrai.
   - `OVERHYPED` — vrai mais mince / déjà-mieux-ailleurs / survendu.
   - `RISK` — un piège à ingénier autour.
6. **Positionner vs l'état de l'art** — citations réelles (auteur/année/système) ; marquer `[mémoire, à
   vérifier]` quand non sourcé. L'accessible et le manque se jugent *relativement* au SOTA.
7. **Classer par LEVIER** (leverage) — pas par enthousiasme. Quelle amélioration achète le plus, au moindre
   coût / risque ?
8. **Consolider** (un agent dédié) dans le markdown : **un fichier par lentille** + une **synthèse
   transversale** (les convergences inter-lentilles = les vrais signaux).

## Catalogue de lentilles (exemples — choisir celles qui collent au système)

| Lentille | Ce qu'elle cherche |
|---|---|
| **Domaine / produit** | les objectifs utilisateurs ; ce que le système rend *uniquement* possible |
| **Adversaire** | où le claim casse, ce qui est déjà fait en mieux ailleurs, les sur-claims |
| **Théorie / formalisation** | l'objet formel que le système *est* (nommer : monoïde, AO\*, JTMS, treewidth…) → relie à la littérature |
| **Live / incrémental / ops** | coût, fraîcheur, recompute, fiabilité à l'échelle |
| **Historique / audit / apprentissage** | provenance, défaisance, apprendre-de-l'échec |

## Contrat de sortie (par lentille)

- Une **thèse en une phrase** en tête (le cœur défendable sous cette lentille).
- Chaque claim **étiqueté** (`REAL`/`OVERHYPED`/`RISK`) **et ancré** (`fichier:ligne` ou citation SOTA).
- Chaque objectif visé classé `[ACCESSIBLE]` / `[ARRANGEMENT: …]` / `[MANQUE: …]`.
- Les recommandations **classées par levier**, pas listées à plat.
- À la fin : une synthèse qui croise les lentilles (ce sur quoi ≥2 lentilles convergent = prioritaire).

## Erreurs courantes

| Tentation | Réalité |
|---|---|
| Ne faire que le sens AVANT (système → idées) | Le porteur est l'ARRIÈRE : objectifs → pont vers le possible. Sans ça, on liste des features, on ne modélise pas. |
| Idéer sans lire le code | Une idée non ancrée est du folklore. Toujours `fichier:ligne`. |
| Tout sonne génial (pas d'étiquette) | Sans `REAL/OVERHYPED/RISK`, l'exercice n'aide pas à décider. Étiqueter, surtout l'`OVERHYPED`. |
| Ignorer l'état de l'art | « Nouveau » sans SOTA = souvent déjà fait. Citer, vraiment. |
| Lister à plat | Classer par levier ; sinon le lecteur ne sait pas par où commencer. |
| Sur-concevoir le `[MANQUE]` | Profondeur raisonnable : assez pour estimer, pas une spec. |
| Capper l'expressivité pour « que ça rentre » | Les améliorations sont *additives* ; ne jamais réduire une capacité existante. |
