import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createModerationStore, moderationApi } from '../server/moderation.js';
import { moderatedMessages } from '../src/moderation-rules.js';

const messages = [
  { index: 0, user: 'Alice', text: 'first', time: 0 },
  { index: 1, user: 'Bob', text: 'second', time: 1 },
  { index: 2, user: 'ALICE', text: 'third', time: 10 },
  { index: 3, user: 'Alice', text: 'fourth', time: 30 },
];

test('ban and mute remove all messages for a case-insensitive username, preserving assignment indices', () => {
  for (const action of ['ban', 'mute']) {
    const store = createModerationStore();
    store.apply(action, { username: ' alice ' });
    assert.deepEqual(moderatedMessages(messages, store.snapshot()).map(m => m.index), [1]);
    assert.equal(moderatedMessages([...messages, { index: 4, user: 'Alice', time: 50 }], store.snapshot()).length, 1);
    store.apply('reset');
    assert.equal(moderatedMessages(messages, store.snapshot()).length, 4);
  }
});

test('timeout lasts 30 seconds of real time, and expiry does not override a ban or mute', () => {
  let now = 1000;
  const store = createModerationStore({ now: () => now });
  store.apply('timeout', { username: 'Alice' });
  const state = store.snapshot();
  assert.equal(state.users[0].timeoutUntil, 31_000);
  assert.equal(moderatedMessages(messages, state, 30_999).length, 1);
  assert.equal(moderatedMessages(messages, state, 31_000).length, 4);
  store.apply('mute', { username: 'ALICE' });
  assert.equal(moderatedMessages(messages, store.snapshot(), 32_000).length, 1);
});

test('warning keeps messages visible and slow mode enforces a per-user 30-second playback-time interval', () => {
  const store = createModerationStore();
  store.apply('warn', { username: 'Alice' });
  store.apply('warn', { username: 'ALICE' });
  assert.equal(store.snapshot().users[0].warnings, 2);
  assert.equal(moderatedMessages(messages, store.snapshot()).length, 4);
  store.apply('slow');
  assert.deepEqual(moderatedMessages(messages, store.snapshot()).map(m => m.index), [0, 1, 3]);
  store.apply('slow', { enabled: false });
  assert.equal(moderatedMessages(messages, store.snapshot()).length, 4);
});

test('awards retain exact text; stale dismissal cannot clear a newer award', () => {
  const store = createModerationStore();
  const first = store.apply('mod-award', { username: 'Alice', message: '<b>hello</b>', messageId: 0 }).award;
  assert.equal(first.message, '<b>hello</b>');
  assert.equal(first.messageId, 0);
  const second = store.apply('mod-award', { username: 'Bob', message: 'next' }).award;
  store.apply('dismiss-award', { awardId: first.id });
  assert.equal(store.snapshot().award.id, second.id);
  store.apply('dismiss-award', { awardId: second.id });
  assert.equal(store.snapshot().award, null);
});

test('invalid commands leave state unchanged', () => {
  const store = createModerationStore();
  for (const [action, body] of [['ban', {}], ['timeout', { username: '' }], ['mod-award', { username: 'Alice' }], ['slow', { enabled: 'false' }]]) {
    assert.throws(() => store.apply(action, body));
  }
  assert.equal(store.snapshot().revision, 0);
});

test('unauthenticated HTTP endpoints validate requests and broadcast API actions over SSE', async () => {
  const store = createModerationStore();
  const middleware = moderationApi(store);
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const abort = new AbortController();
  try {
    const events = await fetch(`${base}/api/events`, { signal: abort.signal });
    assert.equal(events.headers.get('content-type'), 'text/event-stream');
    const reader = events.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /"revision":0/);
    const response = await fetch(`${base}/api/ban`, { method: 'POST', body: JSON.stringify({ username: 'Alice' }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal((await response.json()).users[0].banned, true);
    const broadcast = new TextDecoder().decode((await reader.read()).value);
    assert.match(broadcast, /"banned":true/);
    assert.equal((await fetch(`${base}/api/state`)).status, 200);
    assert.equal((await fetch(`${base}/api/mute`, { method: 'POST', body: '{bad' })).status, 400);
    assert.equal((await fetch(`${base}/api/timeout`, { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await fetch(`${base}/api/ban`)).status, 405);
    assert.equal((await fetch(`${base}/api/missing`)).status, 404);
    assert.equal((await fetch(`${base}/api/ban`, { method: 'OPTIONS' })).status, 204);
  } finally {
    abort.abort();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
