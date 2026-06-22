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
