'use strict';
/**
 * Geo provider — great-circle distance between two node Positions.
 *
 * Concept wiring (see concepts/common/Edge/Distance.json):
 *   { "require": ["originNode:Position", "targetNode:Position"],
 *     "provider": ["CommonGeo::Distance"] }
 *
 * The provider signature is the engine's: (graph, concept, scope, argz, cb),
 * cb(err, mutationTemplate). It emits `{ $_id:'_parent', Distance:{ inKm } }`.
 */

/**
 * Haversine great-circle distance in kilometres.
 * @param a {lat,lng} in degrees
 * @param b {lat,lng} in degrees
 * @returns {number} km
 */
function haversineKm( a, b ) {
	var R = 6371, toR = function ( x ) { return (x * Math.PI) / 180; };
	var dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
	var s = Math.sin(dLat / 2) ** 2 +
		Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(s));
}

var CommonGeo = {
	Distance: function ( graph, concept, scope, argz, cb ) {
		var p1 = graph.getRef('originNode:Position', scope),
		    p2 = graph.getRef('targetNode:Position', scope);
		if ( !p1 || !p2 ) return cb(null, null);// wait until both positions exist
		cb(null, { $_id: '_parent', Distance: { inKm: Math.round(haversineKm(p1, p2)) } });
	}
};

module.exports = { CommonGeo: CommonGeo, haversineKm: haversineKm };
