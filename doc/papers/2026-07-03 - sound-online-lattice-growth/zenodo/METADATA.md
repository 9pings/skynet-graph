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

---

## Description (à coller — bloc HTML/markdown du record)

### Abstract (English)

A language model knows a great deal and asserts it without restraint; a knowledge base asserts only
what it can defend, but everything must be written into it by hand. Systems that couple the two
currently choose between two failure modes. Either the symbolic side never learns — every sort,
every synonym remains an authoring cost. Or the model writes into the base itself, and the base
gradually absorbs its *world-plausibility*: plausible-sounding facts that nothing supports. The
textbook case of this second mode is NELL, the longest-running self-growing knowledge-base
experiment: years of autonomous growth, plausible-but-false facts admitted with no correction
channel, and a drift that neither co-training nor human checks ever stopped.

This article presents the third option, and measures it. The host structure is a **typed *isa*
lattice**: a hierarchy of sorts ("a marble is a ball, a ball is a round thing") on which tasks
declare their requirements. Three kinds of units must be able to enter it along the way: a **slot
restriction** (which sorts a task role accepts), an ***isa* edge** (a parent-child link between
sorts), and a **surface alias** (a synonym of a declared vocabulary word). The need is precise: grow
these three units online, from the noisy extractions of a small local language model, without
absorbing the model's ontology. The instrument is a single admission rule: **a piece of evidence is
admitted for a unit only if its success or failure is uniquely attributable to that unit — by
structural provenance or by counterfactual ablation — and verifies against the declared oracle.**
One gate, three grains. The theoretical justification takes three steps. One: candidate elimination,
the classical algorithm for learning such restrictions, is provably intolerant to noise — a single
false negative expels the right answer forever. Two: the noise of an LLM pipeline is **incompetence
noise** — one-sided (it only manufactures false failures) and competence-correlated (rare cases fail
systematically) — precisely the kind that statistical noise models do not cover. Three: localizing
blame replaces the noisy query over a whole conjunction with a clean query over the single
responsible literal; the residual noise on admitted negatives then reduces to the confounded-episode
case — bounded by a defeasible two-tier envelope, recoverable by retraction, never zero.

The evidence follows three levels. In a deterministic laboratory (no model, exact pre-registered
expectations), the gate halves over-generalization without ever refusing a good task, while the
control that admits every failure self-seals on rare cases. Under live conditions, with an embedded
27-billion-parameter model as the sole organ of world knowledge: 300/300 tasks against 245/300 for
the model alone, the model's deficit concentrated exactly where one must refuse, retract a default,
or follow the ontology in depth; and zero false edges, zero false aliases admitted on permuted
streams, where the ungated variant absorbs the model's ontology and then answers wrongly with no
correction channel left — NELL's drift, reproduced in miniature then blocked, at both grains. On the third-party
benchmark DeFAb, the typed path scores 34/35 (30/35 of them with no model call at all) against 30/35
for the direct model, and every loss of the direct model is an over-general cut — the error class
the gate forbids by construction. A reproduction across nine local models (four families, three
quantizations, two architectures and two size brackets) shows that the decider, the gate and the fail-closed refusal
all generalize; only coverage tracks extraction capability. There remains the economics: what
retrieval pipelines re-pay in context on every call, this system compiles once into a typed,
versioned library, auditable to the episode — knowledge accumulates outside the context window, and
it is the gate that makes this accumulation safe. None of the bricks is new; the composite is: an
LLM that extracts, a lattice that decides, and a gate that lets the lattice grow without drifting.

**Keywords:** selectional restrictions; version spaces; candidate elimination; *isa* lattice;
defeasible reasoning; knowledge-base drift; blame attribution; neurosymbolic systems; online
learning; LLM extraction.

### Résumé (français)

Un modèle de langage sait beaucoup et l'affirme sans retenue ; une base de connaissances n'affirme que ce
qu'elle peut défendre, mais il faut tout lui écrire à la main. Les systèmes qui couplent les deux
choisissent aujourd'hui entre deux modes d'échec. Soit le versant symbolique n'apprend jamais — chaque
sorte, chaque synonyme reste un coût d'autorat. Soit le modèle écrit lui-même dans la base, et la base
absorbe peu à peu sa *plausibilité-monde* : des faits vraisemblables que rien ne soutient. Le cas d'école de
ce second mode est NELL, la plus longue expérience de base de connaissances auto-croissante : des années de
croissance autonome, des faits plausibles-mais-faux admis sans canal de correction, et une dérive que ni le
co-entraînement ni les contrôles humains n'ont arrêtée.

