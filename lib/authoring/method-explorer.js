/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * method-explorer — LIST + JUDGE a concept-method population (host-side, ZERO-CORE, fs-free). The owner's
 * "outil/explorer" ask (2026-07-05): give every crystallized method a TITLE / mini-DESCRIPTION / CATEGORY, and
 * summarize the population so its QUALITY, its OPENNESS (diversity), and its COVERAGE (which declared task-
 * classes have a method — and which are GAPS) are legible. Reads any library SOURCE method-pack normalizes
 * (a master loop / recall index / { entries } / array / a `.sgc methods` bundle's `.methods`).
 *
 * A concept-method is a TYPED decomposition: a class SIGNATURE (the K1 `structure` discriminant keys) → a
 * derivation over `content` holes → reusable templates (`templatesBySig`). So:
 *   - CATEGORY  = the canonical structure signature (the class the method serves).
 *   - TITLE     = the structure values, human-legible.
 *   - COVERAGE  = per structure-key, which VALUES have a method; against a declared vocabulary (a registry enum
 *                 or an explicit `expected`), the MISSING values = the population's gaps (the actionable metric).
 *   - OPENNESS  = distinct classes, singleton fraction (one-off vs reused), templates/method (reuse depth),
 *                 and the Shannon ENTROPY of the class distribution (spread vs concentration).
 *
 *   const { describeLibrary, formatLibrary } = require('skynet-graph/lib/authoring/method-explorer');
 *   const report = describeLibrary(masterLoop, { registry });   // registry → coverage gaps vs the declared canon
 *   console.log(formatLibrary(report));                          // a text listing + population summary
 */

const { toEntries } = require('./method-pack.js');

function canon( x ) {
	if ( x === undefined ) return 'null';
	if ( x === null || typeof x !== 'object' ) return JSON.stringify(x);
	if ( Array.isArray(x) ) return '[' + x.map(canon).join(',') + ']';
	return '{' + Object.keys(x).sort().map(( k ) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}
function templateCountOf( method ) {
	if ( !method || typeof method !== 'object' ) return 0;
	if ( method.templatesBySig && typeof method.templatesBySig === 'object' ) return Object.keys(method.templatesBySig).length;
	if ( Array.isArray(method.templates) ) return method.templates.length;
	return method.template || method.derivation ? 1 : 0;
}

/**
 * A single method's descriptor: id, title, category, mini-description + the typed keys and template count.
 * @param entry a normalized `{ structure, content, method }`
 */
function describeMethod( entry ) {
	const s = entry.structure || {}, c = entry.content || {};
	const sKeys = Object.keys(s).sort(), cKeys = Object.keys(c).sort();
	const category = sKeys.length ? sKeys.map(( k ) => k + '=' + s[k]).join(',') : '(untyped)';
	const title = sKeys.length ? sKeys.map(( k ) => String(s[k])).join(' · ') : '(untyped)';
	const templates = templateCountOf(entry.method);
	const id = (entry.method && entry.method.id) || 'm:' + canon(s);
	return {
		id, title, category,
		description: `keys on {${sKeys.join(', ') || '∅'}} → derives {${cKeys.join(', ') || '∅'}} · ${templates} template${templates === 1 ? '' : 's'}`,
		structureKeys: sKeys, contentKeys: cKeys, templateCount: templates
	};
}

function entropyBits( counts ) {
	const total = counts.reduce(( a, b ) => a + b, 0);
	if ( total <= 0 ) return 0;
	let h = 0;
	for ( const n of counts ) if ( n > 0 ) { const p = n / total; h -= p * Math.log2(p); }
	return h;
}

/**
 * Describe + judge a whole method population.
 * @param source  any library source (see `toEntries`) — a master loop / recall index / { entries } / array /
 *                a `.sgc methods` bundle's `.methods`.
 * @param opts    { registry } to compute coverage GAPS against the declared enum vocab, or { expected:{ <key>:
 *                [values] } } for an explicit declared value-space per structure key.
 * @returns {{ methods, population:{ count, categories, coverage, openness } }}
 */
function describeLibrary( source, opts ) {
	opts = opts || {};
	const entries = toEntries(source);
	const methods = entries.map(describeMethod);

	// class distribution (the CATEGORY = the served signature)
	const catCount = {};
	for ( const m of methods ) catCount[m.category] = (catCount[m.category] || 0) + 1;
	const categories = Object.keys(catCount).map(( category ) => ({ category, count: catCount[category] }))
		.sort(( a, b ) => b.count - a.count || (a.category < b.category ? -1 : 1));

	// COVERAGE — per structure-key present values, and the declared-vocab GAPS (missing values with no method)
	const keyVals = {};
	for ( const e of entries ) for ( const k of Object.keys(e.structure || {}) ) (keyVals[k] = keyVals[k] || new Set()).add(String(e.structure[k]));
	const expectedFor = ( key ) => {
		if ( opts.expected && opts.expected[key] ) return opts.expected[key];
		const entry = opts.registry && opts.registry.keys && opts.registry.keys[key];
		return entry && entry.enum ? entry.enum : null;
	};
	const coverage = Object.keys(keyVals).sort().map(( key ) => {
		const present = [...keyVals[key]].sort();
		const c = { key, present, covered: present.length };
		const exp = expectedFor(key);
		if ( exp ) { const has = keyVals[key]; c.expected = exp.length; c.missing = exp.filter(( v ) => !has.has(String(v))).sort(); c.fraction = exp.length ? present.filter(( v ) => exp.map(String).includes(v)).length / exp.length : 0; }
		return c;
	});

	// OPENNESS — diversity of the population
	const singleton = categories.filter(( c ) => c.count === 1 ).length;
	const totalTemplates = methods.reduce(( s, m ) => s + m.templateCount, 0);
	const openness = {
		distinctClasses: categories.length,
		singletonFraction: categories.length ? singleton / categories.length : 0,
		avgTemplatesPerMethod: methods.length ? totalTemplates / methods.length : 0,
		entropyBits: entropyBits(categories.map(( c ) => c.count )),
		maxEntropyBits: categories.length > 1 ? Math.log2(categories.length) : 0
	};

	return { methods, population: { count: methods.length, categories, coverage, openness } };
}

/** Render a `describeLibrary` report as a compact text listing + a population summary (the CLI/explorer view). */
function formatLibrary( report ) {
	const L = [];
	const p = report.population;
	L.push(`CONCEPT-METHODS — ${p.count} method(s), ${p.openness.distinctClasses} distinct class(es)`);
	L.push('');
	for ( const m of report.methods ) L.push(`  • ${m.title.padEnd(24)}  [${m.category}]  ${m.description}`);
	L.push('');
	L.push(`POPULATION`);
	L.push(`  classes (top): ${p.categories.slice(0, 8).map(( c ) => c.category + '×' + c.count).join(' · ')}`);
	L.push(`  openness: ${p.openness.distinctClasses} classes · singletons ${(100 * p.openness.singletonFraction).toFixed(0)}% · templates/method ${p.openness.avgTemplatesPerMethod.toFixed(2)} · entropy ${p.openness.entropyBits.toFixed(2)}/${p.openness.maxEntropyBits.toFixed(2)} bits`);
	L.push(`  coverage:`);
	for ( const c of p.coverage ) {
		if ( c.expected != null ) L.push(`    ${c.key}: ${c.covered}/${c.expected} (${(100 * c.fraction).toFixed(0)}%)${c.missing.length ? ' · GAPS: ' + c.missing.join(', ') : ' · complete'}`);
		else L.push(`    ${c.key}: ${c.covered} value(s) present [${c.present.join(', ')}]`);
	}
	return L.join('\n');
}

module.exports = { describeMethod, describeLibrary, formatLibrary, templateCountOf };
