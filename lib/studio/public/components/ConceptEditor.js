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

// modal to edit a concept's schema JSON, validate it (author-time), then patch it
// live — the re-eval cascade is visible on the canvas.
export function ConceptEditor( { editing, onChange, onValidate, onApply, onClose } ) {
	if ( !editing ) return null;
	const { name, text, validation } = editing;
	return html`
		<div class="editor-modal" onClick=${( e ) => { if ( e.target.classList.contains('editor-modal') ) onClose(); }}>
			<div class="em-box">
				<div class="em-head">edit concept <b>${name}</b><button onClick=${onClose}>✕</button></div>
				<textarea class="em-text" spellcheck="false" value=${text} onInput=${( e ) => onChange(e.target.value)}></textarea>
				${validation ? html`
					<div class="em-validation ${validation.ok ? 'ok' : 'bad'}">
						${validation.ok ? '✓ valid' : '✗ ' + (validation.errors || []).join('; ')}
						${(validation.warnings || []).length ? html`<div class="em-warn">⚠ ${validation.warnings.join('; ')}</div>` : null}
					</div>` : null}
				<div class="em-actions">
					<button onClick=${onValidate}>validate</button>
					<button class="primary" disabled=${validation && !validation.ok} onClick=${onApply}>apply (patch)</button>
				</div>
			</div>
		</div>`;
}
