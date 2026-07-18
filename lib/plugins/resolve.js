'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * Plugin resolver — the thin new layer of the plugin architecture (design:
 * `WIP/2026-07-16-design-plugin-architecture.md` §3). It orders plugins so a dependency is always
 * initialised before its dependent (a DAG on the explicit `deps` — a JS-init cycle is refused; GRAMMAR
 * cross-references stay legal because the merged concept-map is order-free), then merges the resolved
 * plugins into a bootable graph config.
 *
 * A plugin object: { name, version, concepts:{setName:tree}, providers:{ns:fragment},
 *   providerNamespaces:[ns], deps:[{name,range}], pluginDeps:[pluginObj], combos:{name:factory} }.
 *   Concept trees are pre-built (buildConceptTree) so the resolver is fs-free and unit-testable with
 *   in-memory plugins. `deps` = the {name,range} DECLARATIONS (semver/topo/lint); `pluginDeps` = the
 *   already-required dependency OBJECTS a plugin carries (the npm distribution model, owner 07-16 quater:
 *   node+require do the fetch, the resolver only FLATTENS the object graph — it never fetches).
 *
 * resolvePlugins(plugins) -> { order:[name], conceptMap:{set:tree}, conceptSets:[set], providers:{ns:frag},
 *   combos:{name:factory} }. `plugins` may be a flat sibling list (the dev `plugins/` path, no pluginDeps)
 *   OR a handful of top-level plugins each carrying their deps as objects (the npm path) — both flatten to
 *   the same resolved set. The result feeds `new Graph(record, { conceptSets, ... }, conceptMap)` after
 *   `register`/`Graph._providers = providers` — i.e. exactly the wiring a host does by hand today.
 */

// Flatten the object graph: walk each plugin and, transitively, every plugin it CARRIES in `pluginDeps`,
// into a set unique by name. The same object reached twice (npm hoisting → one shared copy) is a no-op;
// two DIFFERENT versions under one name is a hard error (no silent clobber — the alphabet would fork).
// A flat sibling list (no pluginDeps) passes through unchanged, so the dev path is bit-identical.
function flattenPlugins( plugins ) {
	var byName = {}, out = [];
	function add( p ) {
		var seen = byName[p.name];
		if ( seen ) {
			if ( seen !== p && String(seen.version) !== String(p.version) )
				throw new Error('conflicting versions of plugin "' + p.name + '": ' + seen.version + ' vs ' + p.version);
			return;                                            // same object, or same name+version — dedup (keep first)
		}
		byName[p.name] = p; out.push(p);
		var carried = p.pluginDeps || [];
		for ( var i = 0; i < carried.length; i++ ) add(carried[i]);
	}
	for ( var i = 0; i < plugins.length; i++ ) add(plugins[i]);
	return out;
}

// Topological order of the plugins over their explicit `deps` (dependencies first). Throws on a missing
// dependency or an init cycle. Grammar mutual-references are NOT deps, so a shared kernel read both ways
// is fine — only the JS init order must be acyclic.
function topoOrder( plugins, byName ) {
	var order = [], visiting = {}, done = {};
	function visit( name, stack ) {
		if ( done[name] ) return;
		if ( visiting[name] ) throw new Error('plugin init cycle: ' + stack.concat(name).join(' -> '));
		var p = byName[name];
		if ( !p ) throw new Error('unresolved dependency: ' + name + ' (required by ' + stack[stack.length - 1] + ')');
		visiting[name] = true;
		for ( var i = 0; i < (p.deps || []).length; i++ ) visit(p.deps[i].name, stack.concat(name));
		delete visiting[name];
		done[name] = true;
		order.push(name);
	}
	for ( var i = 0; i < plugins.length; i++ ) visit(plugins[i].name, []);
	return order;
}

