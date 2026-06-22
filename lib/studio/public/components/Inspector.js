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

function fmt( v ) {
	if ( v === true ) return '✓';
	if ( v && typeof v === 'object' ) return JSON.stringify(v);
	return String(v);
}

export function Inspector( { object, applies } ) {
	if ( !object ) {
		return html`<aside class="inspector"><div class="empty">select a node or segment</div></aside>`;
	}
	const facts = Object.keys(object).filter(( k ) => k[0] !== '_');
	const castHere = applies.filter(( a ) => a.targetId === object._id);
	return html`
		<aside class="inspector">
			<h3>${object._id}${object.Segment ? ' (segment)' : ''}</h3>
			<div class="facts">
				${facts.map(( k ) => html`
					<div key=${k} class="fact"><span class="k">${k}</span><span class="v">${fmt(object[k])}</span></div>`)}
			</div>
			<h4>cast here ${castHere.length ? '(' + castHere.length + ')' : ''}</h4>
			${castHere.length === 0 ? html`<div class="empty">—</div>` : castHere.map(( a, i ) => html`
				<div key=${i} class="cast">
					<div class="cn">${a.conceptName} ✓ <span class="ms">${Math.round(a.ms || 0)}ms</span></div>
					${(a.why || []).map(( w, j ) => html`
						<div key=${j} class="why">${w.require} = ${fmt(w.value)}</div>`)}
				</div>`)}
		</aside>`;
}
