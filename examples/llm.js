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
// Thin re-export of the packaged, backend-agnostic LLM provider (providers/llm.js).
// Kept so the existing examples demos (run-problem.js) import { ask, parseJSON, BASE, MODEL }.
const { makeAsk, parseJSON } = require('../lib/providers/llm.js');

const BASE = process.env.LLM_BASE || 'http://localhost:3000';
const MODEL = process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
const ask = makeAsk({ base: BASE, model: MODEL });

module.exports = { ask, parseJSON, BASE, MODEL };
