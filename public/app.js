import { balanceTeams, suggestGroup } from './model.js';

const $ = selector => document.querySelector(selector);
let state;
let selected = [];
let busy = false;
let online = false;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const person = id => state.players.find(p => p.id === id);
const minutes = time => `${Math.max(0, Math.floor((Date.now() - time) / 60000))} min`;
function clock(time) {
  const node = el('span', '', minutes(time));
  node.dataset.since = time;
  return node;
}
function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').className = message ? `notice ${error ? 'error' : ''}` : '';
}
function action(label, handler, className = 'text-button') {
  const button = el('button', className, label);
  button.type = 'button';
  button.disabled = busy || !online;
  button.addEventListener('click', handler);
  return button;
}
async function command(payload) {
  if (busy || !online) return false;
  busy = true;
  render();
  try {
    const response = await fetch('/api/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, version: state.version }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.state) state = result.state;
      throw new Error(result.error || 'Could not update the board.');
    }
    state = result;
    notice(payload.type === 'join' ? 'You’re on the board. Enjoy your tennis!' : 'Board updated.');
    return true;
  } catch (error) {
    notice(error.message, true);
    return false;
  } finally {
    busy = false;
    render();
  }
}
function playerRow(p, index, paused = false) {
  const row = el('div', `player-row ${index === 0 && !paused ? 'first-player' : ''} ${selected.includes(p.id) ? 'selected-player' : ''}`);
  const selectable = !paused && index < 7;
  if (selectable) {
    const checkbox = el('input', 'player-check');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.includes(p.id);
    checkbox.disabled = busy || !online || index === 0 || (!checkbox.checked && selected.length === 4);
    checkbox.setAttribute('aria-label', `Select ${p.name}`);
    checkbox.addEventListener('change', () => {
      selected = checkbox.checked ? [...selected, p.id] : selected.filter(id => id !== p.id);
      render();
    });
    row.append(checkbox);
  } else row.append(el('span', 'position', paused ? 'Ⅱ' : String(index + 1).padStart(2, '0')));
  const avatar = el('span', 'avatar', p.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase());
  const details = el('div', 'player-details');
  const name = el('div', 'player-name', p.name);
  if (index === 0 && !paused) name.append(el('span', 'picker-tag', 'PICKS NEXT'));
  const meta = el('div', 'player-meta', `Level ${p.level} · ${p.setsPlayed} ${p.setsPlayed === 1 ? 'set' : 'sets'} played`);
  if (!paused) meta.append(' · waiting ', clock(p.queuedAt));
  details.append(name, meta);
  const actions = el('div', 'player-actions');
  actions.append(action(paused ? 'Rejoin' : 'Break', () => command({ type: paused ? 'resume' : 'pause', playerId: p.id })));
  actions.append(action('Leave', () => {
    if (confirm(`Remove ${p.name} from this session?`)) command({ type: 'leave', playerId: p.id });
  }));
  row.append(avatar, details, actions);
  return row;
}
function render() {
  if (!state) return;
  selected = selected.filter(id => state.queue.slice(0, 7).includes(id));
  if (state.queue.length && !selected.includes(state.queue[0])) selected.unshift(state.queue[0]);
  selected = selected.slice(0, 4);
  $('#connection').textContent = online ? 'Live board' : 'Offline · reconnecting';
  $('#connection').className = online ? '' : 'offline';
  const playing = state.players.filter(p => p.status === 'playing').length;
  $('#stats').replaceChildren(...[
    [state.queue.length, 'in the queue'], [playing, 'on court'], [state.completedSets ?? state.history.length, 'sets finished'],
  ].map(([value, label]) => {
    const item = el('div');
    item.append(el('strong', '', value), el('span', '', label));
    return item;
  }));
  $('#queue-count').textContent = state.queue.length;
  $('#queue').replaceChildren(...state.queue.map((id, i) => playerRow(person(id), i)));
  if (!state.queue.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('span', 'empty-ball', '◉'), el('h3', '', 'A fresh court. A fresh start.'), el('p', '', 'Be the first to check in for social tennis.'));
    $('#queue').append(empty);
  }
  const paused = state.players.filter(p => p.status === 'paused');
  $('#paused-section').hidden = !paused.length;
  $('#paused').replaceChildren(...paused.map(p => playerRow(p, -1, true)));
  $('#pick-title').textContent = state.queue.length ? `${person(state.queue[0]).name} picks next` : 'Waiting for players';
  $('#pick-hint').textContent = state.queue.length >= 4 ? `${selected.length} of 4 selected · choose from the first ${Math.min(7, state.queue.length)}` : `${Math.max(0, 4 - state.queue.length)} more players needed to start a set.`;
  $('#suggest').disabled = busy || !online || state.queue.length < 4;
  $('#team-preview').replaceChildren();
  if (selected.length === 4) {
    const teams = balanceTeams(state, state.queue.filter(id => selected.includes(id)));
    teams.forEach((team, i) => {
      if (i) $('#team-preview').append(el('span', 'versus', 'vs'));
      $('#team-preview').append(el('span', 'preview-team', team.map(id => person(id).name).join(' + ')));
    });
  }
  const choice = $('#court-choice');
  const previous = choice.value;
  const available = state.courts.filter(c => !c.playerIds.length);
  choice.replaceChildren(...available.map(court => {
    const option = el('option', '', court.name);
    option.value = court.id;
    return option;
  }));
  if (available.some(c => c.id === previous)) choice.value = previous;
  if (!available.length) choice.append(el('option', '', 'All courts are in play'));
  choice.disabled = busy || !online || !available.length;
  $('#start').disabled = busy || !online || selected.length !== 4 || !available.length;
  $('#checkin button').disabled = busy || !online;
  $('#courts').replaceChildren(...state.courts.map(court => {
    const card = el('article', `court-card ${court.playerIds.length ? 'occupied' : ''}`);
    const heading = el('div', 'court-heading');
    const status = el('span', 'court-status', court.playerIds.length ? 'PLAYING · ' : 'AVAILABLE');
    if (court.playerIds.length) status.append(clock(court.startedAt));
    heading.append(el('h3', '', court.name), status);
    card.append(heading);
    if (court.playerIds.length) {
      const teams = el('div', 'court-teams');
      court.teams.forEach((team, i) => {
        if (i) teams.append(el('span', 'versus', 'vs'));
        const block = el('div');
        team.forEach(id => block.append(el('p', '', person(id).name)));
        teams.append(block);
      });
      card.append(teams, action('Finish set & rejoin queue ↩', () => {
        if (confirm(`Finish the set on ${court.name}? All four players will join the end of the queue.`)) {
          command({ type: 'finish', courtId: court.id });
        }
      }, 'button button-outline'));
    } else {
      card.append(el('div', 'court-lines'), el('p', 'court-empty', 'Ready for the next four.'));
    }
    return card;
  }));
}
async function refresh() {
  if (busy) return;
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('Connection failed.');
    const next = await response.json();
    // A poll started before a mutation must not overwrite its newer result.
    const changed = !state || next.version > state.version || !online;
    if (!state || next.version >= state.version) state = next;
    if (!online) notice('');
    online = true;
    if (changed) render();
    else document.querySelectorAll('[data-since]').forEach(node => {
      node.textContent = minutes(Number(node.dataset.since));
    });
  } catch {
    online = false;
    $('#connection').textContent = 'Offline · reconnecting';
    render();
    if (!state) notice('Cannot reach the board. Retrying automatically…', true);
  }
}
$('#checkin').addEventListener('submit', async event => {
  event.preventDefault();
  if (await command({ type: 'join', name: $('#player-name').value, level: Number($('#player-level').value) })) {
    $('#checkin').reset();
    $('#player-name').focus();
  }
});
$('#check-in-link').addEventListener('click', () => $('#player-name').focus());
$('#suggest').addEventListener('click', () => { selected = suggestGroup(state); render(); });
$('#start').addEventListener('click', () => command({ type: 'start', playerIds: selected, courtId: $('#court-choice').value }));
$('#checkin button').disabled = true;
$('#start').disabled = true;
$('#suggest').disabled = true;
refresh();
setInterval(refresh, 4000);
