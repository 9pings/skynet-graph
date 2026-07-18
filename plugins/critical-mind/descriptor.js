'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * dialectic — the LIVING-DEBATE instance-type descriptor (R3 of the instance service): the C9
 * debate as a named, persistent graph instance that agents enrich over days and read by bounded
 * projection. The SAME grammar (concepts/dialectic/), providers (providers.js, byte-frozen p0
 * prompts) and projection (project.js — shared verbatim with the one-shot factory) — the one-shot
 * `critique` is this instance born, run and dropped.
 *
 * create({topic, statements?, viewpoints?})   the factory-grammar seed as a template: MATERIAL
 *     when statements are given (else the Brainstorm leaf builds the pool at first settle — needs
 *     the ask), DECLARED when viewpoints are given (else Split declares them).
 * addArguments {statements}                   evidence grows the pool (p·/c· ids continue).
 * addViewpoint {text, side?}                  a NEW declared point — the grammar explores it
 *     against the CURRENT pool at settle (the living mechanism: day-2 evidence + a re-declared
 *     still-open point = a fresh explore over the grown pool; nothing re-arms by flag surgery).
 * verdict/state/brief (reads)                 projectDebate off the settled structure; brief =
 *     buildCritiqueBrief + renderJudgePrompt (the judgment layer — the LLM weighs, the graph
 *     guarantees the arguments).
 *
 * THE ASK IS CONFIG, NOT CONTEXT (worker placement serializes ctx): the Dialectic:: providers are
 * installed process-wide at module load with a DEFERRED ask — `descriptor.wireAsk(fn)` (host/test)
 * or env LLM_BASE/LLM_MODEL (an OpenAI-compatible server; what a config alias resolves to). No
 * ask available → the provider records a TYPED dialecticError and the projection throws — the
 * witness gate never silently self-flags. One ask per process/worker (per-instance asks = one
 * instance per worker, the mandated placement).
 *
 * V1 scope (consigned): re-declaring beats re-arming (an old open point stays open and counts 0 —
 * append-only, auditable); attacking an ESTABLISHED point with day-2 counter-evidence = the
 * dialectic pass, a later rung.
 */
const path = require('path');

