import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from 'htm/react';
import { connect } from '/ws.js';
import { GraphCanvas, LAYOUT_NAMES } from '/components/GraphCanvas.js';
import { Inspector } from '/components/Inspector.js';
import { Timeline, DiffPanel } from '/components/Timeline.js';
import { ConceptTree } from '/components/ConceptTree.js';
import { ConceptEditor } from '/components/ConceptEditor.js';

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
	const [graph, setGraph] = useState({ objects: [], currentRev: 0, revCount: 0 });
	const [applies, setApplies] = useState([]);
	const [lastApply, setLastApply] = useState(null);
	const [selectedId, setSelectedId] = useState(null);
	const [layout, setLayout] = useState('elk');
	const [relayout, setRelayout] = useState(0);
	const [diffResult, setDiffResult] = useState(null);
	const [conceptTree, setConceptTree] = useState({});
	const [editing, setEditing] = useState(null);
	const api = useRef(null);

	useEffect(() => {
		const c = connect('ws://' + location.host, ( evt ) => {
			if ( evt.type === 'state' ) setGraph(evt.payload);
			else if ( evt.type === 'conceptApply' ) { setApplies(( a ) => [...a, evt.payload]); setLastApply(evt.payload); }
		});
		c.onStatus(setStatus);
		api.current = c;
		try { window.__sgApi = c; } catch ( e ) {} // test hook (puppeteer)
		c.call('listCorpora').then(setCorpora);
	}, []);

	async function loadCorpus( name, seed ) {
		const c = corpora.find(( x ) => x.name === name);
		if ( !c ) return;
		setCorpus(name);
		setApplies([]); setLastApply(null); setSelectedId(null);
		await api.current.call('loadCorpus', { conceptsDir: c.dir, builtins: true, seed });
		setGraph(await api.current.call('state'));
		setConceptTree(await api.current.call('conceptTree'));
	}

	async function openEditor( name ) {
		const schema = await api.current.call('getConcept', { nameOrId: name });
		setEditing({ name, text: JSON.stringify(schema || {}, null, 2), validation: null });
	}
	function editorChange( text ) { setEditing(( e ) => ({ ...e, text, validation: null })); }
	async function editorValidate() {
		let schema;
		try { schema = JSON.parse(editing.text); }
		catch ( err ) { return setEditing(( e ) => ({ ...e, validation: { ok: false, errors: ['invalid JSON: ' + err.message] } })); }
		const v = await api.current.call('validateConcept', { schema });
		setEditing(( e ) => ({ ...e, validation: v }));
	}
	async function editorApply() {
		let schema;
		try { schema = JSON.parse(editing.text); } catch ( err ) { return; }
		await api.current.call('patchConcept', { nameOrId: editing.name, updates: schema });
		setEditing(null);
		setGraph(await api.current.call('state'));
	}

	async function rollback( rev ) {
		await api.current.call('rollback', { rev });
		setGraph(await api.current.call('state'));
	}
	async function showDiff( a, b ) {
		setDiffResult({ a, b, d: await api.current.call('diff', { a, b }) });
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
				<span class="status ${status}">● ${status}</span>
				<span class="rev">rev ${graph.currentRev}/${graph.revCount} · ${graph.objects.length} obj</span>
			</header>
			<${Timeline} revs=${graph.revs} currentRev=${graph.currentRev} onRollback=${rollback} onDiff=${showDiff} />
			<main class="panels">
				<${ConceptTree} tree=${conceptTree} onEdit=${openEditor} />
				<${GraphCanvas} objects=${graph.objects} lastApply=${lastApply} onSelect=${setSelectedId} layout=${layout} relayout=${relayout} />
				<${Inspector} object=${selected} applies=${applies} />
			</main>
			<footer class="bottom">
				<h3>trace</h3>
				<div class="tracerow">
					${applies.slice(-40).map(( r, i ) => html`
						<span key=${i} class="tchip"><b>${r.conceptName}</b>→${r.targetId}</span>`)}
				</div>
			</footer>
			<${ConceptEditor} editing=${editing} onChange=${editorChange} onValidate=${editorValidate} onApply=${editorApply} onClose=${() => setEditing(null)} />
			<${DiffPanel} result=${diffResult} onClose=${() => setDiffResult(null)} />
		</div>`;
}

createRoot(document.getElementById('app')).render(html`<${App} />`);
