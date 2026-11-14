// The fly's verdict on a message, from the smell of each word. Mirrors
// flymod/words.py (tokenize) and flymod/moderator.py (big_stink, action_for);
// the thresholds themselves are exported by Python and passed in.
const API_ACTION = { 'BAN': 'ban', 'MUTE': 'mute', 'TIMEOUT 30s': 'timeout', 'SLOW 30s': 'slow', 'WARN': 'warn', 'MOD AWARD': 'mod-award' };

export function tokenize(message) {
  return message.toLowerCase().replace(/(.)\1{2,}/gu, '$1$1').match(/[a-z0-9']+/g) || [];
}

export function actionFor(stink, thresholds) {
  for (const [threshold, name] of thresholds.punishments) if (stink >= threshold) return name;
  return stink <= thresholds.award_up_to ? 'MOD AWARD' : null;
}

// smells: Map word -> smell. Returns null until every word has been sniffed.
export function judge(text, smells, thresholds) {
  const words = tokenize(text);
  if (words.some(word => !smells.has(word))) return null;
  // A word the fly could not smell (no Python fly running) counts as neutral.
  const values = words.map(word => smells.get(word) ?? thresholds.neutral);
  let stink = thresholds.neutral, worst = null;
  if (values.length) {
    const top = Math.max(...values);
    const stinksFrom = thresholds.punishments.at(-1)[0];
    stink = top >= stinksFrom ? top : values.reduce((sum, value) => sum + value, 0) / values.length;
    if (top >= stinksFrom) worst = words[values.indexOf(top)];
  }
  const label = actionFor(stink, thresholds);
  return { stink, label, action: label && API_ACTION[label], worst, unsniffed: words.some(word => smells.get(word) === null) };
}
