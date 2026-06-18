const Graph = require('./_boot.js');
console.log('Graph loaded:', typeof Graph);
console.log('statics:', Object.keys(Graph));
console.log('proto methods (sample):', Object.keys(Graph.prototype).slice(0, 12));
