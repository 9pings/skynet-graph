'use strict';
/**
 * The "N of the thirteen are Tier-0" claim vs the manifests — the DRIFT GUARD.
 *
 * README, strategies.md and usage.md all quantify how many of the 13 strategies are Tier-0 (pure grammar,
 * zero JS — the flagship trust claim). That sentence once said "Eleven" while the manifests said 6 tier-0
 * plugins → 7 Tier-0 strategy rows in the repo's OWN catalog table (the design-phase count had survived the
 * implementation). This test derives the count from `docs/strategies.md`'s catalog table, cross-checks every
 * row's Tier-0 label against the named plugin's manifest tier, and requires the three doc sentences to carry
 * the derived number — so the claim either tracks the manifests or fails here.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const json5 = require('json5');

const ROOT = path.join(__dirname, '..', '..');
const read = ( f ) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// manifest tier per bundled plugin
const tiers = {};
for ( const name of fs.readdirSync(path.join(ROOT, 'plugins')) ) {
	const manifest = path.join(ROOT, 'plugins', name, 'sg-plugin.json');
	if ( fs.existsSync(manifest) ) tiers[name] = json5.parse(fs.readFileSync(manifest, 'utf8')).tier;
}

// the catalog table rows of docs/strategies.md (between "## The catalog" and the next section)
function catalogRows() {
	const md = read('docs/strategies.md');
	const section = md.split(/^## The catalog.*$/m)[1].split(/^##[^#]/m)[0];
	return section.split('\n')
		.filter(( l ) => /^\|/.test(l) && !/^\|\s*(Strategy|---)/.test(l) )
		.map(( l ) => {
			const cells = l.split('|').map(( c ) => c.trim() );
			const m = (cells[2] || '').match(/`([^`]+)`/);
			return { strategy: cells[1], plugin: m && m[1], shape: cells[3] || '' };
		});
}

test('every catalog row labeled Tier-0 names a manifest-tier-0 plugin, and vice versa', () => {
	const rows = catalogRows();
	assert.equal(rows.length, 13);                        // "the 13 strategies" — the denominator is real
	for ( const r of rows ) {
		if ( !(r.plugin in tiers) ) continue;             // factory/substrate rows (CoT, Meta-Router, Decomposition)
		assert.equal(/Tier-0/.test(r.shape), tiers[r.plugin] === 0,
			r.strategy + ': table says "' + r.shape + '" but manifest tier of ' + r.plugin + ' is ' + tiers[r.plugin]);
	}
});

test('the three doc sentences carry the DERIVED Tier-0 count, in words', () => {
	const n = catalogRows().filter(( r ) => /Tier-0/.test(r.shape) ).length;
	const word = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen'][n];
	assert.match(read('README.md'), new RegExp(word + ' of the thirteen are \\*\\*Tier-0', 'i'),
		'README must say "' + word + ' of the thirteen are **Tier-0"');
	assert.match(read('docs/strategies.md'), new RegExp('\\*\\*Two classes of strategy\\.\\*\\* ' + word + ' are \\*\\*Tier-0\\*\\*', 'i'),
		'strategies.md must say "' + word + ' are **Tier-0**"');
	assert.match(read('docs/usage.md'), new RegExp('\\(' + word + ' of the thirteen are Tier-0', 'i'),
		'usage.md must say "(' + word + ' of the thirteen are Tier-0"');
});
