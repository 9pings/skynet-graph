'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * reason-kernel — the plugin auto-export. `require('reason-kernel')` returns the resolved plugin object
 * (the Ledger providers) via `definePlugin(__dirname)`. No deps to carry (deps: []).
 *
 * `definePlugin` lives in skynet-graph: a peer dependency when this ships as its own npm package, resolved
 * by relative path when it ships bundled INSIDE the skynet-graph repo (a foundation plugin). See
 * plugins/critical-mind/index.js for the same dual-resolution pattern applied to a plugin WITH a dep.
 */
function host() {
	try { return require('skynet-graph'); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require('../../lib/index.js'); }
}

module.exports = host().definePlugin(__dirname);
