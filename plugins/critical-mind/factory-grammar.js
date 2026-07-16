'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * createCriticalMind — the GRAMMAR face of C9 (tranche 2 of combos-as-grammar): the SAME signature
 * and result shape as factory.js, but the debate runs as a CONCEPT SET on the native engine
 * emergence instead of an imperative pipeline. The ledger IS the graph:
 *
 *   seed (frame + ledger + statements + declared viewpoints) → settle → project the result.
 *
 * What emerges (concepts/dialectic/): Brainstorm/PoolReady/Split → Explore/Retry (witness leaves)
 * → Established (ONE admission gate for declared AND generated) → Pro/ConEntry (reason-kernel
 * Ledger tally, append-only) → Uncertain/Generate (G3 placement + the SINGLE generative pass as a
 * null-guard) → Verdict Pro/Con (the margin bound, LIVE: a retraction re-decides natively, both
 * directions) → NormProbe/SettledNorm → Contested (dialectic, annotation-only). The imperative
 * reconcile() loop is the engine's cascade retraction (a witness leaving the pool uncasts every
 * citer, cleaners append to *Retracted) — incremental, permanent, zero code.
 *
 * What stays imperative (design §5): the ask itself + prompt rendering (providers.js, byte-frozen
 * p0 forms), intra-call retry budgets, the per-side SYNTHESIS line + the prose rendering + polish
 * (presentation-only, no gate ever reads them — run post-settle here), the pool parse.
 *
 * PARITY: tests/unit/critique-grammar-parity.test.js replays every scripted scenario of
 * critique.test.js through BOTH faces and asserts identical results (counts/margin/verdict/basis/
 * norm/journal/ledger/prose) AND identical ask budgets. The prose comes from the imperative
 * renderProse itself (a pure projection, reused — zero drift by construction).
 *
 * DETERMINISM: the injected ask is SERIALIZED (mutex-queue — the measured caveat: independent
 * leaves fire concurrently and completion order is a race; enqueue order is deterministic and a
 * local mono-GPU host is serial anyway). Temp 0 everywhere, as the imperative.
 */

const path = require('path');

function requireEither( pkgName, relPath ) {                 // npm name (published) → relative sibling (bundled in-repo)
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const Graph = requireEither('skynet-graph', '../../lib/index.js');
const { buildConceptTree } = requireEither('skynet-graph/lib/authoring/core/concepts.js', '../../lib/authoring/core/concepts.js');
const kernelProviders = requireEither('reason-kernel/providers.js', '../reason-kernel/providers.js');
const { createDialecticProviders, SYSTEM } = require('./providers.js');
const { createCriticalMind: createImperative } = require('./factory.js');

const MECHANICAL_MARGIN = { FREE: 3, MATERIAL: 3, DECLARED: 3, STOCK: 2 };    // the measured bound (mirrors factory.js)
const DIALECTIC_TREE = buildConceptTree(path.join(__dirname, 'concepts', 'dialectic'));

// the prose renderer is the imperative one, REUSED (pure projection of the result object): parity
// by construction, no duplicated template to drift. The instance's ask is never reachable from it.
const RENDER = createImperative({ ask: async () => { throw new Error('render-only instance'); } });

async function settle( g ) {
	const { nextStable } = requireEither('skynet-graph/lib/authoring/core/supervise.js', '../../lib/authoring/core/supervise.js');
	for ( let i = 0; i < 300; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r) );
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
	throw new Error('critique-grammar: the debate graph did not settle');
}