Cet article présente la troisième option, et la mesure. La structure d'accueil est un **treillis
*isa* typé** : une hiérarchie de sortes (« une bille est une balle, une balle est une chose ronde »)
sur laquelle les tâches déclarent leurs exigences. Trois genres d'unités doivent pouvoir y entrer en
cours de route : une **restriction de slot** (quelles sortes un rôle d'une tâche accepte), une
**arête *isa*** (une filiation de sortes), et un **alias de surface** (un synonyme d'un mot du
vocabulaire déclaré). Le besoin est précis : faire croître ces trois unités en ligne, à partir des
extractions bruitées d'un petit modèle de langage local, sans absorber l'ontologie du modèle.
L'instrument est une règle d'admission unique : **une évidence n'est admise pour une unité que si
son succès ou son échec est uniquement attribuable à cette unité — par provenance structurelle ou
par ablation contrefactuelle — et se vérifie contre l'oracle déclaré.** Une porte, trois grains. La
justification théorique tient en trois pas. Un : l'élimination de candidats, l'algorithme classique
pour apprendre de telles restrictions, est prouvablement intolérante au bruit — un seul faux négatif
expulse la bonne réponse pour toujours. Deux : le bruit d'un pipeline LLM est un **bruit
d'incompétence** — unilatéral (il ne fabrique que de faux échecs) et corrélé à la compétence (les
cas rares échouent systématiquement) — précisément le genre que les modèles statistiques de bruit ne
couvrent pas. Trois : localiser le blâme remplace la requête bruitée sur une conjonction entière par
une requête propre sur le seul littéral responsable ; le bruit résiduel sur les négatifs admis se
réduit alors au cas de l'épisode confondu — borné par une enveloppe défaisable à deux étages,
récupérable par rétraction, jamais nul.

L'évidence suit trois niveaux. Dans un laboratoire déterministe (aucun modèle, attendus exacts
pré-enregistrés), la porte divise par deux la sur-généralisation sans jamais refuser une bonne tâche, quand
le contrôle qui admet tout échec s'auto-scelle sur les cas rares. En conditions réelles, avec un modèle
embarqué de 27 milliards de paramètres pour unique organe de connaissance-monde : 300/300 tâches contre
245/300 pour le modèle seul, le déficit du modèle concentré là où il faut refuser, rétracter un défaut, ou
suivre l'ontologie en profondeur ; et zéro arête fausse, zéro alias faux admis sur des flux permutés, là où
la variante sans porte absorbe l'ontologie du modèle et répond ensuite faux sans plus aucun canal de
correction — la dérive de NELL, reproduite en miniature puis bloquée, aux deux grains. Sur le benchmark tiers DeFAb, le
chemin typé obtient 34/35 (dont 30/35 sans aucun appel modèle) contre 30/35 pour le modèle direct, et chaque
perte du direct est une coupe trop générale — la classe d'erreur que la porte interdit par construction. Une
reproduction sur neuf modèles locaux (quatre familles, trois quantisations, deux architectures et deux
ordres de taille) montre que
le décideur, la porte et le refus fermé-sur-échec généralisent ; seule la couverture suit la capacité
d'extraction. Reste l'économie : ce que les pipelines à récupération repaient en contexte à chaque appel, ce
système le compile une fois en bibliothèque typée, versionnée, auditable à l'épisode — le savoir s'accumule
hors de la fenêtre de contexte, et c'est la porte qui rend cette accumulation sûre. Aucune des briques n'est
neuve ; le composite l'est : un LLM qui extrait, un treillis qui décide, une porte qui laisse le treillis
grandir sans dériver.

**Mots-clés :** restrictions sélectionnelles ; espaces de versions ; élimination de candidats ; treillis
*isa* ; raisonnement défaisable ; dérive de base de connaissances ; attribution de blâme ; systèmes
neurosymboliques ; apprentissage en ligne ; extraction par LLM.
