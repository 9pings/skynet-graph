# LOG — Probe #1 : la RÉUTILISATION PARAMÉTRIQUE (argument-typing), mécaniques + LIVE

> **La question** (étude `../../studies/2026-07-02-argument-typing-selectional-restrictions.md` §7, protocole
> confronté : `../../sota/2026-07-03-parametric-reuse-probe-laurie.md`) : monter une méthode en PLAÇANT des
> params typés dans des slots role-typés — sans JAMAIS re-décomposer — découple-t-il la réutilisation de la
> stabilité de décodage ? La cible mesurée : le résidu des **11 productions re-payées** (racine compare +
> (compare→aggregate)) que NI le cache NI aucune clé structurelle ne couvre (borne-sup 0, cf.
> `../2026-07-03-digram-miner-elision/LOG.md`). Le headline n'est PAS l'élision (tautologique une fois monté) :
> c'est **sélection × extraction × soundness-du-partial sur prose externe**, contenu ANNULÉ (exécution
> déterministe depuis les params montés, attribuée comme telle — Laurie 8b).

## Les mécaniques (déterministes, vrai moteur, AVANT tout GPU) — 5 gates VERTS (selftest.js)

1. **Seed à params DISJOINTS** ({overdue,paid} ⟂ {open,closed}) → la LGG troue EXACTEMENT les positions de
   params : slots role-typés `aggregate#0/#1` sur `group` — les trous d'`antiUnify` SONT les slots.
2. **Combo inédit → mount ZERO-FIRE** (eval 0 / expand 0) + les feuilles calculent depuis les NOUVEAUX params
   (`cnt:11`/`cnt:4` — pas un replay des valeurs de seed).
