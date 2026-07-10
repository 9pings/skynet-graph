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

// The LEARNING panel (track 4) — the session's typed lattice registry, visually: declare a vocab key
// (authoring), PROPOSE an alias through THE admission gate (member ∈ enum ∧ confluence — a rejection shows
// its reason), RETRACT an alias (the recoverability guarantee). Every admitted ring row shows its
// provenance; nothing here writes the registry outside the gate.
export function LearningPanel( { learning, onDeclare, onPropose, onRetract, verdict } ) {
	const reg = (learning && learning.registry) || { keys: {} };
	const rings = (learning && learning.rings) || [];
	const keys = Object.keys(reg.keys || {});
	const [kName, setKName] = useState('');
	const [kEnum, setKEnum] = useState('');
	const [pKey, setPKey] = useState('');
	const [pMember, setPMember] = useState('');
	const [pAlias, setPAlias] = useState('');
	const prov = reg.ringProvenance || {};
	const provOf = ( r ) => { const p = prov[r.key + '::' + String(r.alias).trim().toLowerCase()]; return p ? p.via : ''; };

	return html`
		<div class="learning">
			<div class="lp-head">learning — typed lattice registry <span class="lp-ver">${reg.version || ''}</span></div>

			<div class="lp-block">
				<div class="lp-title">declare a vocab key <span class="lp-note">(authoring — enums are host-declared)</span></div>
				<div class="lp-row">
					<input class="lp-key" placeholder="key (e.g. unit)" value=${kName} onChange=${( e ) => setKName(e.target.value)} />
					<input class="lp-enum" placeholder="members, comma-separated" value=${kEnum} onChange=${( e ) => setKEnum(e.target.value)} />
					<button class="lp-declare" disabled=${!kName.trim() || !kEnum.trim()}
						onClick=${() => { onDeclare(kName.trim(), kEnum); setKName(''); setKEnum(''); }}>declare</button>
				</div>
				${keys.length ? html`<div class="lp-keys">${keys.map(( k ) => html`
					<span key=${k} class="lp-kchip"><b>${k}</b>: ${(reg.keys[k].enum || []).join(' · ')}</span>`)}</div>` : null}
			</div>

			<div class="lp-block">
				<div class="lp-title">propose an alias <span class="lp-note">(through THE gate: member ∈ enum ∧ confluence)</span></div>
				<div class="lp-row">
					<select class="lp-pkey" value=${pKey} onChange=${( e ) => { setPKey(e.target.value); setPMember(''); }}>
						<option value="" disabled>key…</option>
						${keys.map(( k ) => html`<option key=${k} value=${k}>${k}</option>`)}
					</select>
					<select class="lp-pmember" value=${pMember} onChange=${( e ) => setPMember(e.target.value)}>
						<option value="" disabled>member…</option>
						${(pKey && reg.keys[pKey] && reg.keys[pKey].enum || []).map(( m ) => html`<option key=${m} value=${m}>${m}</option>`)}
					</select>
					<input class="lp-palias" placeholder="alias" value=${pAlias} onChange=${( e ) => setPAlias(e.target.value)} />
					<button class="lp-propose" disabled=${!pKey || !pMember || !pAlias.trim()}
						onClick=${() => { onPropose(pKey, pMember, pAlias.trim()); setPAlias(''); }}>propose</button>
				</div>
				${verdict ? html`<div class="lp-verdict ${verdict.ok ? 'ok' : 'ko'}">${verdict.text}</div>` : null}
			</div>

			<div class="lp-block lp-grow">
				<div class="lp-title">admitted rings <span class="lp-note">(${rings.length} — retract = the recoverability guarantee)</span></div>
				<div class="lp-rings">
					${rings.length === 0 ? html`<div class="lp-empty">no admitted alias yet — declare a key, then propose</div>`
						: rings.map(( r, i ) => html`
							<div key=${i} class="lp-ring">
								<span class="lp-rkey">${r.key}</span>
								<span class="lp-ralias">${r.alias}</span> → <span class="lp-rmember">${r.member}</span>
								${provOf(r) ? html`<span class="lp-rvia">via ${provOf(r)}</span>` : null}
								<button class="lp-retract" title="retract this alias" onClick=${() => onRetract(r.key, r.alias)}>✕</button>
							</div>`)}
				</div>
			</div>
		</div>`;
}
