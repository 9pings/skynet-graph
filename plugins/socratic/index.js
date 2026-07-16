'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * socratic — the plugin auto-export. A Tier-0 plugin (pure grammar, no JS providers) that DEPENDS on
 * reason-kernel (Thought + the Ledger tally) and carries it as an object; `resolvePlugins` flattens
 * the graph. Dual-resolution (npm name published / relative sibling bundled), same as its siblings.
 */
function requireEither( pkgName, relPath ) {
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const host = requireEither('skynet-graph', '../../lib/index.js');
const reasonKernel = requireEither('reason-kernel', '../reason-kernel');

module.exports = host.definePlugin(__dirname, [reasonKernel]);
