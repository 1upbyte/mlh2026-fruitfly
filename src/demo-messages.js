export function injectDemoMessages(messages, random = Math.random) {
  const result = [];
  const usernames = [...new Map(messages.map(message => [message.user.toLowerCase(), message.user])).values()];
  let available = [...usernames];
  let previousUser;
  let remaining = 10 + Math.floor(random() * 11);
  let injected = 0;
  for (const message of messages) {
    result.push({ ...message, index: result.length });
    if (--remaining > 0) continue;
    if (!available.length) available = [...usernames];
    let pick = Math.floor(random() * available.length);
    if (available.length > 1 && available[pick].toLowerCase() === previousUser) pick = (pick + 1) % available.length;
    const [user] = available.splice(pick, 1);
    previousUser = user.toLowerCase();
    const ban = injected++ % 2 === 0;
    result.push({
      time: message.time, stamp: message.stamp, index: result.length, user,
      text: ban ? 'Shut up, nobody wants you in this chat.' : 'SPAM SPAM SPAM SPAM SPAM',
      demo: true,
      verdict: { action: ban ? 'ban' : 'timeout', label: ban ? 'BAN' : 'TIMEOUT 30s', stink: ban ? 9.5 : 7, worst: null, unsniffed: false },
    });
    remaining = 10 + Math.floor(random() * 11);
  }
  return result;
}
