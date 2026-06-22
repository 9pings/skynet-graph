import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from 'htm/react';
import { connect } from '/ws.js';

// a demo seed so you can watch a graph develop with one click (the real
// mutation/seed UI comes with the canvas + editor panels)
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
	const api = useRef(null);

	useEffect(() => {
		const c = connect('ws://' + location.host, ( evt ) => {
			if ( evt.type === 'state' ) setGraph(evt.payload);
			else if ( evt.type === 'conceptApply' ) setApplies(( a ) => [...a, evt.payload]);
		});
		c.onStatus(setStatus);
		api.current = c;
		c.call('listCorpora').then(setCorpora);
	}, []);

	async function loadCorpus( name, seed ) {
		const c = corpora.find(( x ) => x.name === name);
		if ( !c ) return;
		setCorpus(name);
		setApplies([]);
		await api.current.call('loadCorpus', { conceptsDir: c.dir, builtins: true, seed });
		setGraph(await api.current.call('state'));
	}

	const facts = ( o ) => Object.keys(o).filter(( k ) => k[0] !== '_');

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
				<span class="rev">rev ${graph.currentRev}/${graph.revCount}</span>
			</header>
			<main class="panels">
				<section class="canvas">
					<div class="hint">${graph.objects.length} object(s) — graph canvas lands in the next lot</div>
					<ul class="objs">
						${graph.objects.map(( o ) => html`
							<li key=${o._id}>
								<span class="oid">${o._id}</span>
								<span class="ofacts">{${facts(o).join(', ')}}</span>
							</li>`)}
					</ul>
				</section>
				<aside class="trace">
					<h3>trace</h3>
					<ul>
						${applies.slice(-30).map(( r, i ) => html`
							<li key=${i}><span class="cn">${r.conceptName}</span> → ${r.targetId}</li>`)}
					</ul>
				</aside>
			</main>
		</div>`;
}

createRoot(document.getElementById('app')).render(html`<${App} />`);
