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
import React, { useRef } from 'react';
import { html } from 'htm/react';

// The corpus side-panel for the grammar view: the derived manifest (produces/consumes alphabet,
// required providers), the cross-corpus links + silent writer-collisions, a polarity legend, and
// the .sgc import/export controls. `manifest`/`grammar` come from the corpusManifest/grammarGraph
// ops; onExport()/onImport(bundle) round-trip the portable bundle.
export function CorpusPanel( { manifest, grammar, onExport, onImport } ) {
	const fileRef = useRef(null);
	const g = grammar || {};
	const m = manifest || {};

	function pickFile( e ) {
		const f = e.target.files && e.target.files[0];
		if ( !f ) return;
		const r = new FileReader();
		r.onload = () => { try { onImport(JSON.parse(r.result)); } catch ( err ) { alert('bad .sgc: ' + err.message); } };
		r.readAsText(f);
		e.target.value = '';
	}

	return html`
		<aside class="corpus-panel">
			<div class="cp-actions">
				<button class="cp-export" onClick=${onExport}>export .sgc</button>
				<button class="cp-import" onClick=${() => fileRef.current && fileRef.current.click()}>import .sgc</button>
				<input type="file" accept=".sgc,.json" ref=${fileRef} style=${{ display: 'none' }} onChange=${pickFile} />
			</div>
			<div class="cp-legend">
				<span class="lg lg-w">writes</span><span class="lg lg-rp">reads +</span>
				<span class="lg lg-rn">reads − (defeasance)</span><span class="lg lg-sep">separator</span>
			</div>
			${m.name ? html`
				<div class="cp-manifest">
					<div class="cp-row"><b>${m.name}</b> <span class="cp-v">v${m.version}</span> · ${m.conceptCount} concepts</div>
					<div class="cp-row">providers: ${(m.providersRequired || []).length ? (m.providersRequired || []).map(( p ) => html`<span key=${p} class="cp-prov">${p}</span>`) : '∅'}</div>
					<div class="cp-row">produces: <span class="cp-alpha">${(m.alphabet && m.alphabet.produces || []).join(', ')}</span></div>
					<div class="cp-row">consumes: <span class="cp-alpha">${(m.alphabet && m.alphabet.consumes || []).join(', ') || '∅'}</span></div>
				</div>` : null}
			${(g.crossCorpus || []).length ? html`
				<div class="cp-cross">
					<h4>cross-corpus links</h4>
					${g.crossCorpus.map(( l, i ) => html`<div key=${i} class="cp-link">${l.fromSet} <b>${l.fact}</b> → ${l.toSet}</div>`)}
				</div>` : null}
			${(g.collisions || []).length ? html`
				<div class="cp-coll">
					<h4>⚠ fact collisions</h4>
					${g.collisions.map(( c, i ) => html`<div key=${i} class="cp-clash"><b>${c.fact}</b> written by ${c.sets.join(' & ')}</div>`)}
				</div>` : null}
		</aside>`;
}
