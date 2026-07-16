'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * forge — the plugin auto-export. `require('forge')` returns the resolved plugin object (the Plan
 * grammar + the forge engine + the forgeStock combo) via `definePlugin(__dirname, [learning])`.
 *
 * Both `definePlugin` (from skynet-graph) and the `learning` dependency resolve by npm name when this
 * ships as its own package (peer/dependency installed by npm), and by relative path when it ships
 * bundled INSIDE the skynet-graph repo. `resolvePlugins` flattens the carried learning object — the
 * graph never fetches (owner 07-16 quater).
 */
function requireEither( pkgName, relPath ) {                 // npm name (published) → relative sibling (bundled in-repo)
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const host = requireEither('skynet-graph', '../../lib/index.js');
const learning = requireEither('learning', '../learning');

module.exports = host.definePlugin(__dirname, [learning]);
