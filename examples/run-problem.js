/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
// Part 2: can concept<->prompt pairs make the engine DESIGN a problem-resolution graph?
//
// Two concept-prompt pairs over a typed graph + a hard depth floor:
//   Task           (require Segment)            -- every step is a Task
//     EvalComplexity (require Task)  -> LLM decides Atomic vs NeedsSplit  (floor forces Atomic at MAX_DEPTH)
//     Expand         (require NeedsSplit) -> LLM emits ordered sub-steps -> extends the graph (new nodes+segments)
//
// Termination: each pair sets its own flag (no re-fire) + the depth floor makes the recursion well-founded.
const path = require('path');
const Graph = require('../tests/_boot.js');
const { ask, parseJSON, BASE, MODEL } = require('./llm.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');
console.log = console.info = console.warn = () => {};

const OBJECTIVE = process.env.OBJECTIVE ||
  'Authentifier un pentest interne Active Directory: de "accès réseau initial sans identifiants" jusqu\'à "compromission Domain Admin", en couvrant les étapes méthodologiques.';
const MAX_DEPTH = Number(process.env.MAX_DEPTH || 2);

let llmCalls = 0;
const ctxLine = (scope) => {
  const p = scope._.ctxPath || [];
  return `Objectif global: ${OBJECTIVE}\nChemin parcouru: ${p.length ? p.join(' -> ') : '(racine)'}\n` +
    `Étape courante: ${scope._.label || 'RÉSOUDRE LE PROBLÈME'}\n` +
    (scope._.description ? `Détail: ${scope._.description}\n` : '') +
    `Profondeur: ${scope._.depth || 0}`;
};

Graph._providers = {
  AI: {
    // --- pair 1: decide atomic vs split ---
    evalComplexity(graph, concept, scope, argz, cb) {
      const depth = scope._.depth || 0;
      if (depth >= MAX_DEPTH) {
        out(`  [eval d${depth}] "${scope._.label || 'root'}" -> ATOMIC (depth floor)`);
        return cb(null, { $_id: '_parent', EvalComplexity: true, Atomic: true });
      }
      llmCalls++;
      ask({
        system: 'Tu décomposes des problèmes en un graphe de plan. Tu juges si une étape est ATOMIQUE ' +
          '(directement exécutable telle quelle) ou si elle DOIT être découpée en sous-étapes. ' +
          'RÉPONDS UNIQUEMENT avec le JSON, AUCUN autre texte, AUCUN préambule: {"atomic": true|false, "reason": "court"}',
        user: ctxLine(scope) + '\n\nRéponds uniquement le JSON.',
        maxTokens: 1000,
      }).then((txt) => {
        let r; try { r = parseJSON(txt); } catch { r = { atomic: true, reason: 'parse-fail' }; }
        out(`  [eval d${depth}] "${scope._.label || 'root'}" -> ${r.atomic ? 'ATOMIC' : 'SPLIT'} (${r.reason || ''})`);
        cb(null, { $_id: '_parent', EvalComplexity: true, [r.atomic ? 'Atomic' : 'NeedsSplit']: true });
      }).catch((e) => {
        out(`  [eval d${depth}] LLM error -> degrade to ATOMIC: ${e.message}`);
        cb(null, { $_id: '_parent', EvalComplexity: true, Atomic: true, llmError: e.message });
      });
    },
    // --- pair 2: expand a non-atomic step into ordered sub-steps (extends the graph) ---
    expand(graph, concept, scope, argz, cb) {
      llmCalls++;
      ask({
        system: 'Tu étends un graphe de plan. Donne 2 à 3 sous-étapes ORDONNÉES et concrètes pour réaliser ' +
          'l\'étape courante vers l\'objectif. Chaque sous-étape a un "name" court et une "description". ' +
          'RÉPONDS UNIQUEMENT avec le JSON, AUCUN autre texte, AUCUN préambule: {"steps":[{"name":"...","description":"..."}]}',
        user: ctxLine(scope) + '\n\nRéponds uniquement le JSON.',
        maxTokens: 2000,
      }).then((txt) => {
        let r; try { r = parseJSON(txt); } catch { r = { steps: [] }; }
        const steps = (r.steps || []).slice(0, 4);
        if (!steps.length) return cb(null, { $_id: '_parent', Expand: true, Atomic: true });
        const base = scope._._id;
        const origin = scope._.originNode, target = scope._.targetNode;
        const depth = (scope._.depth || 0) + 1;
        const ctxPath = [...(scope._.ctxPath || []), scope._.label || 'ROOT'];
        const childIds = steps.map((_, i) => `${base}_s${i}`);
        const tpl = [{ $_id: '_parent', Expand: true, OpenPaths: false, expandedInto: childIds }];
        let prev = origin;
        steps.forEach((st, i) => {
          const isLast = i === steps.length - 1;
          const tnode = isLast ? target : `${base}_m${i}`;
          if (!isLast) tpl.push({ _id: tnode, Node: true, label: st.name });
          tpl.push({
            _id: childIds[i], Segment: true, originNode: prev, targetNode: tnode,
            depth, ctxPath, label: st.name, description: st.description,
          });
          prev = tnode;
        });
        out(`  [expand d${depth - 1}] "${scope._.label || 'root'}" -> ${steps.map((s) => s.name).join(' | ')}`);
        cb(null, tpl);
      }).catch((e) => {
        out(`  [expand] LLM error -> leaf: ${e.message}`);
        cb(null, { $_id: '_parent', Expand: true, Atomic: true, llmError: e.message });
      });
    },
  },
};

