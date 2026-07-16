/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * method-pack — the `.sgc` CRYSTALLIZED-METHOD PACKAGE (host-side, ZERO-CORE, fs-free). M3 of the
 * productization campaign / master-graph study persistence rung. The SIBLING of `corpus-pack.js`: that one
 * packages the AUTHORED grammar (a concept tree → a portable bundle with a derived manifest); THIS one
 * packages the LEARNED method library (the forged + crystallized methods the master loop accumulates) so a
 * warm library MOVES between deployments — not just survives a local restart (that is M2 / `store.js`).
 *
 * It reuses the SAME `.sgc` envelope (`format:'sgc'` + `sgcVersion` + `manifest`), discriminated by a
 * `kind` field: `'corpus'` (the existing grammar bundle) vs `'methods'` (this one). One exchange format,
 * two payload kinds; `corpus-pack.js` is untouched and a reader dispatches on `kind` (default `'corpus'`).
 *
 *   const bundle = packMethods(masterLoop, { name: 'travel', version: 'v3' });   // .sgc JSON
 *   //   ... ship the bundle to another deployment, write it to disk via store.saveSgc ...
 *   const r = loadMethods(bundle, freshLoop, { version: 'v3' });                 // re-hydrate the library
 *   //   r.added entries recalled; r.exactReplayed entries warm the 0-call cache (iff versions match)
 *
 * THE PORTABLE UNIT is the recall-index entry `{ structure, content, method }` — signature-addressed, so a
 * receiver can RECALL→VERIFY it (U5). The exact content-address cache is a DERIVED acceleration: its key is
 * recomputable from each entry's signature via the host loop's own `keyOf`, so packing the index is enough.
 *
 * THE LOAD-BEARING SOUNDNESS LINE (B8 — method-version pinning, made portable):
 *   A method is `(typed signature) → derivation`; that FUNCTION is defined by the grammar + the providers,
 *   whose identity IS the version token. Replaying a packaged method verbatim is sound in a receiving host
 *   IFF the host's version matches the package's — otherwise the same typed input may now map to a DIFFERENT
 *   derivation, so NO verbatim replay (neither the exact 0-call cache NOR a recall→verify `'full'` hit, which
 *   also replays the stored method at 0 cost) is trustworthy. So the version gate covers BOTH replay paths:
 *     - versions AGREE → hydrate the recall index AND the exact cache (full 0-call replay, sound).
 *     - versions DIFFER → hydrate NEITHER: the host re-forges (sound). The entries stay readable via
 *       `unpackMethods` for a host that wants to re-forge FROM the skeletons (a future version-aware-recall
 *       refinement could downgrade a cross-version `'full'` to a partial re-forge; not built — refuse beats
 *       a stale replay: "fuzziness in recall, exactness in truth" — a cross-version method is not TRUTH here).
 *   Versions are opt-in (like `cache.js` `version()`): the gate enforces iff BOTH sides declare a version
 *   (absent ⇒ permissive — the host explicitly opted out of pinning). Independently, the typed VERIFY
 *   (`recall.js#verify`) ALSO runs on the receiver, so even a same-version package never replays a method
 *   whose typed STRUCTURE mismatches a local query (the canonicalize.js line holds across hosts).
 *
 * A typed SCHEMA is DERIVED from the entries (mirrors `corpus-pack.js#deriveManifest`): the method-CLASS
 * discriminants (the K1 `structure` keys) and the derived `content` keys — self-describing, no hand-upkeep,
 * so a receiving host knows what typed inputs key each method class without reading the bodies.
 */

