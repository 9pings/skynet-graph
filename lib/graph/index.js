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


// `__SERVER__` is a host/build flag (true = node/server, false = browser/client) read as
// a bare global by the engine. Default it to server when undefined so the lib loads
// standalone without a ReferenceError; a browser host can set globalThis.__SERVER__ =
// false before requiring the engine. (Previously injected by webpack DefinePlugin / _boot.)
if ( typeof globalThis.__SERVER__ === 'undefined' ) globalThis.__SERVER__ = true;

module.exports = require('./Graph.js');