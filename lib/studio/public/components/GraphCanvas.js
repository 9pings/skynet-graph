import React, { useRef, useEffect } from 'react';
import { html } from 'htm/react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import dagre from 'cytoscape-dagre';
import ELK from 'elkjs';

// register the cytoscape-native layout extensions once (idempotent)
let _registered = false;
function registerLayouts() {
	if ( _registered ) return;
	try { cytoscape.use(fcose); } catch ( e ) {}
	try { cytoscape.use(dagre); } catch ( e ) {}
	_registered = true;
}

// ELK is driven DIRECTLY (the bundled build = no web worker) rather than via the
// cytoscape-elk wrapper, whose `new ELK()` breaks under esm.sh interop. Tuning carried
// over from the rocinante workflow editor: layered + NETWORK_SIMPLEX, cleaner than dagre
// for directed/DAG graphs.
const elk = new ELK();
const ELK_OPTS = {
	'elk.algorithm'                            : 'layered',
	'elk.direction'                            : 'RIGHT',
	'elk.spacing.nodeNode'                     : '60',
	'elk.layered.spacing.nodeNodeBetweenLayers': '120',
	'elk.edgeRouting'                          : 'ORTHOGONAL',
	'elk.layered.nodePlacement.strategy'       : 'NETWORK_SIMPLEX'
};

async function runElk( cy ) {
	const children = cy.nodes().map(( n ) => ({ id: n.id(), width: Math.max(n.width() || 40, 40), height: Math.max(n.height() || 40, 40) }));
	if ( !children.length ) return;
	const edges = cy.edges().map(( e, i ) => ({ id: e.id() || ('e' + i), sources: [e.source().id()], targets: [e.target().id()] }));
	const res = await elk.layout({ id: 'root', layoutOptions: ELK_OPTS, children, edges });
	const pos = {};
	(res.children || []).forEach(( n ) => { pos[n.id] = { x: n.x, y: n.y }; });
	cy.nodes().forEach(( n ) => { const p = pos[n.id()]; if ( p ) n.position(p); });
	cy.fit(undefined, 40);
}

// cytoscape-native layouts (ELK is handled separately above)
const CY_LAYOUTS = {
	fcose       : { name: 'fcose', animate: true, animationDuration: 400, randomize: false, padding: 40, nodeSeparation: 90, idealEdgeLength: 90 },
	dagre       : { name: 'dagre', rankDir: 'LR', nodeSep: 30, rankSep: 70, padding: 40, animate: true, animationDuration: 400 },
	breadthfirst: { name: 'breadthfirst', directed: true, padding: 40, animate: true, spacingFactor: 1.2 },
	concentric  : { name: 'concentric', animate: true, padding: 40, minNodeSpacing: 40 },
	circle      : { name: 'circle', animate: true, padding: 40 },
	grid        : { name: 'grid', animate: true, padding: 40 }
};
export const LAYOUT_NAMES = ['elk', ...Object.keys(CY_LAYOUTS)];

// concept self-flags on an object (keys whose value === true) = "what cast here"
function castFlags( o ) { return Object.keys(o).filter(( k ) => k[0] !== '_' && o[k] === true); }

function toElements( objects ) {
	const nodeIds = new Set(objects.filter(( o ) => !o.Segment).map(( o ) => o._id));
	const els = [];
	for ( const o of objects ) {
		const flags = castFlags(o).filter(( k ) => k !== 'Node' && k !== 'Segment');
		if ( o.Segment && nodeIds.has(o.originNode) && nodeIds.has(o.targetNode) ) {
			els.push({ group: 'edges', data: { id: o._id, source: o.originNode, target: o.targetNode, label: flags.join(' ') } });
		} else {
			els.push({ group: 'nodes', data: { id: o._id, label: o._id }, classes: o.Segment ? 'dangling' : '' });
		}
	}
	return els;
}

const STYLE = [
	{ selector: 'node', style: { 'background-color': '#6ea8fe', 'label': 'data(label)', 'color': '#cdd6e0', 'font-size': '10px', 'text-valign': 'center', 'text-halign': 'center', 'width': 34, 'height': 34, 'text-outline-color': '#0f1419', 'text-outline-width': 2 } },
	{ selector: 'node.dangling', style: { 'background-color': '#f5a524', 'shape': 'round-rectangle' } },
	{ selector: 'node:selected', style: { 'border-color': '#fff', 'border-width': 2 } },
	{ selector: 'edge', style: { 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'line-color': '#3ad29f', 'target-arrow-color': '#3ad29f', 'width': 2, 'label': 'data(label)', 'font-size': '9px', 'color': '#9fb0c0', 'text-rotation': 'autorotate', 'text-background-color': '#0f1419', 'text-background-opacity': 0.85, 'text-background-padding': 2 } },
	{ selector: 'edge:selected', style: { 'line-color': '#fff', 'target-arrow-color': '#fff' } },
	{ selector: '.pulse', style: { 'background-color': '#ff6b6b', 'line-color': '#ff6b6b', 'target-arrow-color': '#ff6b6b', 'width': 5 } }
];

export function GraphCanvas( { objects, lastApply, onSelect, layout = 'elk', relayout = 0 } ) {
	const ref = useRef(null);
	const cyRef = useRef(null);
	const layoutRef = useRef(layout);
	useEffect(() => { layoutRef.current = layout; }, [layout]);

	function runLayout() {
		const cy = cyRef.current;
		if ( !cy || cy.elements().length === 0 ) return;
		if ( layoutRef.current === 'elk' ) { runElk(cy).catch(( e ) => console.warn('elk layout failed:', e && e.message)); return; }
		cy.layout(CY_LAYOUTS[layoutRef.current] || CY_LAYOUTS.fcose).run();
	}

	useEffect(() => {
		registerLayouts();
		const cy = cytoscape({ container: ref.current, style: STYLE, wheelSensitivity: 0.2 });
		cy.on('tap', 'node, edge', ( e ) => onSelect && onSelect(e.target.id()));
		cy.on('tap', ( e ) => { if ( e.target === cy ) onSelect && onSelect(null); });
		cyRef.current = cy;
		try { window.__sgCy = cy; } catch ( e ) {} // test hook (puppeteer introspection)
		return () => cy.destroy();
	}, []);

	// reconcile elements on each state update (keep positions; re-layout on topology change)
	useEffect(() => {
		const cy = cyRef.current;
		if ( !cy ) return;
		const want = toElements(objects);
		const wantIds = new Set(want.map(( e ) => e.data.id));
		let topo = false;
		cy.elements().forEach(( el ) => { if ( !wantIds.has(el.id()) ) { el.remove(); topo = true; } });
		want.forEach(( e ) => {
			const ex = cy.getElementById(e.data.id);
			if ( ex.length ) ex.data(e.data);
			else { cy.add(e); topo = true; }
		});
		if ( topo ) runLayout();
	}, [objects]);

	// explicit re-layout (selector change or the relayout button)
	useEffect(() => { runLayout(); }, [layout, relayout]);

	// pulse the target of the most recent concept-apply
	useEffect(() => {
		const cy = cyRef.current;
		if ( !cy || !lastApply ) return;
		const el = cy.getElementById(lastApply.targetId);
		if ( el && el.length ) { el.addClass('pulse'); setTimeout(() => el.removeClass('pulse'), 600); }
	}, [lastApply]);

	return html`<div class="cy" ref=${ref}></div>`;
}
