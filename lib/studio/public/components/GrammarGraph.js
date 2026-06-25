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
import React, { useRef, useEffect } from 'react';
import { html } from 'htm/react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

let _reg = false;
function register() { if ( _reg ) return; try { cytoscape.use(fcose); } catch ( e ) {} _reg = true; }

// per-set hue so concepts from different corpora are visually distinct
const SET_HUES = ['#6ea8fe', '#3ad29f', '#f5a524', '#c084fc', '#fb7185', '#22d3ee'];
function setColor( sets, set ) { const i = sets.indexOf(set); return SET_HUES[(i < 0 ? 0 : i) % SET_HUES.length]; }

// the second, orthogonal graph: concepts ↔ facts. A concept WRITES facts (green) and READS them
// (blue = positive support, red dashed = a negated / defeasance dependency). Separator facts (the
// tree-decomposition narrow waist) are highlighted as gold diamonds; entry-point facts are hollow.
function toElements( g ) {
	const sets = [...new Set(g.concepts.map(( c ) => c.set))].sort();
	const seps = new Set((g.tiling && g.tiling.separators) || []);
	const entry = new Set(g.entryPoints || []);
	const els = [];
	for ( const c of g.concepts )
		els.push({ data: { id: 'c:' + c.name, label: c.name, kind: c.kind, color: setColor(sets, c.set) }, classes: 'concept kind-' + c.kind });
	for ( const f of g.facts ) {
		const cls = ['fact'];
		if ( seps.has(f.key) ) cls.push('separator');
		if ( entry.has(f.key) ) cls.push('entry');
		els.push({ data: { id: 'f:' + f.key, label: f.key }, classes: cls.join(' ') });
	}
	const seen = new Set();
	for ( const e of g.edges ) {
		const a = e.kind === 'writes' ? 'c:' + e.concept : 'f:' + e.fact;
		const b = e.kind === 'writes' ? 'f:' + e.fact : 'c:' + e.concept;
		const cls = e.kind === 'writes' ? 'writes' : (e.polarity === '-' ? 'reads-neg' : 'reads-pos');
		const id = cls + ':' + a + '>' + b;
		if ( seen.has(id) ) continue;            // collapse duplicate read edges (assert+ensure on same fact)
		seen.add(id);
		els.push({ data: { id, source: a, target: b }, classes: cls });
	}
	return els;
}

const STYLE = [
	{ selector: 'node.concept', style: { 'background-color': 'data(color)', 'label': 'data(label)', 'shape': 'round-rectangle', 'color': '#0f1419', 'font-size': '10px', 'font-weight': 'bold', 'text-valign': 'center', 'text-halign': 'center', 'width': 'label', 'height': 22, 'padding': '6px' } },
	{ selector: 'node.kind-llm', style: { 'border-width': 2, 'border-color': '#fde047', 'border-style': 'double' } },
	{ selector: 'node.kind-provider', style: { 'border-width': 2, 'border-color': '#0f1419' } },
	{ selector: 'node.fact', style: { 'background-color': '#1f2733', 'label': 'data(label)', 'shape': 'ellipse', 'color': '#cdd6e0', 'font-size': '9px', 'text-valign': 'center', 'text-halign': 'center', 'width': 'label', 'height': 18, 'padding': '4px', 'border-width': 1, 'border-color': '#3a4757' } },
	{ selector: 'node.entry', style: { 'background-opacity': 0.15, 'border-style': 'dashed' } },
	{ selector: 'node.separator', style: { 'background-color': '#f5a524', 'shape': 'diamond', 'color': '#0f1419', 'border-width': 2, 'border-color': '#fff7e6' } },
	{ selector: 'node:selected', style: { 'border-color': '#fff', 'border-width': 3 } },
	{ selector: 'edge', style: { 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'width': 1.5, 'arrow-scale': 0.8 } },
	{ selector: 'edge.writes', style: { 'line-color': '#3ad29f', 'target-arrow-color': '#3ad29f' } },
	{ selector: 'edge.reads-pos', style: { 'line-color': '#6ea8fe', 'target-arrow-color': '#6ea8fe' } },
	{ selector: 'edge.reads-neg', style: { 'line-color': '#fb7185', 'target-arrow-color': '#fb7185', 'line-style': 'dashed' } }
];

const FCOSE = { name: 'fcose', animate: true, animationDuration: 350, randomize: true, padding: 40, nodeSeparation: 110, idealEdgeLength: 80 };

export function GrammarGraph( { grammar, onSelect } ) {
	const ref = useRef(null);
	const cyRef = useRef(null);

	useEffect(() => {
		register();
		const cy = cytoscape({ container: ref.current, style: STYLE, wheelSensitivity: 0.2 });
		cy.on('tap', 'node', ( e ) => onSelect && onSelect(e.target.id()));
		cyRef.current = cy;
		try { window.__sgGrammarCy = cy; } catch ( e ) {} // puppeteer introspection hook
		return () => cy.destroy();
	}, []);

	useEffect(() => {
		const cy = cyRef.current;
		if ( !cy ) return;
		cy.elements().remove();
		if ( grammar && grammar.concepts ) {
			cy.add(toElements(grammar));
			if ( cy.elements().length ) cy.layout(FCOSE).run();
		}
	}, [grammar]);

	return html`<div class="cy grammar-cy" ref=${ref}></div>`;
}
