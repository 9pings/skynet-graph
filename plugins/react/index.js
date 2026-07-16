'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * react — the plugin auto-export. A Tier-0 plugin (pure grammar, no JS providers) that DEPENDS on
 * reason-kernel (Thought + the Ledger tally) and carries it as an object; `resolvePlugins` flattens
 * the graph. Dual-resolution, same as its siblings. The TOOLS a ReAct loop calls are the HOST's —
 * the impure side stays out of the plugin entirely.
 */
function requireEither( pkgName, relPath ) {
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const host = requireEither('skynet-graph', '../../lib/index.js');
const reasonKernel = requireEither('reason-kernel', '../reason-kernel');

module.exports = host.definePlugin(__dirname, [reasonKernel]);
