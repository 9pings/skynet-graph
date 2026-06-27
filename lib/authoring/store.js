/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * store — DISK-BACKED PERSISTENCE for the method library (host-side, opt-in; uses fs, like `lib/load.js` —
 * the engine core stays fs-free). M2 of the productization campaign: the derivation cache `store` and the
 * master-loop `cache` are both pluggable Map-likes, so a file-backed store makes the warm library SURVIVE a
 * restart — a cold process re-loads it and replays recurrent methods at 0 model calls (cross-session
 * amortization, the master-graph study's persistence rung U5).
 *
 *   const store = createFileStore('./.sg-cache.json');
 *   const cache = createProviderCache({ store });          // the derivation cache persists
 *   const loop  = createMasterLoop({ ..., cache: store }); // or the master-loop cache persists
 *
 * It is a write-through Map: load on construct, persist the whole map on each mutation (simple + correct at
 * reasoning-grade volume; swap in an append-log/LRU for high throughput). Values must be JSON-serializable
 * (the cached templates/results already are — they round-trip through `serialize`/the rev-log).
 */
const fs = require('fs');

function createFileStore( file, opts ) {
	opts = opts || {};
	const max = opts.max || 0;                 // 0 = unbounded; else oldest-eviction like createProviderCache
	let map = new Map();
	// LOAD: re-hydrate the library from disk (a "restart"). A missing/corrupt file → empty (fail-open).
	try {
		if ( fs.existsSync(file) ) {
			const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
			if ( Array.isArray(arr) ) map = new Map(arr);
		}
	} catch ( e ) { map = new Map(); }

	let timer = null;
	function persist() {
		// debounce-free, synchronous write-through (deterministic for tests); coalesce via opts.async if wanted.
		const data = JSON.stringify([...map.entries()]);
		if ( opts.async ) { clearTimeout(timer); timer = setTimeout(() => { try { fs.writeFileSync(file, data); } catch ( e ) {} }, opts.async); }
		else try { fs.writeFileSync(file, data); } catch ( e ) {}
	}
	function evict() { if ( max && map.size > max ) map.delete(map.keys().next().value); }

	return {
		has( k ) { return map.has(k); },
		get( k ) { return map.get(k); },
		set( k, v ) { map.set(k, v); evict(); persist(); return this; },
		delete( k ) { const r = map.delete(k); persist(); return r; },
		clear() { map.clear(); persist(); },
		keys() { return map.keys(); },
		get size() { return map.size; },
		flush() { const data = JSON.stringify([...map.entries()]); try { fs.writeFileSync(file, data); } catch ( e ) {} },
		file
	};
}

/**
 * Persist / re-hydrate a recall INDEX (so fuzzy recall + partial reuse also survive a restart). The index
 * stores { sig, method } entries (the vectors are recomputed on load — they are a pure function of sig).
 */
function saveIndex( index, file ) {
	const entries = (index.entries || []).map(( e ) => ({ sig: e.sig, method: e.method }));
	try { fs.writeFileSync(file, JSON.stringify(entries)); } catch ( e ) {}
	return entries.length;
}
function loadIndex( index, file ) {
	try {
		if ( !fs.existsSync(file) ) return 0;
		const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
		for ( const e of (Array.isArray(arr) ? arr : []) ) index.add(e.sig, e.method);
		return arr.length;
	} catch ( e ) { return 0; }
}

/**
 * Generic `.sgc` bundle file IO (works for BOTH a corpus-pack and a method-pack bundle — anything with
 * `format:'sgc'`). The pack modules stay fs-free (they return/consume plain bundle objects); the disk
 * round-trip lives here, the fs layer. `saveSgc` writes pretty JSON (a `.sgc` is meant to be inspected/
 * diffed); `loadSgc` returns the parsed bundle or null on a missing/corrupt file (fail-open).
 */
function saveSgc( bundle, file ) {
	try { fs.writeFileSync(file, JSON.stringify(bundle, null, 2)); return true; } catch ( e ) { return false; }
}
function loadSgc( file ) {
	try {
		if ( !fs.existsSync(file) ) return null;
		const b = JSON.parse(fs.readFileSync(file, 'utf8'));
		return (b && b.format === 'sgc') ? b : null;
	} catch ( e ) { return null; }
}

module.exports = { createFileStore, saveIndex, loadIndex, saveSgc, loadSgc };
