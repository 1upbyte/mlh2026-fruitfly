import { moderatedMessages, userKey } from './moderation-rules.js';

export function createModeration({ onChange, pause, resume, refreshIcons }) {
  const $ = id => document.getElementById(id);
  let state = { revision: 0, users: [], slowSeconds: 0, award: null, lastAction: null };
  let selected = null;
  let connected = false;
  let pending = false;
  let shownAward = null;
  let lastTimeouts = '';

  function userState(username) { return state.users.find(user => userKey(user.username) === userKey(username)); }

  function updatePanel() {
    $('mod-connection').classList.toggle('connected', connected);
    $('mod-connection').title = connected ? 'API connected' : 'Connecting to API';
    $('mod-selected-user').textContent = selected?.user || 'Select a message';
    $('mod-selected-message').textContent = selected?.text || '';
    for (const button of document.querySelectorAll('[data-mod-action]')) {
      button.disabled = !connected || pending || (button.dataset.modAction !== 'slow' && !selected);
    }
    $('mod-slow').setAttribute('aria-pressed', String(state.slowSeconds > 0));
    $('mod-reset').disabled = !connected || pending;
    $('award-resume').disabled = !connected || pending;
    $('award-dismiss').disabled = !connected || pending;
    const user = selected && userState(selected.user);
    const flags = [];
    if (user?.banned) flags.push('Banned');
    if (user?.muted) flags.push('Muted');
    if (user?.timeoutUntil > Date.now()) flags.push(`Timed out · ${Math.ceil((user.timeoutUntil - Date.now()) / 1000)}s`);
    if (user?.warnings) flags.push(`Warned${user.warnings > 1 ? ` (${user.warnings})` : ''}`);
    if (state.slowSeconds) flags.push('Slow mode · 30s');
    $('mod-user-state').textContent = flags.join(' · ');
  }

  function showAward(award) {
    const overlay = $('mod-award-overlay');
    if (!award) { overlay.hidden = true; shownAward = null; return; }
    pause();
    if (shownAward === award.id) return;
    shownAward = award.id;
    $('award-username').textContent = award.username;
    $('award-message').textContent = award.message;
    overlay.hidden = false;
    overlay.classList.remove('celebrate');
    void overlay.offsetWidth;
    overlay.classList.add('celebrate');
    $('award-particles').replaceChildren(...Array.from({ length: 42 }, (_, index) => {
      const particle = document.createElement('span');
      particle.style.setProperty('--angle', `${index * 137.5}deg`);
      particle.style.setProperty('--distance', `${110 + index % 7 * 32}px`);
      particle.style.setProperty('--delay', `${index % 6 * 35}ms`);
      particle.style.setProperty('--color', ['#ffdb7a', '#bf94ff', '#fff3d0', '#f8acff'][index % 4]);
      return particle;
    }));
    $('award-resume').focus({ preventScroll: true });
    const rect=$('player').getBoundingClientRect();
    if(rect.bottom<50||rect.top>innerHeight) $('player').scrollIntoView({behavior:'smooth',block:'center'});
  }

  function accept(next) {
    if (next.sessionId === state.sessionId && next.revision < state.revision) return;
    state = next;
    showAward(state.award);
    updatePanel();
    onChange();
  }

  async function action(name, body = {}) {
    if (pending) return false;
    pending = true;
    updatePanel();
    $('mod-error').textContent = '';
    try {
      const response = await fetch(`/api/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Action failed.');
      connected = true;
      accept(result);
      return true;
    } catch (error) {
      $('mod-error').textContent = error.message;
      return false;
    } finally {
      pending = false;
      updatePanel();
    }
  }

  for (const button of document.querySelectorAll('[data-mod-action]')) {
    button.onclick = () => {
      const name = button.dataset.modAction;
      if (name === 'slow') return action(name, { enabled: !state.slowSeconds });
      if (!selected) return;
      action(name, { username: selected.user, ...(name === 'mod-award' ? { message: selected.text, messageId: selected.index } : {}) });
    };
  }
  $('mod-reset').onclick = () => action('reset');
  async function dismiss(shouldResume) {
    if (!state.award) return;
    if (await action('dismiss-award', { awardId: state.award.id })) {
      if (shouldResume) await resume();
      else if (selected) document.querySelector(`.chat-message[data-index="${selected.index}"]`)?.focus({ preventScroll: true });
    }
  }
  $('award-resume').onclick = () => dismiss(true);
  $('award-dismiss').onclick = () => dismiss(false);
  $('mod-award-overlay').addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(false); });

  const events = new EventSource('/api/events');
  events.onmessage = event => {
    connected = true;
    accept(JSON.parse(event.data));
  };
  events.onerror = () => { connected = false; updatePanel(); };
  setInterval(() => {
    const active = state.users.filter(user => user.timeoutUntil > Date.now()).map(user => userKey(user.username)).join(',');
    if (active !== lastTimeouts) { lastTimeouts = active; onChange(); }
    updatePanel();
  }, 500);
  updatePanel();
  refreshIcons();

  return {
    filter: messages => moderatedMessages(messages, state),
    select(message) { selected = message; updatePanel(); onChange(); },
    clearSelection() { selected = null; updatePanel(); },
    get selectedIndex() { return selected?.index; },
    get revision() { return state.revision; },
    get awardActive() { return !!state.award; },
    warned: username => !!userState(username)?.warnings,
    dismissAndResume: () => dismiss(true),
  };
}
