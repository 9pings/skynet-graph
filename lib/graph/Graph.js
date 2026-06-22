/**
 * Copyright (C) 2021  Nathanael Braun
 
 * @author Nathanael BRAUN
 *
 * Date: 14/01/2016
 * Time: 09:32
 */
var TaskFlow = require("./tasks/taskflow");
var Node     = require("./objects/Node");
var Segment  = require("./objects/Segment");
var PathMap  = require("./objects/PathMap");
var Concept  = require("./objects/Concept");
var Entity   = require("./objects/Entity");
//import conceptMap from "../concepts";

var isObject    = require('is').object;
var isArray     = require('is').array;
var isFunction  = require('is').fn;
var isString    = require('is').string;
var { compileExpression } = require('./expr');

// Wrap a query (string | array | fn) into a predicate fn(scope) that resolves
// $refs via scope.getRef — replaces the old `new Function` query compiler.
function compileScopeQuery ( query, emptyValue ) {
	if ( isFunction(query) ) return query;
	var _q = compileExpression(query, { empty: emptyValue });
	return function ( scope ) {
		return _q(function ( ref ) { return scope.getRef(ref); });
	};
}
var shortid     = require('shortid');
var dmerge      = require('deepmerge');
var intersect   = require('intersect');
var arrayDiffer = require('array-differ');
var { createLogger, defaultLogger } = require('./log');
// Module-level fallback for the rare spots with no graph in scope. Inside methods
// we rebind `var debug = this._log` (or `me._log`) so logs route to the in-scope
// graph's own logger (per-graph, captured by a host's injected sink). See init().
var debug       = defaultLogger;

/**
 * serialized format :
 * {
 *  spatialEP : (nodeid)
 *  conceptMaps : [
 *  // ... any serialized concept box (nodes/edge or docs) not serialized  
 *  ],
 *  // or
 *  nodes : [
 *  {
 *  _id : ...
 *  ConceptKey1 : true,
 *  ConceptKey2 : true,//...
 *  }
 *  ]
 *  segments : [
 *  {
 *  _id : ...
 *  originNode : {node _id}
 *  targetNode : {node _id}
 *  }
 *  ]
 *  ]
 * }
 *
 *
 * templates format :
 *  example  : from adding Airports
 [
 {// **************** add start to airport segment
   "Segment": true,
   "$originNode": "_parent:originNode",

   "targetNode": "nearbyOriginAirport"
 },
 {
   // **************** add nearby origin airport concept node
   "_id": "nearbyOriginAirport",
   "Node": true,
   "isAirport": true,
   "$nearTo": "_parent:originNode"// ref a value or cbox
 },
 {
   // **************** add long travel flight segment
   "Segment": true,
   "$_id": "_parent", // add concepts/keys to _parent, if no $_id -> original object will be kept
   "LongTravel": true,//
   "Distance":null,// should recalculate distance as soon as nearby airport have Position
   "originNode": "nearbyOriginAirport",
   "targetNode": "nearbyTargetAirport"
 },
 {
   // **************** add nearby target airport concept node
   "_id": "nearbyTargetAirport",
   "Node": true,
   "isAirport": true,
   "$nearTo": "_parent:targetNode"
 },
 {
   // **************** add final nearby target airport TO target place
   "Segment": true,
   "originNode": "nearbyTargetAirport",
   "$targetNode": "_parent:targetNode"
 }
 ]
 
 */
function Graph() {
	this.init(...arguments);
};

//Graph._providers = require("../providers");

Graph.PathMap = PathMap;
Graph.Entity  = Entity;
Graph.Concept = Concept;

