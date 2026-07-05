'use strict';
/* debug-alias-intake.js — replay the G4 memo (0 GPU new calls) and dump per-episode intake + OOV. */
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};
const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';

( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const { ask } = makeDurableAsk(raw, { dir: path.join(__dirname, 'memo'), meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });

	const COLORS = ['yellow', 'red', 'blue', 'green'];
	const holes3 = ( third ) => [{ w: 'star-shaped', cat: 'star' }, { w: 'square', cat: 'square' }, { w: third || 'round', cat: 'round' }];
	const EPISODES = [];
	const ep = ( axis, variant, o ) => EPISODES.push(Object.assign({ axis, variant }, o));
	['0', '1', '2'].forEach(( i, k ) => ep('kind', 'die', { kindTrue: 'dice', surf: 'die', color: COLORS[k], holes: holes3(), gold: 1 }));
	['0', '1', '2'].forEach(( i, k ) => ep('holeName', 'circular', { kindTrue: 'ball', surf: 'ball', color: COLORS[k + 1 & 3], holes: holes3('circular'), gold: 2 }));
	['0', '1'].forEach(( i, k ) => ep('condition', 'liquefied', { kindTrue: 'sugarcube', surf: 'sugar cube', cond: 'liquefied', color: COLORS[k + 2 & 3], holes: holes3(), gold: null }));
	ep('control-invocab', 'deflated', { kindTrue: 'football', surf: 'football', cond: 'deflated', color: 'red', holes: holes3(), gold: null });
	['0', '1'].forEach(( i, k ) => ep('benign', 'damp', { kindTrue: 'ball', surf: 'ball', cond: 'damp', color: COLORS[k], holes: holes3(), gold: 2 }));
	ep('benign', 'gleaming', { kindTrue: 'marble', surf: 'marble', cond: 'gleaming', color: 'blue', holes: holes3(), gold: 2 });
	['0', '1'].forEach(( i, k ) => ep('spont-false', 'waterlogged', { kindTrue: 'ball', surf: 'ball', cond: 'waterlogged', color: COLORS[k + 3 & 3], holes: holes3(), gold: 2 }));
	for ( const t of EPISODES )
		t.prose = `You have a ${t.cond ? t.cond + ' ' : ''}${t.color} ${t.surf}. Put it into one of these holes: `
			+ t.holes.map(( h, k ) => (k === 2 ? 'or the ' : 'the ') + h.w + ' one').join(', ') + '. Which one?';

	async function intakeOpen( prose ) {
		const txt = await ask({
			system: 'You extract the structure of a placement puzzle. Copy the words AS WRITTEN in the text (do not normalize).'
				+ ' Reply ONLY JSON: {"object":{"kind":"<the object noun as written>","category":"<its shape word if directly stated, else \\"\\">",'
				+ '"condition":"<its state/condition adjective as written, or \\"\\">","color":"<or \\"\\">","size":"<small|large|\\"\\">"},'
				+ '"holes":[{"name":"<the hole description word as written>","size":"<small|large|\\"\\">"}]}',
			user: prose, maxTokens: 170,
			grammar: { jsonSchema: { type: 'object', properties: {
				object: { type: 'object', properties: { kind: { type: 'string' }, category: { type: 'string' }, condition: { type: 'string' }, color: { type: 'string' }, size: { type: 'string' } },
					required: ['kind', 'category', 'condition', 'color', 'size'] },
				holes: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, size: { type: 'string' } }, required: ['name', 'size'] } },
			}, required: ['object', 'holes'] } },
		});
		try { const m = String(txt).match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt); } catch ( e ) { return null; }
	}

	for ( const t of EPISODES ) {
		const prose = String(await ask({ system: 'Reword this puzzle in a different natural style, SAME facts, SAME question. Reply ONLY the reworded text.', user: t.prose, maxTokens: 120 })).trim();
		const x = await intakeOpen(prose);
		console.log('── [' + t.axis + '/' + t.variant + ']');
		console.log('   prose: ' + prose.replace(/\s+/g, ' ').slice(0, 150));
		console.log('   x: ' + JSON.stringify(x && { object: x.object, holes: x.holes }));
	}
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
