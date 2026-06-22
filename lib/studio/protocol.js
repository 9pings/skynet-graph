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
	'conceptTree', 'getConcept', 'validateConcept', 'patchConcept', 'addConcept',
	'revisions', 'snapshot', 'rollback', 'diff',
	'fork', 'merge', 'selectSession',
	'prompt'
]);

// events the server pushes to subscribers
const EVENTS = Object.freeze([
	'conceptApply', 'stabilize', 'mutation', 'rollback', 'state',
	'forks', 'promptProgress', 'promptAnswer', 'error'
]);

module.exports = { OPS, EVENTS };
