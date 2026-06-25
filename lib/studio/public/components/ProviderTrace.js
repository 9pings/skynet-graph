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

// Apply-correlated provider / log records (graph.logger.tail) — joins an apply's logs by applyId.
export function ProviderTrace( { records, onRefresh } ) {
	const recs = records || [];
	return html`
		<div class="ptrace">
			<div class="pt-head">provider trace <button class="pt-refresh" onClick=${onRefresh}>↻</button></div>
			<div class="pt-rows">
				${recs.length === 0 ? html`<div class="pt-empty">no records (raise the log level / run a provider)</div>`
					: recs.slice(-60).map(( r, i ) => html`
						<div key=${i} class="pt-row pt-${r.level || 'log'}">
							<span class="pt-lvl">${r.level || 'log'}</span>
							${r.concept ? html`<span class="pt-concept">${r.concept}</span>` : null}
							${r.target ? html`<span class="pt-target">→${r.target}</span>` : null}
							<span class="pt-msg">${r.message || r.msg || ''}</span>
							${r.applyId ? html`<span class="pt-aid">#${String(r.applyId).slice(-4)}</span>` : null}
						</div>`)}
			</div>
		</div>`;
}
