# Dépôt Zenodo — papier treillis (v1) : le paquet

**Fichiers à téléverser (ce dossier) :**
1. `2026-07-03-sound-online-lattice-growth.v1.fr.pdf` — le texte maître (français)
2. `2026-07-03-sound-online-lattice-growth.v1.en.pdf` — la version anglaise (réalignée sur le maître)
3. `sound-online-lattice-growth-artifact-v1.zip` — l'artefact de reproductibilité (source `99105e3`
   + les 4 campagnes d'expériences avec mémos durables ; voir `ARTIFACT-README.md` à sa racine)

---

## Champs du formulaire Zenodo

- **Upload type** : Publication → Preprint
- **Publication date** : 2026-07-05
- **Title** : Sound online growth of a typed *isa* lattice from noisy LLM extraction, through candidate elimination made noise-tolerant by a localized-blame admission gate
- **Additional title** (fr) : Croissance en ligne saine d'un treillis *isa* typé à partir d'une extraction LLM bruitée, grâce à une élimination de candidats rendue tolérante au bruit par une porte d'admission à blâme localisé
- **Authors** : Braun, Nathanael (chercheur indépendant / independent researcher) — ORCID : *à compléter si créé*
- **Language** : eng (+ fra)
- **Version** : v1
- **License** : *au choix de l'auteur* — reco : **CC-BY-4.0** pour les PDF (l'artefact code reste AGPL-3.0-or-later, dit dans son README ; Zenodo n'impose qu'une licence de record — CC-BY-4.0 convient, la mention AGPL du code fait foi fichier par fichier)
- **Keywords** : knowledge graph; isa lattice; candidate elimination; version spaces; noise-tolerant learning; selectional restrictions; admission gate; localized blame; defeasible reasoning; truth maintenance; LLM extraction; ontology learning; NELL; local LLMs; typed facts
- **Related identifiers** :
  - *is supplemented by* : `https://github.com/9pings/skynet-graph` (Software)
  - *is related to (companion paper)* : DOI Zenodo du papier DLL — **à remplir** (10.5281/zenodo.XXXXXXX)
  - *references* : arXiv:2606.18557 (DeFAb — données MIT réutilisées en §7.3)
- **Notes (champ Additional notes)** : « French is the master text; the English version is aligned
  on it. The reproducibility artifact replays every table bit-for-bit from a content-addressed
  durable memo (no GPU required); live re-runs use local GGUF models named in the logs. »
  + « As of deposit, the public repository carries only the substrate and the companion paper's
  artifact; the present paper's mechanism and artifacts ship in this deposit bundle and are pushed
  to the public repository after deposit. »

---

## Description (à coller — bloc du record ; versions courtes, les résumés complets sont dans les PDF)

### Abstract (English)

Couple an LLM to a knowledge base and you inherit one of two failure modes: a symbolic side that
never learns, or a base that absorbs the model's *world-plausibility* — plausible-but-false facts
with no correction channel (NELL's drift is the textbook case). This paper presents and measures a
third option: sound **online growth of a typed *isa* lattice** from the noisy extractions of a
small local LLM. The instrument is a single **localized-blame admission gate**: evidence is
admitted for a unit — slot restriction, *isa* edge, or surface alias — only if its outcome is
uniquely attributable to that unit (structural provenance or counterfactual ablation) and verifies
against the declared oracle; soundness is *recoverability* (provisional/confirmed tiers,
retraction). The gate makes candidate elimination tolerant to the one-sided, competence-correlated
noise of an LLM pipeline. Measured: a deterministic laboratory (126/126 pre-registered checks); a
live circuit (54/54 with defeasance; 300/300 at volume vs 245/300 direct); an ungated control that
reproduces the NELL signature live (false edges, poisoned aliases) where the gated arm admits none
at equal resolution; external validity on DeFAb and a nine-model cross-family campaign (0 false
edges throughout). The deposit bundle replays every table bit-for-bit from a content-addressed
durable memo — no GPU required.

### Résumé (français)

Coupler un LLM à une base de connaissances, c'est hériter d'un de deux modes d'échec : un versant
symbolique qui n'apprend jamais, ou une base qui absorbe la *plausibilité-monde* du modèle — des
faits vraisemblables-mais-faux sans canal de correction (la dérive de NELL est le cas d'école). Cet
article présente et mesure la troisième voie : la **croissance en ligne saine d'un treillis *isa*
typé** depuis les extractions bruitées d'un petit modèle local. L'instrument est une unique **porte
d'admission à blâme localisé** : une évidence n'est admise pour une unité — restriction de slot,
arête *isa* ou alias de surface — que si son issue lui est uniquement attribuable (provenance
structurelle ou ablation contrefactuelle) et se vérifie contre l'oracle déclaré ; la soundness est
une *récupérabilité* (deux étages provisoire/confirmé, rétractation). La porte rend l'élimination
de candidats tolérante au bruit unilatéral, corrélé à la compétence, d'un pipeline LLM. Mesuré : un
laboratoire déterministe (126/126 vérifications pré-enregistrées) ; un circuit vif (54/54 avec
défaisance ; 300/300 en volume contre 245/300 en direct) ; un contrôle sans porte qui reproduit la
signature NELL en vif (arêtes fausses, alias empoisonnés) là où le bras à porte n'en admet aucune à
résolution égale ; la validité externe sur DeFAb et une campagne à neuf modèles (0 arête fausse
partout). Le bundle du dépôt rejoue chaque table bit-à-bit depuis un mémo durable adressé par
contenu — zéro GPU requis.