function createCriticalMind( opts ) {
	const ask = opts.ask;
	if ( typeof ask !== 'function' ) throw new Error('createCriticalMind: opts.ask (async {system,user,maxTokens,temperature} → text) is required');
	const onStage = typeof opts.onStage === 'function' ? opts.onStage : () => {};
	// serialize the ask: concurrent leaves enqueue deterministically, replies apply in enqueue order
	let q = Promise.resolve();
	const serialAsk = ( p ) => { const r = q.then(() => ask(p) ); q = r.catch(() => {} ); return r; };

	// caller statements → pool (the imperative parse, verbatim — pure, no model call)
	function parseStatements( statements ) {
		const pool = []; let p = 0, c = 0, dropped = 0;
		for ( const s of statements ) {
			const rec = typeof s === 'string' ? (s.match(/^(PRO|CON)\s*:\s*(.+)$/i) || null) : null;
			const side = rec ? rec[1].toUpperCase() : (s && s.side ? String(s.side).toUpperCase() : null);
			const text = rec ? rec[2].trim() : (s && s.text ? String(s.text).trim() : null);
			if ( (side !== 'PRO' && side !== 'CON') || !text ) { dropped++; continue; }
			pool.push({ id: side === 'PRO' ? 'p' + (++p) : 'c' + (++c), side, text });
		}
		if ( dropped ) onStage('POOL', dropped + ' statements dropped (each needs side PRO|CON + text, or a "PRO: ..." line)');
		return pool;
	}

	async function run( input ) {
		const topic = String(input && input.topic || '').trim();
		if ( !topic ) throw new Error('critique: input.topic is required');
		const material = Array.isArray(input.statements) && input.statements.length;
		const givenVps = (Array.isArray(input.viewpoints) && input.viewpoints.length)
			? input.viewpoints.map(( s, i ) => ({ key: 'V' + (i + 1), side: (s && s.side) ? String(s.side).toUpperCase() : null,
				text: typeof s === 'string' ? s.trim() : String(s.text || '').trim() }) ).filter(( v ) => v.text )
			: null;
		const poolStatus = material ? 'MATERIAL' : 'FREE';
		const frameStatus = givenVps ? 'DECLARED' : poolStatus;
		const threshold = MECHANICAL_MARGIN[frameStatus] || 3;

		let pool = material ? parseStatements(input.statements) : [];
		const tooSmall = ( p ) => {
			const nPro = p.filter(( a ) => a.side === 'PRO' ).length, nCon = p.filter(( a ) => a.side === 'CON' ).length;
			return p.length < 4 || Math.max(nPro, nCon) < 2;
		};
		// a MATERIAL pool is known before boot — an inadequate one is refused without one model call
		if ( material && tooSmall(pool) )
			return { topic, frameStatus: poolStatus, error: 'pool too small (need ≥4 statements with ≥2 on at least one side)', pool, ledger: [], verdict: 'UNDECIDED' };

		// ── seed: the ledger free-node + the frame + (material) statements + (declared) viewpoints ──
		const frame = { _id: 'frame', isFrame: true, topic, frameStatus, poolStatus, threshold, dialectic: !!input.dialectic };
		if ( material ) {
			frame.poolBuilt = 1;
			frame.nPro = pool.filter(( a ) => a.side === 'PRO' ).length;
			frame.nCon = pool.filter(( a ) => a.side === 'CON' ).length;
		}
		else frame.needsPool = true;
		if ( !givenVps ) frame.needsSplit = true;
		const seed = {
			lastRev : 0, segments: [],
			freeNodes: [{ _id: 'ledger', pro: [], proRetracted: [], con: [], conRetracted: [],
				declared: givenVps ? givenVps.map(( v ) => v.key ) : [], explored: [], open: [],
				poolIds: pool.map(( a ) => a.id ) }],
			nodes: [frame]
				.concat(pool.map(( a ) => ({ _id: a.id, isStatement: true, side: a.side, text: a.text, inPool: true }) ))
				.concat((givenVps || []).map(( v ) => ({ _id: v.key, isViewpoint: true, side: v.side, text: v.text, frame: 'frame' }) )),
		};

		const saved = Graph._providers;                                            // forge/planner idiom: set globally, restore in finally
		Graph._providers = Object.assign({}, saved, kernelProviders, createDialecticProviders({ ask: serialAsk, onStage }));
		let g;
		try {
			g = new Graph(seed, { label: 'critique-grammar', isMaster: true, autoMount: true,
				conceptSets: ['dialectic'], bagRefManagers: {}, logLevel: 'error' }, { dialectic: DIALECTIC_TREE });
			await settle(g);
		} finally { Graph._providers = saved; }

		try {
			// ── projection: read the result OFF the structure (casts + facts), stable order ──
			const etty = ( id ) => g.getEtty(id);
			const fx = ( id ) => { const e = etty(id); return (e && e._) || {}; };
			const cast = ( id, k ) => { const e = etty(id); return !!(e && e._mappedConcepts[k]); };
			const fr = fx('frame'), led = fx('ledger');
			// a provider-recorded ask failure re-throws here (parity: the imperative run() rejects)
			const failed = ['frame'].concat(led.declared || []).map(( id ) => fx(id).dialecticError ).find(Boolean);
			if ( failed ) throw new Error(failed);

			if ( !material ) pool = (led.poolIds || []).map(( id ) => { const f = fx(id); return { id, side: f.side, text: f.text }; });
			if ( tooSmall(pool) )
				return { topic, frameStatus: poolStatus, error: 'pool too small (need ≥4 statements with ≥2 on at least one side)', pool, ledger: [], verdict: 'UNDECIDED' };
			const nPro = pool.filter(( a ) => a.side === 'PRO' ).length, nCon = pool.filter(( a ) => a.side === 'CON' ).length;
			if ( Math.min(nPro, nCon) < 2 ) onStage('POOL', 'one-sided pool (' + nPro + ' PRO / ' + nCon + ' CON) — announced, and itself a signal');
			onStage('POOL', pool.length + ' statements · status ' + poolStatus);

			const declaredKeys = led.declared || [];
			const vps = givenVps || declaredKeys.map(( k ) => { const f = fx(k); return { key: k, side: f.side || null, text: f.text }; });
			onStage('SPLIT', vps.length + ' declared viewpoints · frame ' + frameStatus);

			const genKeys = Object.keys(g._objById || {}).filter(( id ) => /^G\d+$/.test(id) && fx(id).isViewpoint )
				.sort(( a, b ) => Number(a.slice(1)) - Number(b.slice(1)) );
			const retractedSet = new Set([].concat(led.proRetracted || [], led.conRetracted || []));
			const entryOf = ( key, kind ) => {
				const f = fx(key);
				const witnesses = f.w0 ? [f.w0].concat(f.w1 ? [f.w1] : []).concat(f.w2 ? [f.w2] : []) : null;
				const e = { key, kind, side: f.side || null, text: f.text, witnesses,
					status: cast(key, 'Established') ? 'active' : (retractedSet.has(key) ? 'retracted' : 'open'),
					round: kind === 'generated' ? 1 : 0, provenance: kind === 'generated' ? 'generated+witnesses' : 'declared' };
				// key INSERTION order mirrors the imperative crossRefute (attackers, then contested) so even a
				// strict JSON.stringify comparison of the two faces is byte-identical (GPU parity bar GP1)
				if ( f.contested ) { e.attackers = f.attackers; e.contested = true; }
				return e;
			};
			const ledger = declaredKeys.map(( k ) => entryOf(k, 'declared') ).concat(genKeys.map(( k ) => entryOf(k, 'generated') ));

			// journal: the R0 lines are a pure projection of the leaf facts (established-at-round-1 in
			// declared order, then retry hits by (retry#, declared order), then the retry-exhausted opens
			// — exactly the imperative emission order), followed by the generation pass's own journal.
			const journal = [];
			const dIdx = ( k ) => declaredKeys.indexOf(k);
			const dEntries = ledger.filter(( e ) => e.kind === 'declared' );
			const wit = ( k ) => { const f = fx(k); return [f.w0].concat(f.w1 ? [f.w1] : []).filter(Boolean); };
			for ( const e of dEntries ) if ( fx(e.key).w0 && !fx(e.key).retryHit && !fx(e.key).fusedRound )
				journal.push('R0 established ' + e.key + ' (' + e.side + ', ' + wit(e.key).join('+') + ')');
			dEntries.filter(( e ) => fx(e.key).retryHit )
				.sort(( a, b ) => (fx(a.key).retryHit - fx(b.key).retryHit) || (dIdx(a.key) - dIdx(b.key)) )
				.forEach(( e ) => journal.push('R0 established ' + e.key + ' (' + e.side + ', ' + wit(e.key).join('+') + ', retry ' + fx(e.key).retryHit + ')') );
			for ( const e of dEntries ) if ( fx(e.key).retryDone && !fx(e.key).retryHit )
				journal.push('R0 open ' + e.key + ' (' + (e.side || '?') + ', no valid witnesses)');
			journal.push(...(led.genJournal || []));

			const counts = { PRO: (led.pro || []).length - (led.proRetracted || []).length,
				CON: (led.con || []).length - (led.conRetracted || []).length };
			const margin = Math.abs(counts.PRO - counts.CON);
			const norm = fr.normStatus
				? (/^SETTLED_/.test(fr.normStatus) ? { status: 'SETTLED', side: fr.normStatus.slice(8) } : { status: 'CONTESTED' })
				: null;
			let verdict, basis;
			if ( cast('frame', 'Pro') ) { verdict = 'PRO'; basis = 'mechanical-count'; }
			else if ( cast('frame', 'Con') ) { verdict = 'CON'; basis = 'mechanical-count'; }
			else if ( cast('frame', 'SettledNorm') ) { verdict = norm.side; basis = 'settled-norm'; }
			else { verdict = 'UNDECIDED'; basis = norm && norm.status === 'SETTLED' ? 'norm-vs-counts-tension' : null; }

			// per-side synthesis (presentation, post-verdict — the imperative prompt, verbatim)
			const synthesis = {};
			for ( const side of ['PRO', 'CON'] ) {
				const items = ledger.filter(( e ) => e.status === 'active' && e.witnesses && e.side === side );
				if ( !items.length ) continue;
				synthesis[side] = String(await serialAsk({ system: SYSTEM, user: 'Question: ' + topic + '\nEstablished ' + side + ' points:\n'
					+ items.map(( c ) => '- ' + c.text.slice(0, 90) ).join('\n') + '\nSummarize the ' + side + ' case in ONE line (no ids).', maxTokens: 60, temperature: 0 })).trim();
			}

			const result = { topic, frameStatus, rounds: fr.genRound ? 1 : 0, journal, pool, viewpoints: vps,
				ledger, counts, margin, threshold, verdict, basis, norm, synthesis };
			result.prose = RENDER.renderProse(result);
			if ( input.polish ) {                                                  // presentation-only rewrite, content-locked (verbatim)
				const polished = String(await serialAsk({ system: 'You are an editor. Rewrite the report below into flowing prose. Use ONLY the content provided. Do NOT add facts, numbers, or claims. Keep the frame-status caveat and the bottom line verbatim in meaning.',
					user: result.prose, maxTokens: 700, temperature: 0 }));
				result.polished = polished.trim();
			}
			return result;
		} finally { if ( g && g.destroy ) g.destroy(); }
	}

	return { run, renderProse: RENDER.renderProse };
}

// THE default `createCriticalMind` since the GPU parity re-measure (07-16: GP1-GP5 all green on
// live Q2 — results, budgets and prompt sets byte-identical to the imperative reference, replay
// bit-identical). The imperative face stays exported one release as `createCriticalMindImperative`.
module.exports = { createCriticalMind };
