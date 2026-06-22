// Shared bootstrap: set the server flag, then load the (now pure-CommonJS) engine
// directly — no Babel/transpile, so Node runs and debugs the source as-is.
global.__SERVER__ = true;
module.exports = require('../lib/graph/index.js'); // -> Graph
