import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORD = /^[a-z0-9']{1,64}$/;

// Word smells come from two places: the table moderate.py wrote for the example
// chat (xqc1.fly.json), and, for any other word, a trained fly kept running in
// Python (fly_server.py). Without the Python fly, other words have no smell (null).
export function createFlyNose({ root = ROOT, table = 'xqc1.fly.json', command } = {}) {
  let thresholds = null;
  const smells = new Map();
  try {
    const saved = JSON.parse(readFileSync(`${root}/${table}`, 'utf8'));
    thresholds = saved.thresholds;
    for (const [word, smell] of Object.entries(saved.smells)) smells.set(word, smell);
  } catch { /* no table yet: rely on the Python fly */ }

  let child = null, alive = false, ready = null;
  const waiting = [];
  function start() {
    if (ready) return ready;
    if (!command) {
      if (!existsSync(`${root}/trained_fly.npz`)) return ready = Promise.resolve(false);
      const python = process.env.FLY_PYTHON || (existsSync(`${root}/.venv/bin/python`) ? `${root}/.venv/bin/python` : 'python3');
      command = [python, 'fly_server.py'];
    }
    return ready = new Promise(resolve => {
      child = spawn(command[0], command.slice(1), { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
      const stop = () => { alive = false; resolve(false); for (const reply of waiting.splice(0)) reply(null); };
      child.on('error', stop);
      child.on('exit', stop);
      child.stdin.on('error', () => {});
      createInterface({ input: child.stdout }).on('line', line => {
        let value;
        try { value = JSON.parse(line); } catch { return; }   // library chatter on stdout
        if (value?.thresholds) { thresholds = value.thresholds; alive = true; resolve(true); }
        else waiting.shift()?.(value);
      });
    });
  }
  const ask = words => new Promise(resolve => { waiting.push(resolve); child.stdin.write(JSON.stringify(words) + '\n'); });

  return {
    async smell(words) {
      if (!Array.isArray(words) || words.length > 500 || !words.every(word => typeof word === 'string' && WORD.test(word))) {
        throw new Error('words must be up to 500 lowercase tokens.');
      }
      const unknown = [...new Set(words.filter(word => !smells.has(word)))];
      if (unknown.length && await start() && alive) {
        const fresh = await ask(unknown);
        if (fresh) for (const [word, smell] of Object.entries(fresh)) smells.set(word, smell);
      }
      return { thresholds, live: alive, smells: Object.fromEntries(words.map(word => [word, smells.get(word) ?? null])) };
    },
    close() { child?.kill(); },
  };
}
