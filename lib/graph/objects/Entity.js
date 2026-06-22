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

var debug = require('../log').defaultLogger;// module fallback; methods rebind to this._graph._log

var isArray    = require('is').array;
var isFunction = require('is').fn;
var { compileExpression } = require('../expr');


let evalReplaceRE = /\$(\$?[a-zA-Z\_][\w\.\:\$]+)/ig;// 30mn;


function static_ensure( scope, c, cName ) {
	return function () {
		var __R;
		__R = scope._graph._conceptLib[c].isApplicableTo(scope);
		if ( __R ) !scope._mappedConcepts[cName] && scope._graph.castConcept(scope._._id, c);
		else scope._mappedConcepts[cName] && scope.unCast(cName, null);
	}
}

function Entity( _, graph ) {
	this.init(_, graph);
}

Entity.prototype = {
	/**
	 *
	 * @param _
	 * @param graph
	 */
	init: function ( _, graph ) {
		this._                = _;
		this._graph           = graph;
		// `|| {}`: a root concept set with no childConcepts has no _openConcepts —
		// a graph with zero capabilities is degenerate but valid (mounts, stabilizes).
		this._mapOpenConcepts = Object.keys(graph._rootConcept._openConcepts || {});
		this._mappedConcepts  = {};
		this._extOpenConcepts = [];
		
		this._followersByConceptName = {};
		this._watcherByConceptName   = {};
		this._watchers               = {};

	},

	/**
	 * A child logger bound to THIS object's context {target,type}, memoized on the
	 * Entity instance — stored on `this._ctxLog`, NEVER on `this._`, so it is not
	 * serialized (logs stay out of the graph). A provider reaches it as `scope.log`:
	 *   scope.log.warn('positions missing on %s', scope._._id)
	 * For apply-correlated context (concept + applyId) use `concept.log(scope)` instead.
	 */
	get log () {
		if ( !this._ctxLog ) {
			var t = this._ && (this._.Node ? 'node' : this._.Segment ? 'segment' : 'object');
			this._ctxLog = this._graph._log.child({ target: this._ && this._._id, type: t });
		}
		return this._ctxLog;
	},

	// ------------------------------------------------- concepts cast
	
	/**
	 * Walk this object's OPEN concepts (those reachable given what is already cast)
	 * and return the ones that are newly applicable — the discovery step that drives
	 * casting. Called at mount and whenever the object is destabilized.
	 *
	 * It is a tree walk over a stack (`ocStack`, seeded from `_mapOpenConcepts`):
	 *   - For an open concept with `follow`/`ensure`, install watchers ONCE so the
	 *     object is re-tested (or auto de/re-cast) when a watched ref changes.
	 *   - If the concept's fact is already present (`me._[cname]`), it is CAST: mark it
	 *     in `_mappedConcepts` and push its children onto the stack (descend), so child
	 *     capabilities only open under a cast parent (enum pushes the chosen branches).
	 *   - Else it stays OPEN (kept in `cStack`); `autoCast:false` ones are parked in
	 *     `_extOpenConcepts` (dormant — only retested when a follow-watcher fires).
	 * `_mapOpenConcepts` is then replaced by the still-open set, and the applicable
	 * (open + isApplicableTo) concepts are returned for specialize() to cast.
	 *
	 * @returns {Concept[]} concepts to cast now
	 */
	updateApplicableConcepts: function () {
		if ( this._dead ) return [];
		
		var me      = this,
		    execTm  = Date.now(),
		    push    = Array.prototype.push,
		    cStack  = [],
		    ocStack = this._mapOpenConcepts,
		    c, i, cname,
		    cSchema,
		    follow,
		    followMap, ensure,
		    graph   = this._graph;
		
		// if (!me._._id)
		
		
		
		while ( ocStack.length ) {
			c       = ocStack.pop();
			cname   = graph._conceptLib[c]._name;
			cSchema = graph._conceptLib[c]._schema;
			
			// if an "open" concept have follow || ensure it must watch some refs
			if ( !me._watchers[cname] && (cSchema.follow || cSchema.ensure) ) {
				followMap = {};
				follow    = [];
				follow.map(( v ) => followMap[v] = true);
				ensure = null;
				
				me._watchers[cname] = [];
				if ( cSchema.ensure ) {// ensure: auto-cast when the condition holds, auto-uncast when it falls
					ensure = static_ensure(me, c, cname);
					
					cSchema.ensure.forEach(
						( exp ) => {
							var e = exp.match(/\$(\$?[a-zA-Z\_][\w\.\:\$]+)/ig);
							// e && e.shift();
							e && e.length
							&& e.forEach(( v ) => {
								followMap[v.substr(1)] = ensure
							})
						}
					);
					follow = Object.keys(followMap);
					
					follow.forEach(function ( ref ) {
						var wfn = () => {
							ensure(...arguments)
						};
						me._watchers[cname].push(ref, wfn);
						return !graph.getRef(ref, me, wfn) && true || null;
					});
				}
				cSchema.follow && cSchema.follow.reduce(function ( v, ref ) {// follow: re-test applicability when ref changes
					var wfn = function () {
							graph._conceptLib[c].isApplicableTo(me, graph) && graph.castConcept(me._._id, c);
						};
					me._watchers[cname].push(ref, wfn);
					return graph.getRef(ref, me, wfn) && v;
				}, true);
			}
			if ( me._[cname] || me._[cname] === false ) {
				this._mappedConcepts[cname] = graph._conceptLib[c];
				
				i = this._extOpenConcepts.indexOf(c);
				if ( i !== -1 ) {
					this._extOpenConcepts.splice(i, 1);
				}
				if ( graph._conceptLib[c]._schema.autoReCast ) {
					graph.castConcept(this._._id, c);
				}
				if ( (!graph._conceptLib[c].isApplicableTo(me, graph) &&
					graph._conceptLib[c]._schema.autoCast !== false) || graph._conceptLib[c].isLeaf ) continue;
				if ( cSchema.type == "enum" ) {
					push.apply(
						ocStack,
						isArray(me._[cname]) ?
						me._[cname]
						                     :
						me._[cname] && Object.keys(graph._conceptLib[c]._openConcepts) || []
					);
				}
				else {
					// if not leaf check childs
					
					push.apply(ocStack, Object.keys(graph._conceptLib[c]._openConcepts));
				}
			}
			else {
				if ( cSchema.autoCast === false ) {
					i = this._extOpenConcepts.indexOf(c);
					(i == -1) && this._extOpenConcepts.push(c);
				}
				cStack.push(c);
			}
		}
		this._mapOpenConcepts = cStack;
		
		
		let ret = cStack.filter(function ( c ) {// test if c is applicable
			return !!graph._conceptLib[c].isApplicableTo(me, graph);
		}).map(function ( c ) {
			return graph._conceptLib[c];
		});
		
		
		// stats
		graph._statsByProvider["updateApplicableConcepts"] = graph._statsByProvider["updateApplicableConcepts"] || 0;
		graph._statsByProvider["updateApplicableConcepts"] += (Date.now() - execTm);
		
		return ret;
	},
	/**
	 * Retract a cast concept (JTMS-style defeasance): delete its fact, tear down its
	 * watchers, drop it from the by-concept index, and CASCADE — uncast every child
	 * concept too (they were only reachable under this parent). Unless `unReachable`,
	 * the parent is re-armed as OPEN (`_mapOpenConcepts`) so it can re-cast later. If
	 * the concept declares a `cleaner` provider, it runs (optional teardown mutation).
	 *
	 * @param {string} cid          concept name/id to retract
	 * @param {string} [unReachable] if set, do NOT re-open (the concept is gone for good)
	 */
	unCast                  : function ( cid, unReachable ) {
		var me = this, graph = me._graph, debug = graph._log;
		
		// if ( cid == 'SelectingTarget' )
		
		while ( this._watchers[cid] && this._watchers[cid].length )
			this._graph.getRef(this._watchers[cid].shift(), this, this._watchers[cid].shift(), true);
		
		if ( this._mappedConcepts[cid] ) {
			
			delete this._[cid];
			var c = this._mappedConcepts[cid],
			    i = this._graph._mapsByConcept[c._name] && this._graph._mapsByConcept[c._name].indexOf(this._._id);
			this._graph._mapsByConcept[c._name] && (i != -1) && this._graph._mapsByConcept[c._name].splice(i, 1);
			if ( !c ) return debug.warn('cant uncast', cid);
			
			//i = .indexOf()
			this._mapOpenConcepts = this._mapOpenConcepts.filter(( v ) => (v.substr(0, c._id.length) != c._id));
			this._extOpenConcepts = this._extOpenConcepts.filter(( v ) => (v.substr(0, c._id.length) != c._id));
			
			if ( !unReachable ) {
				this._mapOpenConcepts.push(c._id);
			}
			
			c._openConcepts
			&& Object.keys(c._openConcepts)
			         .forEach(( v ) => (this.unCast(c._openConcepts[v]._name, c._openConcepts[v]._id)), this);
			
			// uncaster
			if ( c._schema.cleaner ) {
				var p         = isArray(c._schema.cleaner) ? c._schema.cleaner[0] : c._schema.cleaner,
				    argz      = isArray(c._schema.cleaner) && c._schema.cleaner.slice(1),
				    providers = graph.static._providers;
				p             = p.split("::");
				if ( providers[p[0]] && providers[p[0]][p[1]] ) {
					graph._taskFlow.wait();
					providers[p[0]][p[1]](
						graph, c, me, argz,
						function ( e, r ) {
							r && graph.pushMutation(r, me._._id);
							e && debug.log("Hum cleaner ", p, " has failed : \n", e, e.stack);
							graph._taskFlow.release();
						});
				}
			}
		}
		else {
			unReachable && (this._mapOpenConcepts = this._mapOpenConcepts.filter(
				( v ) => (v.substr(0, unReachable.length) != unReachable)));
		}
		this._watchers[cid] = this._mappedConcepts[cid] = undefined;
	},
	/**
	 * return an async specialisation task that will apply open-concepts
	 * (this will be called as long as the box is unstable)
	 */
	specialize              : function () {
		var me = this;
		return function doSpecialize( graph, flow ) {
			if ( me._dead ) return graph.removeObj(me._._id, true);
			
			var concepts = me.updateApplicableConcepts(graph),
			    todo     = [];
			
			if ( !concepts.length ) {// if there is no applicable concept; this scope is stable
				return graph.toggleGraphObjectState(me._._id, "stable");
			}
			// if mutations come the node will go in pending state
			//
			concepts.forEach(
				function ( c ) {
					todo.push(c.applyTo(me, graph))
				}
			);
			return todo;
		};
	},
	/**
	 * Merge '_' keys-values in the cbox, call watchers if needed
	 * @param _
	 * @param graph
	 */
	update                  : function ( _, graph ) {
		var me = this;
		
		Object.keys(_).forEach(
			function ( c ) {
				me.set(c, _[c], graph);
			}
		)
	},
	/**
	 * Set one fact and fire its listeners. Two listener kinds react here:
	 *   - watchers  (_watcherByConceptName): on-change callbacks (e.g. Segment relink,
	 *     ensure tests) called with (newValue, oldValue).
	 *   - followers (_followersByConceptName): dependents to DESTABILIZE so they get
	 *     re-tested (this is how a `require`/ref consumer wakes when its input appears).
	 * Setting a cast concept to null cascades an unCast. `{__push:x}` appends (see below).
	 *
	 * @param {string} key      fact / concept name
	 * @param {*}       content  value (or {__push:x} to append)
	 * @param {Graph}   graph
	 */
	set                     : function ( key, content, graph ) {
		var old = this._[key], tmp;
		if ( this._dead ) return;

		// array-append primitive: `{__push:x}` appends x to the existing array instead
		// of replacing. Append happens here, at apply-time — and mutations are serialized
		// (one mutation thread) — so concurrent fan-in (many writers -> one array) is
		// race-free, unlike a provider-side read-modify-write.
		if ( content && typeof content === 'object' && content.__push !== undefined ) {
			content = (isArray(this._[key]) ? this._[key].slice() : []).concat([content.__push]);
		}

		this._[key]                     = content;
		this._graph._mapsByConcept[key] = this._graph._mapsByConcept[key] || [];
		(old === undefined) && this._graph._mapsByConcept[key].push(this._._id);
		
		if ( content === null && old !== null && this._mappedConcepts[key] ) {// unref concept
			this.unCast(key);
		}
		
		if ( this._watcherByConceptName[key] ) {
			var i = 0;
			tmp   = this._watcherByConceptName[key].slice();// snapshot: a watcher may re-enter set()
			while ( i < tmp.length ) {
				tmp[i].call(
					tmp[i + 1],
					content,
					old
				);
				if ( this._dead ) return;
				i += 2;
			}
		}
		if ( this._followersByConceptName[key] ) {
			var i = -1;
			while ( ++i < this._followersByConceptName[key].length ) {
				//     "destabilize ", this._followersByConceptName[key][i],
				//     "due to set ", this._._id, key
				// );
				this._graph.toggleGraphObjectState(this._followersByConceptName[key][i], "unstable");
			}
		}
	},
	/**
	 * get an element by concept name
	 * if followerId is set, followerId will be destabilized
	 *
	 * @param key
	 * @param followerId
	 */
	get                     : function ( key, followerId, doUnref ) {
		if ( typeof followerId == "function" ) {
			doUnref ?
			this.unFollow(key, followerId)
			        :
			this.follow(key, followerId);
		}
		else if ( followerId ) {
			if ( followerId === this._._id ) return this._[key];
			
			this._followersByConceptName[key] = this._followersByConceptName[key] || [];
			var i                             = this._followersByConceptName[key].indexOf(followerId);
			if ( i == -1 && !doUnref )
				this._followersByConceptName[key].push(followerId);
			if ( i !== -1 && doUnref )
				this._followersByConceptName[key].splice(i, 1);
			
		}
		return this._[key];
		
	},
	// -------------------------------------------------- refs & events
	doEval                  : function ( asserts = "", refMap ) {
		var me  = this,
		    _fn = compileExpression(asserts, { empty: true });
		try {
			// `refMap` resolves bare identifiers (the old `with(refMap)`).
			return _fn(function ( ref ) { return me.getRef(ref); }, refMap || {});
		} catch ( e ) {
			me._graph._log.error("expression eval failed: %s", asserts, e);
			return undefined;
		}
	},
	
	/**
	 * evaluate 'exp' from this cbox, and add 'follow' as watcher if the targeted value is updated
	 *
	 * @param exp
	 * @param follow
	 * @param unref bool do unwatch 'follow' instead of watch
	 * @returns {*}
	 */
	getRef  : function ( exp, follow, unref ) {
		return this._graph.getRef(exp, this, follow, unref);
	},
	/**
	 * call 'fn' on any change to 'key'
	 * @param key
	 * @param fn
	 * @param scope
	 */
	follow  : function ( key, fn, scope ) {
		this._watcherByConceptName[key] = this._watcherByConceptName[key] || [];
		this._watcherByConceptName[key].push(fn, scope);
	},
	/**
	 * Stop calling 'fn' on 'key' change
	 * @param key
	 * @param fn
	 * @param scope
	 */
	unFollow: function ( key, fn, scope ) {
		
		this._watcherByConceptName[key] = this._watcherByConceptName[key] || [];
		var i                           = this._watcherByConceptName[key].indexOf(fn);
		(i != -1) && this._watcherByConceptName[key].splice(i, 2);
	},
	
	/**
	 * dirty reset/clean of the box
	 */
	reset   : function () {
		this._mapOpenConcepts        = Object.keys(this._graph._rootConcept._openConcepts || {});
		this._mappedConcepts         = {};
		this._followersByConceptName = {};
		this._watcherByConceptName   = {};
	},
	/**
	 * Do un ref watchers boris watchvosky
	 */
	unRefAll: function () {
		var me = this;
		Object.keys(this._watchers)
		      .forEach(( k ) => {
			      while ( me._watchers[k].length ) {
				      me._graph.getRef(me._watchers[k].shift(), me, me._watchers[k].shift(), true)
			      }
		      });
		
		this._watchers = {};
		Object.keys(this._)
		      .forEach(( k ) => {
			      var i = me._graph._mapsByConcept[k].indexOf(me._._id);
			      (i != -1) && me._graph._mapsByConcept[k].splice(i, 1);
			      me._graph._conceptLib[k] && me._graph._conceptLib[k].unRefRequires(me, me._graph);
		      });
	},
	
	test: function ( query ) {// only for ui !
		
		var me = this,
		    _q = isFunction(query) ? null : compileExpression(query, { empty: false }),
		    fn = isFunction(query) ? query : function ( scope ) { return _q(function ( ref ) { return scope.getRef(ref); }); };
		return fn(this);
		
	},
	
	destroy: function ( unrefAll ) {
		var me                = this;
		this._dead            = true;
		this._mapOpenConcepts = this._mappedConcepts = this._followersByConceptName = this._watcherByConceptName = null;
		this._                = {};
	}
};

module.exports = Entity;