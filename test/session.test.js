import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newSession, restoreSession, applyCommand, suggestGroup } from '../public/model.js';
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
  f.run({ type: 'finish', courtId: '1' });
  assert.deepEqual(f.state.queue, ['p4', 'p5', 'p6', 'p7', 'p1', 'p2', 'p3', 'p0']);
  assert.equal(f.state.players[0].setsPlayed, 1);
  assert.equal(f.state.players[0].status, 'waiting');
  assert.equal(f.state.history.length, 1);
  assert.equal(f.state.completedSets, 1);
  assert.equal(f.state.courts[0].teams, undefined);
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

test('suggestions are legal, prefer similar ability and avoid recent group repeats', () => {
  const f = fixture();
  const suggested = suggestGroup(f.state);
  assert.equal(suggested.length, 4);
  assert(suggested.includes('p0'));
  assert(suggested.every(id => f.state.queue.slice(0, 7).includes(id)));
  assert.deepEqual(suggestGroup(fixture(3).state), []);
  const state = fixture(7).state;
  state.players.forEach(p => { p.level = 3; });
  assert.deepEqual(suggestGroup(state), ['p0', 'p1', 'p2', 'p3']);
  state.history.push({ playerIds: ['p0', 'p1', 'p2', 'p3'] });
  assert.deepEqual(suggestGroup(state), ['p0', 'p4', 'p5', 'p6']);
  state.history = [];
  state.players[1].level = 5;
  assert.deepEqual(suggestGroup(state), ['p0', 'p2', 'p3', 'p4']);
});

test('multiple courts retain unique player assignments and queue order', () => {
  const f = fixture(12);
  for (let i = 1; i <= 3; i++) f.run({ type: 'start', courtId: String(i), playerIds: f.state.queue.slice(0, 4) });
  assert.equal(f.state.queue.length, 0);
  f.run({ type: 'finish', courtId: '2' });
  f.run({ type: 'finish', courtId: '1' });
  assert.deepEqual(f.state.queue, ['p5', 'p6', 'p7', 'p4', 'p1', 'p2', 'p3', 'p0']);
});

test('previous queue order overrides click order and survives restart with picker returning last', () => {
  const f = fixture(8);
  f.run({ type: 'start', playerIds: ['p0', 'p6', 'p2', 'p4'] });
  assert.deepEqual(f.state.courts[0].playerIds, ['p0', 'p2', 'p4', 'p6']);
  assert.equal(f.state.courts[0].teams, undefined);
  const restored = restoreSession(JSON.parse(JSON.stringify(f.state)));
  const finished = applyCommand(restored, { type: 'finish', courtId: '1', version: restored.version },
    { id: 'finish', now: 99999 });
  assert.deepEqual(finished.queue, ['p1', 'p3', 'p5', 'p7', 'p2', 'p4', 'p6', 'p0']);
  assert.deepEqual(finished.history[0].playerIds, ['p0', 'p2', 'p4', 'p6']);
  assert.equal(finished.history[0].teams, undefined);
  assert(finished.players.filter(p => ['p0', 'p6', 'p2', 'p4'].includes(p.id)).every(p => p.setsPlayed === 1));
});

test('all six courts fill in numeric order and the lowest reopened court is always used', () => {
  const f = fixture(28);
  assert.equal(f.state.courts.length, 6);
  for (let i = 0; i < 6; i++) {
    const ids = f.state.queue.slice(0, 4);
    f.run({ type: 'start', courtId: '6', playerIds: ids });
    assert.deepEqual(f.state.courts[i].playerIds, ids);
  }
  const full = structuredClone(f.state);
  assert.throws(() => f.run({ type: 'start', playerIds: f.state.queue.slice(0, 4) }), /All courts are in play/);
  assert.deepEqual(f.state, full);
  f.run({ type: 'finish', courtId: '4' });
  f.run({ type: 'finish', courtId: '2' });
  const ids = f.state.queue.slice(0, 4);
  f.run({ type: 'start', courtId: '4', playerIds: ids });
  assert.deepEqual(f.state.courts[1].playerIds, ids);
  assert.equal(f.state.courts[3].playerIds.length, 0);
});

