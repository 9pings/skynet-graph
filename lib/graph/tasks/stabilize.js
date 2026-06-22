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


var defaultLogger = require('../log').defaultLogger;// fallback only; we use graph._log below
/*
 * Launch concepts stabilisation on every unstable nodes
 */
module.exports = function ( graph, flow ) {
	var debug = graph._log;

	graph._stabilizing = true;// a pass is in flight — structural ops (add/patchConcept) issued from a
	                          // provider now defer to the quiescent _loopTF boundary (#11.a re-entrancy)
	debug.info("launch stabilisation: %s unstable, %s triggers", graph._unstable.length, graph._triggeredCastCount);
	//debugger;
	//
	if ( graph._triggeredCastCount ) {
		var updates = Object.keys(graph._triggeredCast);
		flow.pushSubTask(
			updates.map(
				( k ) => {
					debug.log("updates %s !! ", k);
					
					graph.toggleGraphObjectState(graph._triggeredCast[k][0], "unstable");
					return graph._conceptLib[graph._triggeredCast[k][1]].applyTo(
						graph._objById[graph._triggeredCast[k][0]]._etty,
						graph
					);
				}
			)
		)
		
		graph._triggeredCast      = {};
		graph._triggeredCastCount = 0;
		// if ( me._unstable.length )
		//     flow.then(me._loopTF);
	}
	
	flow.pushSubTask(
		graph._unstable.map(
			function ( v ) {
				return v.specialize && v.specialize() || v._etty.specialize();
			}
		));
};