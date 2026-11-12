import { suggestGroup, nextAvailableCourt } from './model.js';

const $ = selector => document.querySelector(selector);
let state;
let selected = [];
let busy = false;
let online = false;
let editingId;
let usingSavedLevel = false;
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
  $('#checkin-notice').textContent = error ? message : '';
  $('#checkin-notice').className = error && message ? 'notice error' : '';
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
    const messages = {
      join: 'Checked in. Ready for the next set.',
      'save-player': 'Player saved.',
      'delete-player': 'Player profile deleted.',
      'new-session': 'New session started. Board and sets cleared. Saved players kept.',
    };
    notice(messages[payload.type] || 'Board updated.');
    return true;
  } catch (error) {
    notice(error.message, true);
    return false;
  } finally {
    busy = false;
    render();
  }
}
function matchingProfile() {
  const name = $('#player-name').value.trim().replace(/\s+/g, ' ').toLowerCase();
  return state?.directory.find(p => p.name.toLowerCase() === name);
}
function syncCheckin() {
  const profile = matchingProfile();
  if (profile) $('#player-level').value = profile.level;
  else if (usingSavedLevel) $('#player-level').value = '3';
  usingSavedLevel = !!profile;
  $('#player-level').disabled = !!profile || busy || !online;
  $('#checkin-profile-note').textContent = profile
    ? `Saved player · level ${profile.level}. Change details on the Players screen.`
    : 'New players are saved automatically.';
}
function resetProfileForm() {
  editingId = undefined;
  $('#profile-form').reset();
  $('#profile-title').textContent = 'Add a player';
  $('#save-profile').textContent = 'Save player →';
  $('#cancel-edit').hidden = true;
}
function renderDirectory() {
  const profiles = [...state.directory].sort((a, b) => a.name.localeCompare(b.name));
  $('#directory-count').textContent = profiles.length;
  $('#known-players').replaceChildren(...profiles.filter(profile => !person(profile.id)).map(profile => {
    const option = el('option', '', `Level ${profile.level}`);
    option.value = profile.name;
    return option;
  }));
  const filter = $('#directory-search').value.trim().toLowerCase();
  const matching = profiles.filter(p => p.name.toLowerCase().includes(filter));
  $('#directory-list').replaceChildren(...matching.map(profile => {
    const row = el('div', 'player-row directory-row');
    const avatar = el('span', 'avatar', profile.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase());
    const details = el('div', 'player-details');
    const name = el('div', 'player-name', profile.name);
    const checkedIn = person(profile.id);
    if (checkedIn) {
      const status = { waiting: 'In queue', playing: 'On court', paused: 'On a break' };
      name.append(el('span', 'directory-status', status[checkedIn.status]));
    }
    details.append(name, el('div', 'player-meta', `Playing level ${profile.level}`));
    const actions = el('div', 'player-actions');
    if (!checkedIn) actions.append(action('Check in', () => command({ type: 'join', playerId: profile.id }), 'button button-dark'));
    actions.append(action('Edit', () => {
      editingId = profile.id;
      $('#profile-title').textContent = 'Edit player';
      $('#profile-name').value = profile.name;
      $('#profile-level').value = profile.level;
      $('#save-profile').textContent = 'Save changes →';
      $('#cancel-edit').hidden = false;
      $('#profile-name').focus();
    }));
    if (!checkedIn) actions.append(action('Delete', async () => {
      if (confirm(`Delete the saved profile for ${profile.name}? This cannot be undone.`)) {
        if (await command({ type: 'delete-player', playerId: profile.id })) {
          if (editingId === profile.id) resetProfileForm();
        }
      }
    }));
    row.append(avatar, details, actions);
    return row;
  }));
  if (!matching.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('h3', '', profiles.length ? 'No matching players' : 'Build your roster'),
      el('p', '', profiles.length ? 'Try another name or add a new player.' : 'Add players here or check in on the session board. Profiles stay saved for next time.'));
    $('#directory-list').append(empty);
  }
  $('#save-profile').disabled = busy || !online;
  $('#profile-name').disabled = busy || !online;
  $('#profile-level').disabled = busy || !online;
  syncCheckin();
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
  if (state.queue.length) selected = [state.queue[0], ...selected.filter(id => id !== state.queue[0])];
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
    empty.append(el('span', 'empty-ball', '◉'), el('h3', '', 'The line-up starts here.'), el('p', '', 'Check in four players. Get the first set underway.'));
    $('#queue').append(empty);
  }
  const paused = state.players.filter(p => p.status === 'paused');
  $('#paused-section').hidden = !paused.length;
  $('#paused').replaceChildren(...paused.map(p => playerRow(p, -1, true)));
  $('#pick-title').textContent = state.queue.length ? `${person(state.queue[0]).name} picks next` : 'Waiting for players';
  $('#pick-hint').textContent = state.queue.length >= 4 ? `${selected.length} of 4 selected · choose from the first ${Math.min(7, state.queue.length)}` : `${Math.max(0, 4 - state.queue.length)} more players needed to start a set.`;
  $('#suggest').disabled = busy || !online || state.queue.length < 4;
  $('#selection-preview').replaceChildren();
  if (selected.length === 4) {
    const queueOrder = state.queue.filter(id => selected.includes(id));
    $('#selection-preview').append(el('span', '', 'Return order:'),
      ...[...queueOrder.slice(1), queueOrder[0]].map((id, i) =>
        el('span', 'preview-player', `${i + 1}. ${person(id).name}`)));
  }
  const court = nextAvailableCourt(state);
  $('#court-choice').textContent = court ? court.name : 'All courts are in play';
  $('#start').disabled = busy || !online || selected.length !== 4 || !court;
  $('#checkin button').disabled = busy || !online;
  $('#player-name').disabled = busy || !online;
  $('#new-session').disabled = busy || !online;
  renderDirectory();
  $('#courts').replaceChildren(...state.courts.map(court => {
    const card = el('article', `court-card ${court.playerIds.length ? 'occupied' : ''}`);
    const heading = el('div', 'court-heading');
    const status = el('span', 'court-status', court.playerIds.length ? 'PLAYING · ' : 'AVAILABLE');
    if (court.playerIds.length) status.append(clock(court.startedAt));
    heading.append(el('h3', '', court.name), status);
    card.append(heading);
    if (court.playerIds.length) {
      const players = el('div', 'court-players');
      court.playerIds.forEach((id, i) => players.append(el('p', '', `${person(id).name}${i === 0 ? ' · picker' : ''}`)));
      card.append(players, el('p', 'court-note', 'Choose teams on court. Picker rejoins last.'), action('Finish set & rejoin queue ↩', () => {
        if (confirm(`Finish the set on ${court.name}? Players rejoin in their previous queue order, with the picker last.`)) {
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
  const profile = matchingProfile();
  const payload = profile
    ? { type: 'join', playerId: profile.id }
    : { type: 'join', name: $('#player-name').value, level: Number($('#player-level').value) };
  if (await command(payload)) {
    $('#checkin').reset();
    syncCheckin();
    $('#checkin-dialog').close();
  } else {
    $('#player-name').focus();
  }
});
$('#player-name').addEventListener('input', syncCheckin);
$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (await command({
    type: 'save-player', playerId: editingId,
    name: $('#profile-name').value, level: Number($('#profile-level').value),
  })) {
    resetProfileForm();
    $('#profile-name').focus();
  }
});
$('#cancel-edit').addEventListener('click', resetProfileForm);
$('#directory-search').addEventListener('input', () => { if (state) renderDirectory(); });
$('#new-session').addEventListener('click', () => {
  if (confirm('Start a new session? This clears every checked-in player, queue, active court, completed set and session history. Saved player profiles are kept. This cannot be undone.')) {
    command({ type: 'new-session' });
  }
});
function showScreen() {
  $('#checkin-dialog').close();
  const players = location.hash === '#players';
  $('#board-screen').hidden = players;
  $('#players-screen').hidden = !players;
  $('#board-link').toggleAttribute('aria-current', !players);
  $('#players-link').toggleAttribute('aria-current', players);
  (players ? $('#players-link') : $('#board-link')).setAttribute('aria-current', 'page');
}
window.addEventListener('hashchange', showScreen);
showScreen();
$('#check-in-link').addEventListener('click', () => {
  $('#checkin-notice').textContent = '';
  $('#checkin-notice').className = '';
  $('#checkin-dialog').showModal();
  $('#player-name').focus();
});
$('#close-checkin').addEventListener('click', () => $('#checkin-dialog').close());
$('#checkin-dialog').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    $('#checkin-dialog').close();
  }
});
$('#suggest').addEventListener('click', () => { selected = suggestGroup(state); render(); });
$('#start').addEventListener('click', () => command({ type: 'start', playerIds: selected }));
$('#checkin button').disabled = true;
$('#start').disabled = true;
$('#suggest').disabled = true;
refresh();
setInterval(refresh, 4000);