3. **Null param-shuffle** : rôles échangés → réponses échangées (les params portent, les rôles comptent).
4. **Affamé** : param manquant → `impracticable` + hint typé `{role, key}` (« une sorte X en rôle Y »), zéro
   mutation, zéro fire (l'off-diagonale = 0 par construction au niveau mécanique).
5. **Déterminisme** RUN1≡RUN2 (seed→slots et mount→réponses).

Lib : `typed-loop opts.stepFacts` (commit `bb43eb3`) — les faits typés par-step atteignent l'enfant
(whitelist-only). Le reste = composition d'existant (`methodContentHoles`/`fillContentHoles`/`mountTemplate`).

## Le protocole LIVE (live-probe.js — pré-enregistré, gates dans le script)

- **Frame DÉCLARÉ** (Laurie 8 : library/human n'ont jamais formé de composite RUN-8 → non-cristallisable de
  leurs traces), matérialisé par le MÊME chemin crystallize que le self-test, params de seed = golds TRAIN
  dataops t6/t8 (`{status:overdue,paid}` ⟂ `{client:ACME,Globex}` — champs ET valeurs disjoints → 4 trous :
  field+value par slot aggregate). GATE : exactement 4 slots.
- **Compute gate** : le winner déterministe (Σ metric par filtre, argmax) == EXPECTED sur les 20 golds — AVANT
  le live (protège l'attribution CONTENT).
- **Intake live** (Qwen3.6-27B-Q2 embarqué, reasoningBudget:0, seed 0, memo run-scoped RUN-4) : extraction
  `{kind, metric, a:{field,value}, b:{field,value}}` — le SCHÉMA est donné, AUCUNE valeur du corpus n'est
  nommée. Cibles : dataops-heldout compare ×4 (ANCRE) · library compare ×8 · human compare ×8.
- **Attribution 3-canaux** ground-truthée : SELECTION (kind=='compare' vs gold) · EXTRACTION
  (exact | swap | wrong vs `intent.a/b`, la symétrie DÉCLARÉE = argmax commutatif → swap bénin pour la
  réponse, compté à part) · CONTENT = déterministe (attribué exécution-déterministe). Échec de canal →
  fallback COMPTÉ (jamais re-cristallisé).
- **ZERO-FIRE gate dur** sur chaque mount (eval 0 / expand 0). **Déterminisme** : double passe in-process
  (le memo) → identique.
- **INJECTION** : prose affamée (tronquée au connecteur) → l'intake doit rendre `b` ABSENT → hint ; les
  complétions sur prose affamée sont comptées (hallucination = la moitié dangereuse de l'off-diagonale).
- **NULL param-rotation** : les param-sets extraits tournés d'un cran entre tâches du groupe → l'accuracy doit
  chuter nettement sous l'accuracy réelle (sinon les params ne portent pas).

## RESULTS (2026-07-03, LIVE sur l'embarqué — 25 s, gates PASS) — ⇒ **GO : le découplage est DÉMONTRÉ**

**RUN 1 (sans barrière canon)** : anchor 4/4 · library **8/8** · human 7/8 — l'unique échec (h6) = le modèle a
extrait la SURFACE verbatim (`"already paid"` au lieu de `paid`, mon prompt disait « exactly as written ») →
0 lignes sommées → mauvais gagnant. Un cas d'école de la **barrière de canonicalisation** ; patch d'un cycle
(la méthode critique) = le canon-snap de l'intake contre le vocabulaire de LA DONNÉE que le système possède
(jamais les golds de test — zéro leakage).

**RUN 2 (avec la barrière — le run de référence)** :

| groupe | sélection | extraction exacte | swap | montées | **réponses OK** | fallbacks |
|---|---|---|---|---|---|---|
| dataops-anchor (4) | 4/4 | 4/4 | 0 | 4 | **4/4** | 0 |
| **library (8 — 0-split RUN-8)** | 8/8 | 8/8 | 0 | 8 | **8/8** | 0 |
| **human/cross-model (8 — 0-split)** | 8/8 | 8/8 (1 snappé) | 0 | 8 | **8/8** | 0 |

- **INJECTION : 9/9 affamées → hint typé, off-diagonale = 0** — sur 9 proses tronquées, l'intake n'a JAMAIS
  halluciné le second groupe ; le canal `impracticable` est sound non-vacuously.
- **NULL param-rotation : library 4/8 · human 0/8** (vs 8/8 réels) — les params portent (le 4/8 library =
  la chance d'un petit espace de valeurs, documenté).
- **Gates : zeroFire=true** (aucun eval/expand sur les 20 mounts — on ne re-décompose jamais, appliqué pas
  slogané) · **déterminisme in-process=true** · canon-snap : 1 snappé, 2 OOV gardés bruts (sans effet).

**La lecture (le headline de Laurie, pas la tautologie)** : sur les corpus EXACTS où la composition
whole-structure lisait 0 (et ~50 % de réponses fausses dans les DEUX arms RUN-8), le mount paramétrique tient
**sélection 20/20 × extraction 20/20-post-canon × soundness-du-partial 9/9** sur prose externe/cross-model —
et la facture structurelle des 16 tâches 0-split passe de **18 productions payées (BLEND) à 0**, contenu inclus
(exécution déterministe depuis les params montés — attribuée comme telle, c'est un win d'ARCHITECTURE, pas
d'extraction). Le résidu-11 est couvert. **La limite RUN-8 frappait l'apprentissage, pas l'usage — démontré.**

## CAVEATS (post-run)

- **EXISTENCE à N=16+4**, un frame (compare), un domaine-schéma par split — pas un taux, pas une généralité
  multi-frames. Le couplage Qwen-seed↔Qwen-extract subsiste hors human (le split human porte la généralisation
  d'extraction : 8/8).
- Le frame est DÉCLARÉ (matérialisé via crystallize depuis 2 tâches train à golds) — la découverte AUTONOME du
  frame reste le chantier apprentissage (roadmap #2 : LGG+négatifs-blame).
- Le déterminisme certifié est IN-PROCESS (memo RUN-4) ; le re-run cross-process n'est pas bit-garanti (GPU).
- L'élision par-construction sur tâches couvertes n'entre pas au headline ; le null 4/8 library est
  partiellement chanceux (espace de valeurs petit).

## CAVEATS (pré-enregistrés)

- N=8+8 ⇒ **claim d'EXISTENCE**, jamais un taux (comptes exacts ; Clopper-Pearson si besoin de bornes).
- Le couplage **Qwen-seed↔Qwen-extract** subsiste sur les splits non-human (Laurie 4c) ; le split human/
  cross-model porte la généralisation d'EXTRACTION (la structure étant montée, plus le décode).
- L'élision sur tâches couvertes est **par construction** (le frame est déclaré, monté à t=0) — elle n'entre
  PAS dans le headline ; le marginal net se facture sur le résidu-11 et les fallbacks des canaux ratés.
- Le `metric` extrait est fallback-é au champ métrique du domaine si vide (amount/copies) — compté comme
  extraction partielle si faux.
- `variation notes` : mountAndCompute porte un reliquat de code mort (params/byRole) — sans effet, à nettoyer
  si le script gradue.
