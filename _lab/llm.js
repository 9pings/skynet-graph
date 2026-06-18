// Minimal Anthropic-style client (Node 24 global fetch). Configurable via env.
const BASE = process.env.LLM_BASE || 'http://localhost:3000';
const MODEL = process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
const KEY = process.env.LLM_KEY || 'sk-local';

async function ask({ system, user, maxTokens = 1024 }) {
  const res = await fetch(BASE.replace(/\/$/, '') + '/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY,
      'authorization': 'Bearer ' + KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.content || []).map((b) => b.text || '').join('');
}

// Robust against "thinking" models that emit a long trace then the real JSON last.
// Returns the LAST balanced {...}/[...] block that JSON.parses.
function parseJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall through */ } }
  const candidates = [];
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) { candidates.push(text.slice(i, j + 1)); break; } }
    }
  }
  for (let k = candidates.length - 1; k >= 0; k--) {
    try { return JSON.parse(candidates[k]); } catch { /* try previous */ }
  }
  throw new Error('no parseable JSON in: ' + text.slice(0, 120));
}

module.exports = { ask, parseJSON, BASE, MODEL };
