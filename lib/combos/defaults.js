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
 * Combos — the SHARED product-default module (roadmap P1 / design doc §2).
 *
 * The ONE place the default posture (§4 of studies/2026-07-04-inventaire-outils-combos.md) is
 * decided, so every `lib/combos/*` component wires the SAME knobs instead of each re-deciding them.
 * CONFIG ONLY — each field is a flag or a brick option passed straight through; NO behavior lives
 * here (behavior would make this a brick-in-disguise, violating the thin-assembly rule). The
 * default posture, from the convergent findings:
 *   fail-closed ON · admission gate ON · IntakeStatus required downstream · durable memo ON ·
 *   author-time validator ON · logs `warn` + audit · constrained grammar OFF (STAGE-1 finding) ·
 *   effectful providers / embedded LLM / durable / learning = OPT-IN by argument (never by env).
 */

/**
 * resolveComboDefaults(opts) → the resolved §4 knob-set, host overrides merged in.
 * @returns {{
 *   failClosed:boolean, gate:'gated'|'ungated', requireTyped:boolean, memo:boolean,
 *   validate:boolean, logLevel:string, audit:boolean, grammar:boolean,
 *   ask:(function|{localModel:string}|null), durable:(object|string|null), learning:boolean
 * }}
 */
function resolveComboDefaults( opts ) {
	opts = opts || {};
	return {
		failClosed  : opts.failClosed   !== false,   // ON  — canon/snap/mount fail-closed
		gate        : opts.gate          || 'gated', // ON  — admission gate (parametric/registry, gated)
		requireTyped: opts.requireTyped  !== false,  // ON  — downstream ensure IntakeStatus=='typed'
		memo        : opts.memo          !== false,  // ON  — content-addressed cache, un-cacheable on CanonMiss
		validate    : opts.validate      !== false,  // ON  — validateOrThrow before the tree reaches the engine
		logLevel    : opts.logLevel      || 'warn',
		audit       : opts.audit         !== false,  // ON  — apply-correlated trace / durable audit available
		grammar     : opts.grammar       === true,   // OFF — STAGE-1 finding; opt-in, per-call on the borderline gate
		ask         : opts.ask           || null,    // opt-in — NO default LLM backend
		durable     : opts.durable       || null,    // opt-in — off = in-memory / none
		learning    : opts.learning      === true    // opt-in — creative loop off by default
	};
}

/**
 * buildAsk(d) → resolve `d.ask` to an async `({system,user,maxTokens}) -> string`.
 *   - a function            → returned as-is (host-supplied backend)
 *   - { localModel:'<gguf>' } → the embedded node-llama-cpp `ask` via the shared host, with the §4
 *                             default `reasoningBudget:0` applied HERE (one place, not re-decided per combo)
 *   - null / absent         → throws (the combo needs a backend)
 *
 * Grammar is deliberately NOT wired here (finding R3): `makeLocalAsk` reads `jsonSchema`/`gbnf`, never
 * a boolean `grammar`; constrained decoding is a per-call seam on the borderline gate, opt-in. So
 * `buildAsk` never touches grammar — the STAGE-1 default (OFF) is simply "pass no schema".
 * The `llm-local`/`local-host` requires are LAZY (only when `{localModel}` is used), so a host that
 * injects its own `ask` never loads the native dependency.
 */
function buildAsk( d ) {
	var a = d && d.ask;
	if ( typeof a === 'function' ) return a;
	if ( a && a.localModel ) {
		var sharedLocalModelHost = require('../providers/local-host.js').sharedLocalModelHost;
		var makeLocalAsk = require('../providers/llm-local.js').makeLocalAsk;
		return makeLocalAsk({
			modelPath      : a.localModel,
			reasoningBudget: a.reasoningBudget != null ? a.reasoningBudget : 0,
			seed           : a.seed,
			host           : sharedLocalModelHost()
		});
	}
	throw new Error('combo needs a backend: pass opts.ask (a function, or { localModel: "<path.gguf>" })');
}

module.exports = { resolveComboDefaults: resolveComboDefaults, buildAsk: buildAsk };
