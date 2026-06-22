/**
 * Copyright (C) 2021  Nathanael Braun
 * @author Nathanael BRAUN
 *
 * Date: 14/01/2016
 * Time: 09:32
 */

// `__SERVER__` is a host/build flag (true = node/server, false = browser/client) read as
// a bare global by the engine. Default it to server when undefined so the lib loads
// standalone without a ReferenceError; a browser host can set globalThis.__SERVER__ =
// false before requiring the engine. (Previously injected by webpack DefinePlugin / _boot.)
if ( typeof globalThis.__SERVER__ === 'undefined' ) globalThis.__SERVER__ = true;

module.exports = require('./Graph.js');