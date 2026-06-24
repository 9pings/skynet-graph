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

// the tree-decomposition TILING (pavage) of the active corpus: the derived separator
// interface (the narrow waist) + each tile/fork with its frontier alphabet. Fed by the
// `forkPlan` Session op (a pure derivation off the concept-dependency graph).
export function TilingOverlay( { plan } ) {
	if ( !plan ) return null;
	return html`
		<div class="tiling">
			<div class="tl-head">tiling
				<span class="tl-meta">tw ${plan.treewidth} · ${plan.nTiles} tiles · ${plan.partitionPays ? 'partition pays' : 'one tile'}</span>
			</div>
			<div class="tl-seps">separators:${(plan.separators || []).map(( s ) => html`<span key=${s} class="tl-sep">${s}</span>`)}</div>
			<div class="tl-forks">
				${(plan.forks || []).map(( f, i ) => html`
					<div key=${i} class="tl-fork">
						<span class="tl-fconc">${(f.concepts || []).join(', ')}</span>
						<span class="tl-ffront">⟶ ${(f.frontier || []).join(', ') || '∅'}</span>
					</div>`)}
			</div>
		</div>`;
}
