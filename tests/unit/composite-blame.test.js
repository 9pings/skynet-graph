'use strict';
/**
 * composite-blame (H3) — graft-provenance BLAME attribution (creative loop; e2e-fidelity LOG confront-verdict G).
 *
 * When a blended (composite) method's runtime post is violated (`assertPost` blames a post atom), the naive H3 rule
 * "revise the donor" OVER-PENALIZES: a donor that is individually correct gets its standalone contract corrupted for
 * a failure that belongs to the GRAFT. The minimal correct rule (Laurie G) attributes each violated post atom to the
 * parent whose `contract.post` CONTRIBUTED it:
 *   · donor-only provenance  → the donor's OWN post failed at the graft site → revise the DONOR pre;
 *   · host-only provenance   → revise the HOST;
 *   · BOTH / unknown / an `escalate` composite (the interface was never statically discharged) → the prime suspect is
 *     the GRAFT itself → retract/revise the COMPOSITE only, never touch a standalone library method;
 *   · overall axis is CONSERVATIVE: 'donor' iff EVERY failed atom is donor-only, 'host' iff every atom host-only,
 *     otherwise 'graft' (when in doubt, blame the composite — corrupting the donor would poison the whole library).
 *
 * These are FAILING (TDD red) tests for two not-yet-implemented pieces:
 *   1. `composeContract(a,b)` gains a `postFrom: { <normalizedAtom>: 'host'|'donor'|'both' }` provenance map, with
 *      NORMALIZED atom keys (the `$`-prefix stripped so `$x==1` and `x==1` are ONE key — the G3 atom-form fix).
 *   2. `attributeCompositeBlame({ composite, failedAtoms })` — the blame-axis attributor.
 *
 * The composites are built REALLY via `blendMethods` over two crystallized candidates (mirroring blend-methods.test.js),
 * so the real blend path (blendAtSegment + checkCompose + composeContract) runs — not a mock. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');                                  // sets __SERVER__ then loads the engine
const { crystallizeStructural } = require('../../lib/authoring/learning/crystallize.js');
const { blendMethods, composeContract, attributeCompositeBlame } = require('../../lib/authoring/learning/adapt.js');
const { BASE } = require('../../lib/authoring/core/abstract.js');
console.log = console.info = console.warn = () => {};

// ── fixture builders (mirror blend-methods.test.js) ────────────────────────────────────────────────────────────
const ground = ( kind ) => 'plan-' + kind;
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, extra ) => Object.assign({ _id: id, Segment: true, originNode: o, targetNode: t }, extra || {});
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };

// crystallize a simple 1-level decompose method for a `kind` (id = 'Crystal'+kind; one graftable child-segment slot).
async function learn( kind ) {
	const Refine = { refine( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true },
			{ _id: mid, Node: true, state: ground(scope._.kind) },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
		]);
	} };
	const TREE = { childConcepts: { Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] } } };
	const nodes = [], segments = [];
	for ( let s = 0; s < 2; s++ ) { const a = `${kind}a${s}`, b = `${kind}b${s}`; nodes.push(node(a), node(b)); segments.push(seg(`${kind}E${s}`, a, b, { kind })); }
	const res = await crystallizeStructural({ episodeTree: TREE, seed: { lastRev: 0, nodes, segments }, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'Crystal' + kind, declaredFrontier: DECL });
	assert.equal(res.admitted, true);
	return res.candidate;
}

// build a REAL composite: crystallize host+donor, OVERRIDE their contracts (to craft the provenance/verdict under
// test, exactly as the H2 test does), then run the real `blendMethods`. blendedFrom = ['Crystalhard','Crystaleasy'].
async function buildComposite( hostContract, donorContract ) {
	const host = await learn('hard'), donor = await learn('easy');
	host.schema.contract = hostContract;
	donor.schema.contract = donorContract;
	return blendMethods(host, donor);
}

// SOUND fixture: host.write ∩ donor.read = ∅ → checkCompose 'sound'. host contributes `hout=='ok'`, donor `dout=='dv'`.
const SOUND_HOST  = { read: ['Segment', 'kind'], write: ['hout'], pre: [], post: ["hout=='ok'"], effect: 'pure' };
const SOUND_DONOR = { read: ['din'], write: ['dout'], pre: [], post: ["dout=='dv'"], effect: 'pure' };
// ESCALATE fixture (mirrors blend-methods H2): host WRITES `route` but leaves it FREE in its post; donor requires
// route=='store' → checkCompose cannot discharge in-fragment → 'escalate' (the statically-undischarged interface).
const ESC_HOST  = { read: ['Segment'], write: ['route'], pre: [], post: ['other==1'], effect: 'pure' };
const ESC_DONOR = { read: ['route'], write: ['done'], pre: ["route=='store'"], post: ['done==true'], effect: 'pure' };

// normalize an atom for matching: strip a leading $/$$ and collapse whitespace (robust to the impl's canonical form).
const normAtom = ( s ) => String(s).replace(/^\$\$?/, '').replace(/\s+/g, '');
// find the provenance a postFrom map records for `atom`, matching on the NORMALIZED key (impl may key bare or $-form).
const provOf = ( pf, atom ) => {
	const want = normAtom(atom);
	for ( const k of Object.keys(pf || {}) ) if ( normAtom(k) === want ) return pf[k];
	return undefined;
};

// ── FIXTURE SMOKE (must PASS today) — proves the real blend path builds the composites this suite blames ─────────
test('fixture smoke — blendMethods really builds the composites (blendedFrom/blendSlot/composeVerdict populated) [passes today]', async () => {
	const sound = await buildComposite(SOUND_HOST, SOUND_DONOR);
	assert.ok(sound, 'a composite is built');
	assert.deepEqual(sound.blendedFrom, ['Crystalhard', 'Crystaleasy'], 'provenance ids recorded ([hostId, donorId])');
	assert.equal(typeof sound.blendSlot, 'string', 'the graft slot is recorded');
	assert.equal(sound.blendSlot.indexOf(BASE + '_'), 0, 'and it is a real child-segment slot');
	assert.equal(sound.composeVerdict, 'sound', 'the SOUND fixture really produces composeVerdict sound (real checkCompose)');
	assert.ok(sound.schema && sound.schema.contract, 'the composite carries a composed contract');
	assert.ok(Object.keys(sound.templatesBySig).length, 'templatesBySig populated — the blendAtSegment path actually ran');

	const esc = await buildComposite(ESC_HOST, ESC_DONOR);
	assert.ok(esc, 'the under-determined composite is ADMITTED (not refused)');
	assert.equal(esc.composeVerdict, 'escalate', 'the ESCALATE fixture really produces composeVerdict escalate (real checkCompose)');
	assert.deepEqual(esc.blendedFrom, ['Crystalhard', 'Crystaleasy']);
});

// ── composeContract postFrom (FAILS today: composeContract does not yet emit postFrom) ───────────────────────────
test('composeContract — postFrom attributes each post atom (host-only → host, donor-only → donor, shared → both)', () => {
	const a = { read: [], write: ['hout'], pre: [], post: ["hOnly==1", "shared=='s'"], effect: 'pure' };
	const b = { read: [], write: ['dout'], pre: [], post: ["dOnly==2", "shared=='s'"], effect: 'pure' };
	const c = composeContract(a, b);
	assert.ok(c.postFrom, 'composeContract annotates the composed post with per-atom provenance (postFrom)');
	assert.equal(provOf(c.postFrom, 'hOnly==1'), 'host', 'a post atom only in parent a (host) → host');
	assert.equal(provOf(c.postFrom, 'dOnly==2'), 'donor', 'a post atom only in parent b (donor) → donor');
	assert.equal(provOf(c.postFrom, "shared=='s'"), 'both', 'a post atom present in BOTH parents → both');
});

test('composeContract — postFrom keys are NORMALIZED: $-prefixed in one parent + bare in the other = ONE key, both (G3 atom-form fix)', () => {
	const a = { read: [], write: ['route'], pre: [], post: ["$route=='store'"], effect: 'pure' };
	const b = { read: [], write: ['x'], pre: [], post: ["route=='store'"], effect: 'pure' };
	const c = composeContract(a, b);
	assert.ok(c.postFrom, 'postFrom present');
	assert.equal(Object.keys(c.postFrom).length, 1, 'the $-prefixed and the bare form collapse to ONE key (not two)');
	assert.equal(provOf(c.postFrom, "route=='store'"), 'both', 'and it is attributed to BOTH parents');
});

// ── attributeCompositeBlame (FAILS today: the export does not exist) ─────────────────────────────────────────────
test('attributeCompositeBlame — a donor-only failed atom on a sound composite → axis donor + the donor id + the slot', async () => {
	const composite = await buildComposite(SOUND_HOST, SOUND_DONOR);
	const r = attributeCompositeBlame({ composite, failedAtoms: ["dout=='dv'"] });
	assert.equal(r.axis, 'donor', 'the donor owns the failing post (revise the DONOR pre — not the whole graft)');
	assert.equal(r.donor, 'Crystaleasy', 'donor id = blendedFrom[1]');
	assert.equal(r.host, 'Crystalhard', 'host id = blendedFrom[0]');
	assert.equal(r.slot, composite.blendSlot, 'slot = blendSlot (localizes the sub-result to check)');
	assert.equal(r.perAtom.length, 1, 'one per-atom verdict per failed atom');
	assert.equal(r.perAtom[0].axis, 'donor');
	assert.equal(normAtom(r.perAtom[0].atom), normAtom("dout=='dv'"), 'the per-atom entry names the failed atom');
});

test('attributeCompositeBlame — a host-only failed atom → axis host', async () => {
	const composite = await buildComposite(SOUND_HOST, SOUND_DONOR);
	const r = attributeCompositeBlame({ composite, failedAtoms: ["hout=='ok'"] });
	assert.equal(r.axis, 'host');
	assert.equal(r.perAtom[0].axis, 'host');
});

test('attributeCompositeBlame — a failed atom with BOTH-parent provenance → axis graft (retract/revise the composite only)', async () => {
	const host = Object.assign({}, SOUND_HOST, { post: ["hout=='ok'", "shared=='s'"] });
	const donor = Object.assign({}, SOUND_DONOR, { post: ["dout=='dv'", "shared=='s'"] });
	const composite = await buildComposite(host, donor);
	assert.equal(composite.composeVerdict, 'sound', 'still a sound compose (the shared post atom does not add write/read sharing)');
	const r = attributeCompositeBlame({ composite, failedAtoms: ["shared=='s'"] });
	assert.equal(r.axis, 'graft', 'a post atom both parents assert → the graft is the suspect, not a standalone parent');
	assert.equal(r.perAtom[0].axis, 'graft');
});

test('attributeCompositeBlame — composeVerdict escalate → EVERY failed atom reads graft, even a donor-only one', async () => {
	const composite = await buildComposite(ESC_HOST, ESC_DONOR);
	assert.equal(composite.composeVerdict, 'escalate', 'precondition: the fixture is the under-determined (escalate) composite');
	// `done==true` is donor-ONLY provenance — but the interface was never statically discharged, so the graft is the
	// prime suspect: retract the graft, keep the donor's standalone contract intact.
	const r = attributeCompositeBlame({ composite, failedAtoms: ['done==true'] });
	assert.equal(r.axis, 'graft', 'escalate overrides donor-only provenance → blame the graft (keep the donor)');
	assert.equal(r.perAtom[0].axis, 'graft');
});

test('attributeCompositeBlame — mixed failed atoms (one donor-only + one host-only, sound) → overall graft (conservative); per-atom axes stay distinct', async () => {
	const composite = await buildComposite(SOUND_HOST, SOUND_DONOR);
	const r = attributeCompositeBlame({ composite, failedAtoms: ["dout=='dv'", "hout=='ok'"] });
	assert.equal(r.axis, 'graft', 'not all-donor and not all-host → blame the COMPOSITE (never corrupt a standalone method)');
	const byAtom = {};
	for ( const e of r.perAtom ) byAtom[normAtom(e.atom)] = e.axis;
	assert.equal(byAtom[normAtom("dout=='dv'")], 'donor', 'the donor-only atom is still per-atom donor');
	assert.equal(byAtom[normAtom("hout=='ok'")], 'host', 'the host-only atom is still per-atom host');
});

test('attributeCompositeBlame — failedAtoms are NORMALIZED before matching postFrom ($-prefixed vs bare, both directions)', async () => {
	// host post stored $-prefixed, donor post stored bare — the attributor must match either query form.
	const host = Object.assign({}, SOUND_HOST, { post: ["$hout=='ok'"] });
	const donor = Object.assign({}, SOUND_DONOR, { post: ["dout=='dv'"] });
	const composite = await buildComposite(host, donor);
	assert.equal(attributeCompositeBlame({ composite, failedAtoms: ["hout=='ok'"] }).axis, 'host',
		'a BARE query atom matches the $-prefixed host post atom');
	assert.equal(attributeCompositeBlame({ composite, failedAtoms: ["$dout=='dv'"] }).axis, 'donor',
		'a $-prefixed query atom matches the bare donor post atom');
});

test('attributeCompositeBlame — an atom in NO parent post (unknown to postFrom) → graft (cannot pin a parent → blame the composite)', async () => {
	const composite = await buildComposite(SOUND_HOST, SOUND_DONOR);
	const r = attributeCompositeBlame({ composite, failedAtoms: ['nonexistent==9'] });
	assert.equal(r.axis, 'graft');
	assert.equal(r.perAtom[0].axis, 'graft');
});
