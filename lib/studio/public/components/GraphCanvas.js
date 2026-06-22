import React, { useRef, useEffect } from 'react';
import { html } from 'htm/react';
import cytoscape from 'cytoscape';

// concept self-flags on an object (keys whose value === true) = "what cast here"
function castFlags( o ) { return Object.keys(o).filter(( k ) => k[0] !== '_' && o[k] === true); }

// objects -> cytoscape elements: Node objects (and free-nodes) become nodes;
// a Segment with both endpoints present becomes an edge, else a standalone node.
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

export function GraphCanvas( { objects, lastApply, onSelect } ) {
	const ref = useRef(null);
	const cyRef = useRef(null);

	useEffect(() => {
		const cy = cytoscape({ container: ref.current, style: STYLE, layout: { name: 'cose' }, wheelSensitivity: 0.2 });
		cy.on('tap', 'node, edge', ( e ) => onSelect && onSelect(e.target.id()));
		cy.on('tap', ( e ) => { if ( e.target === cy ) onSelect && onSelect(null); });
		cyRef.current = cy;
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
		if ( topo ) cy.layout({ name: 'cose', animate: false, padding: 30 }).run();
	}, [objects]);

	// pulse the target of the most recent concept-apply
	useEffect(() => {
		const cy = cyRef.current;
		if ( !cy || !lastApply ) return;
		const el = cy.getElementById(lastApply.targetId);
		if ( el && el.length ) { el.addClass('pulse'); setTimeout(() => el.removeClass('pulse'), 600); }
	}, [lastApply]);

	return html`<div class="cy" ref=${ref}></div>`;
}
