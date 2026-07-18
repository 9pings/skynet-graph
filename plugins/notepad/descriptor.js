'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * notepad — the FIRST instance-type descriptor (the state-memory pillar: `state_note`/`state_recall`
 * as actions on a named persistent instance). Deliberately the SIMPLEST type: it fixes the descriptor
 * FORM the instance service dispatches on (see lib/plugins/descriptor.js for the contract).
 *
 * Alphabet (typed, discrete — the projection keys on it, so out-of-band writes never surface in
 * recall): `NoteEntry` marks a note object; `seq` (number) orders; `text` carries the content;
 * `by` is stamped by the RUNNER (never here — attribution is enforced at the door, R0).
 * All ids are literal (`$$_id`) — no minted ids, replay-deterministic.
 */
module.exports = {
	type       : 'notepad',
	version    : '1.0.0',
	conceptSets: [],                                  // no grammar needed: the alphabet is plain typed facts
	concurrency: ['shared-sequenced', 'fork-merge'],

	create: function ( seed ) {
		return [{ $$_id: 'pad', Notepad: true, title: (seed && seed.title) || '', nextNote: 1 }];
	},

	actions: {
		note: {
			write: true,
			input: { text: 'string' },
			apply: function ( g, args ) {
				var n = g.getEtty('pad').get('nextNote') || 1;
				return [
					{ $$_id: 'note-' + n, NoteEntry: true, seq: n, text: String(args.text) },
					{ $$_id: 'pad', nextNote: n + 1 }
				];
			}
		},
		recall: {
			write: false,
			input: {},
			project: function ( g ) {
				var notes = Object.keys(g._objById)
					.filter(function ( id ) { var e = g.getEtty(id); return e && e.get('NoteEntry'); })
					.map(function ( id ) {
						var e = g.getEtty(id);
						return { id: id, seq: e.get('seq'), text: e.get('text'), by: e.get('by') };
					})
					.sort(function ( a, b ) { return a.seq - b.seq; });
				return { notes: notes, count: notes.length };
			}
		}
	},

	projections: {
		summary: function ( g ) {
			var pad = g.getEtty('pad');
			var count = Object.keys(g._objById).filter(function ( id ) { var e = g.getEtty(id); return e && e.get('NoteEntry'); }).length;
			return { title: pad && pad.get('title'), count: count };
		}
	}
};
