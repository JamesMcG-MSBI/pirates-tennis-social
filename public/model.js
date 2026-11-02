export function newSession() {
  return {
    version: 0,
    players: [],
    queue: [],
    courts: Array.from({ length: 3 }, (_, i) => ({
      id: String(i + 1), name: `Court ${i + 1}`, playerIds: [], teams: [], startedAt: null,
    })),
    history: [],
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function balanceTeams(state, ids) {
  const level = id => state.players.find(p => p.id === id).level;
  const combinations = [
    [[ids[0], ids[1]], [ids[2], ids[3]]],
    [[ids[0], ids[2]], [ids[1], ids[3]]],
    [[ids[0], ids[3]], [ids[1], ids[2]]],
  ];
  const score = teams => {
    const difference = Math.abs(
      teams[0].reduce((sum, id) => sum + level(id), 0) -
      teams[1].reduce((sum, id) => sum + level(id), 0),
    );
    const repeats = state.history.slice(-8).reduce((sum, match) => sum +
      teams.filter(team => match.teams.some(old => team.every(id => old.includes(id)))).length, 0);
    return difference * 10 + repeats;
  };
  return combinations.sort((a, b) => score(a) - score(b))[0];
}

export function suggestGroup(state) {
  const eligible = state.queue.slice(0, 7);
  if (eligible.length < 4) return [];
  let best = null;
  for (let a = 1; a < eligible.length - 2; a++) {
    for (let b = a + 1; b < eligible.length - 1; b++) {
      for (let c = b + 1; c < eligible.length; c++) {
        const ids = [eligible[0], eligible[a], eligible[b], eligible[c]];
        const levels = ids.map(id => state.players.find(p => p.id === id).level);
        const teams = balanceTeams(state, ids);
        const sum = team => team.reduce((total, id) =>
          total + state.players.find(p => p.id === id).level, 0);
        const repeats = state.history.slice(-8).reduce((total, match) =>
          total + teams.filter(team => match.teams.some(old =>
            team.every(id => old.includes(id)))).length, 0);
        const score = (Math.max(...levels) - Math.min(...levels)) * 10 +
          Math.abs(sum(teams[0]) - sum(teams[1])) * 10 + repeats * 2 + (a + b + c) / 10;
        if (!best || score < best.score) best = { ids, score };
      }
    }
  }
  return best.ids;
}

export function applyCommand(current, command, { id, now }) {
  const state = structuredClone(current);
  assert(command && typeof command === 'object', 'Invalid request.');
  assert(command.version === state.version, 'The board changed. Please try again.');
  const player = state.players.find(p => p.id === command.playerId);
  switch (command.type) {
    case 'join': {
      const name = typeof command.name === 'string' ? command.name.trim().replace(/\s+/g, ' ') : '';
      assert(name.length > 0 && name.length <= 40, 'Enter a name between 1 and 40 characters.');
      assert(!/[\u0000-\u001f\u007f]/u.test(name), 'Please use a plain-text name.');
      assert(!state.players.some(p => p.name.toLowerCase() === name.toLowerCase()),
        'That name is already here. Add a surname or initial.');
      assert(Number.isInteger(command.level) && command.level >= 1 && command.level <= 5,
        'Choose an ability from 1 to 5.');
      assert(state.players.length < 200, 'This session is full.');
      state.players.push({
        id, name, level: command.level, status: 'waiting',
        joinedAt: now, queuedAt: now, setsPlayed: 0,
      });
      state.queue.push(id);
      break;
    }
    case 'pause':
      assert(player?.status === 'waiting', 'Only waiting players can take a break.');
      state.queue = state.queue.filter(value => value !== player.id);
      player.status = 'paused';
      break;
    case 'resume':
      assert(player?.status === 'paused', 'That player is not on a break.');
      player.status = 'waiting';
      player.queuedAt = now;
      state.queue.push(player.id);
      break;
    case 'leave':
      assert(player && player.status !== 'playing', 'Finish the court before removing a player.');
      state.queue = state.queue.filter(value => value !== player.id);
      state.players = state.players.filter(p => p.id !== player.id);
      break;
    case 'start': {
      const court = state.courts.find(c => c.id === command.courtId);
      assert(court && court.playerIds.length === 0, 'Choose an available court.');
      const ids = command.playerIds;
      assert(Array.isArray(ids) && ids.length === 4 && new Set(ids).size === 4,
        'Choose exactly four different players.');
      assert(ids.includes(state.queue[0]), 'The first waiting player must play.');
      assert(ids.every(value => state.queue.slice(0, 7).includes(value)),
        'Choose players from the first seven in the queue.');
      court.playerIds = state.queue.filter(value => ids.includes(value));
      court.teams = balanceTeams(state, court.playerIds);
      court.startedAt = now;
      state.queue = state.queue.filter(value => !ids.includes(value));
      for (const p of state.players.filter(p => ids.includes(p.id))) p.status = 'playing';
      break;
    }
    case 'finish': {
      const court = state.courts.find(c => c.id === command.courtId);
      assert(court && court.playerIds.length === 4, 'That court is not playing.');
      state.history.push({ teams: court.teams, startedAt: court.startedAt, finishedAt: now });
      state.history = state.history.slice(-50);
      for (const playerId of court.playerIds) {
        const p = state.players.find(value => value.id === playerId);
        p.status = 'waiting';
        p.queuedAt = now;
        p.setsPlayed++;
        state.queue.push(playerId);
      }
      court.playerIds = [];
      court.teams = [];
      court.startedAt = null;
      break;
    }
    default:
      throw new Error('Unknown action.');
  }
  state.version++;
  return state;
}