Graph.prototype = {
	static: Graph,
	cfg   : {
		label         : "graph",
		autoMount     : true,
		isMaster      : true,
		onStabilize   : undefined, // should trigger synchronisation between graphs
		onConceptApply: undefined, // (record) => {} : concept-apply trace sink (see traceProvider)
		conceptSets   : ["common"],
		defaultContext: "UserRecord",
		bagRefManagers: {
			caipi: {
				test: /^db\:(.+)$/,
				int : {
					get( refId, cb ) {
						refId = refId.split('#');
						// `App/db` is an optional HOST module (not shipped by the engine). The
						// default 'caipi' manager degrades gracefully (cb error) if the host hasn't
						// provided it — pass cfg.bagRefManagers to supply your own data source.
						var db;
						try { db = require('App/db'); }
						catch ( e ) { return cb(new Error("bagRefManager 'caipi': host module 'App/db' not available; pass cfg.bagRefManagers"), null); }
						db.get(refId[0], refId[1], cb);
					}
				}
			}
		}
	},
	/**
	 *
	 * @param serialized
	 * @param conf
	 */
	init: function ( record, conf, conceptMap ) {
		var concepts = {}, me = this,
		    serialized;
		if ( isString(record.graph) ) {
			serialized = JSON.parse(record.graph);
		}
		else {
			serialized = record;
			record     = {
				lastRev: serialized.lastRev,
				graph  : JSON.stringify(record),
				//bagRefs: {}
			}
		}
		
		this._triggeredCast = {};
		this._stabilizing      = false;// true while a stabilization pass is in flight (see stabilize.js / _applyStabilized)
		this._pendingStructural = [];// add/patchConcept issued mid-stabilize, drained at the quiescent _loopTF boundary (#11.a)
		this._pendingRollback   = null;// rollbackTo issued mid-stabilize, applied at the quiescent boundary (#11.c.4)
		this.cfg            = { ...this.cfg, ...conf };
		// One logger per graph (replaces the old console indirection). cfg.logger lets a
		// host inject its own; else build one at cfg.logLevel (or env SG_LOG_LEVEL), with
		// cfg.onLog as a convenience sink. Exposed as graph.logger (see below the prototype).
		this._log          = this.cfg.logger || createLogger({ label: this.cfg.label, level: this.cfg.logLevel, onRecord: this.cfg.onLog });
		this._applyId      = 0;// monotonic id minted per concept-apply: correlates an apply's logs with its trace record (see Concept.applyTo)
		this._applyCount   = {};// per-(target/concept) apply tally within an episode; reset on settle (#11.c.1)
		this._applyCap     = this.cfg.applyCap || 1000;// oscillation backstop ceiling (per target×concept per episode)
		this.cfg.conceptSets.map(( k ) => concepts = dmerge(concepts, conceptMap[k]));
		me._conceptMap     = conceptMap;// kept so fork() can seed children with the same library
		me._conceptLib     = {};
		me._syncTokens     = {};
		me._syncTokensList = [];
		
		this._lastSyncRecord = record;
		
		this._rootConcept      = new Concept(concepts, me);
		this._mapsByConcept    = {};
		this._statsByProvider  = {};
		this._bagRefsByRefId   = {};
		this._on               = {};
		this._revs             = [];
		this._revByIds         = {};
		this._rev              = serialized.lastRev || 0;
		me._triggeredCastCount = 0;
		// TaskFlow (will handle all the graph tasks/mutations)
		
		this._taskFlow = new TaskFlow(
			[
				require('./tasks/stabilize')
			],
			this
		).then(this._loopTF);
		this._preloadBagRefs(
			serialized.bagRefs || {},
			() => {
				serialized && this.mount(serialized);
				
				if ( this.cfg.autoMount ) {
					this._taskFlow.run();
					me._running = true;
				}
				else {
					setTimeout(this._applyStabilized.bind(this));
				}
			}
		);
	},
	/**
	 *
	 * @param newRefs {"$db:id_from_somwhere":{count:1}}
	 * @param cb
	 * @private
	 */
	_preloadBagRefs( newRefs, cb ) {
		// internal : {"$db:id_from_somwhere":{count:1, lastUpdated:tm, watch:tm, record}}
		var debug   = this._log;// per-graph logger; the nested arrows below capture it
		let refsMap = this._bagRefsByRefId,
		    mngrs   = this.cfg.bagRefManagers,
		    running = 1,
		    tm,
		    refs    = Object.keys(newRefs),
		    check   = () => {
			    debug.warn("timeout Preloading refs", newRefs);
			    tm = setTimeout(check, 5000);
		    },
		    done    = () => {
			    if ( !--running ) {
				    //refs.length && debug.log("done Preloading refs", refs);
				    clearTimeout(tm)
				    //this._taskFlow.release()
				    cb()
			    }
		    };
		//this._taskFlow.wait()
		tm          = setTimeout(check, 5000);
		//refs.length && debug.log("Preloading ", refs);
		refs.forEach(
			id => {
				let refMngrId = id && this._isBagRefs(id), v;
				if ( refMngrId && !refsMap[id] ) {
					v = ('' + id).match(mngrs[refMngrId].test)
					//refsMap[id] = refsMap[id] || {
					//    count: 0
					//};
					running++;
					mngrs[refMngrId].int.get(
						v[1] || id,
						( e, r ) => {
							if ( e )
								debug.error("can't retrieve bagRef %s", id);
							refsMap[id] = refsMap[id] || {
								count: 0
							};
							refsMap[id].count++;
							refsMap[id].lastUpdated = Date.now();
							refsMap[id].record      = r || { name: "Error" };
							done()
						}
					)
				}
			}
		)
		
		done();
	},
	_isBagRefs( id ) {
		let refsMap = this._bagRefsByRefId,
		    mngrs   = this.cfg.bagRefManagers,
		    mKeys   = Object.keys(mngrs);
		for ( var i = 0, v; i < mKeys.length; i++ ) {
			
			v = ('' + id).match(mngrs[mKeys[i]].test)
			if ( v ) {
				return mKeys[i]
			}
		}
		return false;
	},
	// -------------------------------------------------------------------------- core
	
	/**
	 * Make the stabilisation taskflow loop until theres no more unstable items
	 * @param me
	 * @param flow
	 * @private
	 */
	_loopTF   : function ( me, flow ) {
		if ( me._dead ) return;
		var debug = me._log;// per-graph logger (captured by the setTimeout closure below)
		// flow.running=false;
		
		
		// me._running = me.cfg.autoMount;
		setTimeout(function () {// loop
			if ( me._dead ) return;
			
			flow.reset();
			debug.info("stabilize loop: %s unstable, %s triggered", me._unstable.length, me._triggeredCastCount);
			flow.then(me._loopTF);
			// me.cfg.autoMount &&
			(me._triggeredCastCount || me._unstable.length) && flow.run();
		});
		if ( !me._unstable.length && !me._triggeredCastCount ) {
			// quiescent boundary. A rollback requested mid-stabilize supersedes everything —
			// it re-mounts an earlier rev (and its concept-lib), so queued structural edits
			// (issued after that rev) are discarded (#11.c.4).
			if ( me._pendingRollback != null ) {
				var _r = me._pendingRollback;
				me._pendingRollback = null;
				me._pendingStructural = [];
				me._doRollback(_r);// mount + restore, no kick — the re-arm re-stabilizes
				return;
			}
			// else apply any structural ops (add/patchConcept) issued mid-stabilize, against
			// the now-settled, consistent cast-state — then let the loop re-run (they
			// write/destabilize) rather than declaring stable (#11.a).
			if ( me._pendingStructural && me._pendingStructural.length ) {
				me._drainStructural();
				return;
			}
			debug.log("stabilize loop quiescent — settling");
			me._applyStabilized();
		}
	},
	printStats: function () {
		var debug = this._log;
		let stats = this._statsByProvider;
		if ( !stats )
			return;
		let total   = 0,
		    parts   = {},
		    results = Object.keys(stats)
		                    .sort(( a, b ) => (stats[b] - stats[a]))
		                    .map(( a ) => {
			                    total += stats[a];
			                    return a
		                    })
		                    .map(( a, i ) => {
			                    let insec = stats[a] / 1000,
			                        pct   = stats[a] * 100 / total;
			                    pct       = Math.round(pct * 1000) / 1000;
			                    insec     = Math.round(insec * 10) / 10;
			                    return "\t" + (pct) + "%\t" + "( ~ " + (insec) + "s )\t:\t" + a;
		                    }).join("\n");
		debug.warn(
			"____________________________________________________")
		debug.warn(
			"%s : Graph providers outer-stats total execTm [ %d s ] \n", this.cfg.label, ~~(total / 1000), results);
		debug.warn(
			"____________________________________________________")
	},
	/**
	 * get a serialized json copy of the graph
	 * @returns {{spatialEP: (*|string), servicesEP: *, timeStepEP: *, lastSpecified: (*|string), conceptMaps: Array}}
	 */
	serialize: function () {
		var state = this._lastSyncState,
		    map   = this._objById;
		return {
			...this._lastSyncRecord,
			lastRev: this.getCurrentRevision(),
			graph  : JSON.stringify(
				{
					spatialEP  : state.spatialEP,
					lastRev    : this.getCurrentRevision(),
					conceptMaps: Object.keys(this._objById).map(
						function ( id ) {
							return { ...map[id]._etty._ };
						}
					),
					bagRefs    : Object.keys(this._bagRefsByRefId).reduce(
						( r, id ) => {
							r[id] = {
								count: this._bagRefsByRefId[id].count
							}
							return r;
						}, {}
					),
					
				}
			)
		}
	},
	/**
	 * Do mount the graph (instantiate all objects & mark them as unstable)
	 * @param sg  serialized graph
	 */
	mount : function ( sg, cfg ) {
		var debug = this._log;
		var me = this, stack = [];
		
		// copy original state
		
		this._lastSyncState = sg = { ...sg };
		this._triggeredCast = {};
		// clean up / init ...
		// user & datas open request
		this._userQuery = [];
		this._dataQuery = [];
		
		this._rev                  = sg.lastRev || 1;
		this._history              = [];
		this._unstable             = [];
		this._pending              = [];
		this._stable               = [];
		this._objById              = {};
		this._pendingMutationsById = {};
		sg.freeNodes               = sg.freeNodes || [];
		sg.nodes                   = sg.nodes || [];
		sg.segments                = sg.segments || [];
		if ( sg.conceptMaps ) {
			sg.conceptMaps.map(
				function ( map ) {
					if ( !map ) return debug.warn(sg.conceptMaps);
					if ( map.Node ) sg.nodes.push(map);
					else if ( map.Segment ) sg.segments.push(map);
					else sg.freeNodes.push(map);
				}
			);
		}
		
		this._freeNodes = sg.freeNodes// free nodes are concept map / scope, linkable on node's & segment's conceptMap, on which we can cast
			// concepts,
			&& sg.freeNodes.map(function ( v ) {
				me._objById[v._id] = { _etty: new Entity(v, me) };
				me._unstable.push(me._objById[v._id]) || me._stable.push(me._objById[v._id]);
				me._objById[v._id]._etty.updateApplicableConcepts(me);
				
				
				return me._objById[v._id];
			})
			|| [];
		this._nodes     = sg.nodes// nodes first as segments autoregister them in nodes
			&& sg.nodes.map(function ( v ) {
				me._objById[v._id] = new Node(v, me);
				// me.cfg.autoMount &&
				me._unstable.push(me._objById[v._id]) || me._stable.push(me._objById[v._id]);
				me._objById[v._id]._etty.updateApplicableConcepts(me);
				
				return me._objById[v._id];
			})
			|| [];
		this._segments  = sg.segments
			&& sg.segments.map(function ( v ) {
				me._objById[v._id] = new Segment(v, me);
				// me.cfg.autoMount &&
				me._unstable.push(me._objById[v._id]) || me._stable.push(me._objById[v._id]);
				me._objById[v._id]._etty.updateApplicableConcepts(me);
				return me._objById[v._id];
			})
			|| [];
		debug.verbose("graph mounted (%s objects)", Object.keys(this._objById || {}).length);
		
	},
	// refId -> [walked ref ids], so a multi-hop walk can tear down its old watchers
	// when an intermediate ref is repointed (see the `refs[exp.length]` handling below).
	refMap: {},
	/**
	 * Resolve a reference expression against a scope object — the read half of the
	 * `$`-ref mini-DSL (the same syntax used in mutation templates and assert/query
	 * strings). Optionally installs a watcher so the scope is retested when the
	 * resolved value later changes/appears.
	 *
	 * The expression is a chain of two kinds of step:
	 *   `.`  walk INTO a key of the current object   (Position.lat)
	 *   `:`  follow a reference to ANOTHER object, then keep walking
	 *        (originNode:Position.lat  →  hop to the origin node, read its Position.lat)
	 *   `$`  prefix = a GLOBAL lookup by id in _objById ($paris, $paris:Position)
	 * A trailing `:` (e.g. "originNode:") returns the linked OBJECT itself, not a value.
	 * A bare key ("Distance") returns that fact off the scope.
	 *
	 * `follow`:
	 *   - `true`  → if the value is absent, destabilize `scope`'s object so it is
	 *               retested once the value appears (this is how `require` waits on a
	 *               not-yet-produced fact); internally normalized to the scope id.
	 *   - a fn    → call it on change instead of destabilizing.
	 *   - falsy   → plain read, no watcher.
	 * `unref` removes a previously-installed watcher instead of adding one.
	 * `getBox` resolves an id → Entity (defaults to this.getEtty; overridable for tests).
	 *
	 * bagRefs (external data ids matching cfg.bagRefManagers) resolve to the preloaded
	 * record in _bagRefsByRefId rather than to a graph object.
	 *
	 * @param {string}        exp     ref expression (e.g. "originNode:Position.lat")
	 * @param {Entity|string} scope   object (or its id) the expression is relative to
	 * @param {boolean|fn}    [follow] install a watcher (see above)
	 * @param {boolean}       [unref]  remove the watcher instead
	 * @param {fn}            [getBox] id -> Entity resolver
	 * @returns the resolved value, or the linked Entity (trailing `:`), or undefined
	 */
	getRef: function ( exp, scope, follow, unref, getBox ) {
		var debug = this._log;
		let cScope = isString(scope) && this.getEtty(scope) || scope || this.getEtty(this.cfg.defaultContext),
		    refId  = cScope && cScope._ && (cScope._._id + '::' + exp),
		    keyRefId,
		    refStack;
		
		getBox = getBox || this.getEtty.bind(this);
		
		exp    = exp.split('.');
		follow = follow === true && scope._._id || follow;
		
		
		let refs = this.refMap[refId] = follow && !unref && this.refMap[refId] || [], bagRef;
		
		while ( exp.length ) {
			if ( exp[0].indexOf(':') != -1 ) {// follow the ref
				exp[0] = exp[0].split(':');
				
				while ( exp[0].length != 1 ) {// consume each `:`-hop, switching scope to the linked object
					
					if ( exp[0][0][0] == '$' ) {// global ref
						cScope = getBox(exp[0][0].substr(1));// switch scope
						exp[0].shift();
					}
					else {
						// read the id stored under this key, then hop to the object it names
						keyRefId = cScope.get && cScope.get(exp[0][0], follow, unref) || cScope[exp[0][0]];// walk
						bagRef = this._isBagRefs(keyRefId)

						if ( bagRef ) // the id points at external (bagRef) data, not a graph object
						{
							if ( !this._bagRefsByRefId[keyRefId] )
								debug.warn("ref to an unknown bagRef %s", keyRefId, cScope)
							cScope = this._bagRefsByRefId[keyRefId] && this._bagRefsByRefId[keyRefId].record || null;
						}
						else {
							// if this hop was repointed since last time, drop the stale watcher
							// installed on the previous target's key before following the new one
							if ( follow && !unref && refs[exp.length] && (refs[exp.length] != keyRefId) )
								getBox(refs[exp.length]) &&
								getBox(refs[exp.length])._etty.get(exp[0][0], follow, true);

							cScope = getBox(keyRefId);// walk to the linked object
						}
						exp[0].shift();

					}
					if ( !cScope ) return;
				}
				if ( !exp[0][0] ) {
					return cScope;// exp finishig by : ex: "originNode:"
				}
				exp[0] = exp[0][0];
			}
			if ( exp[0][0] == '$' ) {// global ref
				if ( exp.length == 1 )
					return this._objById[exp[0].substr(1)] && this._objById[exp[0].substr(1)]._etty._._id;
				cScope = this._objById[exp[0].substr(1)] && this._objById[exp[0].substr(1)]._etty;
			}
			else if ( exp.length == 1 ) {
				return cScope.get ? cScope.get(exp[0], follow, unref) : cScope[exp[0]];
				
			}
			else if ( exp.length ) {
				cScope = cScope.get ? cScope.get(exp[0], follow, unref) : cScope[exp[0]];
			}
			if ( !cScope ) return;
			exp.shift();
		}
		return cScope;
	},
	
	update: function ( record ) {
		var debug = this._log;
		var cRecord = this._lastSyncRecord,
		    changes = Object.keys(record).map(( b ) => ((record[b] != cRecord[b]) && b)).filter(
			    i => !!i || ["graph", "updated"].includes(i)
		    );
		
		if ( !changes.length || (changes.length == 1) && changes[0] == "updated" ) {
			
			return;// no changes
		}
		else {
			debug.error(changes);
			if ( this._rev <= record.lastRev ) {
				
				this._revs[this._rev] = {
					id          : shortid.generate(),
					recordUpdate: record
				};
				record.lastRev++;
				this._rev++;
				// this.stabilize();
				
				
			}
			
			this._lastSyncRecord = {
				...this._lastSyncRecord,
				...record
			};
		}
	},
	
	// -------------------------------------------------------------------------- atomic stuff
	
	getCurrentRevision: function () {
		return this._rev;
	},
	/**
	 * get all atoms from from to to
	 * @param from
	 * @param to
	 * @returns {Array.<T>}
	 */
	getRevisionsRange: function ( from, to ) {
		this._log.verbose("getRevisionsRange %s..%s", from, to);
		return this._revs.slice(from, to);
	},
	
	
	_mutationThread       : [],
	_mutationThreadRunning: false,
	_atomicThread         : [],
	_atomicThreadRunning  : false,
	/**
	 * Push atoms from remote or client
	 * @param from
	 * @param to
	 * @param atoms
	 * @param token
	 * @param resetRevs
	 */
	pushAtomicUpdates: function ( from, to, atoms, token, resetRevs ) {
		// !__SERVER__ &&
		var debug   = this._log;
		var me      = this,
		    i       = 0,
		    max     = to - from,
		    allRefs = {};
		//
		//if ( this._atomicThreadRunning ) {
		//
		//    return this._atomicThread.push([...arguments]);
		//}
		//this._atomicThreadRunning = true;
		debug.warn('RT Update request:', from, to, token, !__SERVER__ && atoms);
		//while ( i < max ) {
		//    atoms[i]
		//    && atoms[i].bagRefs
		//    && atoms[i].bagRefs.length
		//    && atoms[i].bagRefs.each(id => {
		//        allRefs[id] = allRefs[id] || { count: 0 };
		//        allRefs[id].count++;
		//    });
		//    i++;
		//}
		//this._preloadBagRefs(
		//    allRefs,
		//    () => {
		// me._inited = true;
		while ( i < max ) {
			atoms[i]
			//&& !this._revByIds[atoms[i].id]//@todo: alpha method...
			&& this.pushMutation(atoms[i].tpl, atoms[i].parent, true, atoms[i].id, atoms[i].bagRefs), i++;
		}
		token = isArray(token) ? token : token && [token] || [];
		// token && this.on("stabilize", function fn() {// sync cb
		//     me.un("stabilize", fn);
		//
		// });
		// if ( this.cfg.autoMount ) {
		if ( !this._taskFlow.running ) {
			this._taskFlow.run();
		}
		me._running = true;
		token.map(( t ) => me._syncTokensList.push(t));
		// } else this._applyStabilized();
		
		token.map(( t ) => me._syncTokens[t] && me._syncTokens[t]());
		this.stabilize(
			//r=>{
			//
			//}
		);
		
		this._on.atomicUpdate
		&& this._on.atomicUpdate.map(( cb ) => cb(me, from, to, atoms));
		this.cfg.onAtomicUpdate
		&& this.cfg.onAtomicUpdate(this, from, to, atoms);
		//this._atomicThreadRunning = false;
		//
		//if ( this._atomicThread.length ) {
		//    this.pushAtomicUpdates(...this._atomicThread.shift())
		//}
		//}
		//)
		
	},
	
	// -------------------------------------------------------------------------- mutations stuff
	
	/**
	 *
	 * @param path
	 * @param mapLib
	 * @param tSegment
	 */
	pushMutationFromPath: function ( path, descrs, tSegment ) {
		this.pushMutation(this.getMutationFromPath(path, descrs, tSegment), tSegment)
	},
	/**
	 * convert a path to a graph template
	 * @param path
	 * @param mapLib
	 * @param tSegment
	 * @returns {Array}
	 */
	getMutationFromPath: function ( path, descrs, tSegment ) {
		var
			me  = this,
			tpl = path.slice(0);
		tpl.unshift.apply(tpl, descrs);//?
		tpl = tpl.map(
			function ( cmap ) {
				cmap = { ...cmap };
				if ( cmap.__bagRefKeys ) {
					cmap.__bagRefKeys.forEach(
						key => {
							if ( cmap[key] )
								cmap['$$' + key] = cmap[key];
							delete cmap[key];
						}
					)
					delete cmap.__bagRefKeys;
				}
				// if ( cmap.TimePeriod ) {// periods from the vendor record
				//     Period.start = Math.min(Period.start, cmap.TimePeriod.start);
				//     Period.end   = Math.max(Period.end, cmap.TimePeriod.end);
				// }
				// if ( (related = cmap.pathDescriptor) && mapLib[related] ) {
				//     do {
				//         if ( !relatedRefs[related] ) {
				//             relatedRefs[related] = merge(true, mapLib[related]);
				//             relatedTpl.push(relatedRefs[related]);
				//         }
				//     } while (related = mapLib[related] && mapLib[related].parentPathDescriptor)
				// }
				if ( cmap._rev )
					delete cmap._rev;
				// if ( me._objById[cmap._id] ) {// existing turn to ref
				//
				//     // if (cmap._id==)
				//
				//     cmap.$_id = '$' + cmap._id + '._id';
				//     delete cmap._id;
				//
				// }
				return cmap;
			}
		);
		return tpl;
	},
	/**
	 * Manual/forced concept uncast
	 * @param cmapId the target cmap id
	 * @param cId the concept id
	 * @param cb
	 */
	unCastConcept: function ( cmapId, cId, cb ) {
		if ( this._objById[cmapId]._etty._._autokill ) return;
		var me = this, key = cmapId + '/' + cId;
		if ( this._triggeredCast[key] )
			delete this._triggeredCast[key];
		this.pushMutation(
			{
				$_id                         : "_parent",
				[this._conceptLib[cId]._name]: null
			},
			cmapId
		);
		// this._objById[cmapId]._etty.unCast(this._conceptLib[cId]._name, null);
		// this.toggleGraphObjectState(cmapId, "unstable");
		this.stabilize(cb);
	},
	/**
	 * Manual/forced concept cast
	 * @param cmapId the target cmap id
	 * @param cId the concept id
	 * @param cb
	 */
	castConcept   : function ( cmapId, cId, cb ) {
		if ( this._objById[cmapId]._etty._._autokill ) return;
		var me = this, key = cmapId + '/' + cId;
		// this._triggeredCast[key] = [cmapId, cId];
		// me._triggeredCastCount++;
		this._taskFlow.pushSubTask(
			this._conceptLib[cId].applyTo(this._objById[cmapId]._etty, this));
		this.toggleGraphObjectState(cmapId, "unstable");
		this.stabilize(cb);
	},
	/**
	 * Resolve a concept by its id (`_conceptLib` key) or, failing that, by its
	 * `_name`. Returns the Concept instance or null.
	 * @param nameOrId
	 */
	getConceptByName: function ( nameOrId ) {
		if ( this._conceptLib[nameOrId] ) return this._conceptLib[nameOrId];
		var ids = Object.keys(this._conceptLib);
		for ( var i = 0; i < ids.length; i++ )
			if ( this._conceptLib[ids[i]]._name === nameOrId )
				return this._conceptLib[ids[i]];
		return null;
	},
	/**
	 * Hot-patch an expert (concept) and re-evaluate the WHOLE graph against it,
	 * in both directions — no restart, no rebuild:
	 *   - patch the concept's schema + recompile its applicability test
	 *     (delegated to Concept.patch);
	 *   - for every live object: newly-applicable + not cast -> castConcept;
	 *     cast + no-longer-applicable -> unCast (which cascades to children);
	 *   - re-stabilize.
	 *
	 * @param nameOrId  concept id (`_conceptLib` key) or `_name`
	 * @param updates   partial concept schema (e.g. `{ assert: ["$x > 5"] }`)
	 * @param cb        optional stabilize callback
	 * @returns {Graph} this
	 */
	patchConcept  : function ( nameOrId, updates, cb ) {
		// Issued mid-stabilize? Defer to the quiescent _loopTF boundary so the re-eval
		// sees a settled cast-state (else a patch of the concept currently mid-apply is
		// silently dropped — its self-flag is not written yet). (#11.a re-entrancy.)
		if ( this._stabilizing ) {
			this._pendingStructural.push({ op: 'patch', nameOrId: nameOrId, updates: updates, cb: cb });
			return this;
		}
		this._doPatchConcept(nameOrId, updates);
		this.stabilize(cb);
		return this;
	},
	/**
	 * The bidirectional re-eval body of patchConcept WITHOUT the stabilize kick.
	 * Casts (no-kick: queue the apply + destabilize) newly-applicable objects and
	 * uncasts (cascades) no-longer-applicable ones. Used by the public method (host
	 * path, one kick at the end) and by the mid-stabilize drain.
	 */
	_doPatchConcept: function ( nameOrId, updates ) {
		var me      = this,
		    concept = this.getConceptByName(nameOrId);
		if ( !concept )
			throw new Error("patchConcept: no concept '" + nameOrId + "'");

		concept.patch(updates);
		this._conceptSnapshot = null;// concept lib changed — invalidate the N6 schema snapshot cache

		// #11.b scoped re-eval: only the objects whose cast-state for C could change —
		// not the whole graph (was O(graph) stop-the-world).
		this._scopedReevalIds(concept).forEach(function ( id ) {
			var o = me._objById[id];
			if ( !o ) return;
			var etty       = o._etty;
			if ( !etty || etty._dead ) return;
			var applicable = !!concept.isApplicableTo(etty, me),
			    isCast     = !!etty._mappedConcepts[concept._name];
			if ( applicable && !isCast ) {
				me._taskFlow.pushSubTask(concept.applyTo(etty, me));// no-kick cast
				me.toggleGraphObjectState(id, "unstable");
			}
			else if ( !applicable && isCast ) {
				etty.unCast(concept._name);
				me.toggleGraphObjectState(id, "unstable");
			}
		});
		return concept;
	},
	/**
	 * The objects whose cast-state for `concept` could change under a patch — its
	 * sound, minimal re-eval frontier (#11.b):
	 *   - `_mapsByConcept[C._name]` — objects where C is/was cast (the UNCAST direction
	 *     on a tightening patch);
	 *   - `_mapsByConcept[r]` for each simple `require` r — objects that carry a fact C
	 *     needs, so a loosening patch could newly CAST C on them (incl. never-cast ones).
	 * Falls back to the full object scan when it can't be soundly scoped: an assert-only
	 * concept (no `require` ⇒ any object could apply) or a cross-object walk require
	 * (`a:b` ⇒ the require fact lives on another object, not indexable here).
	 */
	_scopedReevalIds: function ( concept ) {
		var me       = this,
		    requires = isArray(concept._schema.require) ? concept._schema.require
		             : concept._schema.require && [concept._schema.require] || [];
		if ( !requires.length || requires.some(function ( r ) { return String(r).indexOf(':') !== -1; }) )
			return Object.keys(me._objById);
		var set = {};
		(me._mapsByConcept[concept._name] || []).forEach(function ( id ) { set[id] = 1; });
		requires.forEach(function ( r ) {
			(me._mapsByConcept[r] || []).forEach(function ( id ) { set[id] = 1; });
		});
		return Object.keys(set);
	},
	/**
	 * Apply-ceiling backstop (#11.c.1): a (target, concept) pair has applied past the
	 * `_applyCap` within one episode. NOTE the framing: a self-destabilizing re-cast loop
	 * is NOT inherently pathological — it is a legitimate *iterative-trial* technique
	 * (the engine's own way to stabilize / try paths & casts). So the cap is a BACKSTOP
	 * (default high, reset on each settle so a converging trial loop is never killed), and
	 * `divergent` is the "did not converge within the ceiling" *outcome* — a reusable trial
	 * signal, not just an error. (Future: an explicit per-concept iteration budget could
	 * turn this into a controlled explore-variations loop — AO-star/beam + the learning loop.)
	 *
	 * Record WHY — a reason record pushed (race-free `{__push}`) into the target's
	 * `divergent` array fact. That fact is a NON-CAST CONDITION (Concept.isApplicableTo
	 * reads it), so the concept de-casts and stops re-firing; it is also a retraction
	 * trigger a host / meta-concept can `ensure`-gate on. Idempotent (one record per pair).
	 */
	_markDivergent: function ( scope, concept, count ) {
		var debug = this._log;
		var cur = scope._ && scope._.divergent;
		if ( cur && cur.length )
			for ( var i = 0; i < cur.length; i++ )
				if ( cur[i] && cur[i].concept === concept._name ) return;// already recorded
		debug.error("DIVERGENT: %s blew the apply ceiling (%s) on %s — de-casting + flagging why",
		            concept._name, this._applyCap, scope._._id);
		this.pushMutation({
			$_id     : "_parent",
			divergent: { __push: { concept: concept._name, applies: count, cap: this._applyCap, reason: "apply-cap" } }
		}, scope._._id);
	},
	/**
	 * Install a NEW expert (concept) into the live library and re-evaluate the
	 * graph against it — the symmetric twin of `patchConcept`, no restart/rebuild.
	 * This is the engine half of declarative AI-authoring (roadmap #10): an
	 * authoring loop proposes a concept term, the host validator gates it, this
	 * installs it.
	 *
	 * It composes existing machinery only (Concept ctor + the cast/sweep/stabilize
	 * path), so there is no new evaluation code:
	 *   - `new Concept` registers itself (and any nested `childConcepts`) into
	 *     `_conceptLib` keyed by `_id`, and recompiles its applicability test;
	 *   - it is attached under `parent._openConcepts` keyed by `_id` (the engine
	 *     invariant: a child's key in `_openConcepts`/`childConcepts` IS its `_id`,
	 *     because `updateApplicableConcepts` pushes those keys straight into
	 *     `_conceptLib[...]`), and mirrored into `parent._schema.childConcepts` so
	 *     serialize() carries the new capability;
	 *   - every live object under the (cast) parent has the new concept opened in
	 *     its `_mapOpenConcepts` and is re-swept — exactly how an object discovers
	 *     a root concept at mount. Unresolved `require`s install their follow-watcher
	 *     during the sweep, so a dormant concept fires when its fact later appears.
	 *
	 * Re-entrancy note: like `patchConcept`, this casts/uncasts + `stabilize()`s
	 * directly (not via the mutation queue). It is meant to be called from the host
	 * at a quiescent boundary (between stabilizations). Calling it from *inside* a
	 * provider mid-stabilize is the self-modification tier (roadmap #11) and needs
	 * the queued/scoped variant (MODELISATION §6.4) — not done here.
	 *
	 * @param parentNameOrId  parent concept id/`_name`; null/undefined = top-level
	 *                        (child of the root container)
	 * @param schema          a concept schema: `{ _id, _name?, require?, assert?,
	 *                        ensure?, provider?, applyMutations?, childConcepts? }`.
	 *                        `_id` must be globally unique; `_name` defaults to `_id`.
	 * @param cb              optional stabilize callback
	 * @returns {Concept} the installed concept
	 */
	addConcept    : function ( parentNameOrId, schema, cb ) {
		// Issued mid-stabilize (e.g. from a meta-concept's provider)? Defer to the
		// quiescent _loopTF boundary, where cast-state is settled (#11.a re-entrancy).
		// The deferred op installs at drain time; its cb gets (err, concept) then.
		if ( this._stabilizing ) {
			this._pendingStructural.push({ op: 'add', parentNameOrId: parentNameOrId, schema: schema, cb: cb });
			return;
		}
		var concept = this._doAddConcept(parentNameOrId, schema);
		this.stabilize(cb);
		return concept;
	},
	/**
	 * The structural body of addConcept WITHOUT the stabilize kick — builds+registers
	 * the concept, attaches it to the parent, opens it on the live objects, and
	 * destabilizes them. Used directly by the public method (host path) and by the
	 * mid-stabilize drain (`_drainStructural`).
	 */
	_doAddConcept : function ( parentNameOrId, schema ) {
		var me = this;
		if ( !schema || !schema._id )
			throw new Error("addConcept: schema must have a unique _id");
		if ( this._conceptLib[schema._id] )
			throw new Error("addConcept: concept '" + schema._id + "' already exists (duplicate _id)");
		if ( !schema._name ) schema._name = schema._id;

		var parent = parentNameOrId ? this.getConceptByName(parentNameOrId) : this._rootConcept;
		if ( !parent )
			throw new Error("addConcept: no parent concept '" + parentNameOrId + "'");

		// build + register (Concept.init does graph._conceptLib[_id]=this, recursively
		// for nested childConcepts, and compiles the applicability test)
		var concept = new Concept(schema, this, parent === this._rootConcept ? undefined : parent);

		// attach under the parent's open-concept map (key === _id, the engine invariant)
		if ( !parent._openConcepts ) {
			parent._openConcepts         = {};
			parent._openConceptsRequires = {};
			parent.isLeaf                = false;
		}
		parent._openConcepts[schema._id]         = concept;
		parent._openConceptsRequires[schema._id] =
			isArray(schema.require) ? schema.require : schema.require && [schema.require] || [];
		// mirror into the parent's live schema so serialize()/snapshots carry it
		parent._schema.childConcepts = parent._schema.childConcepts || {};
		parent._schema.childConcepts[schema._id] = schema;
		this._conceptSnapshot = null;// concept lib changed — invalidate the N6 schema snapshot cache

		// open + re-sweep every live object the new concept could apply to: the root
		// container reaches all objects; a real parent reaches objects it is cast on.
		var atRoot = parent === this._rootConcept;
		Object.keys(this._objById).forEach(function ( id ) {
			var etty = me._objById[id]._etty;
			if ( !etty || etty._dead ) return;
			if ( !atRoot && !etty._mappedConcepts[parent._name] ) return;
			if ( etty._mapOpenConcepts.indexOf(schema._id) === -1 )
				etty._mapOpenConcepts.push(schema._id);
			etty.updateApplicableConcepts(me);
			me.toggleGraphObjectState(id, "unstable");
		});

		return concept;
	},
	/**
	 * Drain structural ops (add/patchConcept) that were queued because they were
	 * issued mid-stabilize. Runs at the quiescent _loopTF boundary, so the re-eval
	 * sees a settled, consistent cast-state. Each op writes/destabilizes; _loopTF's
	 * re-arm then re-stabilizes (no extra kick needed). (#11.a)
	 */
	_drainStructural: function () {
		var debug = this._log;
		var me = this, q = this._pendingStructural;
		this._pendingStructural = [];
		q.forEach(function ( o ) {
			try {
				var r = o.op === 'patch' ? me._doPatchConcept(o.nameOrId, o.updates)
				                         : me._doAddConcept(o.parentNameOrId, o.schema);
				o.cb && o.cb(null, r);
			} catch ( e ) {
				debug.error("drainStructural %s failed: %s", o.op, e && e.message);
				o.cb && o.cb(e);
			}
		});
	},
	pushAtomicData: function ( data, revFrom, token ) {
		var debug = this._log;
		var me = this;
		debug.log("Start pushing from client %j", revFrom);
		token = isArray(token) ? token : token && [token] || [];
		
		this.pushMutation(data.tpl, data.parent, true);
		token.map(( t ) => me._syncTokensList.push(t));
		// token && this.on("stabilize", function fn() {// sync cb
		//     me.un("stabilize", fn);
		//     token.map(( t )=>me._syncTokens[t] && me._syncTokens[t]());
		//
		// });
	},
	/**
	 * Apply a mutation template — the one path that creates/updates graph objects.
	 * Every touched object is destabilized so stabilization re-tests concepts on it.
	 *
	 * A template is an object (or array of objects) describing nodes/segments/docs.
	 * Keys are facts; a few `$`-prefixed forms have meaning (the WRITE half of the
	 * ref DSL — see getRef for the read half):
	 *   _id        create a new object with a fresh id
	 *   $_id       derive this object's id by RESOLVING a ref (e.g. "_parent" → targetId)
	 *   $$_id      force a LITERAL id (upsert that exact object)
	 *   $key       make `key` a REFERENCE (its value is resolved to an id)
	 *   $$key      mark `key` a bagRef (external data id, preloaded before apply)
	 *   _incoming / _outgoing   nest child segments under a node
	 *   { __push: v }           race-free append to an array fact (see Entity.set)
	 *
	 * Pipeline:
	 *   1. WALK the template (a stack), resolving `$`-refs against `refScope`/`aliases`
	 *      and collecting bagRefs to preload. Template-local ids are aliased to graph ids.
	 *   2. PRELOAD any bagRefs (async), then in the callback:
	 *   3. INSTANTIATE — nodes first, then segments/docs (so a segment's endpoints exist),
	 *      via Entity.update; record a revision (revTpl) for history/sync; fire the
	 *      onConceptApply trace if this came from a concept (applyCtx); destabilize +
	 *      stabilize().
	 * Non-master graphs forward the template to the master (cfg.pushToMaster) and apply
	 * the streamed-back result instead of mutating locally.
	 *
	 * @param {object|object[]} template      the mutation template
	 * @param {string}          targetId      object the template is applied to ("_parent")
	 * @param {boolean}         [force]        bypass the master/client deferral
	 * @param {*}               [atomId]       atomic-update id (master/client sync)
	 * @param {object}          [initialRefBag] preseeded bagRefs
	 * @param {fn}              [cb]           called once applied (after bagRef preload)
	 * @param {object}          [applyCtx]     concept-apply trace context (from Concept.applyTo)
	 */
	pushMutation: function ( template, targetId, force, atomId, initialRefBag, cb, applyCtx ) {
		template           = isArray(template) ? template : [template];
		var debug          = this._log;// per-graph logger (captured by nested callbacks below)
		var me             = this,
		    cObject, cTargetObj,
		    push           = Array.prototype.push,
		    tid, refId, revId, revNum,
		    cTplObject,
		    revTpl         = [],
		    stack          = [],
		    pendingObjects = [],
		    pendingRefs    = [],
		    pendingRefMaps = [],
		    pendingERefs   = [],
		    refs           = {},
		    masterToken,
		    keepRev        = !this.cfg.isMaster,
		    originCMap     = targetId && me.getEtty(targetId) && me.getEtty(targetId)._ || false,
		    baseOrigin     = originCMap && originCMap._keepOrigin && originCMap._origin || false,
		    aliases        = ["_parent"],
		    refScope       = {
			    _parent: targetId
		    },
		    bagRefs        = initialRefBag ? { ...initialRefBag } : {};
		
		let refMap = {};
		if ( !force && !this.cfg.isMaster ) {
			debug.warn("pushing 2 master", targetId);
			// if (!me.cfg.isMaster && !me._inited){
			//     this._taskFlow.wait();
			//
			//     return me.on("atomicUpdate", function atomicUpdate() {
			//         me.un("atomicUpdate", atomicUpdate);
			//         me._inited=true;
			//         me.pushMutation.apply(me, arguments);
			//         me._taskFlow.release();
			//     });
			// }
			if ( !this._taskFlow.running ) {
				this._taskFlow.run();
			}
			this._running = true;
			me._taskFlow.wait();
			masterToken = this.cfg.pushToMaster(
				{
					baseRev: me._rev,
					parent : targetId,
					tpl    : template
				}
			);
			
			this._syncTokens[masterToken] = () => {// here the server should have applied this mutation & pushed back the resulting mutations
				me._taskFlow.release();
				debug.info('Complete %s !', masterToken);
				delete me._syncTokens[masterToken];
				cb && cb({ /* should have refscope here*/ })
			};
			debug.warn('RT Push request waiting ', masterToken);
			return;
		}
		
		if ( this._mutationThreadRunning ) {
			debug.warn('Delay mutation', this._mutationThread.length);
			
			return this._mutationThread.push([...arguments]);
		}
		this._mutationThreadRunning = true;
		
		//while ( i < max ) {
		//    atoms[i]
		//    && atoms[i].bagRefs
		//    && atoms[i].bagRefs.length
		//    && atoms[i].bagRefs.each(id => {
		//        allRefs[id] = allRefs[id] || { count: 0 };
		//        allRefs[id].count++;
		//    });
		//    i++;
		//}
		
		push.apply(stack, template);
		
		// if ( !keepRev ) {
		revId = atomId || shortid.generate();
		// }
		
		// !keepRev &&
		revNum = this._rev;
		this._rev++;
		// !keepRev && push.bind(this._revs[this._rev].tpl, template);
		
		// parse objects...
		while ( cTplObject = stack.shift() ) {
			
			// create id & map innertpl ids
			refId = cTplObject.$_id && this.getRef(cTplObject.$_id, refScope,
			                                       null,
			                                       null,
			                                       // required to work when referencing inner tpl from graph items
			                                       ( id ) => {
				                                       return (refScope[id] || this.getEtty(id)) && {
					                                       get: ( key ) => (
						                                       refScope[id] && refScope[id].hasOwnProperty(key)
						                                       ? refScope[id][key]
						                                       : this.getEtty(id) && this.getEtty(id).get(key)
					                                       ),
				                                       }
			                                       });
			
			if ( refId && !isString(refId) )
				refId = refId._id;
			
			if ( cTplObject.$$_id ) {
				refId = cTplObject.$$_id;
				if ( cTplObject.$$_id == cTplObject._id )
					delete cTplObject._id;
			}
			
			if ( !refId && cTplObject._id ) {
				if ( refs[cTplObject._id] ) {// if there was a previous tpl item with same ref
					tid = refs[cTplObject._id];
				}
				else if ( this._objById[cTplObject._id] ) // keep id if no objects use it
					tid = refs[cTplObject._id] = refId || shortid.generate();// force it if refid = $(id) is specified
				else tid = refs[cTplObject._id] = cTplObject._id;
			}
			else if ( refId && cTplObject._id ) {
				tid = refs[cTplObject._id] = refId;
				aliases.push(cTplObject._id);
				refScope[cTplObject._id] = refId;
			}
			else
				tid = refId || shortid.generate(); // if the node inherit some other node keep his id
			
			// if ( keepRev && cTplObject._rev) {// update max rev
			//     this._rev = Math.max(this._rev, cTplObject._rev);
			// }
			
			if ( isString(refScope[tid]) ) {
				
			}
			
			// now create a pushable object
			cObject = refScope[tid] = refScope[tid] || { _id: tid, _rev: revNum };
			// if (!refScope[tid])
			//     refScope[tid] = cObject;
			
			
			Object.keys(cTplObject).forEach(
				function ( c ) {
					if ( c[0] == '$' ) {// auto ref/mount
						if ( /\$(_incoming|_outgoing|\$?_id)/.test(c) ) return;
						if ( c === "$$_refMap" ) {
							
							if ( me.cfg.isMaster ) {// only the master know the real ids
								pendingRefMaps.push([cTplObject, cTplObject[c], cObject]);
							}
							else {
								// clients keep the map
								// cObject._refMap = cTplObject._refMap;
							}
							return;
						}
						var key = c.substr(1);
						
						if ( c[1] == '$' && isString(cTplObject[c]) ) {// bagRef
							let bagMngr = cTplObject[c] && me._isBagRefs(cTplObject[c]);
							if ( bagMngr ) {// if this is an out ref
								bagRefs[cTplObject[c]] = bagRefs[cTplObject[c]] || { count: 0 };
								bagRefs[cTplObject[c]].count++;
								cObject[c.substr(2)] = cTplObject[c];
								
								// keep ref keys to track them when importing paths
								cObject.__bagRefKeys = cObject.__bagRefKeys || [];
								
								!cObject.__bagRefKeys.includes(c.substr(2))
								&& cObject.__bagRefKeys.push(c.substr(2))
							}
							else // if its a string that's an internal ref
								debug.error("no manager for ref %s", c, cTplObject[c]);
						}
						else if ( isString(cTplObject[c]) ) {
							pendingERefs.push([key, cTplObject[c], cObject]);
						}
						else if ( isObject(cTplObject[c]) ) {
							// a nested object value = a child object to create (Node/Segment/doc);
							// $_id derives its id from a ref, $$_id forces a literal id
							if ( cTplObject[c].$_id ) {
								cTplObject[c]._id = me.getRef(cTplObject[c].$_id, refScope);//@note : cant ref innertpl
							}
							if ( cTplObject[c].$$_id ) {
								cTplObject[c]._id = cTplObject[c].$$_id;//@note : cant ref innertpl
							}
							
							cTplObject[c]._id = cTplObject[c]._id || shortid.generate();
							
							pendingRefs.push([key, cTplObject[c]._id, cObject]);
							stack.push(cTplObject[c]);
						}
						
					}
					else {// simple copy
						if ( /(_incoming|_outgoing|\$?_id)/.test(c) ) return;
						if ( cTplObject[c] !== undefined )
							cObject[c] = cTplObject[c];
					}
				}
			);
			
			// push incomings...
			cTplObject._incoming
			&& stack.push.apply(stack, cTplObject._incoming);
			cTplObject._outgoing
			&& stack.push.apply(stack, cTplObject._outgoing);
		}
		this._taskFlow.wait();
		this._preloadBagRefs(
			bagRefs,
			() => {
				
				pendingRefs.map(function ( ref ) {
					ref[2][ref[0]] = ref[1];// apply inner references
				});
				pendingERefs.map(( ref ) => {
					if ( refs[ref[1]] ) {
						// local alias
						ref[2][ref[0]] = refs[ref[1]];
					}
					else {
						// if ( /_currentTask/.test(ref[1]) )
						ref[2][ref[0]] = me.getRef(
							ref[1],
							refScope,
							null,
							null,
							// required to work when referencing inner tpl from graph items
							( id ) => {
								return (refScope[id] || this.getEtty(id)) && {
									get: ( key ) => (
										refScope[id] && refScope[id].hasOwnProperty(key) ? refScope[id][key]
										                                                 : this.getEtty(id) && this.getEtty(id).get(key)
									),
								}
							}
						)
						;// apply outer references
					}
				});
				// build ref map...
				if ( pendingRefMaps.length ) {
					// Object.keys(refScope).forEach(
					//     function ( id ) {
					//
					//         if ( aliases.includes(id) ) {
					//             refMap[id] = refScope[id];
					//             return null;
					//         }
					//         refMap[id] = refScope[id]._id;
					//     });
					
					pendingRefMaps.map(( ref ) => {
						if ( isString(ref[1]) ) {
							debug.error(me._objById[ref[2]._id] && me._objById[ref[2]._id]._etty._._refMap);
						}
						delete ref[0].$$_refMap;
						ref[2]._refMap = ref[0]._refMap =
							isString(ref[1]) ? {
									...(me._objById[ref[2]._id] && me._objById[ref[2]._id]._etty._._refMap || {}),
									[ref[1]]: { ...refs }
								}
							                 : isObject(ref[1]) ? { ...ref[1], ...refs }
							                                    : { ...refs } // reset with/false
					});
				}
				// we still need to instantiate them..
				Object.keys(refScope).forEach(
					function ( id ) {// 1st pass : the nodes
						
						if ( aliases.includes(id) ) {
							// refMap[id] = refScope[id];
							return null;
						}
						// refMap[id] = refScope[id]._id;
						
						
						if ( me._objById[id] ) {// if this is an existing node
							if ( me._objById[id]._etty._.Node ) {
								
								// do merge with existing
								me._objById[id]._etty.update(refScope[id], me);
								
								me.toggleGraphObjectState(id, "unstable");
								return me._objById[id];
							}
							else pendingObjects.push(id);
						}
						else {
							if ( refScope[id].Node ) {
								refScope[id]._origin = refScope[id]._origin || baseOrigin || targetId;
								me._objById[id]      =
									refScope[id].Node && new Node(refScope[id], me);
								
								
								me._nodes.push(me._objById[id]);
								me._unstable.push(me._objById[id]);
								return me._objById[id];
							}
							else pendingObjects.push(id);
						}
					}
				);
				pendingObjects.map(
					function ( id ) {// 2nd pass : the segments (they will be auto linked to the nodes..)
						if ( refScope[id].targetNode == "initialTarget" )
						revTpl.push(refScope[id]);
						if ( me._objById[id] ) {// the segment/doc exist
							// do merge with existing
							me._objById[id]._etty.update(refScope[id], me);
							
							me.toggleGraphObjectState(id, "unstable");
							return me._objById[id];
						}
						else {
							if ( id.match(/debug/) ) debugger;
							if ( refScope[id].Segment ) {// create the segment
								
								refScope[id]._origin = refScope[id]._origin || baseOrigin || targetId;
								me._objById[id]      = new Segment(refScope[id], me);
								
								me._segments.push(me._objById[id]);
								me._unstable.push(me._objById[id]);
								// me.toggleGraphObjectState(id, "unstable");
								me._objById[id]._etty.updateApplicableConcepts(me);
								return me._objById[id];
							}
							else {// records/docs
								refScope[id]._origin = refScope[id]._origin || baseOrigin || targetId;
								me._objById[id]      = { _etty: new Entity(refScope[id], me) };
								
								me._segments.push(me._objById[id]);
								me._unstable.push(me._objById[id]);
								return me._objById[id];
							}
						}
					}
				);
				delete refScope._parent;
				
				
				this._revs[revNum] = {
					id    : revId,
					parent: targetId,
					bagRefs,
					tpl   : Object.keys(refScope).map(
						id => {
							if ( aliases.includes(id) ) {
								refMap[id] = refScope[id];
								return null;
							}
							refMap[id] = refScope[id]._id;
							let item   = { ...refScope[id] };
							
							item.$$_id = item._id;
							delete item._id;
							return item;
						}
					).filter(i => !!i)
				};
				this._on.mutation
				&& this._on.mutation.map(( cb ) => cb(me));
				this.cfg.onMutationApplied
				&& this.cfg.onMutationApplied(this);
				// concept-apply trace: this mutation was produced by a concept apply
				// (applyCtx threaded from Concept.applyTo). Host/sync mutations have no
				// applyCtx -> no record. prompt/reply are merged from traceProvider.
				if ( applyCtx && (this.cfg.onConceptApply || (this._on && this._on.conceptApply)) ) {
					var _rec = {
						rev        : revNum,
						conceptId  : applyCtx.conceptId,
						conceptName: applyCtx.conceptName,
						targetId   : applyCtx.targetId,
						applyId    : applyCtx.applyId,// joins this trace record to the apply's logs (graph.logger.tail({applyId}))
						kind       : applyCtx.kind,
						patch      : this._revs[revNum] && this._revs[revNum].tpl,
						bagRefs    : this._revs[revNum] && this._revs[revNum].bagRefs,
						ms         : applyCtx.ms,
						why        : applyCtx.why
					};
					var _k = applyCtx.conceptId + '/' + applyCtx.targetId;
					if ( this._traceByApply && this._traceByApply[_k] ) {
						_rec.prompt = this._traceByApply[_k].prompt;
						_rec.reply  = this._traceByApply[_k].reply;
						delete this._traceByApply[_k];
					}
					this.cfg.onConceptApply && this.cfg.onConceptApply(_rec);
					this._on.conceptApply && this._on.conceptApply.slice(0).map(( fn ) => fn(me, _rec));
				}
				this._mutationThreadRunning = false;
				this._taskFlow.release();
				cb && cb(refScope)
				if ( this._mutationThread.length ) {
					this.pushMutation(...this._mutationThread.shift())
				}
				this.stabilize();
				
			}
		);
		
		return refScope;
	},
	
	// -------------------------------------------------------------------------- control
	
	/**
	 * Launch a stabilisation on all unstable objects
	 * then call cb
	 * @param cb
	 */
	stabilize: function ( cb ) {
		var me = this;
		cb && this.on("stabilize", function stabilize() {
			me.un("stabilize", stabilize);
			cb(arguments);
		});
		if ( !this._taskFlow.running ) {
			this._taskFlow.run();
		}
		this._running = true;
		
	},
	/**
	 * Call the sync method passed in the cfg (should send last atoms to the server/client)
	 * @param _cb
	 */
	sync: function ( _cb ) {
		var debug = this._log;
		var me    = this,
		    token = this.cfg.doSync
			    && this.cfg.doSync(this, _cb);
		debug.log('RT Push request:', token);
		
		if ( _cb && token ) {
			this._syncTokens[token] = _cb;
		}
		else _cb && _cb();
	},
	/**
	 * mk all object unstable
	 */
	destabilizeThemAll: function () {
		Object.keys(this._objById).map(( k ) => this.toggleGraphObjectState(k, 'unstable'), this);
	},
	/**
	 * Change some object State (dirty way..)
	 * @param id
	 * @param state
	 * @returns {boolean}
	 */
	toggleGraphObjectState: function ( id, state ) {
		var i,
		    out1, out2, in1,
		    obj = this._objById[id];
		
		if ( state == "stable" )
			out1 = this._pending,
				out2 = this._unstable,
				in1 = this._stable;
		else if ( state == "pending" )
			out1 = this._stable,
				out2 = this._unstable,
				in1 = this._pending;
		else if ( state == "unstable" )
			out1 = this._stable,
				out2 = this._pending,
				in1 = this._unstable;
		else
			return false;
		
		if ( (i = out1.indexOf(obj)) != -1 )
			out1.splice(i, 1);
		else if ( (i = out2.indexOf(obj)) != -1 )
			out2.splice(i, 1);
		else
			return false;
		
		in1.push(obj);
		return true;
	},
	
	// -------------------------------------------------------------------------- accessors
	
	/**
	 * get a resultpath (paths from getPaths) and return an PathMap object
	 * @param id
	 * @returns {*|null}
	 */
	getOpenPathOf     : function ( id ) {
		return this._objById[id]
			&& this._objById[id]._etty._.OpenPaths
			&& new PathMap(this._objById[id]._etty._.OpenPaths, this._objById[id]._etty);
	},
	removeObj         : function ( id, justClean ) {
		var obj = this._objById[id], i;
		i       = this._pending.indexOf(obj);
		(i != -1) && this._pending.splice(i, 1);
		i = this._unstable.indexOf(obj);
		(i != -1) && this._unstable.splice(i, 1);
		i = this._stable.indexOf(obj);
		(i != -1) && this._stable.splice(i, 1);
		delete this._objById[id];
		!justClean && obj._etty.destroy(true);
	},
	getConcept        : function ( id ) {
		return this._conceptLib[id];
	},
	getExtOpenConcepts: function ( id ) {
		if ( this._objById[id] ) {
			this._objById[id]._etty.updateApplicableConcepts();// update in case of ..
			return this._objById[id]._etty._extOpenConcepts;
		}
		return [];
	},
	
	// --- kept for reference (R&D): travel-domain path-merge / TimePeriod rollup ---
	// Application-specific (Stay/Travel/childPaths/UserRecord); not part of the V1 core
	// stabilization path. Retained as a worked example of collapsing a discovered path
	// (Graph.getPaths) back into the graph as a single segment with child paths.
	pushPath: function ( path, edgeId, name, cb ) {
		var debug = this._log;
		var
			me                = this,
			scope             = this.getEtty(edgeId),
			// cmaps        = path._pmap.maps,
			getAllPropsInPath = PathMap.prototype.getAllPropsInPath,
			tm                = getAllPropsInPath(path, "TimePeriod"),
			originId          = getAllPropsInPath(path, ["_id", "isTravelStart"])[0],
			travelEnds        = getAllPropsInPath(path, ["_id", "isTravelEnd"]),
			targetId          = travelEnds[travelEnds.length - 1],
			pathId            = shortid.generate(),
			tpl               = path.tpl.map(( obj ) => ({ ...obj, pathId })),
			rpath,
			originSrc         = scope.getRef('originNode'),
			originTarget      = scope.getRef('targetNode'),
			tId               = tpl[1]._id,
			tId2              = tpl[tpl.length - 2]._id;//shortid.generate();
		
		// rm origin target & origin
		// tpl.shift();
		tpl.shift();
		tpl.pop();
		// tpl.pop();
		// tpl = tpl
		tpl[0].originNode              = scope._.originNode;
		tpl[tpl.length - 1].targetNode = scope._.targetNode;
		//this.pushMutationFromPath(tpl, path.descr, edgeId);
		rpath = [
			...path.relatedTpl.map(
				( m ) => {
					return { ...m, $_id: '$' + m._id };// use the existing one if exist
				}
			),
			...this.getMutationFromPath(tpl, path.descr, edgeId),
			{
				$_id     : '$' + edgeId,
				OpenPaths: false,
				// Stay        : null,
				// Travel      : null,
				PathIgnore: !scope._.KeepInPath,// <- /!\ this will hide the segment in the debug graph and navline
			                                    // paths
				// targetNode  : originTarget,
				// originNode  : null,
				childPaths: {
					...(scope._.childPaths || {}),
					[name]: pathId
				},
				TimePeriod: null
			},
			{
				$_id        : "$UserRecord",
				loadingSteps: false,
				// cFocusedEdge : tId2,
				staysCount: me.selectMapsId(["Stay"], ["VendorStep"]).length
			}
		];
		// if (
		//     scope._.targetNode == "target" ||
		//     (scope.getRef("targetNode:Theoric") && edgeId !== "_root" && !scope.getRef("originNode:Theoric") )
		// ) {// root must move the initial seg
		debug.verbose("pushPath rpath", rpath)
		
		this.pushMutation(
			rpath,
			edgeId
		);
		// --- kept for reference (R&D): the alternate root-segment-moving branch ---
		// } else
		//     this.pushMutation(
		//         [
		//
		//             // {
		//             //     $_id    : '$' + tId,
		//             //     _origin : '_root',
		//             // },
		//             // {
		//             //     $_id        : '$' + tId2,
		//             //     "Undefined" : true,
		//             //     _origin     : '_root',
		//             //     // fxdhfgdgfhdgdg: targetId._id
		//             // },
		//             {
		//                 $_id        : '$' + edgeId,
		//                 OpenPaths : false,
		//                 // Stay        : null,
		//                 // Travel      : true,
		//                 // targetNode  : targetId._id,
		//                 Undefined   : false,
		//                 childPaths  : {
		//                     ...(scope._.childPaths || {}),
		//                     [name || pathId] : pathId
		//                 },
		//                 // TimePeriod  : null
		//             },
		//             {
		//                 $_id         : "$UserRecord",
		//                 loadingSteps : false,
		//                 cFocusedEdge : tId2,
		//                 staysCount   : me.selectMapsId(["Stay"], ["VendorStep"]).length
		//             }
		//         ],
		//         edgeId
		//     );
		this.stabilize(() => {
			let newPath  = this.getChildPath(edgeId),
			    nextTheo = newPath.reduce(( r, item ) => (item._etty._.Undefined && item._etty._._id || r), edgeId);
			
			
			cb && cb(nextTheo, newPath);
		});
	},
	/**
	 *
	 * @param origin
	 */
	getChildMatching: function ( edgeId, query ) {
		let newPath  = this.getChildPath(edgeId),
		    fn       = compileScopeQuery(query, false),
		    nextTheo = newPath.filter(( item ) => fn(item._etty));
		
		return nextTheo
	},
	/**
	 *
	 * @param origin
	 */
	isTheoricChildOf: function ( cId, pId ) {
		let child   = this.getEtty(cId),
		    current = child;
		
		while ( current ) {
			if ( current._._id == pId )
				return true;
			
			current = this.getEtty(current._._origin);
		}
		return false;
	},
	/**
	 *
	 * @param origin
	 */
	getChildPath: function ( origin, forceNoTheoric, idOnly ) {
		var debug = this._log;
		// we want paths
		var map                   = this._objById,
		    including             = isArray(forceNoTheoric) && forceNoTheoric.length ? forceNoTheoric : false,
		    edge                  = map[origin || "_root"],
		    from                  = origin && edge._etty.getRef('originNode') || "start",
		    to                    = origin && edge._etty.getRef('targetNode') || "target",
		    cnode = from, i, path = [from], found, sid, nid, subPath, cEdge;
		// forceNoTheoric            = including;
		
		// origin = origin || "_root";
		do {
			found = false;
			for ( i = 0; i < map[cnode]._outgoing.length; i++ ) {
				sid   = map[cnode]._outgoing[i];
				nid   = map[sid]._etty._.targetNode;
				cEdge = map[sid]._etty._;
				
				if ( sid == origin && map[cnode]._outgoing.length > 1 ) continue;
				
				if ( (!cEdge.PathIgnore || (cEdge.PathIgnore && cEdge.KeepInPath)) && cEdge._origin == origin ) {
					if ( path.indexOf(nid) != -1 ) debug.error("This graph have loops", path, nid);
					
					if ( cEdge.Theoric && forceNoTheoric && (!including || including.includes(cEdge._id)) ) {// so get the complete child path
						subPath = this.getChildPath(sid, true, true);
						if ( subPath.length ) {
							subPath.shift();
							path.push(...subPath);
						}
						else
							path.push(sid, nid);
					}
					else
						path.push(sid, nid);
					
					cnode = nid;
					found = true;
					break;
				}
				else {
					continue;
				}
				
				if ( cnode === to )
					break;
			}
			
			if ( !found ) {// take first
				sid = map[cnode]._outgoing[0];
				
				if ( sid == origin ) sid = map[cnode]._outgoing[1];
				
				if ( !sid ) {
					return [];
				}
				
				path.push(sid, map[sid]._etty._.targetNode);
				cnode = map[sid]._etty._.targetNode;
				found = true;
			}
			
			if ( cnode === to )
				break;
		} while ( 1 );
		// if ( origin == "_root" )
		
		
		return idOnly && path || path.map(( id ) => map[id]);
	},
	
	/**
	 * Get a all paths between fromId&toId & return them in json
	 * @param fromId
	 * @param toId
	 * @param ignoreMissing
	 * @returns {{maps: {}, paths: Array}}
	 */
	getPaths: function ( fromId, toId, skip ) {
		var debug = this._log;
		var map      = this._objById,
		    cmaps    = {},
		    start    = this._objById[fromId],
		    end      = this._objById[toId],
		    paths    = [],
		    stack    = [],
		    skipping = skip || [],
		    related,
		    haveNoTheoric,
		    cpath    = [fromId],
		    cnode, i, newPath, sid, nid;
		
		if ( !map[fromId] )
			debug.error(this._id, "GetPath from node can't be found in the graph", fromId);
		if ( !map[toId] )
			debug.error(this._id, "GetPath from node can't be found in the graph", toId);
		if ( !map[toId] || !map[fromId] )
			return {
				maps : cmaps,
				paths: paths
			};
		cmaps[fromId] = { ...map[fromId]._etty._ };
		
		do {
			cnode         = cpath[cpath.length - 1];//last is node
			haveNoTheoric = map[cnode]._outgoing.reduce(
				( p, c ) => {
					return p || !map[c]._etty._.Theoric
				}, false);// knowing if there only theoric ways
			
			for ( i = 0; i < map[cnode]._outgoing.length; i++ ) {
				newPath = cpath.slice();
				sid     = map[cnode]._outgoing[i];
				nid     = map[sid]._etty._.targetNode;// node
				
				// ignore theoric if possible
				if ( haveNoTheoric && map[sid]._etty._.Theoric )
					continue;
				
				// ignore theoric if possible
				if ( skipping.includes(sid) )
					continue;
				
				if ( (related = map[sid]._etty._.pathDescriptor) && map[related] ) {
					do {
						cmaps[related] = { ...map[related]._etty._ };
					} while ( related = map[related] && map[related]._etty._.parentPathDescriptor );// assume broken
				                                                                                    // refs are good in
				                                                                                    // other graphs
				}
				
				if ( (related = map[sid]._etty._._origin) && map[related] ) {// add _origin ( the theoric which has generated this segment )
					
					do {
						// if (map[related] && map[related]._etty._.thisOne)
						
						if ( skipping.includes(related) )
							break;
						
						cmaps[related] = { ...map[related]._etty._ };
						related        = map[related] && map[related]._etty._._origin
						
					} while ( related && map[related] && !cmaps[related] );
				}
				
				newPath.push(sid, nid);
				
				if ( !cmaps[sid] )
					cmaps[sid] = { ...map[sid]._etty._ };
				// if ( !cmaps[nid] && !map[nid]){
				//         nid,
				//         map[sid]._etty._
				//     )
				// }
				if ( !cmaps[nid] )
					cmaps[nid] = { ...map[nid]._etty._ };
				
				if ( nid === toId )
					paths.push(newPath);
				else
					stack.push(newPath);
			}
			
			if ( !stack.length ) break;
			cpath = stack.shift();
		} while ( 1 );
		
		return {
			maps : cmaps,
			paths: paths
		};
	},
	
	/**
	 * We need to know if a vendor record is mounted from some point,
	 * or we'll not have any method to know if a vendorRecord is still available
	 *
	 * @param to
	 * @param manager  // should contain getFormByRecordId, checkRecordValidityById, ...
	 */
	registerVendorRecordByKey: function ( to, manager ) {
	},
	/**
	 * Get an object by his id
	 * @param id
	 * @returns {*}
	 */
	getObjById: function ( id ) {
		return this._objById[id];
	},
	
	/**
	 * Get the concept map by his id
	 * @param id
	 * @returns {*}
	 */
	getEtty: function ( id ) {
		return this._objById[id] && this._objById[id]._etty;
	},
	/**
	 * Select all node that match the query
	 * @param _with Array
	 * @param _without Array
	 * @returns {array|*|Array}
	 */
	queryMaps: function ( query ) {
		
		var me   = this,
		    maps = this._objById,
		    fn   = compileScopeQuery(query, true)
		
		
		;
		return Object.keys(maps).map(( k ) => maps[k]._etty).filter(fn);
		
	},
	/**
	 * Select all node with _with prop but whithout _whithout props
	 * @param _with Array
	 * @param _without Array
	 * @returns {array|*|Array}
	 */
	selectMaps: function ( _with, _without ) {
		var me = this;
		return this.selectMapsId(_with, _without).map(( v ) => me._objById[v] && me._objById[v]._etty);
		
	},
	
	/**
	 * Select all node id with _with prop but whithout _whithout props
	 * @param _with Array
	 * @param _without Array
	 * @returns {array|*|Array}
	 */
	selectMapsId: function ( _with, _without ) {
		var i = 0, me = this, maps = this._mapsByConcept,
		    _with                  = isArray(_with) ? _with : [_with],
		    _have,
		    _without               = isArray(_without) ? _without : [_without];
		
		
		_with.map(( v ) => maps[v] && (_have = intersect(_have || maps[v], maps[v])));
		_have && _without.map(( v ) => maps[v] && (_have = arrayDiffer(_have, maps[v])));
		
		
		return _have || [];
		
	},
	
	// -------------------------------------------------------------------------- events
	
	on: function ( evt, cb ) {
		if ( !isFunction(cb) ) throw 'wtf';
		
		this._on[evt] = this._on[evt] || [];
		this._on[evt].push(cb);
		
	},
	un: function ( evt, cb ) {
		//this._on[evt] = this._on[evt]||[];
		if ( !this._on[evt] ) return;
		var i = this._on[evt].indexOf(cb);
		this._on[evt].splice(i, 1);
	},
	/**
	 * Provider trace hook: lets a provider report the prompt/reply (or any extra
	 * payload) it produced for the current apply, WITHOUT coupling the engine to
	 * providers. No-op unless a concept-apply trace sink is configured. The payload
	 * is merged into the trace record emitted when the provider's mutation lands.
	 * Keyed by concept+target so concurrent async providers don't collide.
	 * @param concept the concept (provider's 2nd arg)
	 * @param scope   the scope Entity (provider's 3rd arg)
	 * @param payload e.g. { prompt, reply }
	 */
	traceProvider: function ( concept, scope, payload ) {
		if ( !this.cfg.onConceptApply && !(this._on && this._on.conceptApply) ) return;
		(this._traceByApply = this._traceByApply || {})[concept._id + '/' + scope._._id] = payload;
	},
	/**
	 * Called once stabilized
	 * @private
	 */
	_applyStabilized: function () {
		this._log.verbose('graph settled (fixpoint reached)');
		var me           = this;
		this._stabilized = true;
		this._stabilizing = false;// pass complete — host ops (incl. those issued from onStabilize) apply immediately again
		this._applyCount = {};// healthy settle ends the episode — clear the per-(target/concept) apply tally (#11.c.1)
		this._lastSettledRev = this.getCurrentRevision();// last clean checkpoint (has a snapshot) for a reactive supervisor's rollback (#11.c.4)
		me._running      = false;
		// me._rev++;// graph inst revision
		this._captureSnapshot();// checkpoint this coherent state so rollbackTo() can restore it
		this._on.stabilize
		&& this._on.stabilize.slice(0).map(( cb ) => cb(me, me._syncTokensList));
		this.cfg.onStabilize
		&& this.cfg.onStabilize(this, me._syncTokensList);
		me._syncTokensList = [];
	},
	history_push    : function ( mutation, targetId, isStep ) {
	},
	history_goto    : function ( to ) {
		return this.rollbackTo(to);
	},
	// -------------------------------------------------------------------------- rollback
	/**
	 * Checkpoint the current stabilized (coherent) state so rollbackTo() can
	 * restore it later. Keyed by the current revision; no-op if already captured.
	 * Snapshots are full serialized states (delta replay is left for later).
	 * @private
	 */
	_captureSnapshot: function () {
		this._snapshots = this._snapshots || {};
		var rev = this.getCurrentRevision();
		if ( !this._snapshots[rev] ) {
			var snap = this.serialize();// { lastRev, graph } — the FACT state
			// N6 (#11.c.2): also snapshot the FULL live concept schema tree, so rollbackTo()
			// restores the rules (runtime add/patchConcept), not just the facts. Cached and
			// invalidated on each concept-lib edit, so unchanged libs aren't re-serialized.
			snap.concepts = this._conceptSnapshot || (this._conceptSnapshot = this._serializeConceptTree());
			this._snapshots[rev] = snap;
		}
	},
	/**
	 * Serialize the LIVE concept tree (reflecting runtime add/patchConcept) into a nested
	 * record `new Concept(...)` can rebuild — walking `_openConcepts` (so adds are caught)
	 * and reading each concept's current `_schema` (so patches are caught; the parent's
	 * `_schema.childConcepts` is NOT authoritative after a patch). JSON-cloned (schemas are
	 * JSON-safe: providers are string refs, no functions). (#11.c.2 / N6)
	 */
	_serializeConceptTree: function () {
		function ser( c ) {
			var out = {}, s = c._schema || {};
			Object.keys(s).forEach(function ( k ) { if ( k !== 'childConcepts' ) out[k] = s[k]; });
			if ( c._openConcepts ) {
				var ids = Object.keys(c._openConcepts);
				if ( ids.length ) {
					out.childConcepts = {};
					ids.forEach(function ( id ) { out.childConcepts[id] = ser(c._openConcepts[id]); });
				}
			}
			return out;
		}
		return JSON.parse(JSON.stringify(ser(this._rootConcept)));
	},
	/**
	 * Rebuild the concept library from a snapshotted schema tree (deep-cloned so later
	 * edits don't mutate the stored snapshot). Used by rollbackTo. (#11.c.2 / N6)
	 */
	_restoreConceptTree: function ( tree ) {
		this._conceptLib  = {};
		this._mapsByConcept = this._mapsByConcept || {};
		this._rootConcept = new Concept(JSON.parse(JSON.stringify(tree)), this);
		this._conceptSnapshot = null;// the live lib changed — force a fresh capture next settle
	},
	/**
	 * @returns {number[]} revisions available to rollbackTo(), ascending
	 */
	getRevisions: function () {
		return Object.keys(this._snapshots || {}).map(Number).sort(( a, b ) => a - b);
	},
	/**
	 * The serialized snapshot captured at `revisionNumber` (as serialize() yields:
	 * `{ lastRev, graph: "<json>" }`), or null if no snapshot was captured for it.
	 * @param revisionNumber
	 */
	getSnapshot: function ( revisionNumber ) {
		return (this._snapshots && this._snapshots[revisionNumber]) || null;
	},
	/**
	 * Parse a snapshot into a { objectId -> facts } map (the serialized
	 * conceptMaps, keyed by _id). `_rev` is dropped (volatile per-object marker).
	 * @private
	 */
	_snapshotFacts: function ( snap ) {
		var maps = (JSON.parse(snap.graph).conceptMaps) || [], by = {};
		maps.forEach(function ( m ) {
			var f = {};
			Object.keys(m).forEach(function ( k ) { if ( k !== '_rev' ) f[k] = m[k]; });
			by[m._id] = f;
		});
		return by;
	},
	/**
	 * Diff two captured revisions: what revision `b` added / removed / changed
	 * versus revision `a`. The inspection layer of "Git for reasoning".
	 *
	 * @param a revision (from getRevisions())
	 * @param b revision (from getRevisions())
	 * @returns {{added:Object, removed:Object, changed:Object}}
	 *   added/removed: { id -> facts }; changed: { id -> { key -> [beforeVal, afterVal] } }
	 * @throws if either revision has no snapshot
	 */
	diffRevisions: function ( a, b ) {
		var snapA = this.getSnapshot(a), snapB = this.getSnapshot(b);
		if ( !snapA ) throw new Error("diffRevisions: no snapshot for revision " + a);
		if ( !snapB ) throw new Error("diffRevisions: no snapshot for revision " + b);

		var fa = this._snapshotFacts(snapA), fb = this._snapshotFacts(snapB),
		    added = {}, removed = {}, changed = {};

		Object.keys(fb).forEach(function ( id ) { if ( !fa[id] ) added[id] = fb[id]; });
		Object.keys(fa).forEach(function ( id ) { if ( !fb[id] ) removed[id] = fa[id]; });
		Object.keys(fa).forEach(function ( id ) {
			if ( !fb[id] ) return;
			var keys = {}, d = {};
			Object.keys(fa[id]).forEach(function ( k ) { keys[k] = 1; });
			Object.keys(fb[id]).forEach(function ( k ) { keys[k] = 1; });
			Object.keys(keys).forEach(function ( k ) {
				if ( JSON.stringify(fa[id][k]) !== JSON.stringify(fb[id][k]) )
					d[k] = [fa[id][k], fb[id][k]];
			});
			if ( Object.keys(d).length ) changed[id] = d;
		});
		return { added: added, removed: removed, changed: changed };
	},
	/**
	 * Roll the whole graph back to a previously stabilized revision: re-mount that
	 * snapshot and re-stabilize (re-fires onStabilize). Snapshots strictly after
	 * `revisionNumber` are discarded — this is a linear undo, the restored timeline
	 * replaces the abandoned one.
	 *
	 * @param   revisionNumber  a revision from getRevisions() / getCurrentRevision()
	 * @returns {number} the restored revision
	 * @throws  {Error} if no snapshot exists for that revision
	 */
	rollbackTo: function ( revisionNumber ) {
		var snap = this._snapshots && this._snapshots[revisionNumber];
		if ( !snap )
			throw new Error("rollbackTo: no snapshot for revision " + revisionNumber +
			                " (available: " + this.getRevisions().join(', ') + ")");

		// N6 (#11.c.2): restore the concept LIBRARY first (before mount re-evaluates objects
		// against it), so a runtime add/patchConcept made after this rev is undone too — else
		// a surviving concept re-casts and the rolled-back edit "resurrects".
		if ( snap.concepts ) this._restoreConceptTree(snap.concepts);

		// Issued mid-stabilize (e.g. from a supervisor concept's provider)? Defer to the
		// quiescent _loopTF boundary — rollbackTo re-mounts, which must not happen mid-pass
		// (#11.c.4). Multiple requests collapse to the EARLIEST rev (roll back furthest).
		if ( this._stabilizing ) {
			this._pendingRollback = (this._pendingRollback == null)
				? revisionNumber : Math.min(this._pendingRollback, revisionNumber);
			return revisionNumber;
		}

		this._doRollback(revisionNumber);
		this._taskFlow.run();// re-stabilize -> re-fires _applyStabilized / onStabilize
		this._running = true;
		return revisionNumber;
	},
	/**
	 * The re-mount body of rollbackTo WITHOUT the stabilize kick — restore the concept
	 * lib (N6) then the facts, and drop the abandoned future. Used by the public method
	 * (host path, then kicks) and by the mid-stabilize drain (`_loopTF`, no kick — the
	 * re-arm re-stabilizes since mount leaves objects unstable). (#11.c.4)
	 */
	_doRollback: function ( revisionNumber ) {
		var me   = this,
		    snap = this._snapshots && this._snapshots[revisionNumber];
		if ( !snap ) return;
		if ( snap.concepts ) this._restoreConceptTree(snap.concepts);// N6: rules first
		this.mount(JSON.parse(snap.graph));// rebuild _objById at that rev, mark unstable, set _rev
		Object.keys(this._snapshots).forEach(function ( r ) {
			if ( Number(r) > revisionNumber ) delete me._snapshots[r];// drop the abandoned future
		});
		this._stabilized = false;
	},
	// -------------------------------------------------------------------------- fork / merge
	/**
	 * Fork an independent child Graph (a sub-agent sandbox) to develop a path /
	 * sub-problem on its own, optionally with a different concept set (= different
	 * capabilities). Reuses this graph's concept library unless `conf.conceptMap`
	 * overrides it. Thin wrapper over `new Graph(...)` — no new core machinery.
	 *
	 * @param seed  serialized graph / {conceptMaps|nodes|segments} seeding the child;
	 *              omitted -> forks this graph's current snapshot (serialize()).
	 * @param conf  cfg overrides merged onto this graph's cfg. Extras:
	 *              `conceptMap` (override library); `reintegrateInto` (targetId) +
	 *              `project` -> auto-merge the child's result back here on its stabilize.
	 * @returns {Graph} the child graph
	 */
	fork: function ( seed, conf ) {
		var me              = this;
		conf                = conf || {};
		var reintegrateInto = conf.reintegrateInto,
		    project         = conf.project,
		    userOnStabilize = conf.onStabilize,
		    conceptMap      = conf.conceptMap || this._conceptMap;

		var childConf = { ...this.cfg, isMaster: true, autoMount: true, ...conf };
		delete childConf.reintegrateInto;
		delete childConf.project;
		delete childConf.conceptMap;

		if ( reintegrateInto != null ) {
			childConf.onStabilize = function ( child, tokens ) {
				userOnStabilize && userOnStabilize(child, tokens);
				if ( !child._merged ) {
					child._merged = true;
					me.merge(child, reintegrateInto, project);
				}
			};
		}

		var record = seed || JSON.parse(this.serialize().graph);
		var child  = new this.static(record, childConf, conceptMap);
		(this._forks = this._forks || []).push(child);
		return child;
	},
	/**
	 * Reintegrate a forked child's result into this graph: apply project(child) (a
	 * mutation template) onto `targetId`, then destroy the child.
	 *
	 * @param child     a Graph returned by fork()
	 * @param targetId  the object in THIS graph to merge the result onto
	 * @param project   (child) -> mutation template; default attaches child.serialize()
	 * @returns {Graph} this
	 */
	merge: function ( child, targetId, project ) {
		var tpl = project
			? project(child)
			: { $$_id: targetId, forkResult: JSON.parse(child.serialize().graph) };
		if ( tpl ) this.pushMutation(tpl, targetId, true);

		var i = this._forks ? this._forks.indexOf(child) : -1;
		if ( i !== -1 ) this._forks.splice(i, 1);
		child && !child._dead && child.destroy && child.destroy();
		return this;
	},
	/**
	 * clean & unref
	 */
	destroy: function () {
		this._taskFlow.kill();
		var me = this;
		this._on.destroy
		&& this._on.destroy.slice(0).map(( cb ) => cb(me));
		Object.keys(this._objById).map(
			( k ) => me._objById[k].destroy ? me._objById[k].destroy() : me._objById[k]._etty.destroy());
		this._freeNodes = this._nodes = this._objById = me._conceptLib = me._syncTokens =
			me._syncTokensList = this._segments =
				this._rootConcept = this._mapsByConcept = this._on =
					this._history = this._unstable = this._pending = this._stable = this._objById = this._pendingMutationsById = null;
		this._dead      = true;
	}
};

// The debugger/host logging interface: graph.logger.addSink(fn) / removeSink /
// tail(n, {concept|target|applyId|level}) / records / setLevel(name). Logs live
// here (bounded ring buffer + sinks), never as facts on the graph objects.
Object.defineProperty(Graph.prototype, 'logger', { get: function () { return this._log; } });

module.exports = Graph;