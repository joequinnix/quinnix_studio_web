#!/usr/bin/env node
/* Adds the starter projects in data/joe-projects.json through your LIVE admin API.
   - Dry run by default (prints what it would do). Add --apply to really create.
   - Create-only: skips any title that already exists; never edits or deletes.
   Usage:
     SITE=https://quinnix-studio-web.onrender.com ADMIN_PASSWORD='your-password' node scripts/seed-joe-projects.js
     ... --apply
*/
const fs = require('fs'), path = require('path');
const SITE = (process.env.SITE || 'https://quinnix-studio-web.onrender.com').replace(/\/$/, '');
const PASS = process.env.ADMIN_PASSWORD, APPLY = process.argv.includes('--apply');
if (!PASS) { console.error('Set ADMIN_PASSWORD in the environment (not on the command line history if you can avoid it).'); process.exit(1); }
const items = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'joe-projects.json'), 'utf8'));
(async () => {
  const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return {}; } };
  const lg = await fetch(SITE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASS }) });
  const { token } = await j(lg);
  if (!token) { console.error('Login failed.'); process.exit(1); }
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
  const existing = await j(await fetch(SITE + '/api/portfolio'));
  const have = new Set((Array.isArray(existing) ? existing : []).map(p => String(p.title).trim().toLowerCase()));
  for (const it of items) {
    if (have.has(it.title.trim().toLowerCase())) { console.log('skip (exists):', it.title); continue; }
    if (!APPLY) { console.log('would create:', it.title); continue; }
    const r = await fetch(SITE + '/api/portfolio', { method: 'POST', headers: H, body: JSON.stringify({ ...it, images: [], coverImage: null }) });
    console.log(r.ok ? 'created:' : 'FAILED (' + r.status + '):', it.title);
  }
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to create.');
})().catch(e => { console.error(e.message); process.exit(1); });
