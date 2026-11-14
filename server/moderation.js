import { randomUUID } from 'node:crypto';
import { userKey } from '../src/moderation-rules.js';
import { createFlyNose } from './fly.js';

export function createModerationStore({ now = Date.now } = {}) {
  const sessionId = randomUUID();
  let revision = 0;
  let users = new Map();
  let slowSeconds = 0;
  let award = null;
  let lastAction = null;
  let playbackTime = 0;
  let lastAwardAt = null;
  const listeners = new Set();
  const activeAward = () => award && now() < award.expiresAt ? award : null;

  function snapshot() {
    return { sessionId, revision, users: [...users.values()].map(user => ({ ...user })), slowSeconds, award: activeAward(), lastAction, playbackTime, awardCooldownUntil: lastAwardAt === null ? 0 : lastAwardAt + 5000 };
  }

  function apply(action, body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object.');
    if (!['ban', 'mute', 'timeout', 'warn', 'slow', 'mod-award', 'dismiss-award', 'reset', 'playback'].includes(action)) {
      throw new Error('Unknown action.');
    }
    const needsUser = ['ban', 'mute', 'timeout', 'warn', 'mod-award'].includes(action);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (needsUser && (!username || username.length > 128)) throw new Error('Provide a username (1–128 characters).');
    if (action === 'mod-award' && (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 8000)) {
      throw new Error('Provide the message text (1–8000 characters).');
    }
    if (action === 'slow' && body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new Error('enabled must be true or false.');
    if (action === 'playback') {
      if (typeof body.time !== 'number' || !Number.isFinite(body.time) || body.time < 0) throw new Error('time must be a nonnegative number.');
      playbackTime = body.time;
      return snapshot();
    }
    if (action === 'warn') return snapshot();
    if (action === 'mod-award') {
      if (body.playbackTime !== undefined && (typeof body.playbackTime !== 'number' || !Number.isFinite(body.playbackTime) || body.playbackTime < 0)) throw new Error('playbackTime must be a nonnegative number.');
      const time = body.playbackTime ?? playbackTime;
      if (time < 2 || activeAward() || (lastAwardAt !== null && now() - lastAwardAt < 5000)) return snapshot();
    }
    if (action === 'dismiss-award' && (!award || body.awardId !== award.id)) return snapshot();

    if (['ban', 'mute', 'timeout'].includes(action)) {
      const key = userKey(username);
      const user = { ...(users.get(key) || { username, banned: false, muted: false, timeoutUntil: 0, warnings: 0 }) };
      if (action === 'ban') user.banned = true;
      if (action === 'mute') user.muted = true;
      if (action === 'timeout') user.timeoutUntil = now() + 30_000;
      users.set(key, user);
    }
    if (action === 'slow') slowSeconds = body.enabled === false ? 0 : 30;
    if (action === 'mod-award') {
      lastAwardAt = now();
      award = { id: randomUUID(), username, message: body.message, messageId: body.messageId ?? null, issuedAt: lastAwardAt, expiresAt: lastAwardAt + 4000 };
    }
    if (action === 'dismiss-award') award = null;
    if (action === 'reset') { users = new Map(); slowSeconds = 0; award = null; lastAwardAt = null; }
    lastAction = { id: randomUUID(), action, username: needsUser ? username : null, at: now() };
    revision++;
    const state = snapshot();
    for (const listener of listeners) listener(state);
    return state;
  }

  return { snapshot, apply, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}

export function moderationApi(store, fly) {
  return async (request, response, next) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/')) return next();
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Cache-Control', 'no-store');
    const json = (code, value) => {
      response.statusCode = code;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(value));
    };
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (path === '/api/state' && request.method === 'GET') return json(200, store.snapshot());
    if (path === '/api/events' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const send = state => response.write(`data: ${JSON.stringify(state)}\n\n`);
      const unsubscribe = store.subscribe(send);
      send(store.snapshot());
      const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000);
      response.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
      return;
    }
    const action = path.slice('/api/'.length);
    const sniff = action === 'fly/smell' && fly;
    if (!sniff && !['ban', 'mute', 'timeout', 'warn', 'slow', 'mod-award', 'dismiss-award', 'reset', 'playback'].includes(action)) {
      return json(404, { error: 'Unknown API endpoint.' });
    }
    if (request.method !== 'POST') return json(405, { error: 'Use POST with a JSON body.' });
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 65_536) { json(413, { error: 'Request body is too large.' }); return; }
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : {};
      return json(200, sniff ? await fly.smell(body.words) : store.apply(action, body));
    } catch (error) {
      return json(400, { error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message });
    }
  };
}

export function moderationPlugin() {
  const store = createModerationStore();
  const fly = createFlyNose();
  return {
    name: 'local-moderation-api',
    configureServer(server) { server.middlewares.use(moderationApi(store, fly)); },
    configurePreviewServer(server) { server.middlewares.use(moderationApi(store, fly)); },
  };
}
