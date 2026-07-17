'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 *
 * Render the social-preview card for the GitHub Pages site → docs/img/og-card.png (1200x630).
 *
 *   node scripts/build-og-card.js
 *
 * Why a script and not a hand-made PNG: the card carries NUMBERS (the head-to-head, the zoom), and a number
 * on a launch image is a claim like any other — it has to be regenerable the day it changes, not redrawn by
 * hand and quietly left stale. Edit CARD below, re-run, commit the png.
 *
 * Deliberately system-font-only (no webfont fetch): the renderer must work offline and produce the same
 * bytes on any machine. Palette + sans stack = docs/index.html's tokens, dark-only (no serif: the page
 * dropped it in the 07-17 legibility pass, and the card must not drift from the page).
 */
const path = require('path');
const puppeteer = require('puppeteer');

const OUT = path.join(__dirname, '..', 'docs', 'img', 'og-card.png');

const CARD = /* html */ `
<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0; padding:0; box-sizing:border-box}
  :root{
    --bg:#0a0d0e; --panel-2:#0c1113; --edge:rgba(120,205,192,.14);
    --ink:#eef2ee; --dim:#a8b4ac; --signal:#37d7c2; --signal-2:#28a596; --amber:#e7b24e; --ok:#6fe08c;
    --mono:ui-monospace,'DejaVu Sans Mono','Liberation Mono',Menlo,monospace;
    --sans:'Inter','DejaVu Sans','Liberation Sans',Helvetica,Arial,sans-serif;
  }
  body{
    width:1200px; height:630px; background:var(--bg); color:var(--ink);
    font-family:var(--sans); position:relative; overflow:hidden;
    display:flex; flex-direction:column; justify-content:center; padding:0 76px;
  }
  /* the faint grid + a signal glow, echoing the site */
  body::before{content:''; position:absolute; inset:0;
    background-image:linear-gradient(rgba(120,205,192,.045) 1px,transparent 1px),
                     linear-gradient(90deg,rgba(120,205,192,.045) 1px,transparent 1px);
    background-size:44px 44px;}
  body::after{content:''; position:absolute; top:-220px; right:-160px; width:640px; height:640px;
    background:radial-gradient(circle,rgba(55,215,194,.13),transparent 62%); }
  .in{position:relative; z-index:1}
  .tag{font-family:var(--mono); font-size:19px; letter-spacing:.24em; text-transform:uppercase;
    color:var(--signal-2); margin-bottom:22px}
  h1{font-size:64px; line-height:1.07; font-weight:600; letter-spacing:-.02em; margin-bottom:22px}
  h1 b{font-weight:700; color:var(--signal)}
  p{font-size:26px; line-height:1.42; color:var(--dim); max-width:34ch; margin-bottom:36px}
  .stats{display:flex; gap:12px}
  .s{font-family:var(--mono); font-size:17.5px; border:1px solid var(--edge); background:var(--panel-2);
    border-radius:9px; padding:11px 15px; color:var(--dim); white-space:nowrap}
  .s b{color:var(--ink); font-weight:700}
  .s .g{color:var(--ok)} .s .a{color:var(--amber)}
  .foot{position:absolute; left:76px; bottom:44px; z-index:1; font-family:var(--mono); font-size:17px;
    color:var(--dim); letter-spacing:.03em}
  .foot b{color:var(--signal)} .foot b.g{color:var(--ok)}
</style></head><body>
  <div class="in">
    <div class="tag">skynet-graph</div>
    <h1>An externalized<br><b>reasoning layer</b> for LLMs</h1>
    <p>Typed facts, declarative rules, truth maintenance — reasoning you can test, replay and reopen.</p>
    <div class="stats">
      <div class="s">piece-by-piece <b>16→52%</b></div>
      <div class="s">certified steering <b>8→63%</b></div>
      <div class="s">on a <b class="g">9.5 GB</b> local quant</div>
    </div>
  </div>
  <div class="foot">runs on your local model · <b class="g">bit-identical replay</b> · AGPL-3.0 · <b>github.com/9pings/skynet-graph</b></div>
</body></html>`;

(async () => {
	const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
	const p = await b.newPage();
	await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
	await p.setContent(CARD, { waitUntil: 'load' });
	await p.screenshot({ path: OUT });
	await b.close();
	console.log('wrote ' + path.relative(path.join(__dirname, '..'), OUT) + ' (1200x630)');
})().catch(( e ) => { console.error(e); process.exit(1); });
