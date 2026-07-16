'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * self-consistency — the plugin auto-export. A Tier-0 plugin (pure grammar, no JS providers) that DEPENDS on
 * reason-kernel and carries it as an object; `resolvePlugins` flattens the graph. Both `definePlugin` (from
 * skynet-graph) and the `reason-kernel` dependency resolve by npm name when published and by relative path
 * when bundled in-repo. See plugins/critical-mind/index.js for the same dual-resolution pattern.
 */
function requireEither( pkgName, relPath ) {
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const host = requireEither('skynet-graph', '../../lib/index.js');
const reasonKernel = requireEither('reason-kernel', '../reason-kernel');

module.exports = host.definePlugin(__dirname, [reasonKernel]);
