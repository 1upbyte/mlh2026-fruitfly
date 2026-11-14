import { judge, tokenize } from './fly-rules.js';

// The trained fly as moderator, seen from chat: asks the server how every word
// smells, turns that into a verdict per message, applies the verdict's action
// through the moderation API the moment the message appears, and announces it
// in chat the way a viewer would see it.
export function createFlyMod({ onChange, flyFor, awardActive }) {
  const $ = id => document.getElementById(id);
  const smells = new Map();
  const acted = new WeakSet();
  const notices = [];
  let thresholds = null, enabled = true, queue = Promise.resolve();
  let generation = 0;

  function render(note) {
    $('fly-auto').setAttribute('aria-pressed', String(enabled));
    $('fly-auto').textContent = enabled ? 'Fly mod on' : 'Fly mod off';
    if (note !== undefined) $('fly-note').textContent = note;
  }

  // What everyone in chat is told. A warning is private, so only you see yours.
  function notice(action, user) {
    const you = user === 'you';
    const who = you ? 'You have' : `${user} has`;
    return {
      ban: `${who} been banned from this chat.`,
      mute: `${who} been muted.`,
      timeout: `${who} been timed out for 30 seconds.`,
      warn: you ? 'A moderator warned you about your message.' : '',
      slow: 'This room is now in slow mode: one message every 30 seconds.',
      'mod-award': `${you ? 'You' : user} received a Mod Award!`,
    }[action];
  }

  // Sniff every word of these messages, then attach a verdict to each message.
  async function load(messages) {
    const session = generation;
    const words = [...new Set(messages.flatMap(message => tokenize(message.text)))].filter(word => !smells.has(word));
    for (let start = 0; start < words.length; start += 100) {
      try {
        const response = await fetch('/api/fly/smell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ words: words.slice(start, start + 100) }) });
        const result = await response.json();
        if (session !== generation) return;
        if (!response.ok) throw new Error(result.error);
        thresholds = result.thresholds;
        for (const [word, smell] of Object.entries(result.smells)) smells.set(word, smell);
        if (!thresholds) throw new Error('no trained fly');
        render(start + 100 < words.length ? `Sniffing words… ${start + 100}/${words.length}` : result.live || !words.some(word => smells.get(word) === null) ? '' : 'Some words are unsniffed (treated as neutral): the Python fly is not running.');
      } catch (error) {
        if (session !== generation) return;
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
    const session = generation;
    const { action } = message.verdict;
    queue = queue.then(async () => {
      if (session !== generation) return;
      if (action === 'mod-award' && awardActive()) return;   // one celebration at a time
      const body = action === 'slow' ? { enabled: true } : { username: message.user, ...(action === 'mod-award' ? { message: message.text, messageId: message.index } : {}) };
      try {
        const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok || session !== generation) return;
        const text = notice(action, message.user);
        if (text) notices.push({ notice: text, time: message.time, index: message.index + .5, fly: flyFor(message), manual: message.user === 'you' });
        onChange();
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
    get notices() { return notices; },
    clear() { generation++; notices.length = 0; },
    describe(message) {
      const verdict = message?.verdict;
      return verdict ? `Fly smells ${verdict.stink.toFixed(1)}${verdict.worst ? ` (worst word “${verdict.worst}”)` : ''} → ${verdict.label || 'no action'}` : '';
    },
  };
}
