export function injectDemoMessages(messages, random = Math.random) {
  const result = [];
  const usernames = new Set(messages.map(message => message.user.toLowerCase()));
  const prefix = `demo_${crypto.randomUUID().slice(0, 6)}`;
  let remaining = 10 + Math.floor(random() * 11);
  let number = 0;
  let injected = 0;
  for (const message of messages) {
    result.push({ ...message, index: result.length });
    if (--remaining > 0) continue;
    let user;
    do { user = `${prefix}_${++number}`; } while (usernames.has(user));
    usernames.add(user);
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
