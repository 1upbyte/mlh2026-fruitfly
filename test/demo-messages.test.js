import test from 'node:test';
import assert from 'node:assert/strict';
import { injectDemoMessages } from '../src/demo-messages.js';
import { createModerationStore } from '../server/moderation.js';
import { moderatedMessages } from '../src/moderation-rules.js';

const source = Array.from({ length: 140 }, (_, index) => ({ index, time: Math.floor(index / 10), user: `viewer_${index}`, text: 'hello', stamp: '0:00:00' }));

test('inject one demo message after 10–20 source messages, with alternating ban and timeout verdicts', () => {
  let count = 0;
  const messages = injectDemoMessages(source, () => count++ % 2 ? .999 : 0);
  let gap = 0, injected = 0;
  for (const [index, message] of messages.entries()) {
    assert.equal(message.index, index);
    if (!message.demo) { gap++; continue; }
    assert.ok(gap >= 10 && gap <= 20);
    assert.equal(message.verdict.action, injected++ % 2 ? 'timeout' : 'ban');
    assert.equal(message.time, messages[index - 1].time);
    gap = 0;
  }
  assert.ok(injected > 0);
  assert.deepEqual(messages.filter(m => !m.demo).map(m => m.text), source.map(m => m.text));
  assert.equal(source.length, 140);
  assert.equal(source.at(-1).index, 139);
});

test('injected users are separate from real chatters and messages are blocked by the existing moderation rules', () => {
  const messages = injectDemoMessages(source, () => 0);
  const second = injectDemoMessages(source, () => 0);
  const fixtures = messages.filter(m => m.demo);
  const names = new Set([...source, ...fixtures, ...second.filter(m => m.demo)].map(m => m.user.toLowerCase()));
  assert.equal(names.size, source.length + fixtures.length * 2);
  const store = createModerationStore({ now: () => 1000 });
  for (const fixture of fixtures) store.apply(fixture.verdict.action, { username: fixture.user });
  assert.deepEqual(moderatedMessages(messages, store.snapshot(), 1000).map(m => m.text), source.map(m => m.text));
});

test('short logs stay unchanged and injections do not extend the recording timeline', () => {
  assert.equal(injectDemoMessages(source.slice(0, 9), () => 0).length, 9);
  const messages = injectDemoMessages(source, () => .999);
  assert.equal(messages.at(-1).time, source.at(-1).time);
  assert.ok(messages.every((m, i) => i === 0 || m.time >= messages[i - 1].time));
});
