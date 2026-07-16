/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
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
const { validateConceptTree, validateMergeProjection, eachConcept } = require('../authoring/core/validate.js');
const { conceptFactGraph } = require('../authoring/core/grammar-graph.js');
const { deriveManifest, packCorpus } = require('../authoring/core/corpus-pack.js');
const { mergeRingProposals, retractRingAlias, creditRingAlias } = require('../authoring/lattice/registry.js');
const { packLattice, loadLattice, ringsOf } = require('../authoring/lattice/lattice-pack.js');

class Session extends EventEmitter {
	constructor( id, { Graph, ask, logger } = {} ) {
		super();
		this.id = id;
		this.Graph = Graph;
		this.ask = ask;
		this.logger = logger;// shared logger so a session's graph logs surface in the host (e.g. sg studio)
		this.graph = null;
		this._conceptMap = null;
		// the session's typed LATTICE registry (vocab enums + synonym rings) — the LearningPanel's object.
		// Aliases enter ONLY through the admission gate (mergeRingProposals / loadLattice — confluence-checked,
		// provenance-tagged); retraction is the recoverability guarantee. Declaring a vocab KEY is authoring
		// (host-declared enums), not admission — the gate concerns ALIASES.
		this._registry = { version: 'v1', keys: {} };
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
			logger        : this.logger,
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
		// retraction detection (zero-core): a concept-flag present on an object last settle but
		// gone now was retracted (JTMS defeasance / cascade). Emit it so the UI can flash it.
		const cur = this._flagsByObj(st.objects);
		if ( this._lastFlags )
			for ( const [id, prev] of this._lastFlags ) {
				const now = cur.get(id) || new Set();
				const gone = [...prev].filter(( c ) => !now.has(c));
				if ( gone.length ) this.emit('retract', { targetId: id, concepts: gone, atRev: st.currentRev });
			}
		this._lastFlags = cur;
		this.emit('stabilize', st);
		this.emit('state', st);
	}

	// the set of concept NAMES in the active map (cached; rebuilt when the map ref changes).
	_conceptNames() {
		if ( this.__cnFor !== this._conceptMap ) {
			this.__cnFor = this._conceptMap;
			const set = new Set();
			for ( const s of Object.keys(this._conceptMap || {}) )
				eachConcept(this._conceptMap[s], ( c ) => { if ( c._name ) set.add(c._name); });
			this.__cnSet = set;
		}
		return this.__cnSet;
	}
	// per-object set of currently-cast concept flags (a truthy key whose name is a concept).
	_flagsByObj( objects ) {
		const names = this._conceptNames(), m = new Map();
		for ( const o of objects ) {
			const s = new Set();
			for ( const k of Object.keys(o) ) if ( names.has(k) && o[k] ) s.add(k);
			m.set(o._id, s);
		}
		return m;
	}

