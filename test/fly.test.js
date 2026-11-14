import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModerationStore, moderationApi } from '../server/moderation.js';
import { createFlyNose } from '../server/fly.js';
import { judge, tokenize } from '../src/fly-rules.js';

const thresholds = { punishments: [[8.75, 'BAN'], [7.5, 'MUTE'], [6.5, 'TIMEOUT 30s'], [5.5, 'SLOW 30s'], [4.5, 'WARN']], award_up_to: 1.5, neutral: 3 };

test('tokenize lowercases, squeezes stretched letters and keeps only word characters', () => {
  assert.deepEqual(tokenize('LMAOOOOO that was GG!!! 😂 don\'t'), ['lmaoo', 'that', 'was', 'gg', "don't"]);
  assert.deepEqual(tokenize('😂😂😂'), []);
});

test('the worst word decides a stinking message; otherwise the average does', () => {
  const smells = new Map([['nice', 1], ['play', 2], ['rotten', 9], ['meh', 4]]);
  assert.deepEqual(judge('nice play', smells, thresholds), { stink: 1.5, label: 'MOD AWARD', action: 'mod-award', worst: null, unsniffed: false });
  assert.deepEqual(judge('nice rotten play', smells, thresholds), { stink: 9, label: 'BAN', action: 'ban', worst: 'rotten', unsniffed: false });
  assert.equal(judge('meh play', smells, thresholds).action, null);
  assert.equal(judge('😂', smells, thresholds).stink, 3);
});

test('a message waits for all its words, and an unsmellable word counts as neutral', () => {
  assert.equal(judge('nice mystery', new Map([['nice', 1]]), thresholds), null);
  const verdict = judge('nice mystery', new Map([['nice', 1], ['mystery', null]]), thresholds);
  assert.equal(verdict.stink, 2);
  assert.equal(verdict.unsniffed, true);
});

test('POST /api/fly/smell answers from the table and asks the running fly for other words', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fly-'));
  writeFileSync(join(root, 'table.json'), JSON.stringify({ thresholds, smells: { gg: 1.2 } }));
  // Stand-in for fly_server.py: every new word smells of its length.
  const script = `console.log(JSON.stringify({thresholds:${JSON.stringify(thresholds)}}));
    require('readline').createInterface({input:process.stdin}).on('line',l=>console.log(JSON.stringify(Object.fromEntries(JSON.parse(l).map(w=>[w,w.length])))));`;
  const post = async (fly, words) => {
    const server = createServer((req, res) => moderationApi(createModerationStore(), fly)(req, res, () => res.end()));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/fly/smell`, { method: 'POST', body: JSON.stringify({ words }) });
      return { status: response.status, body: await response.json() };
    } finally { server.close(); fly.close(); }
  };

  const live = await post(createFlyNose({ root, table: 'table.json', command: [process.execPath, '-e', script] }), ['gg', 'hello']);
  assert.deepEqual(live.body, { thresholds, live: true, smells: { gg: 1.2, hello: 5 } });

  const offline = await post(createFlyNose({ root, table: 'table.json' }), ['gg', 'hello']);
  assert.deepEqual(offline.body, { thresholds, live: false, smells: { gg: 1.2, hello: null } });

  const bad = await post(createFlyNose({ root, table: 'table.json' }), ['Not A Token']);
  assert.equal(bad.status, 400);
});
