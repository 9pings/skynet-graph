'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * Dialectic:: providers — the LLM leaves of the C9 GRAMMAR face (tranche 2 of the combos-as-grammar
 * design §3.5). FACTORY-BUILT per run (they close over the host `ask` + `onStage` — the planner
 * CtxProj precedent): no static provider entrypoint; the `Dialectic` namespace stays claimed in the
 * manifest. The deterministic ledger primitives stay in reason-kernel (`Ledger::tally/untally`).
 *
 * Division of labour (design §5): the STATE, gates, joins, retraction and verdicts live in the
 * concept files (`concepts/dialectic/`); these providers own only the ask itself, the prompt
 * rendering (the pool slice is an enumeration of a LIVE set — the one part a static template cannot
 * interpolate) and the bounded INTRA-call retry budgets (GEN_TRIES / LIST_TRIES / K_RETRIES).
 *
 * PROMPTS ARE BYTE-IDENTICAL to factory.js (the measured parity reference — p0 canonical forms,
 * frozen; never re-tune a prompt on a paraphrase). The parity harness asserts equal ask budgets, so
 * every ask here maps 1:1 onto an imperative ask.
 *
 * Graph conventions (the seed contract of factory-grammar.js, same ids as the concept files' refs):
 * frame node = 'frame', ledger free-node = 'ledger', statements 'p1'/'c3'…, viewpoints 'V1'…/'G1'….
 * Every template SELF-FLAGS its concept marker (cast-marker gotcha) and terminates with a null-guard
 * fact (witnessMiss/retryDone/genRound/normProbed/refuteDone) so a leaf fires exactly once.
 */

const SYSTEM = 'You are a careful analyst. Follow the output format EXACTLY.';
const GEN_TRIES = 3;
const K_RETRIES = 2;                                                          // v1.1 explore retries (open points → stance slice), run INTRA-call
const LIST_TRIES = 2;                                                         // brainstorm list step: initial call + ONE bounded "list MORE" re-ask

const parseCites = ( raw ) => /cites?:\s*NONE/i.test(String(raw || '')) ? [] : (String(raw || '').match(/[pc]\d+/g) || null);
const poolLines = ( pool ) => pool.map(( a ) => a.id + ': ' + a.text ).join('\n');

function createDialecticProviders( opts ) {
	const ask = opts.ask;
	if ( typeof ask !== 'function' ) throw new Error('createDialecticProviders: opts.ask is required');
	const onStage = typeof opts.onStage === 'function' ? opts.onStage : () => {};

	const facts = ( graph, id ) => { const e = graph.getEtty(id); return (e && e._) || {}; };
	const readPool = ( graph ) => (facts(graph, 'ledger').poolIds || []).map(( id ) => {
		const f = facts(graph, id); return { id, side: f.side, text: f.text };
	});
	const witnessesOf = ( f ) => f.w0 ? [f.w0].concat(f.w1 ? [f.w1] : []).concat(f.w2 ? [f.w2] : []) : null;
	// a rejected ask must not wedge the fixpoint: record the error as a typed fact + terminate the
	// leaf (marker + null-guard); the shell re-throws it after settle (parity: the imperative rejects).
	const guarded = ( cb, failFacts ) => ( fn ) => Promise.resolve().then(fn).catch(( e ) =>
		cb(null, Object.assign({ $_id: '_parent', dialecticError: String((e && e.message) || e) }, failFacts)) );

	// ── brainstorm: the FREE pool, TWO-STEP (list unlabeled → ONE forced choice per statement) ────
	function brainstorm( graph, concept, scope, argz, cb ) {
		const topic = scope._.topic;
		guarded(cb, { Brainstorm: true, poolBuilt: 1, nPro: 0, nCon: 0 })(async () => {
			let cands = [];
			for ( let t = 0; t < LIST_TRIES && cands.length < 6; t++ ) {
				const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
					+ '\nList the strongest DISTINCT statements informed people ACTUALLY make about this question, whichever side (one concrete argument each, up to 20 lines).'
					+ '\nIf one side has far fewer serious statements, reflect that honestly — do NOT balance the sides artificially.'
					+ (cands.length ? '\nAlready listed (do NOT repeat these):\n' + cands.map(( c ) => '- ' + c ).join('\n')
						+ '\nList UP TO 10 MORE distinct statements, or reply exactly NONE if there are no more serious ones.' : '')
					+ '\nReply one per line, each: S: <one sentence>', maxTokens: 700, temperature: 0 }));
				if ( /^\s*NONE\s*$/i.test(out.trim()) ) break;
				const got = (out.match(/S:\s*[^\n]+/g) || []).map(( l ) => l.replace(/^S:\s*/, '').trim() ).filter(( s ) => s.length >= 5 );
				const before = cands.length;
				for ( const g of got ) if ( !cands.some(( c ) => c.toLowerCase() === g.toLowerCase() ) ) cands.push(g);
				if ( cands.length === before ) break;                                 // no progress → a same-shape retry is a no-op
			}
			cands = cands.slice(0, 24);
			const pool = []; let p = 0, c = 0, off = 0;
			for ( const text of cands ) {
				const lab = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
					+ '\nStatement: ' + text
					+ '\nIn the context of the question, does this statement support answering YES (PRO), support answering NO (CON), or is it OFF-TOPIC?'
					+ '\nReply ONLY one of: PRO | CON | OFF-TOPIC', maxTokens: 8, temperature: 0 }));
				const m = lab.match(/\b(OFF[- ]?TOPIC|PRO|CON)\b/i);
				const side = m && !/OFF/i.test(m[1]) ? m[1].toUpperCase() : null;
				if ( side && (side === 'PRO' ? p : c) < 12 ) pool.push({ id: side === 'PRO' ? 'p' + (++p) : 'c' + (++c), side, text });
				else off++;
			}
			if ( off ) onStage('POOL', off + ' brainstormed statements dropped by the forced-choice label (OFF-TOPIC or unparseable)');
			cb(null, [
				{ $_id: '_parent', Brainstorm: true, poolBuilt: 1, nPro: p, nCon: c },
				{ $$_id: 'ledger', poolIds: pool.map(( a ) => a.id ) },
			].concat(pool.map(( a ) => ({ _id: a.id, Node: true, isStatement: true, side: a.side, text: a.text, inPool: true }) )));
		});
	}

	// ── split: declare the viewpoints from the per-side slices (when the caller declared none) ────
	function split( graph, concept, scope, argz, cb ) {
		const topic = scope._.topic;
		const pool = readPool(graph);
		guarded(cb, { Split: true, splitDone: 1 })(async () => {
			const vps = [];
			for ( const side of ['PRO', 'CON'] ) {
				const slice = pool.filter(( a ) => a.side === side );
				if ( !slice.length ) continue;
				const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic + '\n' + side + ' statements:\n' + poolLines(slice)
					+ '\nName the 2 main DISTINCT points of view these statements support. Reply 2 lines, each: V: <short name of the viewpoint>', maxTokens: 80, temperature: 0 }));
				(out.match(/V:\s*[^\n]+/g) || []).slice(0, 2).forEach(( l ) =>
					vps.push({ key: 'V' + (vps.length + 1), side, text: l.replace(/^V:\s*/, '').trim() }) );
			}
			cb(null, [
				{ $_id: '_parent', Split: true, splitDone: 1 },
				{ $$_id: 'ledger', declared: vps.map(( v ) => v.key ) },
			].concat(vps.map(( v ) => ({ _id: v.key, Node: true, isViewpoint: true, side: v.side, text: v.text, frame: 'frame' }) )));
		});
	}

	// ── cite: the witness leaf. argz[0].slice = 'full' (round 1) | 'stance' (the v1.1 retry ladder,
	// K_RETRIES INTRA-call — a same-prompt retry at temp 0 is a no-op, but the imperative reference
	// budgets it, so parity does too). Validates cites on METADATA (in-slice + stance), writes only
	// discrete ids w0/w1 — or the typed miss facts. A side-less viewpoint gets its side INFERRED from
	// its first witness (the imperative behaviour), then only same-side cites are kept. ──────────────
	function cite( graph, concept, scope, argz, cb ) {
		const o = (argz && argz[0]) || {};
		const f = scope._, key = f._id;
		const topic = facts(graph, f.frame || 'frame').topic;
		const pool = readPool(graph);
		const declaredSide = f.side || null;
		const leaf = ( slice ) => ask({ system: SYSTEM, user: 'Question: ' + topic
			+ '\nPoint of view' + (declaredSide ? ' (' + declaredSide + ')' : '') + ': ' + f.text
			+ '\nStatements:\n' + poolLines(slice)
			+ '\nWhich statements GENUINELY make this exact point (not merely the same side)? Cite AT MOST 2. Reply ONE line, format: cites: ids_or_NONE', maxTokens: 48, temperature: 0 });
		const gate = ( out, slice ) => {                                            // stance gate on cites (metadata): an opposite-side cite is dropped, never admitted
			let ids = (parseCites(out) || []).filter(( x ) => slice.some(( a ) => a.id === x && (!declaredSide || a.side === declaredSide) ) );
			if ( !declaredSide && ids.length ) {                                     // side-less: infer from the first witness, keep that side only
				const side = pool.find(( a ) => a.id === ids[0] ).side;
				ids = ids.filter(( x ) => pool.find(( a ) => a.id === x ).side === side );
			}
			return ids;
		};
		if ( o.slice === 'stance' ) {                                               // ── the retry ladder (Explore/Retry.json) ──
			const slice = pool.filter(( a ) => a.side === declaredSide );
			guarded(cb, { Retry: true, retryDone: 1 })(async () => {
				for ( let r = 0; r < K_RETRIES; r++ ) {
					const ids = gate(String(await leaf(slice)), slice);
					if ( ids.length ) {
						onStage('EXPLORE', key + ' → established (' + ids.slice(0, 2).join('+') + ', retry ' + (r + 1) + ')');
						const t = { $_id: '_parent', Retry: true, retryDone: 1, retryHit: r + 1, w0: ids[0] };
						if ( ids[1] ) t.w1 = ids[1];
						return cb(null, [t, { $$_id: 'ledger', explored: { __push: key } }]);
					}
				}
				onStage('EXPLORE', key + ' → OPEN');
				cb(null, [{ $_id: '_parent', Retry: true, retryDone: 1 },
					{ $$_id: 'ledger', explored: { __push: key }, open: { __push: key } }]);
			});
			return;
		}
		guarded(cb, { Explore: true, witnessMiss: true, noRetrySlice: 1 })(async () => {   // ── round 1, full pool (Explore.json) ──
			const ids = gate(String(await leaf(pool)), pool);
			if ( ids.length ) {
				onStage('EXPLORE', key + ' → established (' + ids.slice(0, 2).join('+') + ')');
				const t = { $_id: '_parent', Explore: true, w0: ids[0] };
				if ( ids[1] ) t.w1 = ids[1];
				if ( !declaredSide ) t.side = pool.find(( a ) => a.id === ids[0] ).side;
				return cb(null, [t, { $$_id: 'ledger', explored: { __push: key } }]);
			}
			// miss: retryable iff a stance slice exists AND is narrower than the pool (both sides non-empty)
			const retryable = !!declaredSide && pool.some(( a ) => a.side === declaredSide ) && pool.some(( a ) => a.side !== declaredSide );
			if ( retryable ) return cb(null, { $_id: '_parent', Explore: true, witnessMiss: true });
			onStage('EXPLORE', key + ' → OPEN (no narrower slice to retry on)');
			cb(null, [{ $_id: '_parent', Explore: true, witnessMiss: true, noRetrySlice: 1 },
				{ $$_id: 'ledger', explored: { __push: key }, open: { __push: key } }]);
		});
	}

	// ── propose: the SINGLE generative pass (Frame/Uncertain/Generate.json null-guards it). The whole
	// measured pipeline runs INTRA-call (GEN_TRIES per side, anchored ≥2-unused-witnesses gate, overlap
	// merge, semantic SAME/NEW, fuse witness-transfer to open declared points) — ported verbatim from
	// the imperative reference; the mutations it emits are the ONLY way its decisions reach the graph:
	// a NEW thesis = an ordinary Viewpoint node admitted by the SAME Established gate as the declared
	// ones; a fuse = a w0/w1 WRITE onto the open declared node (the admission is the gate, not code). ──
	function propose( graph, concept, scope, argz, cb ) {
		const topic = scope._.topic;
		const pool = readPool(graph);
		const led = facts(graph, 'ledger');
		// picture of the ledger at generation time: the declared entries, in seed order
		const entries = (led.declared || []).map(( k ) => {
			const nf = facts(graph, k);
			return { key: k, kind: 'declared', side: nf.side || null, text: nf.text,
				witnesses: witnessesOf(nf), status: nf.w0 ? 'active' : 'open' };
		});
		const journal = [], newNodes = [], fuseOps = [];
		guarded(cb, { Generate: true, genRound: 1 })(async () => {
			const usedArgs = new Set(entries.flatMap(( e ) => e.witnesses || [] ));
			for ( const side of ['PRO', 'CON'] ) {
				const tried = new Set();
				for ( let i = 0; i < GEN_TRIES; i++ ) {
					const unused = pool.filter(( a ) => a.side === side && !usedArgs.has(a.id) && !tried.has(a.id) );
					if ( unused.length < 2 ) break;
					const seed = unused[0]; tried.add(seed.id);
					const others = unused.filter(( a ) => a.id !== seed.id );
					const cOut = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
						+ '\nCandidate point (' + side + '): ' + seed.text
						+ '\nStatements:\n' + poolLines(others)
						+ '\nWhich statements GENUINELY make this exact point (not merely the same side)? Cite AT MOST 2. Reply ONE line, format: cites: ids_or_NONE', maxTokens: 48, temperature: 0 }));
					const cIds = (parseCites(cOut) || []).filter(( x ) => others.some(( a ) => a.id === x ) );
					const slate = cIds.length ? unused.filter(( a ) => a.id === seed.id || cIds.includes(a.id) ) : unused;
					const table = entries.filter(( e ) => e.side === side && (e.kind === 'declared' || e.status === 'active') ).map(( e ) => '- ' + e.text.slice(0, 90) );
					const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
						+ '\nKnown ' + side + ' points (already on the table):\n' + table.join('\n')
						+ '\nUNUSED statements:\n' + poolLines(slate)
						+ '\nPropose ONE NEW ' + side + ' point of view, DIFFERENT from the known points, that at least TWO of these unused statements genuinely make. '
						+ '\nReply ONE line, format: THESIS: <one short sentence> | cites: id, id   (or exactly: NONE)', maxTokens: 80, temperature: 0 }));
					(String(out).match(/[pc]\d+/g) || []).filter(( x ) => pool.some(( a ) => a.id === x ) ).forEach(( x ) => tried.add(x) );
					const srcLine = [...String(out).split(/\n/).map(( l ) => l.trim() ).filter(Boolean)].reverse().find(( l ) => /THESIS:/i.test(l) || /^NONE$/i.test(l) ) || String(out);
					if ( /^\s*NONE\s*$/i.test(srcLine) ) { onStage('GEN', side + ': honest NONE'); break; }
					const mT = srcLine.match(/THESIS:\s*([^|]{5,200})\|/i);
					const ids = [...new Set(parseCites(srcLine) || [])].filter(( x ) => pool.some(( a ) => a.id === x && a.side === side ) && !usedArgs.has(x) );
					if ( !mT || ids.length < 2 ) { onStage('GEN', side + ': gate refusal (needs ≥2 unused in-pool witnesses)'); continue; }
					const overlap = entries.find(( e ) => e.status === 'active' && e.witnesses && ids.filter(( x ) => e.witnesses.includes(x) ).length / ids.length >= 0.5 );
					if ( overlap ) { onStage('GEN', side + ': merged into ' + overlap.key); continue; }
					const declared = entries.filter(( e ) => e.kind === 'declared' );
					const cls = String(await ask({ system: SYSTEM, user: 'Known points:\n' + declared.map(( e, di ) => (di + 1) + '. ' + e.text.slice(0, 90) ).join('\n')
						+ '\nCandidate thesis: ' + mT[1].trim()
						+ '\nIs the candidate just a restatement of one known point?\nReply with ONLY: SAME <number> or NEW.', maxTokens: 8, temperature: 0 }));
					const mS = cls.match(/SAME\s*(\d)/i);
					if ( mS ) {
						const target = declared[Number(mS[1]) - 1];
						if ( target && target.status === 'open' && target.side === side ) {     // fuse: redundancy TRANSPORTS coverage
							target.witnesses = ids.slice(0, 2); target.status = 'active';
							ids.forEach(( x ) => usedArgs.add(x) );
							fuseOps.push({ $$_id: target.key, w0: target.witnesses[0], w1: target.witnesses[1], fusedRound: 1 });
							onStage('GEN', side + ': fuse — ' + target.key + ' open→established');
							journal.push('R1 fuse ' + target.key + ' open→established (' + target.witnesses.join('+') + ')');
						} else onStage('GEN', side + ': semantic SAME as ' + (target ? target.key : '?') + ' — dropped');
						continue;
					}
					const key = 'G' + (entries.filter(( e ) => e.kind === 'generated' ).length + 1);
					entries.push({ key, kind: 'generated', side, text: mT[1].trim(), witnesses: ids.slice(0, 3), status: 'active' });
					const node = { _id: key, Node: true, isViewpoint: true, kind: 'generated', side, text: mT[1].trim(),
						frame: 'frame', round: 1, provenance: 'generated+witnesses', Explore: true, w0: ids[0], w1: ids[1] };
					if ( ids[2] ) node.w2 = ids[2];
					newNodes.push(node);
					ids.forEach(( x ) => usedArgs.add(x) );
					onStage('GEN', side + ': NEW ' + key + ' (' + ids.slice(0, 3).join('+') + ')');
					journal.push('R1 gen-NEW ' + key + ' (' + side + ', ' + ids.slice(0, 3).join('+') + ')');
				}
			}
			cb(null, [
				{ $_id: '_parent', Generate: true, genRound: 1 },
				// genTallies = the tallies this pass will produce (every admitted node has valid in-pool
				// witnesses by construction) — the counter Frame/NormProbe.json gates on (no transient probe).
				{ $$_id: 'ledger', genTallies: newNodes.length + fuseOps.length, genJournal: journal },
			].concat(newNodes).concat(fuseOps));
		});
	}

	// ── normProbe: ONE forced-choice call → snapped enum (SOFT advisory lane, announced, never a gated
	// fact for the verdict COUNTS — Frame/Verdict/SettledNorm.json reads it as an upgrade gate only). ──
	function normProbe( graph, concept, scope, argz, cb ) {
		const topic = scope._.topic;
		guarded(cb, { NormProbe: true, normProbed: 1, normStatus: 'CONTESTED' })(async () => {
			const nOut = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
				+ '\nAmong informed people, is this question genuinely CONTESTED, or is there a SETTLED answer (law, widely shared ethics, broad consensus)?'
				+ '\nReply ONLY one of: SETTLED PRO | SETTLED CON | CONTESTED', maxTokens: 8, temperature: 0 }));
			const mN = nOut.match(/SETTLED\s*(PRO|CON)/i);
			cb(null, { $_id: '_parent', NormProbe: true, normProbed: 1, normStatus: mN ? 'SETTLED_' + mN[1].toUpperCase() : 'CONTESTED' });
		});
	}

	// ── attack: anchored cross-refutation on ONE established point (Contested.json places it on
	// undecided frames only). Attackers are OPPOSITE-side in-pool cites, never the point's own
	// witnesses; the result is an ANNOTATION (no concept gates on `attackers`/`contested` — the
	// anti-illusion invariant is structural). ──────────────────────────────────────────────────────
	function attack( graph, concept, scope, argz, cb ) {
		const f = scope._, key = f._id;
		const topic = facts(graph, f.frame || 'frame').topic;
		const pool = readPool(graph);
		const oppSide = f.side === 'PRO' ? 'CON' : 'PRO';
		const slice = pool.filter(( a ) => a.side === oppSide );
		if ( !slice.length ) return cb(null, { $_id: '_parent', Contested: true, refuteDone: 1 });
		guarded(cb, { Contested: true, refuteDone: 1 })(async () => {
			const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
				+ '\nEstablished point (' + f.side + '): ' + f.text
				+ '\nOpposing statements:\n' + poolLines(slice)
				+ '\nWhich of these statements SPECIFICALLY CONTRADICT the established point (make it false or insufficient), not merely argue the other side? Cite AT MOST 2. Reply ONE line, format: cites: ids_or_NONE', maxTokens: 48, temperature: 0 }));
			const att = (parseCites(out) || []).filter(( x ) => slice.some(( a ) => a.id === x ) && !(witnessesOf(f) || []).includes(x) );
			if ( !att.length ) return cb(null, { $_id: '_parent', Contested: true, refuteDone: 1 });
			onStage('DIALECTIC', key + ' contested (attacked by ' + att.slice(0, 2).join('+') + ')');
			cb(null, { $_id: '_parent', Contested: true, refuteDone: 1, contested: true, attackers: att.slice(0, 2) });
		});
	}

	return { Dialectic: { brainstorm, split, cite, propose, normProbe, attack } };
}

module.exports = { createDialecticProviders, SYSTEM, parseCites, poolLines };
