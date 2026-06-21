tu # Plan de Développement - Skynet-Graph V1
## "MOE Graph" : Mixture of Experts sur Graphe de Raisonnement

---

## 📋 Résumé Exécutif

**Objectif** : Transformer skynet-graph en une plateforme **MOE (Mixture of Experts) décentralisée** où :
- Chaque expert = un concept spécialisé
- Le graphe = tableau noir partagé
- La stabilisation = orchestrateur émergent
- **Le rollback/patch = super-pouvoir unique**

**Valeur Proposition** :
> "Git pour le raisonnement IA : version control, debugging et exploration des solutions"

**Public Cible** :
- Équipes R&D IA cherchant à structurer leurs agents
- Applications nécessitant traçabilité et auditabilité (finance, santé, juridique)
- Systèmes de planification complexe (logistique, voyage, workflow)

---

## 🎯 Vision Produit

### Ce que ça permet (et que personne d'autre ne fait) :

| Capacité | LangChain | AutoGen | CrewAI | **Skynet-Graph V1** |
|----------|-----------|---------|--------|-------------------|
| Orchestration déclarative | ❌ Code | ❌ Code | ❌ Code | ✅ **Concepts JSON** |
| Rollback du raisonnement | ❌ | ❌ | ❌ | ✅ **Rvisions atomiques** |
| Patch d'experts à chaud | ❌ | ❌ | ❌ | ✅ **Modification concepts** |
| Traçabilité complète | ❌ | ⚠️ Partielle | ⚠️ Partielle | ✅ **Mutations auditées** |
| Exploration de solutions | ❌ | ❌ | ❌ | ✅ **Branches de graphe** |
| Coordination multi-agents | ⚠️ Limitée | ✅ | ⚠️ Basique | ✅ **Natif (sync graphe)** |

### Architecture Cible

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATION HÔTE                            │
├─────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │  Expert A   │    │  Expert B   │    │  Expert C   │    │
│  │ (Géométrie) │    │ (Coût)      │    │ (Temps)     │    │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    │
│         │                 │                 │              │
│         └─────────────────┼─────────────────┘              │
│                           │                                  │
│                    ┌──────▼──────┐                           │
│                    │ SKYNET-GRAPH │                           │
│                    │   V1 MOE    │                           │
│                    ├──────────────┤                           │
│                    │ - Graphe    │←─ Tableau noir partagé    │
│                    │ - Concepts  │←─ Experts enregistrés     │
│                    │ - Revisions │←─ Historique complet     │
│                    │ - Branches  │←─ Exploration alternative │
│                    └──────┬──────┘                           │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐              │
│         │                 │                 │              │
│  ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐    │
│  │   Provider   │    │   Provider   │    │   Provider   │    │
│  │ (LLM, API)  │    │ (Vector DB)  │    │ (Optimizer)  │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗺️ Roadmap (6-9 mois)

### Phase 0 : Fondations (Mois 1-2) - **Priorité Absolue**
**Objectif** : Stabiliser la base pour permettre le développement des phases suivantes.

| Tâche | Effort | Priorité | Livrable | Statut Actuel |
|-------|--------|----------|----------|---------------|
| Fixer `new Function()` | 3-5j | 🔥 CRITIQUE | Parseur d'expressions | ❌ Bloquant |
| Implémenter `rollbackTo(revision)` | 2-3j | 🔥 CRITIQUE | Méthode fonctionnelle | ⚠️ Partiel |
| Ajouter des tests unitaires | 5-7j | HIGH | Suite de tests >80% coverage | ❌ Non |
| Documenter l'API publique | 3-5j | HIGH | Docs dev + exemples | ⚠️ Partiel |
| Créer des providers de base | 5-7j | HIGH | Geo, Math, Basic LLM | ❌ Non |

**Blocage majeur** : Le `new Function()` empêche toute compilation WASM et pose des problèmes de sécurité. **À résoudre en premier.**

---

### Phase 1 : Core MOE (Mois 3-4)
**Objectif** : Implémenter le système d'experts avec rollback/patch.

