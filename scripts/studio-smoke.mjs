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

	await page.screenshot({ path: '/tmp/studio-smoke.png', fullPage: true });
	console.log('rendered: nodes=' + nodes + ' edges=' + edges + ' | layouts: ' + layouts.join(','));
} catch ( e ) {
	errors.push('SCRIPT: ' + e.message);
} finally {
	if ( browser ) await browser.close();
	cleanup();
}

if ( errors.length ) { console.log('\nFAIL — ' + errors.length + ' error(s):\n' + errors.join('\n')); process.exit(1); }
console.log('\nSMOKE OK — page loaded, canvas rendered, all layouts ran, no console errors.');
