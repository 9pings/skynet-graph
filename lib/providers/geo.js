/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <@pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
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