test('completed set totals are retained beyond the history limit', () => {
  const f = fixture(4);
  for (let i = 0; i < 55; i++) {
    f.run({ type: 'start', courtId: '1', playerIds: [...f.state.queue] });
    f.run({ type: 'finish', courtId: '1' });
  }
  assert.equal(f.state.completedSets, 55);
  assert.equal(f.state.history.length, 50);
  assert.equal(f.state.players[0].setsPlayed, 55);
});

test('saved players can be managed independently and reused without duplicate profiles', () => {
  const f = fixture(0);
  f.run({ type: 'save-player', name: '  Alex   Smith ', level: 4 });
  assert.deepEqual(f.state.directory, [{ id: 'p0', name: 'Alex Smith', level: 4 }]);
  assert.equal(f.state.players.length, 0);
  assert.throws(() => f.run({ type: 'save-player', name: 'alex smith', level: 3 }), /already saved/);
  for (const payload of [
    { name: '', level: 3 }, { name: 'Bob', level: 6 },
    { name: 'A'.repeat(41), level: 2 }, { name: 'B\u0000ob', level: 3 },
    { playerId: 'missing', name: 'Bob', level: 3 },
  ]) assert.throws(() => f.run({ type: 'save-player', ...payload }));
  f.run({ type: 'join', name: 'alex smith', level: 1 });
  assert.equal(f.state.players[0].level, 4);
  assert.equal(f.state.players[0].id, 'p0');
  assert.equal(f.state.directory.length, 1);
  assert.throws(() => f.run({ type: 'join', playerId: 'p0' }), /already checked in/);
  assert.throws(() => f.run({ type: 'delete-player', playerId: 'p0' }), /session/);
  f.run({ type: 'save-player', playerId: 'p0', name: 'Alex S', level: 5 });
  assert.equal(f.state.players[0].name, 'Alex S');
  assert.equal(f.state.players[0].level, 5);
  f.run({ type: 'leave', playerId: 'p0' });
  assert.equal(f.state.directory.length, 1);
  f.run({ type: 'join', playerId: 'p0' });
  assert.equal(f.state.players[0].setsPlayed, 0);
  f.run({ type: 'leave', playerId: 'p0' });
  f.run({ type: 'delete-player', playerId: 'p0' });
  assert.deepEqual(f.state.directory, []);
  assert.throws(() => f.run({ type: 'join', playerId: 'p0' }), /no longer exists/);
  assert.throws(() => f.run({ type: 'delete-player', playerId: 'p0' }), /no longer exists/);
});

test('profile edits preserve live court assignments, queue order and history', () => {
  const f = fixture(8);
  f.run({ type: 'start', courtId: '1', playerIds: ['p0', 'p1', 'p2', 'p3'] });
  const courts = structuredClone(f.state.courts);
  const queue = [...f.state.queue];
  assert.throws(() => f.run({ type: 'save-player', playerId: 'p0', name: 'player 1', level: 2 }), /already saved/);
  f.run({ type: 'save-player', playerId: 'p0', name: 'Captain', level: 5 });
  assert.deepEqual(f.state.courts, courts);
  assert.deepEqual(f.state.queue, queue);
  assert.equal(f.state.players[0].status, 'playing');
  f.run({ type: 'finish', courtId: '1' });
  assert.equal(f.state.players[0].setsPlayed, 1);
  assert(f.state.history[0].playerIds.includes('p0'));
});

test('new session clears all participants, courts, sets and history but keeps saved players and version order', () => {
  const f = fixture(12);
  for (let i = 1; i <= 3; i++) f.run({ type: 'start', courtId: String(i), playerIds: f.state.queue.slice(0, 4) });
  f.run({ type: 'finish', courtId: '1' });
  f.run({ type: 'pause', playerId: 'p0' });
  const directory = structuredClone(f.state.directory);
  const version = f.state.version;
  f.run({ type: 'new-session' });
  assert.deepEqual(f.state, { ...newSession(), directory, version: version + 1 });
  assert.throws(() => f.run({ type: 'join', playerId: 'p0', version }), /board changed/);
  f.run({ type: 'join', playerId: 'p0' });
  assert.equal(f.state.players[0].setsPlayed, 0);
  assert.equal(f.state.directory.length, 12);
});

