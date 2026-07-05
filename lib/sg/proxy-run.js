/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * `sg proxy` session orchestration — the local-first proxy cache run loop, EXTRACTED from cli.js so it is
 * testable with an injected stub proxy (the model resolution stays GPU-bound in cli.js; this pure loop is
 * where the single-shot / batch / metrics logic lives). Answers a list of queries against a `createProxyCache`
 * instance, tracks per-answer provenance, and reports the ECONOMY (frontier calls saved vs a no-cache baseline).
 */

/**
 * Run a proxy over a list of queries, in order (so repeats/paraphrases hit the warmed stock).
 * @param opts.proxy     a createProxyCache instance ({ answer, metrics }).
 * @param opts.queries   string[] — the session's queries (one entry = one ask).
 * @param opts.onAnswer  optional (result, index, query) => void — a per-answer hook (CLI streams here).
 * @returns { results:[{ query, answer, source, cached, cost }], metrics, saved }  — `saved` = frontier calls
 *          avoided vs answering every query at the frontier (= local hits).
 */
async function runProxySession( opts ) {
	opts = opts || {};
	var proxy = opts.proxy;
	var queries = opts.queries || [];
	if ( !proxy || typeof proxy.answer !== 'function' ) throw new Error('runProxySession needs opts.proxy (a createProxyCache instance)');
	var results = [];
	for ( var i = 0; i < queries.length; i++ ) {
		var q = queries[i];
		var r = await proxy.answer(q);
		var row = { query: q, answer: r.answer, source: r.source, cached: !!r.cached, cost: r.cost };
		results.push(row);
		if ( typeof opts.onAnswer === 'function' ) opts.onAnswer(row, i, q);
	}
	var metrics = (typeof proxy.metrics === 'function') ? proxy.metrics() : null;
	var saved = metrics ? metrics.local : results.filter(function ( r ) { return r.source === 'local'; }).length;
	return { results: results, metrics: metrics, saved: saved };
}

/**
 * A one-block human report of a proxy session's economy (→ stderr; the answers go to stdout).
 * @param metrics  the proxy.metrics() readout.
 * @param saved    frontier calls avoided (= local hits).
 */
function formatProxyReport( metrics, saved ) {
	if ( !metrics ) return 'proxy: (no metrics)';
	var pct = Math.round((metrics.coverage || 0) * 100);
	var lines = [
		'── proxy economy ──────────────────────────',
		'  served        : ' + metrics.served + ' queries',
		'  local (cache) : ' + metrics.local + '   frontier: ' + metrics.frontier,
		'  coverage      : ' + pct + '%  (frontier calls saved: ' + saved + ')'
	];
	if ( metrics.stock && metrics.stock.size != null ) {
		var s = metrics.stock;
		var stockLine = '  stock         : ' + s.size + ' entries';
		if ( s.reuseRate != null ) stockLine += '   reuse: ' + Math.round(s.reuseRate * 100) + '%   deadWeight: ' + (s.deadWeight != null ? s.deadWeight : '?');
		if ( s.evicted != null && s.evicted.count ) stockLine += '   evicted: ' + s.evicted.count;
		lines.push(stockLine);
	}
	lines.push('────────────────────────────────────────────');
	return lines.join('\n');
}

module.exports = { runProxySession: runProxySession, formatProxyReport: formatProxyReport };
