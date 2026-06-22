// Builds the nested concept tree the engine expects from concepts/<set>/.
// Engine invariants honored:
//   - a child's key in parent.childConcepts MUST equal that child's _id
//   - _id must be globally unique (it keys graph._conceptLib)
//   - _name is the flag written on entities (defaults to the concept name)
const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');

function buildConceptTree(setDir, { exclude = [] } = {}) {
  const seenIds = new Set();
  const reserve = (name) => {
    if (seenIds.has(name)) throw new Error(`concept id collision: ${name}`);
    seenIds.add(name);
    return name;
  };

  // Build one concept from its .json file + optional sibling directory of children.
  function build(name, filePath, childDir) {
    const rec = JSON5.parse(fs.readFileSync(filePath, 'utf8'));
    rec._id = reserve(name);
    rec._name = name;
    if (fs.existsSync(childDir) && fs.statSync(childDir).isDirectory()) {
      const kids = {};
      for (const f of fs.readdirSync(childDir).sort()) {
        if (!f.endsWith('.json')) continue;
        const cname = f.slice(0, -5);
        if (exclude.includes(cname)) continue;
        kids[cname] = build(cname, path.join(childDir, f), path.join(childDir, cname));
      }
      if (Object.keys(kids).length) rec.childConcepts = kids;
    }
    return rec;
  }

  // Root = a container whose children are the top-level *.json files of the set.
  const root = {};
  const kids = {};
  for (const f of fs.readdirSync(setDir).sort()) {
    if (!f.endsWith('.json')) continue;
    const cname = f.slice(0, -5);
    if (exclude.includes(cname)) continue;
    kids[cname] = build(cname, path.join(setDir, f), path.join(setDir, cname));
  }
  root.childConcepts = kids;
  return root;
}

module.exports = { buildConceptTree };
