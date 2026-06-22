import React, { useState, useEffect } from 'react';
import { html } from 'htm/react';

// revision scrubber. Steps through the CHECKPOINTED revs only (getRevisions —
// snapshots are captured per settle, not per intermediate rev), so rollback/diff
// never target a rev that has no snapshot.
export function Timeline( { revs, currentRev, onRollback, onDiff } ) {
	const list = (revs && revs.length) ? revs : [currentRev];
	const [idx, setIdx] = useState(list.length - 1);
	useEffect(() => { setIdx(list.length - 1); }, [currentRev, list.length]);
	const i = Math.min(idx, list.length - 1);
	const at = list[i] != null ? list[i] : currentRev;
	const isLast = at >= currentRev;
	return html`
		<div class="timeline">
			<span class="tl-lbl">timeline</span>
			<input class="tl-range" type="range" min="0" max=${Math.max(list.length - 1, 0)} value=${i}
				onInput=${( e ) => setIdx(Number(e.target.value))} />
			<span class="tl-cur">rev ${at} / ${currentRev} · ${list.length} ckpt</span>
			<button disabled=${isLast} onClick=${() => onRollback(at)}>rollback</button>
			<button disabled=${isLast} onClick=${() => onDiff(at, currentRev)}>diff → ${currentRev}</button>
		</div>`;
}

// added/removed/changed between two revs (diffRevisions output)
export function DiffPanel( { result, onClose } ) {
	if ( !result ) return null;
	const { a, b, d } = result;
	const ids = ( o ) => Object.keys(o || {});
	return html`
		<div class="diffpanel">
			<div class="dp-head">diff rev ${a} → ${b}<button onClick=${onClose}>✕</button></div>
			<div class="dp-body">
				<div class="dp-sec added">+ added: ${ids(d.added).join(', ') || '—'}</div>
				<div class="dp-sec removed">− removed: ${ids(d.removed).join(', ') || '—'}</div>
				<div class="dp-sec changed">~ changed: ${ids(d.changed).length === 0 ? '—' : ids(d.changed).map(( id ) => html`
					<div key=${id} class="dp-chg">${id}: ${Object.keys(d.changed[id]).join(', ')}</div>`)}</div>
			</div>
		</div>`;
}