	/** Current serialized state for the canvas. */
	state() {
		if ( !this.graph ) return { objects: [], currentRev: 0, revCount: 0, revs: [] };
		const ser = JSON.parse(this.graph.serialize().graph);
		const revs = this.graph.getRevisions(); // the checkpointed (snapshotted) revs only
		return {
			objects   : ser.conceptMaps || [],
			currentRev: ser.lastRev || 0,
			revCount  : revs.length,
			revs
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

	/**
	 * The tree-decomposition TILING of the active concept corpus (the TilingOverlay): the
	 * derived separator interface + the tiles/forks + their frontier alphabets + the
	 * treewidth cost bound. Pure derivation off the concept-dependency graph (no engine run).
	 */
	forkPlan() {
		if ( !this._conceptMap ) return null;
		const { treeDecomposition, forkPlan } = require('../authoring/core/decompose.js');
		const root = { childConcepts: {} };            // merge the active sets into one root tree
		for ( const set of Object.keys(this._conceptMap) ) {
			const t = this._conceptMap[set];
			if ( t && t.childConcepts ) Object.assign(root.childConcepts, t.childConcepts);
		}
		const decomp = treeDecomposition(root), plan = forkPlan(root);
		return {
			separators: decomp.separators, treewidth: decomp.treewidth,
			nTiles: decomp.nTiles, partitionPays: decomp.partitionPays, forks: plan.forks
		};
	}

	/**
	 * The concept↔fact GRAMMAR graph of the active corpus (the GrammarGraph view): per-concept
	 * produced/consumed facts WITH polarity, cross-corpus links, silent writer-collisions, the
	 * external entry points, and the forkPlan tiling overlay. Pure derivation (no engine run).
	 */
	grammarGraph() {
		if ( !this._conceptMap ) return { concepts: [], facts: [], edges: [], crossCorpus: [], collisions: [], entryPoints: [], tiling: null };
		return conceptFactGraph(this._conceptMap);
	}

	/** The derived corpus manifest (produces/consumes alphabet, required providers, links). */
	corpusManifest( meta ) {
		return deriveManifest(this._conceptMap || {}, meta || {});
	}

	/**
	 * Pack the corpus into a portable `.sgc` bundle. Exports the LIVE concept tree (so runtime
	 * edits — add/patchConcept — are captured) when a graph is loaded, else the on-disk map.
	 */
	exportCorpus( meta ) {
		meta = meta || {};
		const sets = Object.keys(this._conceptMap || {});
		const name = meta.name || sets.join('+') || 'corpus';
		let map;
		if ( this.graph && this.graph.exportConcepts )
			map = { [sets.length === 1 ? sets[0] : name]: this.graph.exportConcepts() };
		else
			map = this._conceptMap || {};
		return packCorpus(map, { ...meta, name });
	}

	/** Apply-correlated provider/log records (the ProviderTrace view). With no graph loaded, falls back to
	 *  the SHARED host logger — so an embedding host (`sg serve --studio`) surfaces its live request lines
	 *  in the trace panel with zero extra wiring. @returns {Array} */
	providerTrace( n, filter ) {
		const log = (this.graph && this.graph.logger) || this.logger;
		return log ? log.tail(n || 50, filter || {}) : [];
	}

	// --- the typed LATTICE registry (the LearningPanel ops — track 4) ---
	/** The registry + its admitted rings, flattened for the panel. */
	registry() { return { registry: this._registry, rings: ringsOf(this._registry) }; }
	/** Declare/extend a vocab KEY (host-declared enum members — authoring, not admission). */
	declareKey( args ) {
		args = args || {};
		const key = String(args.key || '').trim();
		const members = (Array.isArray(args.enum) ? args.enum : String(args.enum || '').split(','))
			.map(( m ) => String(m).trim()).filter(Boolean);
		if ( !key || !members.length ) throw new Error('declareKey needs { key, enum: [members…] }');
		const cur = this._registry.keys[key] || {};
		const merged = [...new Set([...(cur.enum || []), ...members])];
		this._registry = { ...this._registry, keys: { ...this._registry.keys, [key]: { ...cur, enum: merged } } };
		return this.registry();
	}
	/** Propose an ALIAS — admitted iff member ∈ enum ∧ the ring stays confluent (THE gate, mergeRingProposals);
	 *  a rejection carries its reason. @returns {{admitted, rejected, rings}} */
	proposeAlias( args ) {
		args = args || {};
		const r = mergeRingProposals(this._registry, [{ key: args.key, member: args.member, alias: args.alias, via: args.via || 'studio' }]);
		this._registry = r.registry;
		return { admitted: r.admitted, rejected: r.rejected, rings: ringsOf(this._registry) };
	}
	/** Retract an alias — the un-learn verb (recoverability): removal de-locks the corrected proposal. */
	retractAlias( args ) {
		args = args || {};
		const r = retractRingAlias(this._registry, args.key, args.alias);
		this._registry = r.registry;
		return { retracted: r.retracted, member: r.member, rings: ringsOf(this._registry) };
	}
	/** Credit an alias on a verified reuse (the support half of the defeasible envelope). */
	creditAlias( args ) {
		args = args || {};
		const r = creditRingAlias(this._registry, args.key, args.alias);
		this._registry = r.registry;
		return { member: r.member, support: r.support };
	}
	/** Ship the registry as a `.sgc kind:'lattice'` bundle. */
	exportLattice( meta ) { return packLattice(this._registry, meta || {}); }
	/** Grow the registry from a shipped bundle THROUGH the gate (version-gated; conflicting rings rejected).
	 *  An EMPTY session registry adopts the packaged canon wholesale (loadLattice's no-host path); a grown one
	 *  merges ring-by-ring through mergeRingProposals. */
	importLattice( args ) {
		args = args || {};
		const host = Object.keys(this._registry.keys || {}).length ? this._registry : null;
		const r = loadLattice(args.bundle, host, args.opts || {});
		if ( r.registry ) this._registry = r.registry;
		return { adopted: r.adopted, merged: r.merged, admitted: r.admitted, rejected: r.rejected,
		         loadSafe: r.loadSafe, rings: ringsOf(this._registry) };
	}

	/**
	 * Preview a fork/merge projection against a frontier alphabet — what crosses the boundary and
	 * which keys LEAK (not in the declared alphabet). Pure check (validateMergeProjection); does
	 * not perform the merge. @returns {{errors, warnings}}
	 */
	mergePreview( template, opts ) {
		opts = opts || {};
		return validateMergeProjection(template, { frontierAlphabet: opts.frontierAlphabet, flagContinuous: opts.flagContinuous, strict: opts.strict });
	}

	/** A concept's schema (the JSON the editor edits), by name or id. */
	getConcept( nameOrId ) {
		const c = this.graph && this.graph.getConceptByName(nameOrId);
		return c ? (c._schema || c) : null;
	}

	// --- history (the "git for reasoning" inspection) ---
	revisions() { return this.graph ? this.graph.getRevisions() : []; }
	snapshot( rev ) {
		const snap = this.graph && this.graph.getSnapshot(rev);
		return snap ? { objects: JSON.parse(snap.graph).conceptMaps || [] } : null;
	}
	/** Roll data + rules back to a revision; a 'rollback' then 'state' event follow on settle. */
	rollback( rev ) {
		this.graph.rollbackTo(rev);
		this.emit('rollback', { rev });
		return { ok: true };
	}
	diff( a, b ) { return this.graph.diffRevisions(a, b); }

	// --- live concept authoring (validate before applying) ---
	/** Author-time validation of a candidate concept schema. @returns {{ok, errors, warnings}} */
	validateConcept( schema ) {
		const key = (schema && schema._id) || 'candidate';
		const { errors, warnings } = validateConceptTree({ childConcepts: { [key]: schema } }, {});
		return { ok: errors.length === 0, errors, warnings };
	}
	/** Hot-patch a concept; the re-eval cascade + a 'state' event follow on settle. */
	patchConcept( nameOrId, updates ) { this.graph.patchConcept(nameOrId, updates); return { ok: true }; }
	/** Author a new concept under a parent; opens it on live objects + re-sweeps. */
	addConcept( parentNameOrId, schema ) { this.graph.addConcept(parentNameOrId, schema); return { ok: true }; }
	/** Remove a concept (and its subtree); un-casts it everywhere, then re-stabilizes (CRUD completion). */
	deleteConcept( nameOrId ) { this.graph.deleteConcept(nameOrId); return { ok: true }; }

	/**
	 * Run the decompose -> synthesize answer-loop for a prompt, IN this session's
	 * graph (so the decomposition tree builds on the canvas). Streams 'promptProgress'
	 * and ends with 'promptAnswer'. Needs an LLM `ask` backend (LLM_BASE).
	 * Reuses lib/authoring/core/loop.js (same wiring as examples/run-prompt.js).
	 */
	prompt( text, opts = {} ) {
		if ( !this.ask ) throw new Error('prompt needs an LLM backend — start `sg studio` with LLM_BASE set');
		const { loopConceptTree, makeDecomposeProviders, synthesize } = require('../authoring/core/loop.js');
		const { parseJSON } = require('../providers/llm.js');
		const ask = this.ask;
		const emit = ( m ) => this.emit('promptProgress', m);
		const ctx = ( scope ) => {
			const p = scope._.ctxPath || [];
			return `Objectif global: ${text}\nChemin: ${p.length ? p.join(' > ') : '(racine)'}\n`
				+ `Étape courante: ${scope._.label || 'RÉSOUDRE LE PROBLÈME'}\n`
				+ (scope._.description ? `Détail: ${scope._.description}\n` : '') + `Profondeur: ${scope._.depth || 0}`;
		};
		const J = async ( system, user ) => parseJSON(await ask({ system, user: user + '\n\nRéponds UNIQUEMENT le JSON.', maxTokens: 1500 }));

		this.Graph._providers = makeDecomposeProviders({
			maxDepth: opts.maxDepth == null ? 2 : opts.maxDepth,
			evalFn: async ( scope ) => {
				const r = await J('Tu juges si une étape de plan est ATOMIQUE (directement répondable) ou doit être DÉCOUPÉE. JSON: {"atomic":true|false,"reason":"court"}', ctx(scope)).catch(() => ({ atomic: true }));
				emit({ kind: 'eval', depth: scope._.depth || 0, label: scope._.label, atomic: !!r.atomic });
				return r;
			},
			expandFn: async ( scope ) => {
				const r = await J('Tu découpes une étape en 2 à 3 sous-étapes ORDONNÉES et concrètes. JSON: {"steps":[{"name":"court","description":"..."}]}', ctx(scope)).catch(() => ({ steps: [] }));
				const cp = [...(scope._.ctxPath || []), scope._.label];
				emit({ kind: 'expand', depth: scope._.depth || 0, label: scope._.label, into: (r.steps || []).map(( s ) => s.name) });
				return (r.steps || []).map(( s ) => ({ name: s.name, description: s.description, ctxPath: cp }));
			},
			answerFn: async ( scope ) => {
				const t = await ask({ system: 'Réponds à cette étape atomique de façon concise et concrète (3-5 phrases max).', user: ctx(scope), maxTokens: 600 });
				emit({ kind: 'answer', depth: scope._.depth || 0, label: scope._.label });
				return String(t).trim();
			}
		});
		const rollupFn = async ( seg, kids ) => {
			const t = await ask({ system: 'Tu synthétises les réponses des sous-étapes en UNE réponse cohérente et BORNÉE (max ~6 phrases). Ne recopie pas, résume.', user: `Étape: ${seg.label}\n\nRéponses des sous-étapes:\n` + kids.map(( a, i ) => `${i + 1}. ${a}`).join('\n'), maxTokens: 700 });
			emit({ kind: 'rollup', label: seg.label, children: kids.length });
			return String(t).trim();
		};

		this._destroy();
		this._conceptMap = { common: loopConceptTree };
		let answered = false;
		const seed = {
			lastRev : 0,
			nodes   : [{ _id: 'start', label: 'état initial' }, { _id: 'goal', label: 'objectif' }],
			segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', depth: 0, label: String(text).slice(0, 60), ctxPath: [] }]
		};
		this.graph = new this.Graph(seed, {
			autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logger: this.logger,
			onConceptApply: ( rec ) => this.emit('conceptApply', rec),
			onStabilize   : async () => {
				this._onSettle();
				if ( answered ) return;
				answered = true;
				try { this.emit('promptAnswer', { answer: await synthesize(this.graph, 'root', rollupFn) }); }
				catch ( e ) { this.emit('promptAnswer', { answer: '(synthesis failed: ' + e.message + ')' }); }
			}
		}, this._conceptMap);
		return { ok: true };
	}

	/**
	 * REQUEST/RESPONSE bridge (Controller-P0): run the decompose→synthesize answer loop for `text`
	 * and RESOLVE with the answer — the event-based `prompt` lifted into a promise, so a controller
	 * (a CLI, an MCP tool, a small-LLM driver) can `await session.ask(q)`. Progress is still emitted
	 * as `promptProgress` events (subscribe before awaiting to stream). Rejects on a missing LLM
	 * backend or a timeout. ZERO-CORE — pure composition over the existing `prompt` + settle.
	 * (Named `answer`, not `ask`: `this.ask` is the injected MODEL backend — an instance field that
	 * would shadow a prototype `ask()`.)
	 * @param opts.maxDepth  decomposition depth (default 2). opts.timeout ms (default 120000).
	 * @returns Promise<{ answer, state }>
	 */
	answer( text, opts = {} ) {
		return new Promise(( resolve, reject ) => {
			const to = opts.timeout || 120000;
			const timer = setTimeout(() => reject(new Error('Session.ask timed out after ' + to + 'ms')), to);
			this.once('promptAnswer', ( { answer } ) => { clearTimeout(timer); resolve({ answer, state: this.state() }); });
			try { this.prompt(text, opts); } catch ( e ) { clearTimeout(timer); reject(e); }
		});
	}

	_destroy() {
		if ( this.graph && this.graph.destroy ) this.graph.destroy();
		this.graph = null;
		this._lastFlags = null;// fresh retraction baseline for the next corpus
	}
}

module.exports = Session;
