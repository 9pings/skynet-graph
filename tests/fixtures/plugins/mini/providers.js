'use strict';
// The Mini plugin's provider entrypoint (Tier-1 JS). Self-flags its concept marker (Thing) — the
// cast-marker gotcha — and writes a `tagged` fact so a boot test can observe the provider ran.
function tag( graph, concept, scope, argz, cb ) {
	cb(null, { $_id: '_parent', Thing: true, tagged: true });
}
module.exports = { Mini: { tag } };
