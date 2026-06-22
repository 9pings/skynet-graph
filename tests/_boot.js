// Shared bootstrap: define server flag + register babel so the ESM-ish engine loads under Node.
global.__SERVER__ = true;
require('@babel/register')({
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  ignore: [/node_modules/],
  extensions: ['.js'],
  cache: true,
});
module.exports = require('../lib/graph/index.js'); // -> Graph
