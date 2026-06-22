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


var isArray    = require('is').array;
var isFunction = require('is').fn;
var isString   = require('is').string;
var { compileExpression } = require('../expr');
var shortid    = require('shortid');

// Wrap a query (string | array | fn) into a predicate fn(me, map) that resolves
// $refs via me.getRef(ref, map) — replaces the old `new Function` query compiler.
function compilePathQuery ( query ) {
	if ( isFunction(query) ) return query;
	var _q = compileExpression(query, { empty: true });
	return function ( me, map ) {
		return _q(function ( ref ) { return me.getRef(ref, map); });
	};
}

// A read-side view over the result of Graph.getPaths: a set of object "maps" plus the
// paths (sequences of object ids) found between two nodes. It lets a host SELECT a
// subset of paths (by required/excluded properties or a query) and EXTRACT per-path
// shape/transport/descriptors. Not part of stabilization — it consumes a stabilized
// graph. (PathMap is the constructor arg name too; `this._` holds {maps, paths}.)
function PathMap( PathMap, graph, pathOrigin ) {
	this.init(PathMap, graph, pathOrigin);
};
PathMap.fromPath  = function ( path ) {
	let tpl = isString(path.tpl) ? JSON.parse(path.tpl) : path.tpl,
	    pm  = new PathMap(
		    {
			    maps : [...(path.relatedTpl || []), ...(path.descr || []), ...(tpl || [])],
			    paths: tpl.map(m => m._id)
		    });
	return pm;
};
PathMap.prototype = {
	/**
	 *
	 * @param PathMap : serialized path list from graph:getPaths
	 */
	init: function ( PathMap ) {
		this._         = PathMap;
		this._._id     = this._._id || shortid.generate();
		this._selected = [];
		this._paths    = [];
		
		this.mount();
		//if ( this._.skycube ) {
		//	this.skycube = new Skycube(this._.skycube);
		//}
	},
	/**
	 * Get every cbox/cbox socpe with 'p' conceptKey
	 * @param p
	 * @param map Get the hashMap instead of the cbox
	 * @returns {Array}
	 */
	mount: function ( p, map ) {
		
		var i     = 0, p,
		    lib   = this._.maps,
		    ni,
		    map,
		    ptest = true,
		    cpath;
		
		for ( ; i < this._.paths.length; i++ ) {
			p     = this._.paths[i];
			cpath = [];
			ptest = false;
			for ( ni = 0; ni < p.length; ni++ ) {
				cpath.push(lib[p[ni]]);
			}
			this._paths[i] = cpath;
		}
		return this;
	},
	
	/**
	 * Get every cbox/cbox socpe with 'p' conceptKey
	 * @param p
	 * @param map Get the hashMap instead of the cbox
	 * @returns {Array}
	 */
	getAll: function ( p, map ) {
		var s = [];
		for ( var o in this._.maps ) {
			if ( this._.maps.hasOwnProperty(o) && this._.maps[o][p] )
				s.push(map && this._.maps[o] || this._.maps[o][p]);
		}
		return s;
	},
	/**
	 * Do select paths with one of '_width' props and not '_without' props
	 * @param _with
	 * @param _without
	 * @returns {PathMap}
	 */
	selectPathsFromReducer: function ( fn, def = true ) {
		var i               = 0, p,
		    lib             = this._.maps,
		    ni,
		    map,
		    ptest           = true,
		    test            = true,
		    push            = Array.prototype.push,
		    selectedMapWith = {},
		    selected        = [],
		    selectedPOI     = [],
		    cpath;
		
		// debugger;
		
		for ( ; i < this._.paths.length; i++ ) {
			cpath = this._.paths[i].map(( mId ) => lib[mId]);
			if ( cpath.reduce(fn, def) )
				selected.push(i);
		}
		
		this._selected = selected;
		return this;
	},
	/**
	 * Do select paths with one of '_width' props and not '_without' props
	 * @param _with
	 * @param _without
	 * @returns {PathMap}
	 */
	selectPaths: function ( _with, _without ) {
		var i               = 0, p,
		    lib             = this._.maps,
		    ni,
		    map,
		    ptest           = true,
		    test            = true,
		    push            = Array.prototype.push,
		    selectedMapWith = {},
		    selected        = [],
		    selectedPOI     = [],
		    cpath;
		_with               = _with || [];
		_without            = _without || [];
		
		// debugger;
		
		for ( ; i < this._.paths.length; i++ ) {
			p     = this._.paths[i];
			cpath = [];
			ptest = false;
			test  = true;
			for ( ni = 0; ni < p.length; ni++ ) {
				map = lib[p[ni]];
				
				_with.forEach(( k ) => {
					ptest              = ptest || map.hasOwnProperty(k)
					selectedMapWith[k] = selectedMapWith[k] || [];
					selectedMapWith[k].push(map)
				});
				
				_without.forEach(( k ) => test = test && !map.hasOwnProperty(k));
				cpath.push(map);
				//ptest = ptest&&test;
				if ( !test ) break;
			}
			if ( ptest && test ) {
				selected.push(i);
				push.apply(selectedPOI, cpath);
			}
		}
		this._selected        = selected;
		this._selectedMapWith = selectedMapWith;
		this._selectedPOI     = selectedPOI;
		return this;
	},
	/**
	 * Do select paths with one of it's maps that match query
	 * @param query
	 * @returns {PathMap}
	 */
	selectPathsFromQuery: function ( query ) {
		var i               = 0, p,
		    lib             = this._.maps,
		    ni,
		    map,
		    ptest           = true,
		    test            = true,
		    push            = Array.prototype.push,
		    selectedMapWith = {},
		    selected        = [],
		    selectedPOI     = [],
		    cpath,
		    fn              = compilePathQuery(query);
		
		for ( ; i < this._.paths.length; i++ ) {
			p     = this._.paths[i];
			cpath = [];
			ptest = true;
			for ( ni = 0; ni < p.length; ni++ ) {
				map = lib[p[ni]];
				if ( !fn(this, map) ) {
					ptest = false;
					// console.log("Path %d have match on ", i, map)
					break;
				}
				;
			}
			if ( ptest ) {
				selected.push(i);
				// push.apply(selectedPOI, cpath);
			}
		}
		// this._selectedId      = selected;
		this._selected        = selected;
		this._selectedMapWith = selectedMapWith;
		// this._selectedPOI = selectedPOI;
		return this;
	},
	
	/**
	 * Select all node that match the query in a path
	 * @param path {Array|int} the path were to search
	 * @param query {fn|string} query of function that select the maps
	 * @returns {array|*|Array}
	 */
	queryMapsOnPath: function ( path, query ) {
		
		var me       = this,
		    selected = path._isPath ? path.tpl : this._paths[path] || [],
		    maps     = this._.maps,
		    fn       = compilePathQuery(query)
		
		
		;
		// debugger;
		return selected.filter(( v ) => fn(me, v));
		
	},
	/**
	 * Get all props in a path
	 *
	 * if _props is a string this will return an array of value if not hashmaps
	 *
	 *
	 * @param i : selected path number or the path itself
	 * @param _props {array|string} the wanted props
	 * @param mapFn {function} optional function to apply on the results
	 * @returns {*}
	 */
	getAllPropsInPath: function ( i, _props, mapFn ) {
		_props         = isArray(_props) ? _props : _props && [_props] || [];
		var c,
		    // lib        = this._.maps,
		    pln        = _props.length,
		    test       = true,
		    selected   = pln && i._isPath ? i.tpl : this._paths[i] || [],
		    propsStack = [],
		    props, value;
		
		(pln > 1) ? selected.forEach(( map ) => {
			          props = {};
			          c     = 0;
			          _props.forEach(( k ) => (map[k] && (c++, props[k] = map[k])));
			          (pln == c) && propsStack.push(props);
		          })
		          : selected.forEach(( map ) => {
			          props = null;
			          c     = 0;
			          _props.forEach(( k ) => (map[k] && (c++, props = map[k])));
			          c && propsStack.push(props);
		          });
		if ( mapFn ) {
			// debugger;
			propsStack.forEach(( v ) => value = mapFn(value, v));
			return value;
		}
		return propsStack;
	},
	/**
	 * Get a serialized specific path by his selected id,
	 * Add available descriptors
	 * @param i
	 * @returns {{_pmap: PathMap, tpl: *, descr: *}}
	 */
	getPath         : function ( i ) {
		var path        = this._paths[i] || [],
		    lib         = this._.maps,
		    relatedById = {},
		    related     = [];
		path.forEach(
			( map ) => {
				if ( relatedById[map._origin] ) return;
				while ( map && map._origin ) {
					relatedById[map._origin] = lib[map._origin] || true;// missing silently?
					lib[map._origin] && related.push(lib[map._origin]);
					if ( map == lib[map._origin] ) break;
					map = lib[map._origin]
				}
			}
		);
		return {
			_id: this._._id + '::' + i,// should be an unique key sync to the query graph params or an unique
		                               // path hash
			_isPath   : true,
			tpl       : path,
			relatedTpl: related,//@todo add bagrefs
			
			transportTypes: this.extractTransportTypes(path, related),
			shape         : this.extractShape(path, related),
			descr         : this.getPathDescriptor(i)
		};
	},
	getPaths        : function () {
		return this._paths
			&& this._paths.map(( p, i ) => this.getPath(i)) || [];
	},
	getSelectedPaths: function () {
		return this._selected
			&& this._selected.map(this.getPath.bind(this)) || [];
	},
	
	extractShape( path, related ) {
		let shapes = [], prec, next;
		// debugger;
		path &&
		path.map(
			( map, i ) => {
				let lastShape, dur;
				prec = i && path[i - 1];
				next = path[i + 1];
				if ( map.Segment ) {
					dur = map.DefaultDuration || map.TimePeriod && map.TimePeriod.duration && map.TimePeriod.duration.ms || 60000;
					if ( map.shape ) {
						lastShape = {
							_origin: map._id,
							// etty          : map,
							duration     : dur,
							transportType: map.transportType || 'pedestrian',
							related      : [],
							shape        : map.shape
						}
						shapes.push(lastShape);
					}
					else if ( dur ) {
						
						lastShape = {
							_origin: map._id,
							// etty          : map,
							duration     : dur,
							transportType: map.transportType || 'pedestrian',
							related      : [],
							shape        : []
						}
						shapes.push(lastShape);
						prec && prec.Position &&
						lastShape.shape.push(
							[prec.Position.lat, prec.Position.lng]);
						
						next && next.Position &&
						lastShape.shape.push(
							[next.Position.lat, next.Position.lng]);
						
						
					}
				}
			})
		return shapes;
	},
	extractTransportTypes( path, related ) {
		let shapes = [], prec, next;
		// debugger;
		path &&
		path.map(
			( map, i ) => {
				let lastShape;
				prec = i && path[i - 1];
				next = path[i + 1];
				if ( map.Segment ) {
					if ( map.shape ) {
						lastShape = {
							_origin: map._id,
							// etty          : map,
							transportType: map.transportType,
							related      : [],
							shape        : map.shape
						}
						shapes.push(lastShape);
					}
					else {
						
						lastShape = {
							_origin: map._id,
							// etty          : map,
							transportType: map.transportType,
							related      : [],
							shape        : []
						}
						shapes.push(lastShape);
						prec && prec.Position &&
						lastShape.shape.push(
							[prec.Position.lat, prec.Position.lng]);
						
						next && next.Position &&
						lastShape.shape.push(
							[next.Position.lat, next.Position.lng]);
						
						
					}
				}
			})
		return shapes;
	},
	// --- kept for reference (R&D): skycube multi-dimensional path selection ---
	// Pareto/skyline selection over path descriptors (loadSkycube/getBest/
	// availableDimension), backed by an external @aetheris/skycube builder. Not shipped
	// in V1 (the dependency isn't vendored); retained as the design sketch for ranking
	// discovered paths by several dimensions at once.
	//loadSkycube: __SERVER__ && function ( callback ) {
	//	var skycubeBuilder = new SkycubeBuilder(),
	//	    me             = this;
	//
	//	this.skycube = skycubeBuilder.skycube;
	//
	//	// If a callback must be called, we bind it to the skycube computation end event
	//	if ( callback != undefined ) {
	//		skycubeBuilder.eventEmitter.on('file_loaded', callback);
	//	}
	//
	//	skycubeBuilder.sanitizeDimension(this);
	//
	//	// We only apply skycube on path that have a path descriptor (since they are "real" path issued from provider
	//	// this may be changed in the future to apply to more generated path (wo path descriptor)
	//	this.selectPaths(["pathDescriptor"], []);
	//	this._selected.map(( pathId, index ) => {
	//		//console.log("Processing " + pathId + " -> " + util.inspect( this.getPath(pathId).tpl , {depth: 3} ) );
	//		skycubeBuilder.processObject(pathId, this);
	//	});
	//
	//	skycubeBuilder.computeSkycube();
	//	//skycubeBuilder.skycube.loadStructure();
	//},
	//
	///**
	// * Get a serialized specific path by his selected id,
	// * Add available descriptors
	// * @param i
	// * @returns {{_pmap: PathMap, tpl: *, descr: *}}
	// */
	//getBest: function ( dimensions ) {
	//	if ( this.skycube == undefined ) {
	//		throw Error("Skycube has not bin yet calculated");
	//	}
	//	return this.skycube.getIdsFromDim(dimensions);
	//},
	//
	///**
	// * Get a serialized specific path by his selected id,
	// * Add available descriptors
	// * @param i
	// * @returns {{_pmap: PathMap, tpl: *, descr: *}}
	// */
	//availableDimension: function () {
	//	if ( this.skycube == undefined ) {
	//		throw Error("Skycube has not bin yet calculated");
	//	}
	//	return this.skycube.getAvailableDimension();
	//},
	
	
	/**
	 *
	 * Will walk in scopes to get some value or be warn if somthing set the value...
	 *
	 * @param exp
	 * @param scope
	 * @param follow bool do unstabilize scope's object if the concept asked is not here
	 *                    (so it will warn object that the stuff it ask is now here)
	 * @returns {targeted value}
	 */
	getRef: function ( exp, scope, follow, unref ) {
		var cScope = scope;
		exp        = exp.split('.');
		
		while ( exp.length ) {
			if ( exp[0].indexOf(':') != -1 ) {// follow the ref
				exp[0] = exp[0].split(':');
				cScope = this._.maps[cScope[exp[0][0]]];// switch scope
				
				if ( !cScope ) return;
				if ( exp[0][1] )
					exp[0] = exp[0][1];
				else return cScope;
			}
			if ( exp[0][0] == '$' ) {// global ref
				//debugger;
				if ( exp.length == 1 ) return this._.maps[exp[0].substr(1)];
				cScope = this._objById[exp[0].substr(1)];
			}
			else if ( exp.length == 1 ) {
				return cScope && cScope[exp[0]];
			}
			if ( !cScope ) return;
			exp.shift();
		}
		return cScope;
	},
	/**
	 * Get available descriptors for path i
	 * @param i
	 * @returns {Array}
	 */
	_getPathDescriptor: function ( i ) {
		var path = i._isPath ? i.tpl : this._paths[i], descr, descrs = [];
		for ( i = 0; i < path.length; i++ ) {
			if ( path[i].pathDescriptor ) {
				descr = this._.maps[path[i].pathDescriptor];
				descrs.push(descr);
				while ( descr.parentPathDescriptor ) {
					descrs.push(this._.maps[descr.parentPathDescriptor]);
					descr = this._.maps[descr.parentPathDescriptor];
				}
				return descrs;
			}
		}
	},
	/**
	 * Get available descriptors for path i
	 * @param i can be the path object OR the path indice in the pathMap
	 * @returns {Array}
	 */
	getPathDescriptor: function ( i, type ) {
		var path      = i && i._isPath ? i.tpl : this._paths[i],
		    descr,
		    descrs    = {},
		    descrList = [];
		
		for ( i = 0; i < path.length; i++ ) {
			if ( path[i].pathDescriptor && (!type || this._.maps[path[i].pathDescriptor].type == type) ) {
				if ( !descrs[path[i].pathDescriptor] ) {
					descrList.push(path[i].pathDescriptor);
					descrs[path[i].pathDescriptor] = this._.maps[path[i].pathDescriptor];
				}
			}
		}
		return descrList.map(( v ) => descrs[v]);
	}
};
module.exports = PathMap;