function requireEither( pkgName, relPath ) {
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const Graph = requireEither('skynet-graph', '../../lib/index.js');
const { buildConceptTree } = requireEither('skynet-graph/lib/authoring/core/concepts.js', '../../lib/authoring/core/concepts.js');
const kernelProviders = requireEither('reason-kernel/providers.js', '../reason-kernel/providers.js');
const { createDialecticProviders } = require('./providers.js');
const { projectDebate } = require('./project.js');
const { buildCritiqueBrief, renderJudgePrompt } = require('./brief.js');

const MECHANICAL_MARGIN = { FREE: 3, MATERIAL: 3, DECLARED: 3, STOCK: 2 };
const DIALECTIC_TREE = buildConceptTree(path.join(__dirname, 'concepts', 'dialectic'));

// ── the deferred ask: wired by the host/test, else env (an OpenAI-compatible server) ──────────
let wiredAsk = null;
let envAsk = null;
function resolveAsk() {
	if ( wiredAsk ) return wiredAsk;
	if ( envAsk ) return envAsk;
	if ( process.env.LLM_BASE ) {
		const { makeAsk } = requireEither('skynet-graph/lib/providers/llm.js', '../../lib/providers/llm.js');
		return (envAsk = makeAsk({ base: process.env.LLM_BASE, model: process.env.LLM_MODEL || 'default' }));
	}
	throw new Error('dialectic: no ask wired — call descriptor.wireAsk(fn) or set LLM_BASE (the debate\'s witness gate needs a model; it never self-flags)');
}
// serialized (the factory-grammar discipline: enqueue order deterministic)
let q = Promise.resolve();
const serialAsk = ( p ) => { const r = q.then(() => resolveAsk()(p) ); q = r.catch(() => {} ); return r; };

// providers installed ONCE per process/worker (same namespaces; the ask resolves lazily per call)
Graph._providers = Object.assign({}, Graph._providers, kernelProviders, createDialecticProviders({ ask: serialAsk }));

// caller statements → pool records (the imperative parse, verbatim shape)
function parseStatements( statements, startP, startC ) {
	const pool = []; let p = startP || 0, c = startC || 0, dropped = 0;
	for ( const s of statements || [] ) {
		const rec = typeof s === 'string' ? (s.match(/^(PRO|CON)\s*:\s*(.+)$/i) || null) : null;
		const side = rec ? rec[1].toUpperCase() : (s && s.side ? String(s.side).toUpperCase() : null);
		const text = rec ? rec[2].trim() : (s && s.text ? String(s.text).trim() : null);
		if ( (side !== 'PRO' && side !== 'CON') || !text ) { dropped++; continue; }
		pool.push({ id: side === 'PRO' ? 'p' + (++p) : 'c' + (++c), side, text });
	}
	return { pool, dropped, p, c };
}
const fx = ( g, id ) => { const e = g.getEtty(id); return (e && e._) || {}; };
const idMax = ( ids, prefix ) => ids.reduce(( m, id ) => { const x = id.match(new RegExp('^' + prefix + '(\\d+)$')); return x ? Math.max(m, Number(x[1])) : m; }, 0);

const descriptor = {
	type       : 'dialectic',
	version    : '1.0.0',
	conceptSets: ['dialectic'],
	conceptMap : { dialectic: DIALECTIC_TREE },            // carried DATA — the store/worker boots with it
	concurrency: ['shared-sequenced', 'fork-merge'],
	wireAsk    : ( fn ) => { wiredAsk = fn; },             // host/test wiring (per process/worker)

	create: function ( seed ) {
		const topic = String(seed && seed.topic || '').trim();
		if ( !topic ) throw new Error('dialectic: seed.topic is required');
		const { pool } = parseStatements(seed && seed.statements);
		const material = pool.length > 0;
		const givenVps = (Array.isArray(seed && seed.viewpoints) && seed.viewpoints.length)
			? seed.viewpoints.map(( s, i ) => ({ key: 'V' + (i + 1), side: (s && s.side) ? String(s.side).toUpperCase() : null,
				text: typeof s === 'string' ? s.trim() : String(s.text || '').trim() }) ).filter(( v ) => v.text )
			: null;
		const poolStatus = material ? 'MATERIAL' : 'FREE';
		const frameStatus = givenVps ? 'DECLARED' : poolStatus;
		const frame = { $$_id: 'frame', Node: true, isFrame: true, topic, frameStatus, poolStatus,
			threshold: MECHANICAL_MARGIN[frameStatus] || 3, dialectic: !!(seed && seed.dialectic) };
		if ( material ) { frame.poolBuilt = 1; frame.nPro = pool.filter(( a ) => a.side === 'PRO' ).length; frame.nCon = pool.filter(( a ) => a.side === 'CON' ).length; }
		else frame.needsPool = true;
		if ( !givenVps ) frame.needsSplit = true;
		return [
			{ $$_id: 'ledger', pro: [], proRetracted: [], con: [], conRetracted: [],
				declared: givenVps ? givenVps.map(( v ) => v.key ) : [], explored: [], open: [],
				poolIds: pool.map(( a ) => a.id ) },
			frame
		].concat(pool.map(( a ) => ({ $$_id: a.id, Node: true, isStatement: true, side: a.side, text: a.text, inPool: true }) ))
			.concat((givenVps || []).map(( v ) => ({ $$_id: v.key, Node: true, isViewpoint: true, side: v.side, text: v.text, frame: 'frame' }) ));
	},

	actions: {
		/** Evidence grows the pool (p·/c· ids continue; the frame counters follow). */
		addArguments: {
			write: true, input: { statements: 'array' },
			apply: function ( g, args ) {
				const led = fx(g, 'ledger'), frame = fx(g, 'frame');
				const ids = led.poolIds || [];
				const { pool, dropped } = parseStatements(args.statements, idMax(ids, 'p'), idMax(ids, 'c'));
				if ( !pool.length ) return null;               // typed refusal from the runner (+ dropped is visible in state)
				return [
					{ $$_id: 'ledger', poolIds: ids.concat(pool.map(( a ) => a.id )) },
					{ $$_id: 'frame', nPro: (frame.nPro || 0) + pool.filter(( a ) => a.side === 'PRO' ).length,
						nCon: (frame.nCon || 0) + pool.filter(( a ) => a.side === 'CON' ).length,
						...(dropped ? { lastDropped: dropped } : {}) }
				].concat(pool.map(( a ) => ({ $$_id: a.id, Node: true, isStatement: true, side: a.side, text: a.text, inPool: true }) ));
			}
		},
		/** A NEW declared point — explored against the CURRENT pool at settle (the living mechanism). */
		addViewpoint: {
			write: true, input: { text: 'string', side: 'string?' },
			apply: function ( g, args ) {
				const text = String(args.text || '').trim();
				if ( !text ) return null;
				const led = fx(g, 'ledger');
				const key = 'V' + (idMax(led.declared || [], 'V') + 1);
				const side = args.side ? String(args.side).toUpperCase() : null;
				return [
					{ $$_id: key, Node: true, isViewpoint: true, side, text, frame: 'frame' },
					{ $$_id: 'ledger', declared: (led.declared || []).concat([key]) }
				];
			}
		},
		verdict: {
			write: false, input: {},
			project: function ( g ) {
				const r = projectDebate(g);
				return r.error ? { verdict: r.verdict, error: r.error, frameStatus: r.frameStatus }
					: { verdict: r.verdict, basis: r.basis, counts: r.counts, margin: r.margin, threshold: r.threshold, norm: r.norm, frameStatus: r.frameStatus };
			}
		},
		state: { write: false, input: {}, project: ( g ) => projectDebate(g) },
		brief: {
			write: false, input: {},
			project: function ( g ) {
				const r = projectDebate(g);
				if ( r.error ) return { error: r.error };
				const brief = buildCritiqueBrief(r);
				return { brief, judgePrompt: renderJudgePrompt(brief) };
			}
		}
	},

	projections: {
		summary: function ( g ) {
			const r = projectDebate(g);
			return r.error ? { topic: r.topic, verdict: r.verdict, error: r.error }
				: { topic: r.topic, frameStatus: r.frameStatus, counts: r.counts, margin: r.margin, verdict: r.verdict };
		}
	}
};

module.exports = descriptor;
