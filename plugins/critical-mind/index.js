'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * critical-mind — the plugin auto-export. `require('critical-mind')` returns the resolved plugin object
 * (the dialectic concepts + the createCriticalMind combo) via `definePlugin(__dirname, [reason-kernel])`.
 *
 * Both `definePlugin` (from skynet-graph) and the `reason-kernel` dependency resolve by npm name when this
 * ships as its own package (peer/dependency installed by npm), and by relative path when it ships bundled
 * INSIDE the skynet-graph repo (a foundation plugin, where sibling packages are not in node_modules).
 * `resolvePlugins` flattens the carried reason-kernel object — the graph never fetches (owner 07-16 quater).
 */
function requireEither( pkgName, relPath ) {                 // npm name (published) → relative sibling (bundled in-repo)
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const host = requireEither('skynet-graph', '../../lib/index.js');
const reasonKernel = requireEither('reason-kernel', '../reason-kernel');

module.exports = host.definePlugin(__dirname, [reasonKernel]);
