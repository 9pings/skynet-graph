// Headless browser smoke for `sg studio`: boots the server, loads the page,
// switches corpus + seeds, exercises every layout, and FAILS on any console/page
// error. Run: node scripts/studio-smoke.mjs
import { spawn } from 'child_process';
import puppeteer from 'puppeteer';

const PORT = Number(process.env.PORT) || 4990;
const URL = 'http://localhost:' + PORT + '/';

const server = spawn('node', ['bin/sg', 'studio', '--port', String(PORT), '--root', '.'], { stdio: 'ignore' });
const cleanup = () => { try { server.kill(); } catch ( e ) {} };
process.on('exit', cleanup);

async function waitServer() {
	for ( let i = 0; i < 60; i++ ) {
		try { const r = await fetch(URL); if ( r.ok ) return; } catch ( e ) {}
		await new Promise(( r ) => setTimeout(r, 100));
	}
	throw new Error('server did not start');
}

const errors = [];
let browser;
try {
	await waitServer();
	browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 800 });
	page.on('console', ( m ) => { if ( m.type() === 'error' ) errors.push('console.error: ' + m.text()); });
	page.on('pageerror', ( e ) => errors.push('pageerror: ' + e.message));
	page.on('requestfailed', ( r ) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
	page.on('response', ( r ) => { if ( r.status() >= 400 ) errors.push('http ' + r.status() + ': ' + r.url()); });

	await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
	// React mounted + ws connected
	await page.waitForFunction(() => {
		const s = document.querySelector('.status');
		return s && /live/.test(s.textContent);
	}, { timeout: 20000 });

	// pick the `concepts` corpus (first select = corpus)
	await page.select('.toolbar > select', 'concepts');
	// click "seed demo"
	await page.evaluate(() => {
		const b = [...document.querySelectorAll('.toolbar button')].find(( x ) => x.textContent.includes('seed demo'));
		if ( b ) b.click();
	});
	// canvas populated
	await page.waitForFunction(() => window.__sgCy && window.__sgCy.nodes().length >= 2, { timeout: 20000 });
	const nodes = await page.evaluate(() => window.__sgCy.nodes().length);
	const edges = await page.evaluate(() => window.__sgCy.edges().length);

	// exercise every layout (this is where the ELK constructor error fired)
	const layouts = await page.evaluate(() => [...document.querySelectorAll('.lyt select option')].map(( o ) => o.value));
	for ( const lay of layouts ) {
		await page.select('.lyt select', lay);
		await new Promise(( r ) => setTimeout(r, 900));
	}

	// T9: create a 2nd checkpoint (mutate -> settle), then scrub + diff + rollback for real
	await page.evaluate(() => window.__sgApi && window.__sgApi.call('mutate', { template: { $$_id: 's', note: 'x' }, targetId: 's' }));
	await new Promise(( r ) => setTimeout(r, 1300));
	const ckpts = await page.evaluate(async () => ((await window.__sgApi.call('state')).revs || []).length);
	await page.evaluate(() => {
		const r = document.querySelector('.tl-range');
		if ( r && Number(r.max) > 0 ) {
			const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
			set.call(r, '0');
			r.dispatchEvent(new Event('input', { bubbles: true }));
		}
	});
	await new Promise(( r ) => setTimeout(r, 300));
	await page.evaluate(() => { const b = [...document.querySelectorAll('.timeline button')].find(( x ) => /diff/.test(x.textContent) && !x.disabled); if ( b ) b.click(); });
	await new Promise(( r ) => setTimeout(r, 400));
	const diffShown = await page.evaluate(() => !!document.querySelector('.diffpanel'));
	await page.evaluate(() => { const c = document.querySelector('.diffpanel .dp-head button'); if ( c ) c.click(); });
	await page.evaluate(() => { const b = [...document.querySelectorAll('.timeline button')].find(( x ) => /rollback/.test(x.textContent) && !x.disabled); if ( b ) b.click(); });
	await new Promise(( r ) => setTimeout(r, 800));
	const noteAfter = await page.evaluate(async () => { const s = ((await window.__sgApi.call('state')).objects || []).find(( o ) => o._id === 's'); return s ? (s.note == null ? 'gone' : s.note) : 'no-seg'; });

	// T10: open the concept editor, validate, apply (benign re-patch of Distance)
	await page.evaluate(() => { const c = [...document.querySelectorAll('.concepts .cname')].find(( x ) => x.textContent.trim() === 'Distance'); if ( c ) c.click(); });
	await page.waitForSelector('.em-box', { timeout: 8000 });
	await page.evaluate(() => { const b = [...document.querySelectorAll('.em-actions button')].find(( x ) => /validate/.test(x.textContent)); if ( b ) b.click(); });
	await new Promise(( r ) => setTimeout(r, 500));
	const validation = await page.evaluate(() => { const v = document.querySelector('.em-validation'); return v ? v.className.replace('em-validation ', '').trim() : null; });
	await page.evaluate(() => { const b = [...document.querySelectorAll('.em-actions button')].find(( x ) => /apply/.test(x.textContent) && !x.disabled); if ( b ) b.click(); });
	await new Promise(( r ) => setTimeout(r, 700));
	const editorClosed = await page.evaluate(() => !document.querySelector('.em-box'));

	// T11: fork the active session, verify the switch, then merge back
	await page.evaluate(() => { const b = [...document.querySelectorAll('.fk-head button')].find(( x ) => /fork/.test(x.textContent)); if ( b ) b.click(); });
	await page.waitForFunction(() => { const a = document.querySelector('.fk-item.active .fk-id'); return a && /fork-/.test(a.textContent); }, { timeout: 8000 });
	const activeAfterFork = await page.evaluate(() => { const a = document.querySelector('.fk-item.active .fk-id'); return a ? a.textContent.trim() : null; });
	const forkCount = await page.evaluate(() => document.querySelectorAll('.fk-item').length);
	await page.evaluate(() => { const b = document.querySelector('.fk-merge'); if ( b ) b.click(); });
	await new Promise(( r ) => setTimeout(r, 900));
	const forkNodeMerged = await page.evaluate(async () => ((await window.__sgApi.call('state', {}, 'root')).objects || []).some(( o ) => /^fork-/.test(o._id)));

	// T12: prompt console — submit without an LLM backend -> graceful error notice (no crash)
	await page.evaluate(() => { const i = document.querySelector('.pr-bar input'); if ( i ) { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(i, 'plan a trip to tokyo'); i.dispatchEvent(new Event('input', { bubbles: true })); } });
	await new Promise(( r ) => setTimeout(r, 200));
	await page.evaluate(() => { const b = [...document.querySelectorAll('.pr-bar button')].find(( x ) => /run/.test(x.textContent)); if ( b ) b.click(); });
	await new Promise(( r ) => setTimeout(r, 700));
	const promptErr = await page.evaluate(() => { const e = document.querySelector('.pr-err'); return e ? e.textContent.trim().slice(0, 40) : null; });

	// T13: switch to the GRAMMAR view — the concept↔fact graph renders (its own cytoscape)
	await page.evaluate(() => { const b = [...document.querySelectorAll('.viewtoggle button')].find(( x ) => x.textContent.trim() === 'grammar'); if ( b ) b.click(); });
	await page.waitForFunction(() => window.__sgGrammarCy && window.__sgGrammarCy.nodes().length >= 3, { timeout: 15000 });
	const gNodes = await page.evaluate(() => window.__sgGrammarCy.nodes().length);
	const gEdges = await page.evaluate(() => window.__sgGrammarCy.edges().length);
	if ( !(gNodes >= 3 && gEdges >= 1) ) errors.push('T13: grammar graph did not render (nodes=' + gNodes + ' edges=' + gEdges + ')');

	// T14: corpus exchange — export .sgc (UI button) then re-import via the API (round-trip)
	await page.evaluate(() => { const b = document.querySelector('.cp-export'); if ( b ) b.click(); });
	await page.waitForFunction(() => window.__sgLastBundle && window.__sgLastBundle.format === 'sgc', { timeout: 8000 });
	const exported = await page.evaluate(() => ({ fmt: window.__sgLastBundle.format, sets: Object.keys(window.__sgLastBundle.conceptMap || {}).length, prov: (window.__sgLastBundle.manifest.providersRequired || []).length }));
	const reimported = await page.evaluate(async () => { const r = await window.__sgApi.call('importCorpus', { bundle: window.__sgLastBundle, opts: { builtins: true } }, 'root'); return !!r.ok; });
	if ( exported.fmt !== 'sgc' || !reimported ) errors.push('T14: .sgc export/import round-trip failed (' + JSON.stringify(exported) + ' reimported=' + reimported + ')');

	// T15: retraction — a synthetic ensure-gated concept retracts when its fact falls; the
	//      Session emits 'retract', the app records it (and flashes the node red).
	const retracted = await page.evaluate(async () => {
		window.__sgRetracts = [];
		const conceptMap = { test: { childConcepts: { Tagged: { _id: 'Tagged', _name: 'Tagged', require: 'Segment', ensure: ['$keep==true'] } } } };
		const seed = { conceptMaps: [ { _id: 'a', Node: true }, { _id: 'b', Node: true }, { _id: 's', Segment: true, originNode: 'a', targetNode: 'b', keep: true } ] };
		await window.__sgApi.call('loadCorpus', { conceptMap, sets: ['test'], seed }, 'root');
		await new Promise(( r ) => setTimeout(r, 600));
		await window.__sgApi.call('mutate', { template: { $$_id: 's', keep: false }, targetId: 's' }, 'root');
		await new Promise(( r ) => setTimeout(r, 900));
		return (window.__sgRetracts || []).some(( x ) => x.targetId === 's' && (x.concepts || []).includes('Tagged'));
	});
	if ( !retracted ) errors.push('T15: retraction was not detected/emitted');

	await page.evaluate(() => { const b = [...document.querySelectorAll('.viewtoggle button')].find(( x ) => x.textContent.trim() === 'data'); if ( b ) b.click(); });
	await page.select('.lyt select', 'elk');
	await new Promise(( r ) => setTimeout(r, 600));
	await page.screenshot({ path: '/tmp/studio-smoke.png', fullPage: true });
	console.log('rendered: nodes=' + nodes + ' edges=' + edges + ' | layouts: ' + layouts.join(','));
	console.log('T13 grammar: nodes=' + gNodes + ' edges=' + gEdges);
	console.log('T14 corpus: exported=' + JSON.stringify(exported) + ' reimported=' + reimported);
	console.log('T15 retraction: detected=' + retracted);
	console.log('T9 timeline: checkpoints=' + ckpts + ' diffShown=' + diffShown + ' noteAfterRollback=' + noteAfter);
	console.log('T10 editor: validation=' + validation + ' closedAfterApply=' + editorClosed);
	console.log('T11 forks: activeAfterFork=' + activeAfterFork + ' forkCount=' + forkCount + ' forkNodeMerged=' + forkNodeMerged);
	console.log('T12 prompt: error(no-LLM)=' + JSON.stringify(promptErr));
} catch ( e ) {
	errors.push('SCRIPT: ' + e.message);
} finally {
	if ( browser ) await browser.close();
	cleanup();
}

if ( errors.length ) { console.log('\nFAIL — ' + errors.length + ' error(s):\n' + errors.join('\n')); process.exit(1); }
console.log('\nSMOKE OK — page loaded, canvas rendered, all layouts ran, no console errors.');
