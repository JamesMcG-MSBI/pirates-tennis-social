import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { applyCommand, newSession, restoreSession } from './public/model.js';

const root = dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/model.js', ['model.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);

export function createApp({ dataFile = resolve(root, 'data/session.json') } = {}) {
  let state = existsSync(dataFile) ? restoreSession(JSON.parse(readFileSync(dataFile, 'utf8'))) : newSession();
  const send = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.method === 'GET' && req.url === '/api/state') return send(res, 200, state);
      if (req.method === 'POST' && req.url === '/api/command') {
        const origin = req.headers.origin;
        if ((origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) ||
            req.headers['sec-fetch-site'] === 'cross-site') {
          return send(res, 403, { error: 'Use the session board to make changes.' });
        }
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
          return send(res, 415, { error: 'Send JSON requests only.' });
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 8192) {
            send(res, 413, { error: 'Request is too large.' });
            return;
          }
        }
        let command;
        try { command = JSON.parse(body); } catch {
          return send(res, 400, { error: 'Invalid JSON.' });
        }
        if (command?.version !== state.version) {
          return send(res, 409, { error: 'The board changed. Please try again.', state });
        }
        let next;
        try {
          next = applyCommand(state, command, { id: randomUUID(), now: Date.now() });
        } catch (error) {
          return send(res, 400, { error: error.message });
        }
        mkdirSync(dirname(dataFile), { recursive: true });
        writeFileSync(`${dataFile}.tmp`, JSON.stringify(next), { mode: 0o600 });
        renameSync(`${dataFile}.tmp`, dataFile);
        state = next;
        return send(res, 200, state);
      }
      const asset = assets.get(req.url);
      if (req.method === 'GET' && asset) {
        res.writeHead(200, { 'Content-Type': asset[1] });
        return res.end(readFileSync(resolve(root, 'public', asset[0])));
      }
      send(res, 404, { error: 'Not found.' });
    } catch (error) {
      console.error('Request failed:', error);
      if (!res.headersSent) send(res, 500, { error: 'Could not save the board. Please try again.' });
      else res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  createApp({ dataFile: process.env.DATA_FILE || resolve(root, 'data/session.json') })
    .listen(port, host, () => console.log(`Pirates Social Tennis: http://${host}:${port}`));
}
