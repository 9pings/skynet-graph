/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * givens — the TYPED BASE-FACT FRONT-DOOR (ZERO-CORE, host-side). Closes the tiered-plan gap (i): a leaf served
 * through the context projection saw its UPSTREAM values but never the task's own literals (the 6 and the 4 of
 * "a 6×4 rectangle"), so the executor re-guessed them. This brick extracts the task's base facts DETERMINISTICALLY
 * (no model), names each one with a stable typed key, and the projection seeds them into the top pool as
 * `val_<given>` — a leaf that cites a given key in its `needs` gets the VALUE injected into its bounded context,
 * exactly like a producer's output. Nothing here is domain reasoning: it is a DECLARED front-door — two extractors
 * (numeric literals in prose; numeric cells of a table), both pure surface, both fail-closed (what is not a clean
 * numeric literal is NOT a given).
 *
 *   const { numberGivens, givensBlock, seedOf } = require('skynet-graph/lib/authoring/givens');
 *   const givens = numberGivens(task);                        // [{ key:'g1_wide', value:6, snippet:'is 6 wide' }]
 *   const leaves = await decompose(task + '\n' + givensBlock(givens));   // parts cite given keys in `needs`
 *   await createPlanLoop({ decompose, serveLeaf }).run(task, { givens: seedOf(givens) });
 *
 * The KEY is positional + a lexical slug (`g<i>_<word>`): stable, typed, never a sentence — the human-readable
 * meaning rides the SNIPPET (presentation), never the key (dispatch), per the K1 discipline.
 */

// a numeric literal in prose: optional $, digits with thousand-commas, optional decimals, optional %.
// NOTE (owner 07-10): the front-door stays DIGITS-ONLY on purpose — translating prose quantities ("ten",
// "twice") into numbers host-side is the wrong layer; the DECOMPOSER is instructed to restate any non-given
// base fact explicitly in the consuming part's instruction (DECOMPOSE_SYSTEM rule 6), which covers spelled
// numbers, fractions in words, and world knowledge alike.
const NUM_RE = /\$?\s?\d[\d,]*(?:\.\d+)?%?/g;
const WORD_RE = /[a-z][a-z'-]*/i;

// slug = the nearest content word AFTER the number (else BEFORE) — purely lexical, lowercased, bounded.
const STOP = { the: 1, a: 1, an: 1, of: 1, to: 1, and: 1, or: 1, is: 1, are: 1, was: 1, were: 1, it: 1, its: 1, in: 1, on: 1, at: 1, for: 1, with: 1, then: 1, than: 1, by: 1, per: 1, each: 1, more: 1, less: 1, had: 1, has: 1, have: 1, them: 1, they: 1, those: 1, these: 1, this: 1, that: 1, his: 1, her: 1, their: 1, he: 1, she: 1, we: 1, as: 1, so: 1, but: 1, if: 1, how: 1, many: 1, much: 1, did: 1, does: 1, do: 1 };
function slugNear( text, start, end ) {
	const pick = ( s ) => {
		let m;
		const re = new RegExp(WORD_RE.source, 'gi');
		while ( (m = re.exec(s)) ) if ( !STOP[m[0].toLowerCase()] ) return m[0].toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
		return '';
	};
	return pick(text.slice(end, end + 24)) || pick(text.slice(Math.max(0, start - 24), start).split(/\s+/).reverse().join(' '));
}

/**
 * numberGivens(text) → [{ key, value, snippet }] — every clean numeric literal of the prose, in reading order.
 * Deterministic, fail-closed, DIGITS-ONLY (see the NOTE above — prose quantities are the decomposer's job,
 * by prompt rule, not a host-side translation table). `value` is the bare Number ($/commas/% stripped).
 */
function numberGivens( text ) {
	const s = String(text == null ? '' : text);
	const out = [];
	let m;
	NUM_RE.lastIndex = 0;
	while ( (m = NUM_RE.exec(s)) ) {
		const raw = m[0];
		const v = Number(raw.replace(/[$,%\s]/g, ''));
		if ( !isFinite(v) ) continue;
		const slug = slugNear(s, m.index, m.index + raw.length);
		const key = 'g' + (out.length + 1) + (slug ? '_' + slug : '');
		out.push({ key: key, value: v, snippet: s.slice(Math.max(0, m.index - 18), m.index + raw.length + 18).trim().replace(/\s+/g, ' ') });
	}
	return out;
}

/**
 * cellGivens(table) → [{ key, value, snippet, cell:{r,c} }] — every numeric cell of a row-major table (the FinQA
 * front-door; row 0 = headers by convention). Key = `c<r>_<c>_<slug-of-row-label>`; snippet = "rowLabel · colHeader".
 */
function cellGivens( table ) {
	const rows = Array.isArray(table) ? table : [];
	const headers = Array.isArray(rows[0]) ? rows[0] : [];
	const out = [];
	for ( let r = 1; r < rows.length; r++ ) {
		const row = rows[r] || [];
		const label = String(row[0] == null ? '' : row[0]);
		for ( let c = 1; c < row.length; c++ ) {
			let raw = String(row[c] == null ? '' : row[c]).trim();
			if ( !raw ) continue;
			const neg = /^\(.*\)$/.test(raw);                                 // (1,234) = accounting negative
			if ( !neg ) raw = raw.replace(/\(\s*[^)]*\)\s*$/, '').trim();     // "-17.1 ( 17.1 )" = FinQA dup-in-parens → keep the head
			const v = Number(raw.replace(/[$,%()\s]/g, '')) * (neg ? -1 : 1);
			if ( !isFinite(v) || !/\d/.test(raw) ) continue;
			const slug = (label.toLowerCase().match(WORD_RE) || [''])[0].replace(/[^a-z]/g, '').slice(0, 12);
			out.push({ key: 'c' + r + '_' + c + (slug ? '_' + slug : ''), value: v, cell: { r: r, c: c },
				snippet: (label + ' · ' + String(headers[c] == null ? '' : headers[c])).trim() });
		}
	}
	return out;
}

/** givensBlock(givens) → the prompt block appended to the decompose USER message (keys citable in `needs`). */
function givensBlock( givens ) {
	if ( !givens || !givens.length ) return '';
	return 'GIVENS (base facts already available — a part that uses one MUST cite its key in "needs"; do NOT restate the number): '
		+ givens.map(( g ) => g.key + '=' + g.value + ' ("' + g.snippet + '")' ).join(' · ');
}

/** seedOf(givens) → { key: value } — the map the projection seeds as `val_<key>` (plan-loop's `ctx.givens`). */
function seedOf( givens ) {
	const map = {};
	for ( const g of (givens || []) ) map[g.key] = g.value;
	return map;
}

/**
 * labelsOf(givens) → { key: snippet } — provenance labels for leaf prompts, STRUCTURED PROVENANCE ONLY (the
 * "cells" rule, ablation-verified at N=40 and N=200): a table cell's MEANING (row · col header) is invisible in
 * its bare value, so the label fixes leaf mis-localization (wrong cell/base-year/sign); a PROSE given is already
 * restated self-contained by the decomposer (rule 7), so labelling it is pure prompt perturbation (net-negative),
 * and upstream-producer labels help nowhere. Wire as `ctx.labels` (plan-loop → context-project).
 */
function labelsOf( givens ) {
	const map = {};
	for ( const g of (givens || []) ) if ( g && g.cell && g.snippet ) map[g.key] = String(g.snippet).slice(0, 70);
	return map;
}

module.exports = { numberGivens, cellGivens, givensBlock, seedOf, labelsOf };
