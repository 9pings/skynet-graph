'use strict';
/*
 * createCriticalMind — the external critical mind as a combo (C9): split a user question into
 * declared viewpoints, ESTABLISH each one against a statement pool through a witness gate
 * (cap-2 precision), GENERATE the missing theses anchored-by-witnesses (clusters + quarantine +
 * semantic SAME/NEW gate + fuse-to-open), keep everything in a typed LEDGER, and render a
 * certification-aware verdict:
 *
 *   frame status FREE (model-brainstormed pool) / MATERIAL (caller statements) / DECLARED
 *   (caller viewpoints) — a MECHANICAL verdict fires only at count margin ≥ 3 (the measured
 *   decidability bound; a certified .sgc perimeter is what buys margin ≥ 2 — measured 24/24);
 *   below the bound the honest output is counts + coverage + UNDECIDED, never a fake verdict.
 *
 * Assembles the measured FULL config of the generative critical loop (WIP campaigns 07-12/07-13:
 * decision ladder by margin · cluster-anchored generation · quarantine · SAME/NEW semantic gate ·
 * fuse witness-transfer to open declared points · 0-fabrication held across all negative
 * controls). The LEDGER is the deliverable; `renderProse` turns it into a readable report and
 * `polish: true` adds ONE bounded rewrite pass constrained to the given content (presentation
 * only — the ledger stays the audit trail).
 */

const SYSTEM = 'You are a careful analyst. Follow the output format EXACTLY.';
const GEN_TRIES = 3;
const MECHANICAL_MARGIN = { FREE: 3, MATERIAL: 3, DECLARED: 3, STOCK: 2 };   // the measured bound

const parseCites = ( raw ) => /cites?:\s*NONE/i.test(String(raw || '')) ? [] : (String(raw || '').match(/[pc]\d+/g) || null);
const poolLines = ( pool ) => pool.map(( a ) => a.id + ': ' + a.text ).join('\n');

