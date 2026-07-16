'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * mixture-serve — the plugin auto-export. A self-contained JS combo (no concepts/providers, deps:[]); it
 * exposes `createMixtureServe` + `makeSurfaceDispatch` as combo entrypoints. `definePlugin` resolves from
 * skynet-graph (peer dep when published, relative path when bundled in-repo).
 */
function host() {
	try { return require('skynet-graph'); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require('../../lib/index.js'); }
}

module.exports = host().definePlugin(__dirname);
