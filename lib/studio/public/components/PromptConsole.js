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
import React, { useState } from 'react';
import { html } from 'htm/react';

// bottom bar: type a prompt -> decompose & synthesize (answer-loop). The decomposition
// builds live on the canvas; steps stream here and the synthesized answer lands at the end.
export function PromptConsole( { onRun, progress, answer, running, error } ) {
	const [text, setText] = useState('');
	const hasOut = (progress && progress.length) || answer || error;
	return html`
		<div class="prompt">
			${hasOut ? html`
				<div class="pr-out">
					${error ? html`<div class="pr-err">${error}</div>` : null}
					${(progress || []).map(( p, i ) => html`
						<div key=${i} class="pr-step pr-${p.kind}">
							[${p.kind}${p.depth != null ? ' d' + p.depth : ''}] ${p.label || ''}
							${p.atomic != null ? (p.atomic ? '→ atomic' : '→ split') : ''}
							${p.into ? '→ ' + p.into.join(' | ') : ''}
							${p.children != null ? '← ' + p.children + ' children' : ''}
						</div>`)}
					${answer ? html`<div class="pr-answer"><b>answer</b><div>${answer}</div></div>` : null}
				</div>` : null}
			<form class="pr-bar" onSubmit=${( e ) => { e.preventDefault(); if ( text.trim() ) onRun(text.trim()); }}>
				<input placeholder="prompt → decompose & synthesize (needs LLM_BASE)" value=${text}
					onInput=${( e ) => setText(e.target.value)} disabled=${running} />
				<button type="submit" disabled=${running || !text.trim()}>${running ? 'running…' : 'run'}</button>
			</form>
		</div>`;
}