// Minimal semver satisfaction (no dep): exact, `*`, `^`, `~`, `>=`. Enough for plugin deps like `^1.0.0`.
function parseVer( v ) { return String(v).replace(/^[^0-9]*/, '').split('.').map(function ( x ) { return parseInt(x, 10) || 0; }); }
function cmpVer( a, b ) { for ( var i = 0; i < 3; i++ ) { var d = (a[i] || 0) - (b[i] || 0); if ( d ) return d > 0 ? 1 : -1; } return 0; }
function satisfies( version, range ) {
	range = String(range == null ? '*' : range).trim();
	if ( range === '*' || range === '' ) return true;
	var v = parseVer(version), r;
	if ( range[0] === '^' ) {                              // compatible-with: same left-most non-zero, and >=
		r = parseVer(range.slice(1));
		if ( r[0] > 0 ) return v[0] === r[0] && cmpVer(v, r) >= 0;
		if ( r[1] > 0 ) return v[0] === 0 && v[1] === r[1] && cmpVer(v, r) >= 0;
		return v[0] === 0 && v[1] === 0 && v[2] === r[2];
	}
	if ( range[0] === '~' ) { r = parseVer(range.slice(1)); return v[0] === r[0] && v[1] === r[1] && cmpVer(v, r) >= 0; }
	if ( range.slice(0, 2) === '>=' ) return cmpVer(v, parseVer(range.slice(2))) >= 0;
	return cmpVer(v, parseVer(range)) === 0;              // exact
}

function resolvePlugins( plugins ) {
	plugins = flattenPlugins(plugins);                        // collect carried dep-objects; unique by name after this
	var byName = {};
	for ( var i = 0; i < plugins.length; i++ ) {
		var p = plugins[i];
		if ( byName[p.name] ) throw new Error('duplicate plugin: ' + p.name);   // defensive: flatten already dedups
		byName[p.name] = p;
	}

	// namespace claims: a provider namespace (`Ns::fn`) may be claimed by exactly ONE plugin (a future
	// `extendsNamespace` will relax this) — two independent claimers silently clobber via Object.assign.
	var claimed = {};
	for ( var c = 0; c < plugins.length; c++ ) {
		var nss = plugins[c].providerNamespaces || [];
		for ( var m = 0; m < nss.length; m++ ) {
			if ( claimed[nss[m]] && claimed[nss[m]] !== plugins[c].name )
				throw new Error('provider namespace "' + nss[m] + '" claimed by both ' + claimed[nss[m]] + ' and ' + plugins[c].name);
			claimed[nss[m]] = plugins[c].name;
		}
	}

	// semver: each declared dependency must be present at a satisfying version (absence is caught by topoOrder).
	for ( var d = 0; d < plugins.length; d++ ) {
		var deps = plugins[d].deps || [];
		for ( var e = 0; e < deps.length; e++ ) {
			var dep = byName[deps[e].name];
			if ( dep && !satisfies(dep.version, deps[e].range) )
				throw new Error('dependency ' + deps[e].name + '@' + dep.version + ' does not satisfy ' + plugins[d].name + '\'s range ' + deps[e].range);
		}
	}

	var order = topoOrder(plugins, byName);

	var conceptMap = {}, conceptSets = [], providers = {}, factories = {}, descriptors = {};
	for ( var k = 0; k < order.length; k++ ) {
		var pl = byName[order[k]];
		var sets = Object.keys(pl.concepts || {});
		for ( var s = 0; s < sets.length; s++ ) { conceptMap[sets[s]] = pl.concepts[sets[s]]; conceptSets.push(sets[s]); }
		var nss = Object.keys(pl.providers || {});
		for ( var n = 0; n < nss.length; n++ ) providers[nss[n]] = Object.assign(providers[nss[n]] || {}, pl.providers[nss[n]]);
		var fcs = Object.keys(pl.factories || pl.combos || {});
		for ( var c = 0; c < fcs.length; c++ ) factories[fcs[c]] = (pl.factories || pl.combos)[fcs[c]];
		// instance-type descriptors (`entrypoints.descriptor`): keyed by descriptor.type, one claimer
		// per type — two plugins shipping the same type would silently shadow, like provider namespaces.
		if ( pl.descriptor && pl.descriptor.type ) {
			if ( descriptors[pl.descriptor.type] )
				throw new Error('instance type "' + pl.descriptor.type + '" declared by two plugins (descriptor collision at ' + pl.name + ')');
			descriptors[pl.descriptor.type] = pl.descriptor;
		}
	}

	// `combos` = the @deprecated alias of `factories` (the retired name) — remove at 2.0.
	return { order: order, conceptMap: conceptMap, conceptSets: conceptSets, providers: providers, factories: factories, combos: factories, descriptors: descriptors };
}

module.exports = { resolvePlugins, flattenPlugins };
