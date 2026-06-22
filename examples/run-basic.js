const path = require('path');
const Graph = require('../tests/_boot.js');
const { buildConceptTree } = require('../lib/authoring/concepts.js');
const { register, CommonGeo } = require('../lib/providers');

// ---- quiet the engine's chatter, keep a clean tagged printer + real errors ----
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
console.log = console.info = console.warn = () => {};

// ---- wire the packaged Geo provider in one line so the real `common` Distance concept can fire ----
register(Graph, [{ CommonGeo }]);

// ---- the concept set (exclude the `targetNode` concept: name collides with the data field) ----
const tree = buildConceptTree(path.join(__dirname, '..', 'concepts', 'common'), { exclude: ['targetNode'] });

// ---- a tiny graph: Paris -> Singapore (long), Paris -> Versailles (short) ----
const serialized = {
  lastRev: 0,
  nodes: [
    { _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } },
    { _id: 'singapore', Position: { lat: 1.3521, lng: 103.8198 } },
    { _id: 'versailles', Position: { lat: 48.8049, lng: 2.1204 } },
  ],
  segments: [
    { _id: 'long', originNode: 'paris', targetNode: 'singapore' },
    // give the short one Theoric so the real ShortTravel concept (require Theoric) can fire
    { _id: 'short', originNode: 'paris', targetNode: 'versailles', Theoric: true },
  ],
};

const CONCEPT_KEYS = ['Vertice', 'Edge', 'Distance', 'Travel', 'LongTravel', 'ShortTravel', 'Stay', 'LongStay'];
function report(graph) {
  out('\n=== STABILIZED ===');
  for (const id of Object.keys(graph._objById)) {
    const e = graph._objById[id]._etty._;
    const flags = CONCEPT_KEYS.filter((k) => e[k]);
    const extra = e.Distance ? ` (Distance.inKm=${e.Distance.inKm})` : '';
    out(`  ${id.padEnd(11)} -> ${flags.join(', ') || '(none)'}${extra}`);
  }
  out('==================');
}

out('Mounting graph + stabilizing with the real `common` concept set...\n');
let done = false;
const g = new Graph(serialized, {
  label: 'demo',
  isMaster: true,
  autoMount: true,
  conceptSets: ['common'],
  bagRefManagers: {},
  onStabilize(graph) {
    if (done) return;
    done = true;
    report(graph);
    setTimeout(() => process.exit(0), 50);
  },
}, { common: tree });

// safety timeout in case it never stabilizes
setTimeout(() => { out('\n[TIMEOUT] did not stabilize in 8s'); process.exit(1); }, 8000);
