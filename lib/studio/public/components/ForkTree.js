/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <@pp9ping@gmail.com>
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
