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
