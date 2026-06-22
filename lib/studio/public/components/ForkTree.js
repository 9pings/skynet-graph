import React from 'react';
import { html } from 'htm/react';

// the session tree: fork the active graph into an independent child (a sub-agent),
// switch between sessions, merge a fork's result back into its parent.
export function ForkTree( { forks, active, onFork, onSelect, onMerge } ) {
	const ids = Object.keys(forks || {});
	return html`
		<div class="forks">
			<div class="fk-head">forks<button onClick=${onFork} title="fork the active session">+ fork</button></div>
			<div class="fk-list">
				${ids.map(( id ) => html`
					<div key=${id} class=${'fk-item' + (id === active ? ' active' : '')}>
						<span class="fk-id" onClick=${() => onSelect(id)}>${id}${forks[id].parent ? '' : ' · root'}</span>
						${forks[id].parent ? html`<button class="fk-merge" title="merge into parent" onClick=${() => onMerge(id)}>merge ↩</button>` : null}
					</div>`)}
			</div>
		</div>`;
}
