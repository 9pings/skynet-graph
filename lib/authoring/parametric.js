/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * parametric — role-typed SLOTS over an LGG method skeleton: bind, mount fail-closed, and blame per slot.
 *
 * The Probe-#1 mechanics promoted to a brick (2026-07-03; three experiment reuses: selftest, live-probe,
 * live-discover-2). A method crystallized from param-DISJOINT episodes LGGs into a skeleton whose antiUnify
 * HOLES are exactly the param positions — « sous-qualifié = abstrait = un slot ». This module:
 *
 *   - `slotBindings`        reads each content hole's OWNING template object and types it: role =
 *                           `<stepKind>#<stepIndex>` (the frame's positional role id);
 *   - `mountParametric`     fills the holes from typed params and mounts in ONE create-mode mutation (the
 *                           ZERO-FIRE discipline — never re-decompose). Fail-closed at EVERY hole: a missing
 *                           param → `{ status:'impracticable', hint:[{role,key,stepKind}] }` — the typed hint
 *                           (« need sort X in role Y »), never a partial mount, never a provider re-fire;
 *   - `slotPostFrom`        mint per-SLOT post provenance where the atoms are DECLARED (the H3 rule: build
 *                           provenance where the knowledge exists, never reverse-engineer it at blame time);
 *   - `attributeSlotBlame`  the blame-gate PRIMARY of restriction learning (Laurie Q2: incompetence noise is
 *                           one-sided and self-sealing → classic candidate-elimination is UNSOUND; admitting
 *                           ONLY blame-localized negatives restores the clean rates): a failed post atom maps
 *                           to a slot iff its provenance names exactly ONE role; anything shared/unknown/mixed
 *                           → `unlocalized` and the whole failure is INADMISSIBLE as negative evidence — the
 *                           lab's C-arm (all-failures-negative) measured the price of skipping this gate
 *                           (monotone self-sealing on rare sorts, never recovered).
 *
 * The provenance carrier (`postSlots`) mirrors adapt.js#composeContract's `postFrom` (atom→'host'|'donor'|
 * 'both') at slot grain (atom→role|'shared'), with the same canonical atom key (adapt.js#canonAtom) so both
 * provenances survive the `$x==1` ≡ `x == 1` surface variance.
 */

const { fillContentHoles } = require('./abstract.js');
const { mountTemplate } = require('./typed-loop.js');
const { canonAtom } = require('./adapt.js');

/** Locate each content hole's OWNING template object and read its typed role: { path, key, stepKind,
 *  stepIndex, role } — role = `<stepKind>#<stepIndex>`. `gen` = adapt.js#methodContentHoles output. */
function slotBindings( gen ) {
	const slots = [];
	const walk = ( x, path, owner ) => {
		if ( Array.isArray(x) ) { x.forEach(( v, i ) => walk(v, path + '[' + i + ']', owner)); return; }
		if ( x && typeof x === 'object' ) {
			if ( '§var' in x && Object.keys(x).length === 1 ) {
				const key = path.split('.').pop().replace(/\[\d+\]/g, '');
				slots.push({ path: x['§var'], key,
					stepKind: owner && owner.stepKind, stepIndex: owner && owner.stepIndex,
					role: (owner && owner.stepKind || '?') + '#' + (owner && owner.stepIndex != null ? owner.stepIndex : '?') });
				return;
			}
			const own = (x.Segment || x.$_id === '_parent') ? x : owner;
			for ( const k in x ) walk(x[k], path ? path + '.' + k : k, own);
		}
	};
	walk(gen.skeleton, '', null);
	return slots;
}

/**
 * The parametric mount. `paramsByRole` keys: `<role>.<key>` (a slot's hole), or bare `<role>` when the role
 * carries a single hole. Fail-closed at EVERY hole: missing → `{ status:'impracticable', hint }`, NOTHING
 * mounted; complete → `{ status:'complete', mutation, filled, values }` for `graph.pushMutation`
 * (create-mode: task + structure in ONE atomic mutation — the ZERO-FIRE discipline). `values` (path → value)
 * is the fill-time provenance a per-slot contract minter reads.
 */
function mountParametric( gen, slots, site, paramsByRole ) {
	const values = {}, hint = [];
	for ( const s of slots ) {
		const v = paramsByRole && (s.role + '.' + s.key in paramsByRole ? paramsByRole[s.role + '.' + s.key] : paramsByRole[s.role]);
		if ( v != null && v !== '' ) values[s.path] = v;
		else hint.push({ role: s.role, key: s.key, stepKind: s.stepKind });
	}
	if ( hint.length ) return { status: 'impracticable', hint };
	const filled = fillContentHoles(gen.skeleton, values);
	if ( !filled ) return { status: 'impracticable', hint: slots.map(( s ) => ({ role: s.role, key: s.key, stepKind: s.stepKind })) };
	const mutation = mountTemplate(filled, site);
	if ( !mutation ) return { status: 'impracticable', hint: [{ role: 'frontier', key: '_id' }] };
	return { status: 'complete', mutation, filled, values };
}

/** Mint per-slot post provenance from atoms DECLARED per role: `{ role: [atoms] }` →
 *  `{ post, postSlots }` — postSlots maps each canonical atom to its role, or 'shared' when two roles claim
 *  the same atom (the 'both' of postFrom: a shared atom can never localize a failure). */
function slotPostFrom( atomsByRole ) {
	const post = [], postSlots = {};
	for ( const role in (atomsByRole || {}) )
		for ( const atom of atomsByRole[role] || [] ) {
			const k = canonAtom(atom);
			if ( !(k in postSlots) ) { post.push(atom); postSlots[k] = role; }
			else if ( postSlots[k] !== role ) postSlots[k] = 'shared';
		}
	return { post, postSlots };
}

/** The per-SLOT blame rule (the H3 doctrine at slot grain). Given the post atoms `assertPost` reported
 *  violated on a parametric mount, attribute each to its provenance role. A failure is ADMISSIBLE as negative
 *  evidence for a slot iff EVERY failed atom localizes to the SAME single role — anything shared, unknown, or
 *  spanning roles → `{ admissible:false, role:null }` and the caller DISCARDS it (the blame-gate: an
 *  unlocalized failure is indistinguishable from model incompetence — Laurie Q2/8a).
 *  @param opts { contract | postSlots, failedAtoms }
 *  @returns { perAtom:[{atom, role}], role, admissible } — perAtom role 'unlocalized' when unmapped/shared. */
function attributeSlotBlame( opts ) {
	const postSlots = (opts && (opts.postSlots || (opts.contract && opts.contract.postSlots))) || {};
	const perAtom = ((opts && opts.failedAtoms) || []).map(( atom ) => {
		const role = postSlots[canonAtom(atom)];
		return { atom, role: role && role !== 'shared' ? role : 'unlocalized' };
	});
	const roles = new Set(perAtom.map(( x ) => x.role ));
	const admissible = perAtom.length > 0 && roles.size === 1 && !roles.has('unlocalized');
	return { perAtom, role: admissible ? [...roles][0] : null, admissible };
}

module.exports = { slotBindings, mountParametric, slotPostFrom, attributeSlotBlame };
