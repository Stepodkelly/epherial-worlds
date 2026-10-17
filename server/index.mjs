import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDay } from './day.mjs';
import { commit, recall } from './graph.mjs';
import { attachRoom } from './room.mjs';
import { nameObject, sequenceDay } from './voice.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function loadEnv() {
  let text = '';
  try {
    text = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnv();

function sendJson(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

let packCache = null;
function worldPack() {
  if (!packCache) packCache = JSON.parse(readFileSync(join(root, 'world-pack.json'), 'utf8'));
  return packCache;
}

async function dayPayload() {
  const pack = worldPack();
  const day = await loadDay({ pack });
  if (!day.events?.length) return day;
  const sequenced = await Promise.race([
    sequenceDay({
      events: day.events,
      templates: Object.values(pack.voice || {}),
      voice: pack.voice || {},
    }),
    new Promise((resolve) => {
      setTimeout(() => resolve(null), 8000);
    }),
  ]);
  if (sequenced?.line) day.line = sequenced.line;
  return day;
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  if (decoded.includes('\0')) return '';
  const relative = decoded.replace(/^\/+/, '');
  if (!relative || relative === '.') return join(root, 'app', 'index.html');
  const filePath = normalize(join(root, relative));
  if (filePath !== root && !filePath.startsWith(`${root}/`)) return '';
  const base = filePath.slice(root.length + 1).split('/')[0];
  if (base === '.env' || base.startsWith('.env') || base === '.git' || base === 'node_modules') return '';
  return filePath;
}

function sendFile(res, filePath) {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  if (stat.isDirectory()) {
    sendFile(res, join(filePath, 'index.html'));
    return;
  }
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'no-cache',
  });
  res.end(readFileSync(filePath));
}

export async function handleRequest(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/day' && req.method === 'GET') {
      sendJson(res, await dayPayload());
      return;
    }
    if (url.pathname === '/api/recall' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, await recall(body || {}));
      return;
    }
    if (url.pathname === '/api/commit' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, await commit(body || {}));
      return;
    }
    if (url.pathname === '/api/name' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, await nameObject(body || {}));
      return;
    }
    if (url.pathname === '/api/sequence' && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, await sequenceDay(body || {}));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, { error: true }, 404);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }
    const filePath = safeFile(url.pathname);
    if (!filePath) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }
    sendFile(res, filePath);
  } catch (error) {
    const status = error?.status || 500;
    if (url.pathname.startsWith('/api/')) {
      const quiet = url.pathname === '/api/recall' || url.pathname === '/api/commit';
      sendJson(res, quiet ? { enabled: false } : { error: true }, status === 500 ? 200 : status);
      return;
    }
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The floor could not answer.');
  }
}

export function createServer() {
  const server = http.createServer((req, res) => {
    handleRequest(req, res);
  });
  attachRoom(server);
  return server;
}

const launched = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (launched) {
  const port = Number(process.env.PORT || 8770);
  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Epherial floor on http://127.0.0.1:${port}/app/`);
  });
}
