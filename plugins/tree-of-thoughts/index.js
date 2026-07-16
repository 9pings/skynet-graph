'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * tree-of-thoughts — the plugin auto-export: the tot grammar (state + native cascade prune) + the
 * beam-driver factory, DEPENDING on reason-kernel (Thought + the Score band brick), carried as an
 * object; `resolvePlugins` flattens the graph. Dual-resolution, same as its siblings.
 */
function requireEither( pkgName, relPath ) {
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const host = requireEither('skynet-graph', '../../lib/index.js');
const reasonKernel = requireEither('reason-kernel', '../reason-kernel');

module.exports = host.definePlugin(__dirname, [reasonKernel]);