function createCriticalMind( opts ) {
	const ask = opts.ask;
	if ( typeof ask !== 'function' ) throw new Error('createCriticalMind: opts.ask (async {system,user,maxTokens,temperature} → text) is required');
	const onStage = typeof opts.onStage === 'function' ? opts.onStage : () => {};

	async function buildPool( topic, statements ) {
		if ( Array.isArray(statements) && statements.length ) {
			const pool = []; let p = 0, c = 0, dropped = 0;
			for ( const s of statements ) {
				const rec = typeof s === 'string' ? (s.match(/^(PRO|CON)\s*:\s*(.+)$/i) || null) : null;
				const side = rec ? rec[1].toUpperCase() : (s && s.side ? String(s.side).toUpperCase() : null);
				const text = rec ? rec[2].trim() : (s && s.text ? String(s.text).trim() : null);
				if ( (side !== 'PRO' && side !== 'CON') || !text ) { dropped++; continue; }
				pool.push({ id: side === 'PRO' ? 'p' + (++p) : 'c' + (++c), side, text });
			}
			if ( dropped ) onStage('POOL', dropped + ' statements dropped (each needs side PRO|CON + text, or a "PRO: ..." line)');
			return { pool, status: 'MATERIAL' };
		}
		const pool = [];
		for ( const side of ['PRO', 'CON'] ) {
			const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
				+ '\nWrite the 10 strongest DISTINCT ' + side + ' STATEMENTS a well-read person could make (one concrete argument each, no numbering).'
				+ '\nReply with EXACTLY 10 lines, each: S: <one sentence>', maxTokens: 420, temperature: 0 }));
			(out.match(/S:\s*[^\n]+/g) || []).slice(0, 10).forEach(( l, i ) =>
				pool.push({ id: (side === 'PRO' ? 'p' : 'c') + (i + 1), side, text: l.replace(/^S:\s*/, '').trim() }) );
		}
		return { pool, status: 'FREE' };
	}

	async function declareViewpoints( topic, pool, given ) {
		if ( Array.isArray(given) && given.length )
			return given.map(( s, i ) => ({ key: 'V' + (i + 1), side: (s && s.side) ? String(s.side).toUpperCase() : null,
				text: typeof s === 'string' ? s.trim() : String(s.text || '').trim() }) ).filter(( v ) => v.text );
		const vps = [];
		for ( const side of ['PRO', 'CON'] ) {
			const slice = pool.filter(( a ) => a.side === side );
			if ( !slice.length ) continue;
			const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic + '\n' + side + ' statements:\n' + poolLines(slice)
				+ '\nName the 2 main DISTINCT points of view these statements support. Reply 2 lines, each: V: <short name of the viewpoint>', maxTokens: 80, temperature: 0 }));
			(out.match(/V:\s*[^\n]+/g) || []).slice(0, 2).forEach(( l ) =>
				vps.push({ key: 'V' + (vps.length + 1), side, text: l.replace(/^V:\s*/, '').trim() }) );
		}
		return vps;
	}

	async function explore( topic, pool, vps, ledger ) {
		for ( const v of vps ) {
			const slice = v.side ? pool.filter(( a ) => a.side === v.side ) : pool;
			if ( !slice.length ) continue;
			const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
				+ '\nPoint of view' + (v.side ? ' (' + v.side + ')' : '') + ': ' + v.text
				+ '\nStatements:\n' + poolLines(slice)
				+ '\nWhich statements GENUINELY make this exact point (not merely the same side)? Cite AT MOST 2. Reply ONE line, format: cites: ids_or_NONE', maxTokens: 48, temperature: 0 }));
			const ids = (parseCites(out) || []).filter(( x ) => slice.some(( a ) => a.id === x ) );
			const side = v.side || (ids[0] && ids[0][0] === 'p' ? 'PRO' : 'CON');
			ledger.push({ key: v.key, kind: 'declared', side, text: v.text,
				witnesses: ids.length ? ids.slice(0, 2) : null, status: ids.length ? 'active' : 'open', provenance: 'declared' });
			onStage('EXPLORE', v.key + ' → ' + (ids.length ? 'established (' + ids.slice(0, 2).join('+') + ')' : 'OPEN'));
		}
	}

	async function generate( topic, pool, ledger ) {
		const usedArgs = new Set(ledger.flatMap(( e ) => e.witnesses || [] ));
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
				const table = ledger.filter(( e ) => e.side === side && (e.kind === 'declared' || e.status === 'active') ).map(( e ) => '- ' + e.text.slice(0, 90) );
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
				const overlap = ledger.find(( e ) => e.status === 'active' && e.witnesses && ids.filter(( x ) => e.witnesses.includes(x) ).length / ids.length >= 0.5 );
				if ( overlap ) { onStage('GEN', side + ': merged into ' + overlap.key); continue; }
				const declared = ledger.filter(( e ) => e.kind === 'declared' );
				const cls = String(await ask({ system: SYSTEM, user: 'Known points:\n' + declared.map(( e, di ) => (di + 1) + '. ' + e.text.slice(0, 90) ).join('\n')
					+ '\nCandidate thesis: ' + mT[1].trim()
					+ '\nIs the candidate just a restatement of one known point?\nReply with ONLY: SAME <number> or NEW.', maxTokens: 8, temperature: 0 }));
				const mS = cls.match(/SAME\s*(\d)/i);
				if ( mS ) {
					const target = declared[Number(mS[1]) - 1];
					if ( target && target.status === 'open' && target.side === side ) {     // fuse: redundancy TRANSPORTS coverage
						target.witnesses = ids.slice(0, 2); target.status = 'active';
						ids.forEach(( x ) => usedArgs.add(x) );
						onStage('GEN', side + ': fuse — ' + target.key + ' open→established');
					} else onStage('GEN', side + ': semantic SAME as ' + (target ? target.key : '?') + ' — dropped');
					continue;
				}
				const key = 'G' + (ledger.filter(( e ) => e.kind === 'generated' ).length + 1);
				ledger.push({ key, kind: 'generated', side, text: mT[1].trim(), witnesses: ids.slice(0, 3), status: 'active', provenance: 'generated+witnesses' });
				ids.forEach(( x ) => usedArgs.add(x) );
				onStage('GEN', side + ': NEW ' + key + ' (' + ids.slice(0, 3).join('+') + ')');
			}
		}
	}

	/** deterministic prose from the LEDGER — the audit trail stays the source of truth. */
	function renderProse( r ) {
		const quote = ( id ) => { const a = r.pool.find(( x ) => x.id === id ); return a ? '“' + a.text + '”' : id; };
		const sideBlock = ( side, title ) => {
			const items = r.ledger.filter(( e ) => e.status === 'active' && e.witnesses && e.side === side );
			if ( !items.length ) return '## ' + title + '\n\nNothing could be established on this side from the pool.\n';
			let s = '## ' + title + '\n\n' + (r.synthesis[side] ? r.synthesis[side] + '\n' : '');
			for ( const e of items ) s += '\n- **' + e.text + '**' + (e.kind === 'generated' ? ' *(new angle found while reading)*' : '')
				+ '\n  ' + e.witnesses.map(quote).join(' · ') + '\n';
			return s;
		};
		const open = r.ledger.filter(( e ) => e.status === 'open' );
		let s = '# ' + r.topic + '\n\n'
			+ '*Frame status: **' + r.frameStatus + '**'
			+ (r.frameStatus === 'FREE' ? ' — the statement pool is model-generated; coverage is relative to this pool, not the world.' : '')
			+ (r.frameStatus === 'MATERIAL' ? ' — statements supplied by the caller; the decision frame is not certified.' : '')
			+ (r.frameStatus === 'DECLARED' ? ' — viewpoints declared by the caller.' : '') + '*\n\n'
			+ sideBlock('PRO', 'The case for') + '\n' + sideBlock('CON', 'The case against') + '\n';
		if ( open.length ) s += '## Points that could not be established\n\n' + open.map(( e ) => '- ' + e.text + ' *(no valid witnesses — left open, not faked)*' ).join('\n') + '\n\n';
		s += '## Bottom line\n\n';
		s += r.verdict !== 'UNDECIDED'
			? '**' + r.verdict + '** — anchored points ' + r.counts.PRO + ' vs ' + r.counts.CON + ' (margin ' + r.margin + ' ≥ ' + r.threshold + '): the verdict is mechanical, no model weighing involved.\n'
			: 'Anchored points: PRO ' + r.counts.PRO + ' vs CON ' + r.counts.CON + ' (margin ' + r.margin + '). On a ' + r.frameStatus
			+ ' frame this margin is below the measured decidability bound (' + r.threshold + '), so no verdict is rendered — '
			+ 'the honest deliverable is the anchored coverage above. A certified perimeter (.sgc stock) is what buys a verdict at margin ≥ 2.\n';
		return s;
	}

	async function run( input ) {
		const topic = String(input && input.topic || '').trim();
		if ( !topic ) throw new Error('critique: input.topic is required');
		const ledger = [];
		const { pool, status: poolStatus } = await buildPool(topic, input.statements);
		if ( pool.filter(( a ) => a.side === 'PRO' ).length < 2 || pool.filter(( a ) => a.side === 'CON' ).length < 2 )
			return { topic, frameStatus: poolStatus, error: 'pool too small (need ≥2 statements per side)', pool, ledger, verdict: 'UNDECIDED' };
		const frameStatus = (Array.isArray(input.viewpoints) && input.viewpoints.length) ? 'DECLARED' : poolStatus;
		onStage('POOL', pool.length + ' statements · status ' + poolStatus);
		const vps = await declareViewpoints(topic, pool, input.viewpoints);
		onStage('SPLIT', vps.length + ' declared viewpoints · frame ' + frameStatus);
		await explore(topic, pool, vps, ledger);
		await generate(topic, pool, ledger);
		const counts = { PRO: 0, CON: 0 };
		for ( const e of ledger ) if ( e.status === 'active' && e.witnesses ) counts[e.side]++;
		const margin = Math.abs(counts.PRO - counts.CON);
		const threshold = MECHANICAL_MARGIN[frameStatus] || 3;
		const verdict = margin >= threshold ? (counts.PRO > counts.CON ? 'PRO' : 'CON') : 'UNDECIDED';
		const synthesis = {};
		for ( const side of ['PRO', 'CON'] ) {
			const items = ledger.filter(( e ) => e.status === 'active' && e.witnesses && e.side === side );
			if ( !items.length ) continue;
			synthesis[side] = String(await ask({ system: SYSTEM, user: 'Question: ' + topic + '\nEstablished ' + side + ' points:\n'
				+ items.map(( c ) => '- ' + c.text.slice(0, 90) ).join('\n') + '\nSummarize the ' + side + ' case in ONE line (no ids).', maxTokens: 60, temperature: 0 })).trim();
		}
		const result = { topic, frameStatus, pool, viewpoints: vps, ledger, counts, margin, threshold, verdict, synthesis };
		result.prose = renderProse(result);
		if ( input.polish ) {                                                     // presentation-only rewrite, content-locked
			const polished = String(await ask({ system: 'You are an editor. Rewrite the report below into flowing prose. Use ONLY the content provided. Do NOT add facts, numbers, or claims. Keep the frame-status caveat and the bottom line verbatim in meaning.',
				user: result.prose, maxTokens: 700, temperature: 0 }));
			result.polished = polished.trim();
		}
		return result;
	}

	return { run, renderProse };
}

module.exports = { createCriticalMind };
