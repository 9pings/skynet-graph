import React from 'react';
import { html } from 'htm/react';

function children( node, onEdit, depth ) {
	const kids = node && node.childConcepts;
	if ( !kids ) return null;
	return Object.keys(kids).map(( name ) => html`
		<div key=${name} class="cnode">
			<span class="cname" style=${{ paddingLeft: (depth * 12) + 'px' }} onClick=${() => onEdit(name)}>${name}</span>
			${children(kids[name], onEdit, depth + 1)}
		</div>`);
}

// left panel: the loaded concept corpus (sets -> nested concepts); click to edit.
export function ConceptTree( { tree, onEdit } ) {
	const sets = Object.keys(tree || {});
	return html`
		<aside class="concepts">
			<h3>concepts</h3>
			${sets.length === 0 ? html`<div class="empty">load a corpus</div>` : sets.map(( set ) => html`
				<div key=${set} class="cset">
					<div class="csetname">${set}</div>
					${children(tree[set], onEdit, 0)}
				</div>`)}
		</aside>`;
}
