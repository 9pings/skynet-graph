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
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from 'htm/react';
import { connect } from '/ws.js';
import { GraphCanvas, LAYOUT_NAMES } from '/components/GraphCanvas.js';
import { Inspector } from '/components/Inspector.js';
import { Timeline, DiffPanel } from '/components/Timeline.js';
import { ConceptTree } from '/components/ConceptTree.js';
import { ConceptEditor } from '/components/ConceptEditor.js';
import { ForkTree } from '/components/ForkTree.js';
import { TilingOverlay } from '/components/TilingOverlay.js';
import { PromptConsole } from '/components/PromptConsole.js';
import { GrammarGraph } from '/components/GrammarGraph.js';
import { CorpusPanel } from '/components/CorpusPanel.js';
import { ProviderTrace } from '/components/ProviderTrace.js';
import { SessionSplit } from '/components/SessionSplit.js';
import { LearningPanel } from '/components/LearningPanel.js';

// a demo seed so you can watch a graph develop with one click
const DEMO_SEED = { conceptMaps: [
	{ _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },
	{ _id: 'b', Node: true, Position: { lat: 1.35, lng: 103.8 } },
	{ _id: 's', Segment: true, originNode: 'a', targetNode: 'b' }
] };

function App() {
	const [status, setStatus] = useState('connecting');
	const [corpora, setCorpora] = useState([]);
	const [corpus, setCorpus] = useState('');
	const [graph, setGraph] = useState({ objects: [], currentRev: 0, revCount: 0, revs: [] });
	const [applies, setApplies] = useState([]);
	const [lastApply, setLastApply] = useState(null);
	const [selectedId, setSelectedId] = useState(null);
	const [layout, setLayout] = useState('elk');
	const [relayout, setRelayout] = useState(0);
	const [diffResult, setDiffResult] = useState(null);
	const [conceptTree, setConceptTree] = useState({});
	const [editing, setEditing] = useState(null);
	const valTimer = useRef(null);                                   // debounce timer for in-editor live ref-checking
	const [sessionId, setSessionId] = useState('root');
	const [forks, setForks] = useState({ root: { id: 'root', parent: null } });
	const [tiling, setTiling] = useState(null);
	const [promptProgress, setPromptProgress] = useState([]);
	const [promptAnswer, setPromptAnswer] = useState('');
	const [promptRunning, setPromptRunning] = useState(false);
	const [promptError, setPromptError] = useState('');
	const [view, setView] = useState('data');         // 'data' (instance graph) | 'grammar' (concepts↔facts) | 'learning' (lattice registry)
	const [grammar, setGrammar] = useState(null);
	const [learning, setLearning] = useState(null);           // { registry, rings } — the LearningPanel readout
	const [learnVerdict, setLearnVerdict] = useState(null);   // the last gate verdict { ok, text }
	const [manifest, setManifest] = useState(null);
	const [trace, setTrace] = useState([]);
	const [lastRetract, setLastRetract] = useState(null);
	const [split, setSplit] = useState(null);          // { parentId, forkId, parentObjects, forkObjects, preview }
	const api = useRef(null);
	const sessionRef = useRef('root'); // the active session — events for others are ignored

	useEffect(() => {
		const c = connect('ws://' + location.host, ( evt ) => {
			if ( evt.type === 'forks' ) { setForks(evt.payload); return; }
			if ( evt.sessionId && evt.sessionId !== sessionRef.current ) return; // not the active session
			if ( evt.type === 'state' ) setGraph(evt.payload);
			else if ( evt.type === 'conceptApply' ) { setApplies(( a ) => [...a, evt.payload]); setLastApply(evt.payload); }
			else if ( evt.type === 'promptProgress' ) setPromptProgress(( p ) => [...p, evt.payload]);
			else if ( evt.type === 'promptAnswer' ) { setPromptAnswer(evt.payload.answer); setPromptRunning(false); }
			else if ( evt.type === 'retract' ) { setLastRetract(evt.payload); try { (window.__sgRetracts = window.__sgRetracts || []).push(evt.payload); } catch ( e ) {} }
		});
		c.onStatus(setStatus);
		api.current = c;
		try { window.__sgApi = c; } catch ( e ) {} // test hook (puppeteer)
		c.call('listCorpora').then(setCorpora);
	}, []);

	const sid = () => sessionRef.current;

	async function loadCorpus( name, seed ) {
		const c = corpora.find(( x ) => x.name === name);
		if ( !c ) return;
		sessionRef.current = 'root'; setSessionId('root');
		setForks({ root: { id: 'root', parent: null } });
		setCorpus(name);
		setApplies([]); setLastApply(null); setSelectedId(null);
		await api.current.call('loadCorpus', { conceptsDir: c.dir, builtins: true, seed });
		setGraph(await api.current.call('state', {}, 'root'));
		setConceptTree(await api.current.call('conceptTree', {}, 'root'));
		api.current.call('forkPlan', {}, 'root').then(setTiling).catch(() => setTiling(null));
		refreshGrammar('root');
		refreshTrace();
	}

	async function refreshGrammar( id ) {
		try {
			setGrammar(await api.current.call('grammarGraph', {}, id || sid()));
			setManifest(await api.current.call('corpusManifest', { meta: { name: corpus || id } }, id || sid()));
		} catch ( e ) { setGrammar(null); setManifest(null); }
	}
	async function refreshTrace() {
		try { setTrace(await api.current.call('providerTrace', { n: 80 }, sid())); } catch ( e ) { setTrace([]); }
	}

	// --- learning (the typed lattice registry — every alias goes through THE admission gate) ---
	async function refreshLearning( id ) {
		try { setLearning(await api.current.call('registry', {}, id || sid())); } catch ( e ) { setLearning(null); }
	}
	async function declareKey( key, en ) {
		setLearning(await api.current.call('declareKey', { key, enum: en }, sid()));
		setLearnVerdict(null);
	}
	async function proposeAlias( key, member, alias ) {
		const r = await api.current.call('proposeAlias', { key, member, alias }, sid());
		setLearnVerdict(r.admitted.length
			? { ok: true, text: 'ADMITTED — ' + alias + ' → ' + member + ' (gate: member ∈ enum ∧ confluence)' }
			: { ok: false, text: 'REJECTED — ' + (r.rejected[0] && r.rejected[0].reason || 'gate refused') });
		try { window.__sgLastVerdict = r; } catch ( e ) {}   // test hook (puppeteer)
		await refreshLearning();
	}
	async function retractAlias( key, alias ) {
		const r = await api.current.call('retractAlias', { key, alias }, sid());
		setLearnVerdict({ ok: true, text: (r.retracted ? 'RETRACTED — ' : 'no-op — ') + alias + (r.member ? ' (was → ' + r.member + ')' : '') });
		await refreshLearning();
	}

	// --- corpus exchange (.sgc) ---
	async function exportCorpus() {
		const bundle = await api.current.call('exportCorpus', { meta: { name: corpus || 'corpus', version: '1.0.0' } }, sid());
		try { window.__sgLastBundle = bundle; } catch ( e ) {}
		try {
			const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob); a.download = (bundle.manifest && bundle.manifest.name || 'corpus') + '.sgc';
			a.click(); URL.revokeObjectURL(a.href);
		} catch ( e ) {}
		return bundle;
	}
	async function importCorpus( bundle, seed ) {
		sessionRef.current = 'root'; setSessionId('root');
		setForks({ root: { id: 'root', parent: null } });
		setApplies([]); setLastApply(null); setSelectedId(null);
		const res = await api.current.call('importCorpus', { bundle, opts: { builtins: true, seed } }, 'root');
		if ( !res.ok ) { setPromptError('import failed: ' + (res.errors || []).map(( e ) => e.message).join('; ')); return res; }
		setCorpus((bundle.manifest && bundle.manifest.name) || 'imported');
		setGraph(await api.current.call('state', {}, 'root'));
		setConceptTree(await api.current.call('conceptTree', {}, 'root'));
		refreshGrammar('root');
		return res;
	}

	// --- sub-graph split (parent ↔ fork side by side, with a merge preview) ---
	async function openSplit() {
		const forkId = sid();
		if ( forkId === 'root' ) return;
		const parentId = (forks[forkId] && forks[forkId].parent) || 'root';
		const [parentObjects, forkState] = await Promise.all([
			api.current.call('state', {}, parentId).then(( s ) => s.objects),
			api.current.call('state', {}, forkId)
		]);
		const preview = await api.current.call('mergePreview', { template: { $$_id: forkId, forkResult: true }, opts: {} }, forkId).catch(() => null);
		setSplit({ parentId, forkId, parentObjects, forkObjects: forkState.objects, preview });
	}

	async function selectSession( id ) {
		sessionRef.current = id; setSessionId(id);
		setApplies([]); setLastApply(null); setSelectedId(null);
		setGraph(await api.current.call('state', {}, id));
		refreshGrammar(id);
	}
	async function doFork() {
		const { childId } = await api.current.call('fork', {}, sid());
		await selectSession(childId);
	}
	async function doMerge( childId ) {
		const parent = (forks[childId] && forks[childId].parent) || 'root';
		await api.current.call('merge', { childId, targetId: childId }, parent); // forkResult lands on a <childId> node
		await selectSession(parent);
	}

	async function runPrompt( text ) {
		setPromptProgress([]); setPromptAnswer(''); setPromptError(''); setPromptRunning(true);
		setApplies([]); setLastApply(null); setSelectedId(null);
		try { await api.current.call('prompt', { text }, sid()); }
		catch ( e ) { setPromptError(e.message); setPromptRunning(false); }
	}

	async function openEditor( name ) {
		const schema = await api.current.call('getConcept', { nameOrId: name }, sid());
		setEditing({ name, text: JSON.stringify(schema || {}, null, 2), validation: null });
	}
	function editorChange( text ) {
		setEditing(( e ) => ({ ...e, text, validation: null }));
		// in-editor ref-checking (track 4): debounce-validate the schema live as the operator types — reuses the
		// author-time validator (unknown-ref / prose-on-dependency / unparseable-expr checks) so mistakes surface inline.
		if ( valTimer.current ) clearTimeout(valTimer.current);
		valTimer.current = setTimeout(async () => {
			let schema;
			try { schema = JSON.parse(text); }
			catch ( err ) { return setEditing(( e ) => e && { ...e, validation: { ok: false, errors: ['invalid JSON: ' + err.message] } }); }
			const v = await api.current.call('validateConcept', { schema }, sid());
			setEditing(( e ) => e && { ...e, validation: v });
		}, 400);
	}
	async function editorValidate() {
		let schema;
		try { schema = JSON.parse(editing.text); }
		catch ( err ) { return setEditing(( e ) => ({ ...e, validation: { ok: false, errors: ['invalid JSON: ' + err.message] } })); }
		const v = await api.current.call('validateConcept', { schema }, sid());
		setEditing(( e ) => ({ ...e, validation: v }));
	}
	async function editorApply() {
		let schema;
		try { schema = JSON.parse(editing.text); } catch ( err ) { return; }
		await api.current.call('patchConcept', { nameOrId: editing.name, updates: schema }, sid());
		setEditing(null);
		setGraph(await api.current.call('state', {}, sid()));
	}
	// CRUD completion: remove the concept (+ its subtree); un-casts it everywhere, then refresh the tree + grammar.
	async function editorDelete() {
		if ( !editing ) return;
		await api.current.call('deleteConcept', { nameOrId: editing.name }, sid());
		setEditing(null);
		setGraph(await api.current.call('state', {}, sid()));
		setConceptTree(await api.current.call('conceptTree', {}, sid()));
		refreshGrammar(sid());
	}

	async function rollback( rev ) {
		await api.current.call('rollback', { rev }, sid());
		setGraph(await api.current.call('state', {}, sid()));
	}
	async function showDiff( a, b ) {
		setDiffResult({ a, b, d: await api.current.call('diff', { a, b }, sid()) });
	}

	const selected = selectedId && graph.objects.find(( o ) => o._id === selectedId);

	return html`
		<div class="studio">
			<header class="toolbar">
				<strong>sg studio</strong>
				<select value=${corpus} onChange=${( e ) => loadCorpus(e.target.value)}>
					<option value="" disabled>corpus…</option>
					${corpora.map(( c ) => html`<option key=${c.name} value=${c.name}>${c.name}</option>`)}
				</select>
				<button disabled=${!corpus} onClick=${() => loadCorpus(corpus, DEMO_SEED)}>seed demo</button>
				<button disabled=${!corpus} onClick=${() => loadCorpus(corpus)}>reset</button>
				<span class="sep"></span>
				<label class="lyt">layout
					<select value=${layout} onChange=${( e ) => setLayout(e.target.value)}>
						${LAYOUT_NAMES.map(( n ) => html`<option key=${n} value=${n}>${n}</option>`)}
					</select>
				</label>
				<button title="re-run layout" onClick=${() => setRelayout(( r ) => r + 1)}>↻</button>
				<span class="sep"></span>
				<div class="viewtoggle">
					<button class=${view === 'data' ? 'on' : ''} onClick=${() => setView('data')}>data</button>
					<button class=${view === 'grammar' ? 'on' : ''} onClick=${() => { setView('grammar'); if ( !grammar ) refreshGrammar(); }}>grammar</button>
					<button class=${view === 'learning' ? 'on' : ''} onClick=${() => { setView('learning'); refreshLearning(); }}>learning</button>
				</div>
				<button title="open two sub-graphs side by side" disabled=${sessionId === 'root'} onClick=${openSplit}>split</button>
				<span class="status ${status}">● ${status}</span>
				<span class="rev">${sessionId !== 'root' ? sessionId + ' · ' : ''}rev ${graph.currentRev}/${graph.revCount} · ${graph.objects.length} obj</span>
			</header>
			<${Timeline} revs=${graph.revs} currentRev=${graph.currentRev} onRollback=${rollback} onDiff=${showDiff} />
			<main class="panels">
				<${ConceptTree} tree=${conceptTree} onEdit=${openEditor} />
				${view === 'learning'
					? html`<${LearningPanel} learning=${learning} verdict=${learnVerdict} onDeclare=${declareKey} onPropose=${proposeAlias} onRetract=${retractAlias} />`
					: view === 'grammar'
						? html`<${GrammarGraph} grammar=${grammar} onSelect=${( id ) => setSelectedId(null)} />`
						: html`<${GraphCanvas} objects=${graph.objects} lastApply=${lastApply} lastRetract=${lastRetract} onSelect=${setSelectedId} layout=${layout} relayout=${relayout} />`}
				${view === 'grammar'
					? html`<${CorpusPanel} manifest=${manifest} grammar=${grammar} onExport=${exportCorpus} onImport=${importCorpus} />`
					: html`<${Inspector} object=${selected} applies=${applies} />`}
			</main>
			<footer class="bottom">
				<div class="trace-wrap">
					<h3>trace</h3>
					<div class="tracerow">
						${applies.slice(-40).map(( r, i ) => html`
							<span key=${i} class="tchip"><b>${r.conceptName}</b>→${r.targetId}</span>`)}
					</div>
				</div>
				<${ForkTree} forks=${forks} active=${sessionId} onFork=${doFork} onSelect=${selectSession} onMerge=${doMerge} />
				<${TilingOverlay} plan=${tiling} />
				<${ProviderTrace} records=${trace} onRefresh=${refreshTrace} />
			</footer>
			<${PromptConsole} onRun=${runPrompt} progress=${promptProgress} answer=${promptAnswer} running=${promptRunning} error=${promptError} />
			<${ConceptEditor} editing=${editing} onChange=${editorChange} onValidate=${editorValidate} onApply=${editorApply} onDelete=${editorDelete} onClose=${() => setEditing(null)} />
			<${DiffPanel} result=${diffResult} onClose=${() => setDiffResult(null)} />
			<${SessionSplit} open=${!!split} parentId=${split && split.parentId} forkId=${split && split.forkId} parentObjects=${split && split.parentObjects} forkObjects=${split && split.forkObjects} preview=${split && split.preview} onClose=${() => setSplit(null)} onMerge=${async () => { if ( split ) { await doMerge(split.forkId); setSplit(null); } }} />
		</div>`;
}

createRoot(document.getElementById('app')).render(html`<${App} />`);
