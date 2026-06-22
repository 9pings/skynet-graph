import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from 'htm/react';
import { connect } from '/ws.js';
import { GraphCanvas } from '/components/GraphCanvas.js';
import { Inspector } from '/components/Inspector.js';

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
	const api = useRef(null);

	useEffect(() => {
		const c = connect('ws://' + location.host, ( evt ) => {
			if ( evt.type === 'state' ) setGraph(evt.payload);
			else if ( evt.type === 'conceptApply' ) { setApplies(( a ) => [...a, evt.payload]); setLastApply(evt.payload); }
		});
		c.onStatus(setStatus);
		api.current = c;
		c.call('listCorpora').then(setCorpora);
	}, []);

	async function loadCorpus( name, seed ) {
		const c = corpora.find(( x ) => x.name === name);
		if ( !c ) return;
		setCorpus(name);
		setApplies([]); setLastApply(null); setSelectedId(null);
		await api.current.call('loadCorpus', { conceptsDir: c.dir, builtins: true, seed });
		setGraph(await api.current.call('state'));
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
				<span class="status ${status}">● ${status}</span>
				<span class="rev">rev ${graph.currentRev}/${graph.revCount} · ${graph.objects.length} obj</span>
			</header>
			<main class="panels">
				<${GraphCanvas} objects=${graph.objects} lastApply=${lastApply} onSelect=${setSelectedId} />
				<${Inspector} object=${selected} applies=${applies} />
			</main>
			<footer class="bottom">
				<h3>trace</h3>
				<div class="tracerow">
					${applies.slice(-40).map(( r, i ) => html`
						<span key=${i} class="tchip"><b>${r.conceptName}</b>→${r.targetId}</span>`)}
				</div>
			</footer>
		</div>`;
}

createRoot(document.getElementById('app')).render(html`<${App} />`);
