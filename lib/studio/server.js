/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <@pp9ping@gmail.com>
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
 * The studio server: serves the static frontend (lib/studio/public) over http and
 * bridges a WebSocket to the Studio (ops in, events out). Thin — all logic lives in
 * studio.js / session.js.
 *
 *   const { createServer } = require('skynet-graph/lib/studio/server');
 *   const srv = createServer({ Graph: require('skynet-graph'), root: './' , ask });
 *   srv.listen(4848, () => console.log('sg studio on http://localhost:4848'));
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Studio = require('./studio.js');
const { OPS } = require('./protocol.js');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
	'.json': 'application/json', '.svg': 'image/svg+xml', '.map': 'application/json'
};

// route an op to a studio-level or session-level method
function dispatch( studio, sessionId, op, args ) {
	switch ( op ) {
		case 'listCorpora':   return studio.listCorpora();
		case 'loadCorpus':    return studio.loadCorpus(args);
		case 'fork':          return studio.fork(sessionId || 'root', args);
		case 'merge':         return studio.merge(args.childId, args.targetId, args.project);
		case 'selectSession': return { ok: !!studio.getSession(args.sessionId) };
	}
	const s = studio.getSession(sessionId || 'root');
	if ( !s ) throw new Error('no such session: ' + sessionId);
	switch ( op ) {
		case 'reset':           s._destroy(); return { ok: true };
		case 'mutate':          return s.mutate(args.template, args.targetId);
		case 'run':             return s.run();
		case 'state':           return s.state();
		case 'conceptTree':     return s.conceptTree();
		case 'getConcept':      return s.getConcept(args.nameOrId);
		case 'validateConcept': return s.validateConcept(args.schema);
		case 'patchConcept':    return s.patchConcept(args.nameOrId, args.updates);
		case 'addConcept':      return s.addConcept(args.parentNameOrId, args.schema);
		case 'revisions':       return s.revisions();
		case 'snapshot':        return s.snapshot(args.rev);
		case 'rollback':        return s.rollback(args.rev);
		case 'diff':            return s.diff(args.a, args.b);
		case 'prompt':
			if ( typeof s.prompt !== 'function' ) throw new Error('prompt not available (no LLM backend wired)');
			return s.prompt(args.text, args.opts);
	}
	throw new Error('unhandled op: ' + op);
}

function serveStatic( req, res ) {
	let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
	if ( urlPath === '/favicon.ico' ) { res.writeHead(204); return res.end(); }
	if ( urlPath === '/' ) urlPath = '/index.html';
	const filePath = path.normalize(path.join(PUBLIC, urlPath));
	if ( !filePath.startsWith(PUBLIC) ) { res.writeHead(403); return res.end('forbidden'); }
	fs.readFile(filePath, ( err, buf ) => {
		if ( err ) { res.writeHead(404); return res.end('not found'); }
		res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
		res.end(buf);
	});
}

function createServer( { Graph, ask, root, logger } = {} ) {
	const studio = new Studio({ Graph, ask, root, logger });
	const httpServer = http.createServer(serveStatic);
	const wss = new WebSocketServer({ server: httpServer });

	wss.on('connection', ( ws ) => {
		const onEvent = ( e ) => { if ( ws.readyState === ws.OPEN ) ws.send(JSON.stringify(e)); };
		studio.on('event', onEvent);
		ws.on('close', () => studio.off('event', onEvent));
		ws.on('message', async ( data ) => {
			let msg;
			try { msg = JSON.parse(data.toString()); } catch ( e ) { return; }
			const { id, sessionId, op, args } = msg;
			try {
				if ( !OPS.includes(op) ) throw new Error('unknown op: ' + op);
				const result = await dispatch(studio, sessionId, op, args || {});
				ws.send(JSON.stringify({ id, ok: true, result }));
			} catch ( e ) {
				ws.send(JSON.stringify({ id, ok: false, error: e.message }));
			}
		});
	});

	return {
		httpServer, studio,
		listen( port, cb ) { httpServer.listen(port, cb); return this; },
		close( cb ) { wss.close(); httpServer.close(cb); }
	};
}

module.exports = { createServer };
