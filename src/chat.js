export function parseChat(text) {
  const messages = []; let previous = 0; let day = 0;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^\[(\d{1,2}):(\d{2}):(\d{2})\]\s*([^:]+):\s?(.*)$/);
    if (match) {
      const hour = +match[1], minute = +match[2], second = +match[3];
      if (hour > 23 || minute > 59 || second > 59) continue;
      const seconds = hour * 3600 + minute * 60 + second;
      if (previous - seconds > 43200) day += 86400;
      previous = seconds;
      messages.push({ absolute: day + seconds, user: match[4].trim(), text: match[5], stamp: `${match[1]}:${match[2]}:${match[3]}` });
    } else {
      messages.push({ absolute: messages.length ? messages.at(-1).absolute + 1 : 0, user: 'viewer', text: line, stamp: '' });
    }
  }
  const start = messages[0]?.absolute ?? 0;
  return messages.map((message, index) => ({ ...message, time: Math.max(0, message.absolute - start), index }));
}
export const assignedTo = (index, count) => index % count;
export function visibleMessages(messages, time, offset = 0) { return messages.filter(message => message.time <= time - offset); }
export function userColor(name) {
  const colors = ['#bf94ff', '#00d9a0', '#ff8280', '#55b9ff', '#e5b75b', '#ff75cb', '#9cd65e', '#ac9cff'];
  return colors[[...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % colors.length];
}