test('legacy saved sessions gain a directory without changing the existing board', () => {
  const f = fixture(4);
  f.run({ type: 'start', courtId: '1', playerIds: [...f.state.queue] });
  const legacy = structuredClone(f.state);
  delete legacy.directory;
  legacy.courts = legacy.courts.slice(0, 3);
  const restored = restoreSession(legacy);
  assert.deepEqual(restored, f.state);
  assert.equal(legacy.directory, undefined);
  assert.equal(legacy.courts.length, 3);
  assert.deepEqual(restoreSession(restored), restored);
});

test('legacy court teams and history migrate to unpaired players, retaining the original picker', () => {
  const f = fixture(8);
  f.run({ type: 'start', playerIds: ['p0', 'p1', 'p2', 'p3'] });
  const legacy = structuredClone(f.state);
  legacy.courts[0].teams = [['p0', 'p2'], ['p1', 'p3']];
  legacy.history.push({ teams: [['p4', 'p6'], ['p5', 'p7']], startedAt: 1, finishedAt: 2 });
  const restored = restoreSession(legacy);
  assert.equal(restored.courts[0].teams, undefined);
  assert.deepEqual(restored.history[0], { playerIds: ['p4', 'p6', 'p5', 'p7'], startedAt: 1, finishedAt: 2 });
  const finished = applyCommand(restored, { type: 'finish', courtId: '1', version: restored.version },
    { id: 'finish', now: 99999 });
  assert.deepEqual(finished.queue, ['p4', 'p5', 'p6', 'p7', 'p1', 'p2', 'p3', 'p0']);
  assert.deepEqual(restoreSession(restored), restored);
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
  const reset = await post({ type: 'new-session', version: state.version });
  assert.equal(reset.status, 200);
  const cleared = await reset.json();
  assert.equal(cleared.players.length, 0);
  assert.deepEqual(cleared.directory, state.directory);
  assert.equal((await post({ type: 'join', playerId: state.players[0].id, version: state.version })).status, 409);
  const afterReset = await listen();
  assert.deepEqual(await (await fetch(`${afterReset}/api/state`)).json(), cleared);
  const rejoin = await post({ type: 'join', playerId: cleared.directory[0].id, version: cleared.version });
  assert.equal(rejoin.status, 200);
  const rejoined = await rejoin.json();
  assert.equal(rejoined.players[0].name, payload.name);
  const edited = await post({
    type: 'save-player', playerId: cleared.directory[0].id,
    name: 'Updated player', level: 5, version: rejoined.version,
  });
  assert.equal(edited.status, 200);
  const updated = await edited.json();
  const afterEdit = await listen();
  assert.deepEqual(await (await fetch(`${afterEdit}/api/state`)).json(), updated);
  assert.equal(updated.directory[0].name, 'Updated player');
  assert.equal(updated.players[0].level, 5);
  const leave = await post({ type: 'leave', playerId: updated.players[0].id, version: updated.version });
  assert.equal(leave.status, 200);
  const left = await leave.json();
  const deleted = await post({ type: 'delete-player', playerId: left.directory[0].id, version: left.version });
  assert.equal(deleted.status, 200);
  const removed = await deleted.json();
  const afterDelete = await listen();
  assert.deepEqual(await (await fetch(`${afterDelete}/api/state`)).json(), removed);
  assert.deepEqual(removed.directory, []);
  const legacyFile = { ...state };
  delete legacyFile.directory;
  writeFileSync(dataFile, JSON.stringify(legacyFile));
  const migrated = await listen();
  assert.deepEqual((await (await fetch(`${migrated}/api/state`)).json()).directory, state.directory);
});
