export const userKey = name => name.trim().normalize('NFC').toLowerCase();

export function moderatedMessages(messages, state, now = Date.now()) {
  const users = new Map(state.users.map(user => [userKey(user.username), user]));
  const lastSent = new Map();
  return messages.filter(message => {
    const key = userKey(message.user);
    const user = users.get(key);
    if (user?.banned || user?.muted || user?.timeoutUntil > now) return false;
    if (state.slowSeconds) {
      const last = lastSent.get(key);
      if (last !== undefined && message.time - last < state.slowSeconds) return false;
      lastSent.set(key, message.time);
    }
    return true;
  });
}
