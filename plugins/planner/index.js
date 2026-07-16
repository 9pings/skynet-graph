'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * planner (C7) — the plugin auto-export. `require('planner')` returns the resolved plugin object
 * (the planner/loop/support grammar sets + the createPlanLoop combo) via `definePlugin(__dirname)`.
 *
 * `definePlugin` (from skynet-graph) resolves by npm name when this ships as its own package (peer
 * installed by npm), and by relative path when it ships bundled INSIDE the skynet-graph repo (a
 * foundation plugin). The projection ENGINE lives in `lib/` here (context-project, serve-leaf,
 * givens, dag-decompose, …) — host code may require those modules directly; the combo is the
 * packaged assembly (`Graph.combos.createPlanLoop`).
 */
function requireEither( pkgName, relPath ) {                 // npm name (published) → relative sibling (bundled in-repo)
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const host = requireEither('skynet-graph', '../../lib/index.js');

module.exports = host.definePlugin(__dirname);
