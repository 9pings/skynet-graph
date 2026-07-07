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
'use strict';
/**
 * The studio wire contract (shared by server.js and the frontend ws client).
 *
 * Client -> server : { id, sessionId?, op, args }   (op in OPS)
 * Server -> client : { id, ok, result | error }     (op responses)
 *                  | { type, sessionId, payload }    (unsolicited events, type in EVENTS)
 */

// operations a client may invoke (one Session/Studio method each)
const OPS = Object.freeze([
	'listCorpora', 'loadCorpus', 'reset',
	'mutate', 'run', 'state',
	'conceptTree', 'getConcept', 'validateConcept', 'patchConcept', 'addConcept', 'forkPlan',
	'grammarGraph', 'corpusManifest', 'exportCorpus', 'importCorpus', 'providerTrace', 'mergePreview',
	'revisions', 'snapshot', 'rollback', 'diff',
	'fork', 'merge', 'selectSession',
	'registry', 'declareKey', 'proposeAlias', 'retractAlias', 'creditAlias', 'exportLattice', 'importLattice',
	'prompt'
]);

// events the server pushes to subscribers
const EVENTS = Object.freeze([
	'conceptApply', 'stabilize', 'mutation', 'rollback', 'state', 'retract',
	'forks', 'promptProgress', 'promptAnswer', 'error'
]);

module.exports = { OPS, EVENTS };
