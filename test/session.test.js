import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newSession, applyCommand, balanceTeams, suggestGroup } from '../public/model.js';
import { createApp } from '../server.js';

function fixture(count = 8) {
  let state = newSession();
  const run = payload => {
    state = applyCommand(state, { version: state.version, ...payload },
      { id: `p${state.version}`, now: state.version * 1000 });
    return state;
  };
  for (let i = 0; i < count; i++) run({ type: 'join', name: `Player ${i}`, level: i % 5 + 1 });
  return { run, get state() { return state; } };
}

test('check-in preserves arrival order, normalizes names, and rejects duplicates and invalid levels', () => {
  const f = fixture(0);
  f.run({ type: 'join', name: '  Alex   Smith ', level: 3 });
  assert.equal(f.state.players[0].name, 'Alex Smith');
  for (const payload of [
    { name: 'alex smith', level: 2 }, { name: '', level: 3 },
    { name: 'A'.repeat(41), level: 3 }, { name: 'Bob', level: 0 },
    { name: 'Bob', level: 6 }, { name: 'Bob', level: 2.5 },
  ]) assert.throws(() => f.run({ type: 'join', ...payload }));
  f.run({ type: 'join', name: 'Bob', level: 4 });
  assert.deepEqual(f.state.queue, ['p0', 'p1']);
});

test('first player is mandatory and selections are limited to the first seven', () => {
  const f = fixture();
  const original = structuredClone(f.state);
  for (const ids of [
    ['p1', 'p2', 'p3', 'p4'], ['p0', 'p1', 'p2', 'p7'],
    ['p0', 'p1', 'p2', 'p2'], ['p0', 'p1', 'p2'],
  ]) assert.throws(() => f.run({ type: 'start', courtId: '1', playerIds: ids }));
  assert.deepEqual(f.state, original);
  f.run({ type: 'start', courtId: '1', playerIds: ['p6', 'p0', 'p4', 'p2'] });
  assert.deepEqual(f.state.queue, ['p1', 'p3', 'p5', 'p7']);
  assert.deepEqual(f.state.courts[0].playerIds, ['p0', 'p2', 'p4', 'p6']);
  assert.equal(f.state.players.filter(p => p.status === 'playing').length, 4);
});

test('finishing a court returns all four behind waiting players exactly once', () => {
  const f = fixture();
  f.run({ type: 'start', courtId: '1', playerIds: ['p0', 'p1', 'p2', 'p3'] });
  assert.throws(() => f.run({ type: 'leave', playerId: 'p0' }));
  assert.throws(() => f.run({ type: 'pause', playerId: 'p0' }));
  assert.throws(() => f.run({ type: 'start', courtId: '1', playerIds: ['p4', 'p5', 'p6', 'p7'] }));
  f.run({ type: 'finish', courtId: '1' });
  assert.deepEqual(f.state.queue, ['p4', 'p5', 'p6', 'p7', 'p0', 'p1', 'p2', 'p3']);
  assert.equal(f.state.players[0].setsPlayed, 1);
  assert.equal(f.state.players[0].status, 'waiting');
  assert.equal(f.state.history.length, 1);
  assert.deepEqual(f.state.courts[0].teams, []);
  assert.throws(() => f.run({ type: 'finish', courtId: '1' }));
});

test('pause, rejoin and leave preserve the queue and reject stale edits', () => {
  const f = fixture();
  f.run({ type: 'pause', playerId: 'p0' });
  assert.equal(f.state.queue[0], 'p1');
  assert.equal(f.state.players[0].status, 'paused');
  assert.throws(() => f.run({ type: 'pause', playerId: 'p0' }));
  f.run({ type: 'resume', playerId: 'p0' });
  assert.equal(f.state.queue.at(-1), 'p0');
  f.run({ type: 'leave', playerId: 'p0' });
  assert.equal(f.state.players.length, 7);
  assert(!f.state.queue.includes('p0'));
  assert.throws(() => f.run({ type: 'resume', playerId: 'p0' }));
  assert.throws(() => f.run({ type: 'pause', playerId: 'p1', version: 0 }), /board changed/);
});

test('suggestions are legal, balance ratings, and avoid recent partners on equal balance', () => {
  const f = fixture();
  const suggested = suggestGroup(f.state);
  assert.equal(suggested.length, 4);
  assert(suggested.includes('p0'));
  assert(suggested.every(id => f.state.queue.slice(0, 7).includes(id)));
  assert.deepEqual(suggestGroup(fixture(3).state), []);
  const state = fixture(4).state;
  state.players.forEach(p => { p.level = 3; });
  const original = balanceTeams(state, state.queue);
  state.history.push({ teams: original });
  const rotated = balanceTeams(state, state.queue);
  assert.notDeepEqual(rotated, original);
  state.history = [];
  [1, 2, 4, 5].forEach((level, i) => { state.players[i].level = level; });
  const teams = balanceTeams(state, state.queue);
  const totals = teams.map(team => team.reduce((sum, id) => sum + state.players.find(p => p.id === id).level, 0));
  assert.equal(totals[0], totals[1]);
});

test('multiple courts retain unique player assignments and queue order', () => {
  const f = fixture(12);
  for (let i = 1; i <= 3; i++) f.run({ type: 'start', courtId: String(i), playerIds: f.state.queue.slice(0, 4) });
  assert.equal(f.state.queue.length, 0);
  f.run({ type: 'finish', courtId: '2' });
  f.run({ type: 'finish', courtId: '1' });
  assert.deepEqual(f.state.queue, ['p4', 'p5', 'p6', 'p7', 'p0', 'p1', 'p2', 'p3']);
});

test('HTTP API persists state, rejects concurrent writes, and protects request boundaries', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pirates-test-'));
  const dataFile = join(directory, 'session.json');
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    })));
    rmSync(directory, { recursive: true, force: true });
  });
  async function listen() {
    const server = createApp({ dataFile });
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const base = await listen();
  const post = (body, headers = {}) => fetch(`${base}/api/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const payload = { type: 'join', version: 0, name: '<img src=x onerror=alert(1)>', level: 3 };
  const results = await Promise.all([post(payload), post(payload)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.players.length, 1);
  assert.equal(state.players[0].name, payload.name);
  assert.equal((await post({ ...payload, version: 1 }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await post({}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post('x'.repeat(9000))).status, 413);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
  assert.equal((await fetch(`${base}/data/session.json`)).status, 404);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const restarted = await listen();
  assert.deepEqual(await (await fetch(`${restarted}/api/state`)).json(), state);
});
