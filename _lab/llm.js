// Thin re-export of the packaged, backend-agnostic LLM provider (providers/llm.js).
// Kept so the existing _lab demos (run-problem.js) import { ask, parseJSON, BASE, MODEL }.
const { makeAsk, parseJSON } = require('../providers/llm.js');

const BASE = process.env.LLM_BASE || 'http://localhost:3000';
const MODEL = process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
const ask = makeAsk({ base: BASE, model: MODEL });

module.exports = { ask, parseJSON, BASE, MODEL };
