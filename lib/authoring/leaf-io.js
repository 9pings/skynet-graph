/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * leaf-io — the TYPED LEAF I/O DISCIPLINE (ZERO-CORE, host-side). Closes the tiered-plan gap (ii): the executor's
 * raw reply ("area=120", "72 km/h", "yes.") polluted the projection pool, so downstream leaves consumed garbage and
 * the reassembled answer was unreadable. This generalizes the demo's execProgram/cellule idiom to prose leaves:
 * the leaf's OUTPUT is parsed to a BARE TYPED VALUE (number | yes/no) or REFUSED — never carried garbled. Fail-closed:
 * an ambiguous reply (two numbers, prose) is a typed refusal with a blame, not a guess.
 *
 *   const { parseLeafValue, LEAF_ANSWER_SYSTEM } = require('skynet-graph/lib/authoring/leaf-io');
 *   const out = await ask({ system: LEAF_ANSWER_SYSTEM, user: leaf.prompt, maxTokens: 16 });
 *   const v = parseLeafValue(out);              // { ok:true, kind:'number', value:24 } | { ok:false, blame }
 *   if ( !v.ok ) refuseLeaf(v.blame); else post(v.value);
 */

// the executor-side contract matching the parser (kept WITH it so prompt and parse never drift apart).
const LEAF_ANSWER_SYSTEM = 'Solve this single small step. Reply with ONLY the bare result: one number (no units, '
	+ 'no commas, no symbols, no variable name), or yes/no. Nothing else.';

/**
 * parseLeafValue(raw, opts) → { ok:true, kind:'number'|'bool', value } | { ok:false, blame, raw }
 * Deterministic, fail-closed. Tolerated surface noise: a `name=`/`name:` echo (takes the RHS), one leading $, comma
 * thousand-separators, a trailing unit word after the number, trailing punctuation, yes/no casing. REFUSED: empty,
 * no numeric/boolean token, several DISTINCT numeric candidates (ambiguity is never resolved by guessing).
 * @param opts.kind 'number' | 'bool' — restrict the accepted type ('auto' default accepts both).
 */
function parseLeafValue( raw, opts ) {
	opts = opts || {};
	const want = opts.kind || 'auto';
	let s = String(raw == null ? '' : raw).trim().replace(/^["'`\s]+|["'`.\s]+$/g, '');
	if ( !s ) return { ok: false, blame: 'empty reply', raw: raw };
	if ( s.indexOf('=') >= 0 ) s = s.slice(s.lastIndexOf('=') + 1).trim();   // "area=120" / "6*4=24" → the declared result (RHS)
	const lbl = s.match(/^[a-z_][\w .]*:\s*(.+)$/i);                         // "result: 120" → the RHS (alphabetic label only — "2:30" stays ambiguous)
	if ( lbl ) s = lbl[1].trim();
	if ( want !== 'number' ) {
		const b = s.match(/^(yes|no|true|false)\b[.!]?$/i);
		if ( b ) { const y = /^(yes|true)/i.test(b[1]); return { ok: true, kind: 'bool', value: y ? 'yes' : 'no' }; }
	}
	if ( want === 'bool' ) return { ok: false, blame: 'not a yes/no reply', raw: raw };
	// numeric: the reply must carry exactly ONE numeric value (a unit word after it is tolerated, a second number is not).
	const nums = s.match(/-?\$?\d[\d,]*(?:\.\d+)?/g) || [];
	const distinct = Array.from(new Set(nums.map(( n ) => Number(n.replace(/[$,]/g, '')) )));
	if ( distinct.length === 0 ) return { ok: false, blame: 'no numeric value in reply', raw: raw };
	if ( distinct.length > 1 ) return { ok: false, blame: 'ambiguous reply (' + distinct.length + ' distinct numbers)', raw: raw };
	// the remainder must be a value+unit surface, not a sentence re-stating the problem (fail-closed on prose).
	const stripped = s.replace(/-?\$?\d[\d,]*(?:\.\d+)?/g, ' ').replace(/[%°]/g, ' ').trim();
	if ( /\s/.test(stripped) && stripped.split(/\s+/).length > 2 ) return { ok: false, blame: 'prose reply, not a bare value', raw: raw };
	return { ok: true, kind: 'number', value: distinct[0] };
}

module.exports = { parseLeafValue, LEAF_ANSWER_SYSTEM };
