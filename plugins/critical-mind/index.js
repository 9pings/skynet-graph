'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * critical-mind — the plugin auto-export. `require('critical-mind')` returns the resolved plugin object
 * (concepts + Dialectic providers + the createCriticalMind combo) via `definePlugin(__dirname)`.
 *
 * `definePlugin` lives in skynet-graph. When this plugin is installed as its own npm package, skynet-graph
 * is a peer dependency and resolves by name; when it ships bundled INSIDE the skynet-graph repo (a
 * foundation plugin), the package name does not self-resolve, so we fall back to skynet-graph's facade by
 * relative path. Either way the exported plugin object is identical. No deps to carry (deps: []).
 */
function host() {
	try { return require('skynet-graph'); }
	catch ( e ) { return require('../../lib/index.js'); }   // bundled in-repo: skynet-graph doesn't self-resolve
}

module.exports = host().definePlugin(__dirname);
