import { judge, tokenize } from './fly-rules.js';

// The trained fly as moderator: asks the server how every word smells, turns
// that into a verdict per message, and applies the verdict's action through the
// moderation API the moment the message appears in chat.
export function createFlyMod({ onChange, flyFor, awardActive }) {
  const $ = id => document.getElementById(id);
  const smells = new Map();
  const acted = new WeakSet();
  const log = [];
  let thresholds = null, enabled = true, queue = Promise.resolve();

  function render(note) {
    $('fly-auto').setAttribute('aria-pressed', String(enabled));
    $('fly-auto').textContent = enabled ? 'Fly mod on' : 'Fly mod off';
    if (note !== undefined) $('fly-note').textContent = note;
    $('fly-log').replaceChildren(...log.slice(-4).reverse().map(entry => {
      const row = document.createElement('li');
      const what = document.createElement('b');
      what.textContent = entry.label;
      what.dataset.action = entry.action;
      row.append(`Fly ${entry.fly + 1} `, what, ` ${entry.user} · stink ${entry.stink.toFixed(1)}${entry.worst ? ` (“${entry.worst}”)` : ''}`);
      return row;
    }));
  }

  // Sniff every word of these messages, then attach a verdict to each message.
  async function load(messages) {
    const words = [...new Set(messages.flatMap(message => tokenize(message.text)))].filter(word => !smells.has(word));
    for (let start = 0; start < words.length; start += 100) {
      try {
        const response = await fetch('/api/fly/smell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ words: words.slice(start, start + 100) }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        thresholds = result.thresholds;
        for (const [word, smell] of Object.entries(result.smells)) smells.set(word, smell);
        if (!thresholds) throw new Error('no trained fly');
        render(start + 100 < words.length ? `Sniffing words… ${start + 100}/${words.length}` : result.live || !words.some(word => smells.get(word) === null) ? '' : 'Some words are unsniffed (treated as neutral): the Python fly is not running.');
      } catch (error) {
        render(`The fly is offline (${error.message}).`);
        return;
      }
      for (const message of messages) message.verdict ??= judge(message.text, smells, thresholds);
      onChange();
    }
    for (const message of messages) message.verdict ??= thresholds && judge(message.text, smells, thresholds);
    onChange();
  }

  function act(message) {
    const { action, label, stink, worst } = message.verdict;
    queue = queue.then(async () => {
      if (action === 'mod-award' && awardActive()) return;   // one celebration at a time
      const body = action === 'slow' ? { enabled: true } : { username: message.user, ...(action === 'mod-award' ? { message: message.text, messageId: message.index } : {}) };
      try {
        const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) return;
        log.push({ fly: flyFor(message), label, action, user: message.user, stink, worst });
        render();
      } catch { /* the moderation panel already reports a lost connection */ }
    });
  }

  $('fly-auto').onclick = () => { enabled = !enabled; render(); };
  render('');

  return {
    load,
    // Called with the messages currently on screen. Each is acted on once.
    observe(visible) {
      for (const message of visible) {
        if (!message.verdict || acted.has(message)) continue;
        acted.add(message);
        if (enabled && message.verdict.action) act(message);
      }
    },
    // The smell badge on a chat line.
    badge(message) {
      if (!message.verdict) return null;
      const { stink, label } = message.verdict;
      const badge = document.createElement('span');
      badge.className = 'stink-badge';
      badge.dataset.level = stink >= thresholds.punishments.at(-1)[0] ? 'bad' : stink <= thresholds.award_up_to ? 'good' : 'ok';
      badge.textContent = stink.toFixed(1);
      badge.title = `Fly smell index ${stink.toFixed(2)}${label ? ` → ${label}` : ''}`;
      return badge;
    },
    describe(message) {
      const verdict = message?.verdict;
      return verdict ? `Fly smells ${verdict.stink.toFixed(1)}${verdict.worst ? ` (worst word “${verdict.worst}”)` : ''} → ${verdict.label || 'no action'}` : '';
    },
  };
}
