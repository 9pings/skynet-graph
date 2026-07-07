'use strict';
// sg forge (M3) — the one-command fabrication CLI, smoked deterministically (no model): a tiny inline
// adapter → a gold-verified .sgc stock + a PASS validation dossier, exit 0. Proves the command wires the
// adapter → forgeStock → file outputs correctly (the live GPU path is exercised separately).
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ADAPTER = "module.exports={name:'tiny',stepEnum:['filter','aggregate','select'],"
	+ "loadClasses:()=>({'select|0':[{problem:'a',goldSteps:['select']},{problem:'b',goldSteps:['select']}],"
	+ "'count|1':[{problem:'c',goldSteps:['filter','aggregate','select']},{problem:'d',goldSteps:['filter','aggregate','select']}]}),"
	+ "decompose:async(ask,rec,o)=>((o&&o.corrupt)?rec.goldSteps.slice(0,Math.max(1,rec.goldSteps.length-1)):rec.goldSteps.slice())};";

test('sg forge — deterministic dry run writes a .sgc stock + a PASS validation dossier (exit 0)', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgforge-'));
	const adapter = path.join(dir, 'adapter.js'); fs.writeFileSync(adapter, ADAPTER);
	const out = path.join(dir, 'stock.sgc'), doss = path.join(dir, 'dossier.md');
	const r = cp.spawnSync('node', ['bin/sg', 'forge', '--adapter', adapter, '--out', out, '--dossier', doss, '--name', 'tiny-stock', '--version', 'v1'],
		{ cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
	try {
		assert.equal(r.status, 0, 'exit 0 (verdict PASS). stdout+stderr: ' + r.stdout + r.stderr);
		assert.ok(fs.existsSync(out) && fs.existsSync(doss), 'the .sgc + dossier were written');
		const bundle = JSON.parse(fs.readFileSync(out, 'utf8'));
		assert.equal(bundle.format, 'sgc');
		assert.equal(bundle.kind, 'methods', 'a methods stock');
		const md = fs.readFileSync(doss, 'utf8');
		assert.match(md, /Validation dossier/);
		assert.match(md, /PASS/);
		assert.match(r.stdout, /verdict: PASS/);
		assert.match(r.stdout, /admitted 2\/2/, 'both gold-consistent classes admitted');
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
