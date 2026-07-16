'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * durable — the plugin auto-export. `require('durable')` returns the resolved plugin object (the C2
 * durable executor + the createDurableRunner combo) via `definePlugin(__dirname)`.
 *
 * `definePlugin` (from skynet-graph) resolves by npm name when this ships as its own package (peer
 * installed by npm), and by relative path when it ships bundled INSIDE the skynet-graph repo. The
 * executor lives in `lib/` here (checkpoint-store, xlate, interpreter, fold, audit) — the host facade
 * exposes it as `Graph.durable` / `Graph.createCheckpointStore`; the combo is the packaged runner
 * (`Graph.combos.createDurableRunner`, `sg flow run`).
 */
function requireEither( pkgName, relPath ) {                 // npm name (published) → relative sibling (bundled in-repo)
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const host = requireEither('skynet-graph', '../../lib/index.js');

module.exports = host.definePlugin(__dirname);
