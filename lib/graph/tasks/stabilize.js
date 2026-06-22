/**
 * Copyright (C) 2021  Nathanael Braun
 
 * @author Nathanael BRAUN
 *
 * Date: 18/01/2016
 * Time: 14:51
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