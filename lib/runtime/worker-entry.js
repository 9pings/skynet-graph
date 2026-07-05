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
 * Worker-thread entry — the worker_threads adaptor for the transport-agnostic worker protocol (protocol.js).
 * It wraps `parentPort` as a channel and hands it to `attachWorker`; all the init/dispatch/ask logic lives in
 * protocol.js so the socket transport (transport-socket.js) runs the identical handler over a socket.
 */
var parentPort = require('worker_threads').parentPort;
var attachWorker = require('./protocol.js').attachWorker;

attachWorker({
	send: function ( m ) { parentPort.postMessage(m); },
	onMessage: function ( fn ) { parentPort.on('message', fn); },
	close: function () { process.exit(0); }
});
