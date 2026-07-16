'use strict';
// Deep-path back-compat shim — the catalog moved to lib/factories/ (the "combo" name is retired:
// a combo was simply a plugin's packaged FACTORY). Remove at 2.0.
module.exports = require('../factories');
