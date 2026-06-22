'use strict';
/**
 * A studio Session wraps ONE live Graph and exposes the ops the web layer drives,
 * emitting events as the graph develops. No web dependency — this is the unit the
 * studio tests cover. Construct with the engine facade and an optional model `ask`:
 *
 *   const Session = require('./session.js');
 *   const s = new Session('root', { Graph: require('../index.js'), ask });
 *   s.on('conceptApply', rec => …); s.on('state', st => …);
 *   s.loadCorpus({ conceptsDir, builtins: true, seed });
 *
 * Events: 'conceptApply'(rec) · 'stabilize'(state) · 'state'(state) · 'mutation'({targetId}) · 'rollback'({rev}).
 */
const EventEmitter = require('events');

class Session extends EventEmitter {
	constructor( id, { Graph, ask } = {} ) {
		super();
		this.id = id;
		this.Graph = Graph;
		this.ask = ask;
		this.graph = null;
		this._conceptMap = null;
	}

	/**
	 * (Re)build the live graph from a corpus (dir or in-memory map) + providers + seed.
	 * @returns {{objects, currentRev, revCount}} the initial state
	 */
	loadCorpus( opts = {} ) {
		this._destroy();
		this._conceptMap = opts.conceptMap
			|| (opts.conceptsDir ? this.Graph.loadConceptMap(opts.conceptsDir) : {});
		const conf = {
			autoMount     : true,
			onConceptApply: ( rec ) => this.emit('conceptApply', rec),
			onStabilize   : () => this._onSettle()
		};
		if ( opts.sets ) conf.conceptSets = opts.sets;
		this.graph = this.Graph.fromDirs({
			conceptMap : this._conceptMap,
			providers  : opts.providersDir,
			builtins   : opts.builtins,
			seed       : opts.seed,
			providerCtx: { ask: this.ask, env: process.env },
			conf
		});
		return this.state();
	}

	_onSettle() {
		const st = this.state();
		this.emit('stabilize', st);
		this.emit('state', st);
	}

	/** Current serialized state for the canvas. */
	state() {
		if ( !this.graph ) return { objects: [], currentRev: 0, revCount: 0 };
		const ser = JSON.parse(this.graph.serialize().graph);
		return {
			objects   : ser.conceptMaps || [],
			currentRev: ser.lastRev || 0,
			revCount  : this.graph.getRevisions().length
		};
	}

	/** Apply a mutation template; stabilization + a 'state' event follow on settle. */
	mutate( template, targetId ) {
		this.graph.pushMutation(template, targetId);
		this.emit('mutation', { targetId });
		return { ok: true };
	}

	/** Force a stabilization pass (e.g. after a no-op edit). */
	run() {
		this.graph.stabilize();
		return { ok: true };
	}

	/** The active conceptMap (set tree) for the concept panel. */
	conceptTree() {
		return this._conceptMap || {};
	}

	/** A concept's schema (the JSON the editor edits), by name or id. */
	getConcept( nameOrId ) {
		const c = this.graph && this.graph.getConceptByName(nameOrId);
		return c ? (c._schema || c) : null;
	}

	_destroy() {
		if ( this.graph && this.graph.destroy ) this.graph.destroy();
		this.graph = null;
	}
}

module.exports = Session;