| Tâche | Effort | Priorité | Livrable |
|-------|--------|----------|----------|
| ~~Système de scoring des experts~~ → scoring = facts ordinaires | ~0.5j | HIGH | Test de verrouillage (cf. #4) — aucun feature d'engine |
| ~~Détection de cycles~~ → HORS PÉRIMÈTRE (graphe dirigé acyclique par construction : on part d'un segment racine, on ajoute des paths enfants) | — | — | — |
| Méthodes de fork/merge de graphe | 5-7j | HIGH | `graph.fork()`, `graph.merge()` |
| API de patch d'experts à chaud | 2-3j | HIGH | `graph.patchConcept(name, updates)` |
| Historique des révisions amélioré | 3-5j | MEDIUM | Indexation + recherche |
| Sérialisation/desérialisation robuste | 3-5j | MEDIUM | Tests de round-trip |

**Livrable Phase 1** : Une bibliothèque stable permettant de :
- Définir des experts (concepts) spécialisés
- Rollback à n'importe quelle révision
- Patcher un expert sans redémarrer
- Forker un graphe pour tester des alternatives

---

### Phase 2 : Outils Développeur (Mois 5-6)
**Objectif** : Rendre la plateforme utilisable par des développeurs IA.

| Tâche | Effort | Priorité | Livrable |
|-------|--------|----------|----------|
| CLI de debugging | 5-7j | HIGH | `sg debug graph.json` |
| Visualiseur de graphe | 7-10j | HIGH | Interface web (D3.js) |
| SDK Python (via WASM ou HTTP) | 10-15j | MEDIUM | `pip install skynet-graph` |
| Exemples complets | 5-7j | HIGH | Travel planner, Chatbot, Workflow |
| Intégration avec LLM (OpenAI, etc.) | 5-7j | HIGH | Providers LLM prêts-à-l'emploi |
| Système de logging structuré | 3-5j | MEDIUM | JSON logs + export |

**Livrable Phase 2** : Un écosystème minimal pour :
- Debugger visuellement un graphe
- Intégrer avec des LLM
- Utiliser depuis Python/JS
- Avoir des exemples concrets

---

### Phase 3 : Production Ready (Mois 7-9)
**Objectif** : Préparer pour le déploiement en production.

| Tâche | Effort | Priorité | Livrable |
|-------|--------|----------|----------|
| Optimisation des performances | 10-15j | HIGH | Benchmarks + optimisations |
| Système de cache des providers | 5-7j | MEDIUM | Cache Redis/Memcached |
| Détection de cycles avancée | 5-7j | MEDIUM | Algorithme de détection |
| Authentification & Sécurité | 5-7j | HIGH | JWT, rate limiting |
| API REST/GraphQL | 7-10j | MEDIUM | Serveur Node.js |
| Monitoring & Métriques | 5-7j | MEDIUM | Prometheus/Grafana |
| Documentation utilisateur | 7-10j | MEDIUM | Guides, tutoriels |

**Livrable Phase 3** : Une plateforme prête pour :
- Déploiement en production
- Scale horizontale
- Intégration avec des systèmes existants

---

## 📦 Backlog Détaillé

### 🔥 Critique (Doit être fait avant toute release)

#### 1. Remplacer `new Function()`
**Problème** :
- Bloque la compilation WASM
- Problème de sécurité (CSP)
- Performances médiocres

**Solution proposée** :
```javascript
// Avant (problématique) :
this._assertTest = new Function("scope", "graph", ...);

// Après (solution) :
// Option 1 : Parseur d'expressions simple
this._assertTest = compileExpression(asserts.join(" && "));

// Option 2 : Compilation AOT (meilleure perf)
this._assertTest = precompiledAsserts[name];
```

**Effort** : 3-5 jours
**Tests** : Vérifier que toutes les assertions existantes fonctionnent
**Risque** : Régressions si le parseur ne gère pas tous les cas

---

#### 2. Implémenter `rollbackTo(revision)`

**Implémentation proposée** :
```javascript
Graph.prototype.rollbackTo = function(revisionNumber) {
  // 1. Valider que la révision existe
  if (!this._revs[revisionNumber]) {
    throw new Error(`Revision ${revisionNumber} not found`);
  }
  
  // 2. Restaurer l'état du graphe
  this._rev = revisionNumber;
  this._lastSyncRecord = this._revs[revisionNumber].record;
  
  // 3. Remonter le graphe
  this._objById = {};
  this._unstable = [];
  this.mount(this._lastSyncRecord);
  
  // 4. Marquer comme nécessitant re-stabilisation
  this._needsStabilize = true;
  
  // 5. Retourner la révision
  return this._revs[revisionNumber];
};
```

**Effort** : 2-3 jours
**Tests** : Vérifier que le rollback et la re-stabilisation fonctionnent
**Risque** : Problèmes avec les références circulaires

---

#### 3. Ajouter des tests unitaires

**Stratégie** :
1. **Tests de base** : Entités, concepts, graphes simples
2. **Tests de stabilisation** : Vérifier que les concepts s'appliquent correctement
3. **Tests de rollback** : Vérifier que l'on peut revenir en arrière
4. **Tests de performance** : Benchmarks sur des graphes de taille croissante

**Framework** : Jest ou Mocha (déjà partiellement présent)

**Cible** : >80% coverage du code core

**Effort** : 5-7 jours

---

### HIGH Priority (Fonctionnalités principales)

#### 4. Scoring des experts = des facts ordinaires (PAS un feature d'engine)

**Révisé (2026-06-19).** La version initiale proposait des champs de schéma `confidence`/`weight`/`confidenceProvider` + une « résolution de conflits » (le plus haut `confidence*weight` gagne quand deux experts écrivent la même prop). **C'est la mauvaise raison** : le graphe est *fact-driven et additif* — un concept ajoute des props et de **nouveaux segments/paths**, ce qui déclenche d'autres concepts en cascade. Les experts ne se disputent pas une propriété ; ils font croître le graphe en branches alternatives. Donc **aucune machinerie de scoring n'est nécessaire** : `confidence` (ou tout score) est un **fact comme un autre**.

Tout le contexte d'application d'un concept étant déjà accessible, un score se manipule sans aucun code d'engine :

- **Déclenchement par seuil (B)** — lisible directement dans les `assert` :
  ```json
  { "require": ["Theoric"], "assert": ["$confidence > 0.7"] }
  ```
  (géré tel quel par le parseur d'expressions, cf. `App/expr.js`).
- **Input de prompt** — le provider reçoit `scope`, donc `confidence`, `depth`, ou n'importe quel fact du contexte peut nourrir le prompt de l'expert (via `graph.getRef('confidence', scope)`).
- **Écriture** — un expert écrit `confidence` comme un prop ordinaire sur ses segments via `pushMutation`.
- **Classement des paths (A)** — agréger `confidence` le long d'un path avec le `PathMap` existant (`getAllPropsInPath`, `pathDescriptor`) pour ranker/sélectionner les branches alternatives.

**Livrable** : pas de feature. Un test de verrouillage (`tests/integration/scoring.test.js`) prouve que (A) et (B) marchent déjà avec le moteur + le parseur, sans nouveau code.

**Effort** : ~0.5j (test + doc). `confidenceProvider` dynamique : seulement si un besoin réel émerge (YAGNI).

---

#### 5. Détection de Cycles

**Solution simple (immédiate)** :
```javascript
Graph.prototype.cfg.maxStabilizationDepth = 100;
Graph.prototype.cfg.stabilizationTimeout = 5000; // ms

// Dans _loopTF :
if (this._stabilizationDepth > this.cfg.maxStabilizationDepth) {
  throw new Error("Cycle detected: max stabilization depth exceeded");
}
if (Date.now() - this._stabilizationStart > this.cfg.stabilizationTimeout) {
  throw new Error("Cycle detected: timeout exceeded");
}
```

**Solution avancée (plus tard)** :
- Algorithme de détection de cycles dans le graphe de dépendances
- Marquer les objets/concepts impliqués dans des cycles

**Effort** : 3-5j (basique) / 5-7j (avancée)

---

#### 6. Méthodes Fork/Merge de Graphe

**Fork** :
```javascript
Graph.prototype.fork = function(name, fromRevision) {
  const revision = fromRevision || this._rev;
  const branchId = shortid.generate();
  
  this._branches[branchId] = {
    id: branchId,
    name: name,
    parent: this._currentBranch || "master",
    parentRevision: revision,
    graph: new Graph(
      this._revs[revision].record,
      {...this.cfg, label: `${this.cfg.label}:${name}`},
      this._conceptLib
    ),
    createdAt: Date.now()
  };
  
  return this._branches[branchId].graph;
};
```

**Merge** :
```javascript
Graph.prototype.merge = function(branchId, strategy = "keepMine") {
  const branch = this._branches[branchId];
  if (!branch) throw new Error(`Branch ${branchId} not found`);
  
  // Stratégies de merge :
  // - keepMine : garde les valeurs du graphe courant
  // - keepTheirs : prend les valeurs de la branche
  // - highestConfidence : prend la valeur avec le score le plus haut
  // - manual : retourne les conflits pour résolution manuelle
  
  const mergedRecord = deepMerge(
    this._lastSyncRecord,
    branch.graph._lastSyncRecord,
    { strategy: mergeStrategy[strategy] }
  );
  
  this.mount(mergedRecord);
  return this;
};
```

**Effort** : 5-7 jours

---

### MEDIUM Priority (Améliorations)

#### 7. Providers LLM Prêts-à-l'Emploi

**Objectif** : Intégration native avec OpenAI, Anthropic, Mistral, etc.

**Implémentation** :
```javascript
// providers/llm.js
module.exports = {
  OpenAI: {
    call: async (prompt, options) => {
      const response = await openai.chat.completions.create({
        model: options.model || "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        ...options
      });
      return response.choices[0].message.content;
    }
  },
  Mistral: {
    call: async (prompt, options) => {
      // Implémentation Mistral
    }
  }
};

// Dans Graph.js :
Graph._providers = {
  ...Graph._providers,
  ...require("./providers/llm")
};
```

**Exemple d'utilisation** :
```json
{
  "require": ["Node:text"],
  "provider": ["OpenAI::Classify"],
  "providerArgs": {
    "prompt": "Classify the following text: ${text}",
    "model": "gpt-4"
  }
}
```

**Effort** : 5-7 jours (pour 3-4 providers majeurs)

---

#### 8. Visualiseur de Graphe

**Objectif** : Outil web pour explorer le graphe et son historique.

**Technologies** :
- Frontend : React + D3.js
- Backend : API REST simple (Node.js/Express)
- Features :
  - Visualisation interactive du graphe
  - Navigation dans l'historique des révisions
  - Inspection des objets/concepts
  - Replay du raisonnement

**Effort** : 7-10 jours

---

#### 9. CLI de Debugging

**Commandes** :
```bash
# Charger un graphe
sg load graph.json

# Lister les révisions
sg log

# Rollback à une révision
sg rollback 24

# Inspecter un objet
sg inspect segment123

# Rejouer le raisonnement
sg replay

# Comparer deux révisions
sg diff 24 28

# Exporter un graphe
sg export graph_v2.json
```

**Effort** : 5-7 jours

---

## 👥 Équipe Recommandée

| Rôle | Compétences | Temps Alloué | Responsabilités |
|------|-------------|---------------|------------------|
| **Tech Lead / Architecte** | Node.js, Graph Theory, IA | 100% | Design global, décisions techniques |
| **Développeur Backend** | JavaScript, Algorithmes | 100% | Core engine, performances |
| **Développeur Frontend** | React, D3.js | 50% | Visualiseur, CLI |
| **Expert IA** | LLM, RAG, Agents | 50% | Intégration providers, exemples |
| **DevOps** | CI/CD, Docker | 20% | Déploiement, monitoring |

**Taille équipe** : 3-4 personnes (2.5-3 ETP)
**Coût estimé** : 150-200k€ (6-9 mois, équipe senior)

---

## 💰 Budget Estimé

| Poste | Coût (k€) | Détails |
|-------|------------|---------|
| Développement | 120-160 | 6-9 mois d'équipe |
| Infrastructure | 10-20 | Serveurs, outils |
| Documentation | 10-15 | Docs technique + utilisateur |
| Marketing | 5-10 | Site web, démos |
| **Total** | **145-205** | |

---

## ⚠️ Risques & Mitigation

### Risques Techniques

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Complexité `new Function` | Moyenne | Élevée | Prototyper le parseur d'abord |
| Performances insuffisantes | Haute | Élevée | Optimiser tôt, benchmarks |
| Détection de cycles incomplète | Moyenne | Moyenne | Implémenter solution simple d'abord |
| Incompatibilité WASM | Moyenne | Moyenne | Valider avec AssemblyScript tôt |

### Risques Produit

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Adoption lente | Moyenne | Élevée | Exemples concrets, démos |
| Concurrence | Faible | Moyenne | Focus sur la différenciation (rollback) |
| Maintenance | Moyenne | Moyenne | Documentation, tests |

---

## 📈 Métriques de Succès

### V1 (Mois 6)
- [ ] Core MOE fonctionnel (experts + rollback)
- [ ] 3 exemples complets (voyage, chatbot, workflow)
- [ ] Tests >80% coverage
- [ ] Documentation technique complète
- [ ] 5 providers intégrés (Geo, LLM, etc.)

### V1.1 (Mois 9)
- [ ] CLI de debugging
- [ ] Visualiseur de graphe
- [ ] SDK Python
- [ ] Détection de cycles avancée
- [ ] Benchmarks de performance

### V2 (Future)
- [ ] Compilation WASM
- [ ] Distribution du graphe (sharding)
- [ ] Apprentissage des experts
- [ ] Interface no-code pour définir des experts

---

## 🎯 Prochaines Étapes (30 jours)

### Semaine 1 : Validation Technique
- [ ] Finaliser le design du parseur d'expressions
- [ ] Prototyper le rollback sur un cas simple
- [ ] Valider la détection de cycles basique
- [ ] Décider de l'architecture fork/merge

### Semaine 2-3 : Core MOE
- [ ] Implémenter le parseur d'expressions
- [ ] Implémenter `rollbackTo()`
- [ ] Ajouter le système de scoring
- [ ] Tests unitaires de base

### Semaine 4 : Première Release Interne
- [ ] Package npm `@skynet-graph/core@1.0.0-alpha`
- [ ] Exemple minimal fonctionnel
- [ ] Documentation initiale
- [ ] Présentation à l'équipe

---

## 📌 Annexes

### A. Exemple d'Architecture de Graphe MOE

```json
{
  "spatialEP": "start",
  "conceptMaps": [
    {
      "_id": "start",
      "Node": true,
      "CommonPlaceName": "Paris",
      "Position": { "lat": 48.8566, "lng": 2.3522 }
    },
    {
      "_id": "target",
      "Node": true,
      "CommonPlaceName": "Tokyo",
      "Position": { "lat": 35.6762, "lng": 139.6503 }
    },
    {
      "_id": "travel1",
      "Segment": true,
      "originNode": "start",
      "targetNode": "target",
      "Travel": true
    }
  ],
  "experts": [
    {
      "name": "GeometryExpert",
      "concept": "Distance",
      "provider": "Geo::Haversine",
      "confidence": 0.99
    },
    {
      "name": "TransportExpert",
      "concept": "TransportMode",
      "provider": "LLM::DecideTransport",
      "confidence": 0.95
    },
    {
      "name": "CostExpert",
      "concept": "CostEstimate",
      "provider": "API::FlightPrices",
      "confidence": 0.90
    }
  ]
}
```

### B. Comparaison des Approches MOE

| Critère | MOE Classique (LLM) | MOE Skynet-Graph |
|---------|----------------------|------------------|
| **Type** | Réseaux de neurones | Règles + Providers |
| **Orchestration** | Router central | Émergente (graphe) |
| **Contexte** | Tensor/Embeddings | Graphe structuré |
| **Rollback** | ❌ Impossible | ✅ Natif |
| **Patch** | ❌ Re-entraînement | ✅ À chaud |
| **Traçabilité** | ❌ Black box | ✅ Complète |
| **Coût** | Élevé (entraînement) | Faible (développement) |
| **Flexibilité** | Limitée (architecture fixe) | Illimitée (ajout concepts) |

### C. Benchmarks Cibles

| Taille Graphe | Temps Stabilisation | Mémoire | Révisions/s |
|---------------|---------------------|---------|-------------|
| 100 nœuds | < 100ms | < 10MB | 100+ |
| 1,000 nœuds | < 500ms | < 100MB | 50+ |
| 10,000 nœuds | < 2s | < 1GB | 10+ |

---

## 🚀 Conclusion

**Skynet-Graph V1 a le potentiel pour devenir LA plateforme de raisonnement structuré pour l'IA.**

Avec un investissement de **6-9 mois et 150-200k€**, on peut livrer :
1. Un core stable et performant
2. Un écosystème d'outils pour les développeurs
3. Des exemples concrets prouvant la valeur
4. Une différenciation claire face à LangChain & co

**Le timing est parfait** : Les agents IA deviennent mainstream, et **personne ne résout le problème de la traçabilité et du debugging**. Skynet-Graph comble ce vide.

> "Ce n'est pas juste un graphe. C'est un système d'exploitation pour le raisonnement IA."

---

*Document généré le 18 juin 2026. À discuter avec l'équipe technique et les parties prenantes.*
