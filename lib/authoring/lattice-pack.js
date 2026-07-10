/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * lattice-pack — the `.sgc` TYPED-LATTICE PACKAGE (host-side, ZERO-CORE, fs-free). The THIRD sibling of
 * `corpus-pack.js` (kind `'corpus'` = the authored grammar tree) and `method-pack.js` (kind `'methods'` =
 * the learned method library): THIS one packages the REGISTRY — the typed isa/enum vocabulary + the
 * synonym RINGS grown at runtime by the admission gate (`registry.js#decideRingAdmission` /
 * `mergeRingProposals`) + their `ringProvenance`. So a GROWN lattice (the runtime-learned vocabulary edges,
 * e.g. from the SemEval-T9 / hypernymy campaign) MOVES between deployments — not just survives a restart.
 *
 * One `.sgc` envelope (`format:'sgc'` + `sgcVersion` + `manifest`), discriminated by `kind` — here
 * `'lattice'`. A reader dispatches on `kind`; corpus-pack / method-pack are untouched.
 *
 *   const bundle = packLattice(freezeRegistry(reg, 'v3'), { name: 'isa', version: 'v3' });   // .sgc JSON
 *   const r = loadLattice(bundle, hostRegistry, { version: 'v3' });                          // grow the canon
 *   //   r.registry = the host registry GROWN by the shipped rings (confluence-checked); r.admitted/rejected
 *
 * THE PORTABLE UNIT is the registry value object `{ version, frozen, keys:{ <key>:{ tier, enum, synonyms,
 * grain, … } }, ringProvenance }` — already plain JSON and already version-stamped (`freezeRegistry` /
 * `bumpVersion`), so packing is a clone + a derived, self-describing manifest.
 *
 * THE LOAD-BEARING SOUNDNESS LINE (the SAME B8 doctrine as method-pack, plus the ring's own admission gate):
 *   The registry IS the closed typed vocabulary (any tier) + the defeasible ring envelope; its identity is
 *   the version token. Loading a packaged lattice into a receiving host is sound IFF versions AGREE — else
 *   the same key may now carry a DIFFERENT enum/ring, so no verbatim adoption (a stale ring would mis-canon
 *   a downstream fact). So the gate covers loading:
 *     - versions AGREE → grow the host: each shipped ring alias is re-proposed through `mergeRingProposals`,
 *       so it enters ONLY if its member is a registered enum member of the host key AND the ring stays
 *       CONFLUENT (the critical-pair check) — a conflicting shipped alias is REJECTED, never blindly merged.
 *       With NO host registry, the packaged registry is ADOPTED wholesale (the portable canon).
 *     - versions DIFFER → grow NOTHING (the host re-derives / re-learns). The bundle stays readable via
 *       `unpackLattice` for a host that wants to inspect it ("refuse beats a stale canon").
 *   Versions are opt-in (like `cache.js#version` / method-pack): the gate enforces iff BOTH sides declare a
 *   version (absent ⇒ permissive — the host explicitly opted out of pinning).
 */
const { mergeRingProposals } = require('./registry.js');

function clone( x ) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

// B8 gating (verbatim doctrine of method-pack#versionsAgree): active iff BOTH sides declare a version.
function versionsAgree( vHost, vPkg ) {
	if ( vHost == null || vPkg == null ) return true;   // no pinning requested → permissive
	return vHost === vPkg;
}

/** the flat ring PROPOSALS of a registry — one `{key, member, alias}` per (member, alias) in every key's ring. */
function ringsOf( reg ) {
	const out = [], keys = (reg && reg.keys) || {};
	for ( const key of Object.keys(keys) ) {
		const syn = keys[key].synonyms;
		if ( !syn ) continue;
		for ( const member of Object.keys(syn) )
			for ( const alias of (syn[member] || []) ) out.push({ key, member, alias });
	}
	return out;
}

/**
 * Derive the self-describing SCHEMA of a registry — what a receiver needs to know without reading bodies.
 * @returns {{ keyCount, tier1Keys, enumKeys:[…], ringMembers, ringAliases }}
 */
function deriveLatticeSchema( reg ) {
	const keys = (reg && reg.keys) || {};
	const enumKeys = []; let tier1 = 0, ringMembers = 0, ringAliases = 0;
	for ( const k of Object.keys(keys) ) {
		const e = keys[k];
		if ( e.tier === 1 ) tier1++;
		if ( e.enum ) enumKeys.push(k);
		if ( e.synonyms ) for ( const m of Object.keys(e.synonyms) ) { ringMembers++; ringAliases += (e.synonyms[m] || []).length; }
	}
	return { keyCount: Object.keys(keys).length, tier1Keys: tier1, enumKeys: enumKeys.sort(), ringMembers, ringAliases };
}

/**
 * Pack a registry (typed isa lattice + grown rings) into a portable `.sgc` lattice bundle (plain JSON).
 * @param registry  a registry (from `deriveRegistry` / `freezeRegistry` / the merged runtime container).
 * @param opts      { name, version, description } — version defaults to the registry's own stamp.
 */
function packLattice( registry, opts ) {
	opts = opts || {};
	registry = registry || { keys: {} };
	return {
		format    : 'sgc',
		sgcVersion: 1,
		kind      : 'lattice',
		manifest  : {
			name       : opts.name || 'lattice',
			version    : opts.version || registry.version || '0.0.0',
			description: opts.description || '',
			frozen     : !!registry.frozen,
			schema     : deriveLatticeSchema(registry)
		},
		registry  : clone(registry)
	};
}

/**
 * Unpack a `.sgc` lattice bundle. Pure read — returns the registry + manifest + a version-gate verdict (does
 * NOT mutate any host). Throws on a non-lattice bundle.
 * @param bundle  a packLattice() output
 * @param opts    { hostVersion } — compared against the package version for `loadSafe`.
 * @returns {{ registry, manifest, schema, versionPackage, loadSafe }}
 */
function unpackLattice( bundle, opts ) {
	opts = opts || {};
	if ( !bundle || bundle.format !== 'sgc' ) throw new Error('not an .sgc bundle');
	if ( bundle.kind !== 'lattice' ) throw new Error('not a .sgc lattice bundle (kind=' + bundle.kind + ')');
	const registry = bundle.registry || { keys: {} };
	const manifest = bundle.manifest || {};
	return {
		registry, manifest, schema: manifest.schema || deriveLatticeSchema(registry),
		versionPackage: manifest.version, loadSafe: versionsAgree(opts.hostVersion, manifest.version)
	};
}

/**
 * Load a `.sgc` lattice bundle INTO a host registry, gated by the version (B8). On a version MATCH it GROWS
 * the host: with a host registry, each shipped ring alias is re-proposed through `mergeRingProposals` (member
 * ∈ enum ∧ confluence re-checked) so a conflicting alias is REJECTED, never blindly merged; with NO host
 * registry, the packaged registry is ADOPTED wholesale. On a MISMATCH it grows nothing (the host re-learns).
 *
 * @param bundle        a packLattice() output
 * @param hostRegistry  the host registry to grow (or null/undefined to ADOPT the packaged one)
 * @param opts          { version } — the host's canon version (B8). Omit to opt out of version pinning.
 * @returns {{ registry, adopted, merged, admitted, rejected, skipped, loadSafe, versionHost, versionPackage }}
 */
function loadLattice( bundle, hostRegistry, opts ) {
	opts = opts || {};
	const hostVersion = opts.version != null ? opts.version : (hostRegistry && hostRegistry.version);
	const { registry: pkg, versionPackage } = unpackLattice(bundle, { hostVersion });
	const safe = versionsAgree(hostVersion, versionPackage);
	const shipped = ringsOf(pkg);
	if ( !safe )   // version mismatch → refuse to inject a stale canon; the host re-derives / re-learns.
		return { registry: hostRegistry || null, adopted: false, merged: false, admitted: [], rejected: [], skipped: shipped.length, loadSafe: false, versionHost: hostVersion, versionPackage };
	if ( !hostRegistry )   // no host canon → adopt the portable one wholesale (its own rings come along).
		return { registry: clone(pkg), adopted: true, merged: false, admitted: shipped, rejected: [], skipped: 0, loadSafe: true, versionHost: hostVersion, versionPackage };
	// grow the host by the shipped rings through the SAME admission gate (confluence-checked, provenance-tagged).
	const proposals = shipped.map(( r ) => ({ key: r.key, member: r.member, alias: r.alias, via: 'loaded:' + (bundle.manifest && bundle.manifest.name || 'lattice') }));
	const r = mergeRingProposals(hostRegistry, proposals);
	return { registry: r.registry, adopted: false, merged: true, admitted: r.admitted, rejected: r.rejected, skipped: 0, loadSafe: true, versionHost: hostVersion, versionPackage };
}

module.exports = { packLattice, unpackLattice, loadLattice, deriveLatticeSchema, ringsOf };
