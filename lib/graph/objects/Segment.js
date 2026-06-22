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


var Entity = require('./Entity');
var debug  = require('../log').defaultLogger;// fallback; methods log via this._graph._log

function Segment( _, graph, parentMutation ) {
	this.init(_, graph, parentMutation);
};
Segment.prototype = {
	init           : function ( _, graph, parentMutation ) {
		this._id                        = _._id;
		this._graph                     = graph;
		this._etty                      = new Entity(
			{
				_id    : _._id,
				Segment: true
			},
			graph
		);
		graph._mapsByConcept["Segment"] = graph._mapsByConcept["Segment"] || [];
		graph._mapsByConcept["Segment"].push(_._id);
		this._etty.follow("targetNode", this._onTargetChange, this);
		this._etty.follow("originNode", this._onOriginChange, this);
		this._etty.follow("_autokill", this._killMe, this);
		this._ppp = _;
		this._etty.update(_, graph);
		
		// this._etty.updateApplicableConcepts();
		// this._onTargetChange()
	},
	_killMe        : function ( n, o ) {
		this._etty.unRefAll();
		this._graph._log.verbose("segment %s auto-killed (unref)", this._id);
		this._etty.set("targetNode", null);
		this._etty.set("originNode", null);
		// this._graph.removeObj(this._id);
	},
	/**
	 * update targeted nodes; updating the graph
	 * @param o
	 * @param n
	 * @private
	 */
	_onTargetChange: function ( n, o ) {
		var node = o && this._graph.getObjById(o), i;
		if ( node ) {
			i = node._incoming.indexOf(this._id);
			if ( i != -1 )
				node._incoming.splice(i, 1);
		}
		node = n && this._graph.getObjById(n);
		node && node._incoming.push(this._id);
		if ( !node && n ) {
			this._graph._log.error("can't relink target from %s to %s (target node missing)", o, n);
		}
	},
	/**
	 * update origin nodes; updating the graph
	 * @param o
	 * @param n
	 * @private
	 */
	_onOriginChange: function ( n, o ) {
		var node = o && this._graph.getObjById(o), i;
		if ( node ) {
			i = node._outgoing.indexOf(this._id);
			if ( i != -1 )
				node._outgoing.splice(i, 1);
		}
		node = n && this._graph.getObjById(n);
		node && node._outgoing.push(this._id);
		if ( !node && n ) {
			this._graph._log.error("can't relink origin from %s to %s (origin node missing)", o, n);
		}
	},
	relink         : function () {
		this._etty.unRefAll();
	},
	specialize     : function () {
		return this._etty.specialize();
	}
};
module.exports    = Segment;