// stable, key-sorted, recursive stringify (digest-safe; the same canon the recall index + master loop use).
function canon( x ) {
	if ( x === undefined ) return 'null';
	if ( x === null || typeof x !== 'object' ) return JSON.stringify(x);
	if ( Array.isArray(x) ) return '[' + x.map(canon).join(',') + ']';
	return '{' + Object.keys(x).sort().map(( k ) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}

function clone( x ) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

/**
 * Normalize any reasonable library SOURCE into a flat array of `{ structure, content, method }` entries:
 *   - a master loop      (has `.index` recall index)  → its index entries
 *   - a recall index     (has `.entries` + `.recall`) → its entries
 *   - `{ entries:[...] }`                              → those entries
 *   - a bare array                                     → itself
 * Each raw entry may be `{ sig:{structure,content}, method }` (the index shape) or already
 * `{ structure, content, method }`. Missing structure/content default to `{}`.
 */
function toEntries( source ) {
	let raw;
	if ( Array.isArray(source) ) raw = source;
	else if ( source && source.index && Array.isArray(source.index.entries) ) raw = source.index.entries;
	else if ( source && Array.isArray(source.entries) ) raw = source.entries;
	else raw = [];
	return raw.map(( e ) => {
		const structure = (e.sig ? e.sig.structure : e.structure) || {};
		const content   = (e.sig ? e.sig.content   : e.content)   || {};
		return { structure: clone(structure), content: clone(content), method: clone(e.method) };
	});
}

/**
 * Derive the typed SCHEMA off the method entries — the self-describing contract a receiver needs.
 * @returns {{ structureKeys, contentKeys, classes:[{structure,count}] }}
 *   structureKeys  the union of K1 method-CLASS discriminant keys (what defines a method class).
 *   contentKeys    the union of derived `content` keys (the per-instance holes).
 *   classes        the distinct typed structures present, with how many entries each covers.
 */
function deriveMethodSchema( entries ) {
	const sKeys = new Set(), cKeys = new Set(), classes = new Map();
	for ( const e of entries ) {
		for ( const k of Object.keys(e.structure || {}) ) sKeys.add(k);
		for ( const k of Object.keys(e.content || {}) ) cKeys.add(k);
		const key = canon(e.structure || {});
		const c = classes.get(key) || { structure: clone(e.structure || {}), count: 0 };
		c.count++; classes.set(key, c);
	}
	return {
		structureKeys: [...sKeys].sort(),
		contentKeys  : [...cKeys].sort(),
		classes      : [...classes.values()].sort(( a, b ) => canon(a.structure) < canon(b.structure) ? -1 : 1)
	};
}

/**
 * Pack a learned method library into a portable `.sgc` methods bundle (plain JSON).
 * @param source  a master loop / recall index / { entries } / array (see `toEntries`)
 * @param opts    { name, version, description }
 */
function packMethods( source, opts ) {
	opts = opts || {};
	const entries = toEntries(source);
	return {
		format    : 'sgc',
		sgcVersion: 1,
		kind      : 'methods',
		manifest  : {
			name       : opts.name || 'methods',
			version    : opts.version || '0.0.0',
			description: opts.description || '',
			methodCount: entries.length,
			schema     : deriveMethodSchema(entries)
		},
		methods   : entries
	};
}

/**
 * Unpack a `.sgc` methods bundle. Pure read — returns the entries + manifest + derived schema and a
 * version-gate verdict (does NOT mutate any host). Throws on a non-methods bundle.
 * @param bundle  a packMethods() output
 * @param opts    { hostVersion } — if given, compared against the package version for `exactReplaySafe`.
 * @returns {{ methods, manifest, schema, versionPackage, exactReplaySafe }}
 */
function unpackMethods( bundle, opts ) {
	opts = opts || {};
	if ( !bundle || bundle.format !== 'sgc' ) throw new Error('not an .sgc bundle');
	if ( bundle.kind !== 'methods' ) throw new Error('not a .sgc methods bundle (kind=' + bundle.kind + ')');
	const methods = bundle.methods || [];
	const manifest = bundle.manifest || {};
	return {
		methods, manifest, schema: manifest.schema || deriveMethodSchema(methods),
		versionPackage : manifest.version,
		exactReplaySafe: versionsAgree(opts.hostVersion, manifest.version)
	};
}

// B8 gating: active iff BOTH sides declare a version (opt-in, like cache.js#version). Absent ⇒ permissive.
function versionsAgree( vHost, vPkg ) {
	if ( vHost == null || vPkg == null ) return true;   // no pinning requested → permissive
	return vHost === vPkg;
}

/**
 * Re-hydrate a `.sgc` methods bundle INTO a host library, gated by the version (B8). On a version MATCH it
 * feeds BOTH replay paths — the recall index AND the exact 0-call cache; on a MISMATCH it hydrates NEITHER
 * (the host re-forges; the stale bodies never write a derivation here). See the soundness line in the header.
 *
 * @param bundle  a packMethods() output
 * @param host    { index, cache, keyOf } — e.g. a master loop (it exposes exactly these). `cache`/`keyOf`
 *                optional: without them only the recall index is hydrated.
 * @param opts    { version } — the host's method-lib version (B8). Omit to opt out of version pinning.
 * @returns {{ added, exactReplayed, exactReplaySafe, skipped, versionHost, versionPackage }}
 */
function loadMethods( bundle, host, opts ) {
	opts = opts || {};
	const { methods, versionPackage } = unpackMethods(bundle, { hostVersion: opts.version });
	const safe = versionsAgree(opts.version, versionPackage);
	let added = 0, exactReplayed = 0;
	if ( !safe )   // version mismatch → refuse to inject stale methods into the live replay paths (re-forge instead).
		return { added: 0, exactReplayed: 0, exactReplaySafe: false, skipped: methods.length, versionHost: opts.version, versionPackage };
	for ( const e of methods ) {
		const sig = { structure: e.structure, content: e.content };
		if ( host && host.index && host.index.add ) { host.index.add(sig, clone(e.method)); added++; }    // recall path
		if ( host && host.cache && host.cache.set && typeof host.keyOf === 'function' ) {
			host.cache.set(host.keyOf(sig), clone(e.method)); exactReplayed++;                            // exact 0-call path
		}
	}
	return { added, exactReplayed, exactReplaySafe: true, skipped: 0, versionHost: opts.version, versionPackage };
}

module.exports = { packMethods, unpackMethods, deriveMethodSchema, loadMethods, toEntries };
