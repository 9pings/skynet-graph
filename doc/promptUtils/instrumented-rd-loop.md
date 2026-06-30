---
name: instrumented-rd-loop
description: Use when doing open-ended R&D, a feasibility study, or design/architecture exploration on a real system — when intuitions must become verified, MEASURED findings grounded in the actual code rather than arguments; when a result surprises and you must understand the mechanism before concluding; or when tempted to conclude from a green check or a second-hand subagent diagnosis. Keywords: feasibility, ideation follow-through, negative control, verify-before-build, root cause, minimal repro, instrumented, measurable.
---

# Instrumented, incremental R&D loop

## Le principe

La peur de fond, dans toute R&D ambitieuse, c'est le **« trou sans fond »** (on creuse sans jamais savoir
si on avance). La réponse : une R&D **instrumentée et incrémentale** — chaque barreau est **testé sur le
système réel** et **inspectable**, donc la valeur est **mesurable** à chaque pas. Un avis non ancré ne vaut
rien ; un chiffre vert qu'on ne sait pas expliquer non plus.

## Directives fondatrices

1. **BUILD, pas thin-layer.** Implémenter, ne pas re-litiger, ne pas downscoper.
2. **Agir en pro.** Déduire et **construire les outils** nécessaires ; ne pas attendre des specs détaillées.
3. **Sous-agents pour les aspects profonds** (exploration, SOTA, débats, lentilles spécialisées).
4. **Step back entre les phases** ; ne pas enchaîner mécaniquement.
5. **Pas de Q&A incrémental.** Avis tranché d'abord ; une question seulement si elle **change l'action**.
6. **Ne jamais capper l'expressivité.** Valider la *structure*, pas la grammaire. Préférer **lever
   l'existant** à de la machinerie nouvelle.
7. **Tout ajout est additif** et marqué comme tel ; le socle existant reste le récit.

## 1. La macro-boucle (par sujet)

```
ÉTUDIER l'existant (code RÉEL + trail R&D) ─▶ AVIS tranché (fondé ? où est le vrai enjeu ?)
  ─▶ DÉBAT / SOTA multi-agents (lentilles opposées, citations réelles) ─▶ FORMALISER (objets formels nommés)
  ─▶ EXPÉRIMENTER sur le système réel (§2) ─▶ CRITIQUER (§3) ─▶ INTÉGRER aux docs ─▶ MAJ roadmap.
  Step back entre chaque.
```

- **Étudier avant d'opiner** : lire le code réel + le trail, pas le folklore.
- **Avis d'abord** : à « est-ce pertinent / cohérent ? », répondre franchement *avant* de lancer des agents.
- **Débattre le contestable** : faire s'affronter des positions (pro / contra / théorie) ancrées code + SOTA,
  puis synthèse-juge.
- **Formaliser** : nommer le vrai objet (monoïde, semi-anneau, AO\*, JTMS, treewidth, CDCL, CRF…) — ça
  transforme une intuition en quelque chose de **vérifiable** et relié à la littérature.

## 2. La micro-boucle expérimentale (par claim)

**Chaque claim de la formalisation s'EXÉCUTE sur le système réel, il ne s'argumente pas.**

1. **Verify-before-build.** Vérifier l'API runnable réelle (lire le code / les tests) **avant** d'écrire un
   harness. Leçon dure et répétée : lire le code casse les hypothèses « free lunch » fausses.
2. **Harness partagé minimal** : boot in-process du vrai système, API d'observation au-dessus de l'opération
   qui amène à un état stable/observable.
