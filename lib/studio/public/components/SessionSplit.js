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
import { GraphCanvas } from '/components/GraphCanvas.js';

// Side-by-side parent ↔ fork sub-graphs (track 5 / G3). Shows both graphs at once + the
// merge-projection PREVIEW: what the projection crosses the frontier, and any frontier-leak.
export function SessionSplit( { open, parentId, forkId, parentObjects, forkObjects, preview, onClose, onMerge } ) {
	if ( !open ) return null;
	const warns = (preview && preview.warnings) || [];
	const leaks = warns.filter(( w ) => w.kind === 'frontier-leak');
	return html`
		<div class="split-modal" onClick=${onClose}>
			<div class="split-box" onClick=${( e ) => e.stopPropagation()}>
				<div class="split-head">
					<span>sub-graphs: <b>${parentId}</b> ↔ <b>${forkId}</b></span>
					<button onClick=${onClose}>close</button>
				</div>
				<div class="split-canvases">
					<div class="split-pane"><div class="split-label">${parentId} (parent)</div>
						<${GraphCanvas} objects=${parentObjects || []} layout="elk" /></div>
					<div class="split-pane"><div class="split-label">${forkId} (fork)</div>
						<${GraphCanvas} objects=${forkObjects || []} layout="elk" /></div>
				</div>
				<div class="split-merge">
					${preview ? html`<span class="split-prev">${leaks.length ? '⚠ ' + leaks.length + ' frontier-leak(s): ' + leaks.map(( l ) => l.ref).join(', ') : 'projection clean — frontier respected'}</span>` : null}
					<button class="split-do" onClick=${onMerge}>merge fork → parent</button>
				</div>
			</div>
		</div>`;
}
