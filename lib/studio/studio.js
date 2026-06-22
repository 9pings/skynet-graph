'use strict';
/**
 * Studio — a registry of Sessions (the root + a tree of forks) plus corpus
 * discovery. Routes ops to a session and relays every session's events as a
 * single tagged `'event'` ({ type, sessionId, payload }) the server forwards to
 * the browser. Owns the optional model `ask` backend for the prompt loop.
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const Session = require('./session.js');

// session-level events relayed to subscribers (tagged with sessionId)
const RELAYED = ['conceptApply', 'stabilize', 'state', 'mutation', 'rollback', 'promptProgress', 'promptAnswer'];

class Studio extends EventEmitter {
	constructor( { Graph, ask, root } = {} ) {
		super();
		this.Graph = Graph;
		this.ask = ask;
		this.root = root || process.cwd();
		this.sessions = new Map();
		this._counter = 0;
		this._newSession('root', null);
	}

	_newSession( id, parentId ) {
		const s = new Session(id, { Graph: this.Graph, ask: this.ask });
		s._parentId = parentId;
		this.sessions.set(id, s);
		RELAYED.forEach(( type ) => s.on(type, ( payload ) => this.emit('event', { type, sessionId: id, payload })));
		return s;
	}

	getSession( id ) { return this.sessions.get(id); }

	/** Load a corpus into the root session (the default active session). */
	loadCorpus( opts ) { return this.getSession('root').loadCorpus(opts); }

	/** Discover corpus dirs under `root`: an immediate sub-dir that holds *.json (a set),
	 *  or that holds set sub-dirs with *.json. */
	listCorpora() {
		let entries;
		try { entries = fs.readdirSync(this.root, { withFileTypes: true }); } catch ( e ) { return []; }
		const out = [];
		for ( const e of entries ) {
			if ( !e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.') ) continue;
			const dir = path.join(this.root, e.name);
			if ( this._hasConcepts(dir) ) out.push({ name: e.name, dir });
		}
		return out;
	}
	_hasConcepts( dir ) {
		let files;
		try { files = fs.readdirSync(dir, { withFileTypes: true }); } catch ( e ) { return false; }
		if ( files.some(f => f.isFile() && f.name.endsWith('.json')) ) return true;
		return files.some(( f ) => {
			if ( !f.isDirectory() ) return false;
			try { return fs.readdirSync(path.join(dir, f.name)).some(n => n.endsWith('.json')); }
			catch ( e ) { return false; }
		});
	}

	/** Fork a session into an independent child sub-graph (a sub-agent). */
	fork( parentId, opts = {} ) {
		const parent = this.sessions.get(parentId || 'root');
		if ( !parent || !parent.graph ) throw new Error('fork: parent session not loaded');
		const childId = 'fork-' + (++this._counter);
		const child = this._newSession(childId, parent.id);
		const conf = {
			onConceptApply: ( rec ) => child.emit('conceptApply', rec),
			onStabilize   : () => child._onSettle()
		};
		child.graph = parent.graph.fork(opts.seed, { ...(opts.conf || {}), ...conf });
		child._conceptMap = parent._conceptMap;
		this.emit('event', { type: 'forks', sessionId: 'root', payload: this.forkTree() });
		return { childId };
	}

	/** Reintegrate a fork's result into its parent, then drop the child. */
	merge( childId, targetId, project ) {
		const child = this.sessions.get(childId);
		if ( !child ) throw new Error('merge: no such fork ' + childId);
		const parent = this.sessions.get(child._parentId || 'root');
		parent.graph.merge(child.graph, targetId, project);
		this.sessions.delete(childId);
		this.emit('event', { type: 'forks', sessionId: 'root', payload: this.forkTree() });
		return { ok: true };
	}

	/** Flat session tree (id -> {id, parent}) for the fork panel. */
	forkTree() {
		const tree = {};
		for ( const [id, s] of this.sessions ) tree[id] = { id, parent: s._parentId || null };
		return tree;
	}
}

module.exports = Studio;