3. **Un script par expérience**, chaque sous-test ciblant **un** claim **+ un CONTRÔLE NÉGATIF** (montrer
   que le test n'est pas vacuous : le cas qui *devrait* échouer échoue).
4. **Assertions + chiffres**, pas des impressions. Mesurer (taux de hit, taux d'erreur, regret, variance
   d'ordre, MSE… — les métriques réelles du domaine).
5. **Re-run déterministe** pour tout résultat à part aléatoire (Monte-Carlo, restarts) — confirmer la stabilité.

## 3. Le protocole de CRITIQUE (le cœur)

> **Une assertion verte ne suffit pas : le MÉCANISME doit être compris. Ne jamais reporter un chiffre dont
> on ne sait pas expliquer la cause.**

Quand une expérience **ne converge pas / surprend**, AVANT toute conclusion :

1. **Critiquer la MÉTHODE d'abord.** Est-ce un artefact d'instrumentation / de conception du test ? (tracer
   round-par-round). *Typique : une sonde qui lit un état persistant après invalidation → faux positif ;
   un corpus synthétique mal formé → mauvais ground-truth ; une métrique qui mesure le mauvais événement.*
2. **Trancher : MÉTHODE vs LIMITE RÉELLE ?** Reproduire **minimalement** la condition exacte. *Décisif : un
   sous-agent diagnostique « la cause est X » ; le repro minimal de la condition exacte se comporte
   parfaitement → c'était une MAUVAISE attribution, la vraie cause était ailleurs. Sans repro, on « corrige »
   un fantôme.*
3. **Si limite réelle : résoluble par une ADAPTATION ACCEPTABLE de l'existant** (discipline, pattern,
   primitif déjà là), ou exige un nouveau primitif cœur ? Marquer `[NO-CORE-CHANGE]` vs `[NEEDS-PRIMITIVE: X]`.
4. **Journaliser** l'adaptation (objectif · approche · adaptation critique-driven · résultat · verdict).

## 4. Vérifier avant de conclure

- **Re-run depuis un shell propre** ; un PASS sur la parole d'un sous-agent ne compte pas — re-vérifier soi-même.
- **Régression** : tout changement du **cœur / module load-bearing** → la **suite complète** reste verte
  + un **test de régression dédié** au bug corrigé.
- **Ne pas sur-affirmer** : un mécanisme flou, on le dit et on l'investigue ; on ne l'enrobe pas.

## 5. Debugging d'un vrai bug

`AUCUN fix sans cause racine d'abord.` Reproduire minimalement → cause racine **dans le code** → **une**
hypothèse → fix minimal **au point racine** (pas au symptôme) → test de régression (TDD) → suite verte.

## 6. Orchestration multi-agents

- **Quand fan-out** : sujets profonds décomposables (débat de positions, confrontation SOTA, tracks
  parallèles) — pas pour un fait unique. Hybride : scouter inline (lister le travail) **puis** orchestrer.
- **Grounding obligatoire** : chaque agent reçoit les faits vérifiés + le cadrage + les contraintes
  (invariants, socle). SOTA → **citations réelles** (auteur/année/système) ; sinon `[mémoire, à vérifier]`.
- **Structure** : positions/tracks en parallèle (barrière justifiée si la synthèse a besoin de tout) →
  synthèse-juge. **Vérifier soi-même les rendus** (re-run, repro) ; intégrer soi-même dans les docs.

## 7. Discipline documentaire (survivre à un restart)

- **`LOG.md`** par campagne : méthode + une section par expérience (objectif / approche / adaptations /
  critique / verdict) + synthèse transversale + note de vérification indépendante.
- **Études** (débat → synthèse → formalisation) et **SOTA** (confrontations + SYNTHÈSE) séparés.
- **Fil de lecture** (ordre de lecture de l'arc) pour qu'un tiers entre par le bon bout.
- **Ledger vivant** = état courant + roadmap priorisée ; y consigner les **findings** numérotés.
- **Mémoire persistante** : les décisions/verdicts **non dérivables du code**, pour les sessions futures.

## 8. Anti-patterns (rationalisations à refuser)

| Tentation | Réalité |
|---|---|
| « le sous-agent a dit que c'est X » | Reproduire d'abord. Les diagnostics de seconde main se trompent. |
| « c'est vert, donc compris » | Vert ≠ compris. Expliquer le mécanisme ou continuer à creuser. |
| « ça marche, pas besoin de contrôle négatif » | Sans contrôle négatif, le test peut être vacuous. |
| « je corrige le symptôme » | Cause racine d'abord. Fix au point d'origine. |
| « petit changement cœur, pas besoin de la suite » | Tout changement cœur → suite complète + test de régression. |
| « capper / restreindre pour que ça passe » | Ne jamais capper l'expressivité ; valider la structure. |
| « Q&A pour être sûr » | Avis tranché d'abord ; question seulement si elle change l'action. |
