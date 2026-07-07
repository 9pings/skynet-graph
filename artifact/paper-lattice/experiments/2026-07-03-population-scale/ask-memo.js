'use strict';
/*
 * ask-memo.js — le G-MEMO du PROTOCOL v2 (Laurie 7, 2e non-demandé) : memo d'ask DURABLE, content-addressed,
 * sur disque — partagé par TOUTES les tranches et les deux arms, pour que chaque replay/reprise fasse face à
 * la MÊME fonction-modèle (le non-déterminisme GPU cross-process est documenté ; sans memo durable, deux
 * tranches courues à des moments différents corrompent le contraste inter-arms).
 * Clé = sha256 du JSON canonique {modelPath, seed, reasoningBudget, system, user, maxTokens, grammar}.
 * Valeur = memo/<clé>.json { response, at, meta } — lisible, greppable, diffable (jamais un blob opaque).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function makeDurableAsk( raw, opts ) {
	const dir = (opts && opts.dir) || path.join(__dirname, 'memo');
	const meta = (opts && opts.meta) || {};
	fs.mkdirSync(dir, { recursive: true });
	const stats = { hits: 0, misses: 0 };
	const ask = async ( o ) => {
		const key = crypto.createHash('sha256').update(JSON.stringify([
			meta.modelPath || '', meta.seed == null ? 0 : meta.seed, meta.reasoningBudget == null ? 0 : meta.reasoningBudget,
			o.system, o.user, o.maxTokens, o.grammar && o.grammar.jsonSchema || null,
		])).digest('hex');
		const file = path.join(dir, key + '.json');
		if ( fs.existsSync(file) ) { stats.hits++; return JSON.parse(fs.readFileSync(file, 'utf8')).response; }
		const response = await raw(o);
		stats.misses++;
		fs.writeFileSync(file, JSON.stringify({ response, at: meta.at || null, meta: { system: o.system.slice(0, 120), user: o.user.slice(0, 200) } }, null, 1));
		return response;
	};
	return { ask, stats, dir };
}

module.exports = { makeDurableAsk };
