'use strict';
/* ARCADE leaderboard + feedback API — shared across all games.
   Endpoints:
     GET  /api/leaderboard/<game>?limit=N   -> top N scores
     POST /api/leaderboard/<game>           -> {name, score, meta} -> {rank, total}
     GET  /api/feedback?limit=N             -> recent feedback
     POST /api/feedback                     -> {text, game} -> {id, ts}
   Persists to JSON files on a mounted volume (DATA_DIR, default /data).
   Zero dependencies — Node built-ins only. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'leaderboard.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
const MAX_PER_GAME = 200;
const MAX_NAME_LEN = 20;
const MAX_META_LEN = 40;
const MAX_FEEDBACK_LEN = 1000;
const MAX_FEEDBACK_KEPT = 500;

let db = {};
try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  db = {};
}
for (const g of Object.keys(db)) {
  if (!Array.isArray(db[g])) delete db[g];
}

let feedback = [];
try {
  const parsed = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
  if (Array.isArray(parsed)) feedback = parsed;
} catch (e) {
  feedback = [];
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db));
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedback));
  } catch (e) {
    console.error('persist failed:', e.message);
  }
}

function clean(s, max) {
  return String(s || '').replace(/[<>&"']/g, '').trim().slice(0, max);
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');

  // ---- feedback endpoints ----
  if (url.pathname === '/api/feedback') {
    if (req.method === 'GET') {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), 100);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ feedback: feedback.slice(0, limit) }));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let entry = {};
        try { entry = JSON.parse(body || '{}'); } catch (e) { /* fall through */ }
        const text = clean(entry.text, MAX_FEEDBACK_LEN);
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'text is required' }));
          return;
        }
        const rec = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          text,
          game: clean(entry.game, 40),
          ts: Date.now()
        };
        feedback.unshift(rec);
        if (feedback.length > MAX_FEEDBACK_KEPT) feedback.length = MAX_FEEDBACK_KEPT;
        save();
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: rec.id, ts: rec.ts }));
      });
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }

  const m = url.pathname.match(/^\/api\/leaderboard\/([a-z0-9-]+)$/);
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  const game = m[1];
  if (!db[game]) db[game] = [];

  if (req.method === 'GET') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), 50);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ game, scores: db[game].slice(0, limit) }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let entry = {};
      try { entry = JSON.parse(body || '{}'); } catch (e) { /* fall through */ }
      const score = Math.max(0, Math.floor(Number(entry.score) || 0));
      const name = clean(entry.name, MAX_NAME_LEN) || 'PLAYER';
      const meta = clean(entry.meta, MAX_META_LEN);
      if (score <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'score must be > 0' }));
        return;
      }
      const rec = { name, score, meta, ts: Date.now() };
      db[game].push(rec);
      db[game].sort((a, b) => b.score - a.score);
      if (db[game].length > MAX_PER_GAME) db[game].length = MAX_PER_GAME;
      save();
      const rank = db[game].indexOf(rec) + 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ game, rank, total: db[game].length }));
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
});

const PORT = parseInt(process.env.PORT || '8080', 10);
server.listen(PORT, () => console.log('leaderboard API listening on :' + PORT));