// Concept tree built in-code (the "library of concept<->prompt pairs")
const tree = {
  childConcepts: {
    Task: {
      _id: 'Task', _name: 'Task', require: 'Segment',
      childConcepts: {
        EvalComplexity: { _id: 'EvalComplexity', _name: 'EvalComplexity', require: ['Task'], provider: ['AI::evalComplexity'] },
        Expand: { _id: 'Expand', _name: 'Expand', require: ['Task', 'NeedsSplit'], provider: ['AI::expand'] },
      },
    },
  },
};

const serialized = {
  lastRev: 0,
  nodes: [{ _id: 'start', label: 'état initial' }, { _id: 'goal', label: 'objectif' }],
  segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', depth: 0, label: 'RÉSOUDRE LE PROBLÈME' }],
};

function printPlan(graph) {
  out('\n=== PLAN-GRAPH conçu par les concept-prompts ===');
  out('Objectif: ' + OBJECTIVE + '\n');
  const seen = new Set();
  function walk(segId, indent) {
    if (seen.has(segId)) return; seen.add(segId);
    const o = graph._objById[segId]; if (!o) return;
    const e = o._etty._;
    const tag = e.Atomic ? '•' : (e.expandedInto ? '┐' : '?');
    out(`${'  '.repeat(indent)}${tag} ${e.label || segId}` + (e.Atomic ? '  [atomique]' : ''));
    (e.expandedInto || []).forEach((c) => walk(c, indent + 1));
  }
  walk('root', 0);
  out(`\nSegments dans le graphe: ${Object.keys(graph._objById).filter((k) => graph._objById[k]._etty._.Segment).length}` +
    ` | appels LLM: ${llmCalls}`);
  out('================================================');
}

out(`Endpoint: ${BASE}  modèle: ${MODEL}  MAX_DEPTH=${MAX_DEPTH}`);
out('Seeding: start --[RÉSOUDRE LE PROBLÈME]--> goal, puis stabilisation...\n');
let done = false;
new Graph(serialized, {
  label: 'problem', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
  onStabilize(graph) { if (done) return; done = true; printPlan(graph); setTimeout(() => process.exit(0), 50); },
}, { common: tree });

setTimeout(() => { out('\n[TIMEOUT] pas stabilisé'); process.exit(1); }, 400000);
