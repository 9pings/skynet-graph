# LOG — G-EXT : le chemin typé sur DeFAb (validité externe du papier)

> `defab-probe.js` + RESULTS-defab.json + `data/level3_instances.json` (tier0). Benchmark : **DeFAb**
> (Cooper & Velasquez 2026, arXiv 2606.18557 — HF `PatrickAllenCooper/DeFAb`, MIT ; leur solveur règles
> = 100 %, frontier LLMs 65 % → 23.5 % rendering-robust). Le gap G-EXT du verdict prior-art : sans oracle
> TIERS machine-vérifiable, « treillis jouet déclaré » tue le claim. Ici l'oracle (`gold_label`) est
> certifié par LEUR vérifieur poly-time — zéro circularité avec nos golds.

## Le mapping (Level-3 = defeater abduction ≡ notre cellule restriction/défaisance)

Une instance : `theory` (faits + règles strictes) + `anomaly` (une dérivation par défaut qui ne doit PAS
tenir pour UN individu) + 6 `candidates` (1 gold + 5 distracteurs TYPÉS : broad / wrong_head / irrelevant /
positive / wrong_cond). Le sélecteur typé implémente LEURS checks déclarés (dérivation valide ·
conservativité · minimalité · distance de révision d_rev) à travers nos lentilles :
- **load-bearing** (la condition tire sur l'individu anormal — `decideRingAdmission`) ;
- **bon slot/polarité** (règle défaisable négative sur le prédicat de l'anomalie) ;
- **conservativité** (ne tue aucune expectation préservée d'un individu couvert — le garde-fou de
  vacuité/sur-généralisation) ;
- **minimalité** = (nb de faits POSÉS, puis couverture) — une condition NOUVELLE (inconnue des faits ∪
  têtes strictes) est POSABLE pour l'individu anormal seul (l'abduction minimale ; leur pattern
  `novel_facts_for_gold`, 10/10 instances nov reproduites).
Ambiguïté résiduelle = deux conditions posées formellement symétriques → **le modèle tranche DANS
l'ensemble admissible vérifié** (≤2 candidats, sans la `description` — anti-leak) : la doctrine en couches
(la porte fait la LOGIQUE, le modèle est l'organe de connaissance-monde à la frontière — le ratchet).

## RÉSULTATS (N=35 tier0, 3 domaines ; memo durable ; Qwen3.6-27B-Q2 embarqué)

| arm | all | dom-1 (16) | dom-2 legal (10) | dom-3 materials (9) |
|---|---|---|---|---|
| **SYS (porte + tie-break in-set)** | **34/35** | 16/16 | 9/10 | 9/9 |
| — dont structurel-PUR (0 call) | 30/35 | 16/16 | 9/10 | 5/9 |
| SYS-extract (prose→extraction→porte) | 33/35 | 16/16 | 8/10 | 9/9 |
| DIRECT-rb0 | 30/35 | 13/16 | 8/10 | 9/9 |
| DIRECT-rbON (1024) | 30/35 | 13/16 | 9/10 | 8/9 |

- **L'attribution du gap (vérifiée instance par instance)** : les 5 pertes DIRECT-rb0 sont TOUTES des
  coupes SUR-GÉNÉRALES — `no_novel` ×3 (la sorte établie trop large : elle tuerait le défaut préservé de
  l'AUTRE individu de la même sorte) + `broad` ×2. **La classe d'échec exacte que la dent de conservativité
  bloque par construction** — le mécanisme du papier, mesuré sur un oracle tiers. Le thinking n'y change
  rien (30/35 aussi ; il déplace les erreurs, ne les corrige pas).
- **La seule perte SYS = `laches`** : gold `laches_applies(X)` vs near_gold `unreasonable_delay(X)` —
  quasi-synonymes PAR DESIGN (le nom du distracteur le dit) ; le prompt de tie-break (« TRUE mechanism »)
  a orienté vers le fondement factuel plutôt que le prédicat opératoire. Reporté tel quel — retoucher le
  prompt pour flipper UNE cellule = gold-fitting post-hoc, refusé.
- **Coût** : 30/35 à ZÉRO call modèle (micro-seconde, le régime de leur solveur) ; 5 tie-breaks à 1 call
  sur ≤2 candidats vérifiés ; DIRECT paie 35 calls et perd 5 cellules. SYS-extract : le bruit d'extraction
  coûte 1 cellule de plus (emancipated_minor : candidat corrompu à la copie → impracticable, fail-closed).

## Caveats exacts (à dire avec le chiffre)

tier0 = la tranche pilote (35), Level-3 seulement (les fichiers L1/L2 du HF étaient vides au fetch) ; mode
SÉLECTION (candidats fournis) — leurs 65 %/23.5 % frontier sont sur génération + rendering-robust : PAS
comparables ; notre comparaison est INTERNE (SYS vs DIRECT, même protocole, même modèle, même prose
rendue). La sémantique du vérifieur est réimplémentée depuis les champs d'instance (pas d'audit du repo
`blanc`) — à cross-checker contre leur vérifieur avant le dépôt. NEXT : DeFAb-Hard (235) + leurs renderings
NL officiels (le mode où les frontier tombent à 23.5 %) + generation-mode via constrained-completion.

---

## Extension L2 (374 instances dev, 3 domaines) + les chiffres OFFICIELS frontier

> `defab-l2-probe.js` + RESULTS-defab-l2.json ; fichiers `*_dev_instances.json` (tier0) + `summary.json`
> (leur run officiel claude-sonnet-4-6, 2026-02-28) + `symbolic_baseline_l2/l3.json`.

- **Level-2 (« identify the missing observation »)** : le gold est l'UNIQUE candidat dont la tête unifie
  avec le target (vérifié par scan : 374/374, mono-gold, corps vides, zéro chaînage nécessaire). **Le
  sélecteur typé = 374/374 à 0 call** (micro-seconde — le régime de leur solveur, qui fait aussi 100 %).
- **Les chiffres OFFICIELS publiés du repo (leur protocole, renderings M1-M4 + génération)** :
  claude-sonnet-4-6 = **L2 77.2 % · L3 16.4 %** · par modalité : **M1 19.1 %** vs M2/M3/M4 87-91 % — le
  spread modalité EST la variance de rendering. (Notre SYS tier0-L3 : 34/35.)
- **Nos arms modèle sur échantillon stride 30 (10/domaine), NOTRE rendering (propre)** : DIRECT-27B 30/30 ·
  SYS-extract 30/30 ⇒ sur un rendering propre, même un 27B-Q2 sature L2 — **la tâche est RENDERING-bound,
  pas knowledge-bound** : l'échec frontier (77 %, et 19 % en M1) vient de la variance de SURFACE
  adversariale de leur protocole — exactement la variance exogène que la barrière canon + le ring G4
  adressent chez nous. On ne peut PAS reproduire leurs modalités localement : **le code d'éval `blanc` est
  404 (privé/renommé)** — leurs chiffres sont cités tels que publiés, protocole ≠, étiqueté.
- **Caveat repro pour le papier** : la DATA DeFAb est publique (MIT), le harnais d'éval ne l'est pas — le
  cross-check de sémantique du vérifieur (laches near-gold : LEUR solveur fait 35/35 là où notre tie-break
  monde en perd 1 — ils ont donc un discriminant formel qu'on n'a pas reconstruit) reste ouvert, à
  documenter comme tel dans le manuscrit.
