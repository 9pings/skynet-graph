'use strict';
// The MiniDep plugin's provider entrypoint (Tier-1 JS). Self-flags Thing2 (the cast-marker gotcha) and
// writes a `tagged2` fact so a boot test can observe the provider ran.
function tag2( graph, concept, scope, argz, cb ) {
	cb(null, { $_id: '_parent', Thing2: true, tagged2: true });
}
module.exports = { MiniDep: { tag2 } };
