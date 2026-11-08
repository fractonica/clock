// When a test call rings (`--call WHEN`), and how far off that is, in words.

/**
 * A test call's time: a delay from now (`90s`, `2m`, `1h30m`, `45` for seconds), a time of day on this computer's clock
 * (`14:30`, `14:30:15`: today, or tomorrow once it has passed), or a date and time (`2026-11-09T14:30`, local). Unix
 * seconds, or null for anything else.
 */
export function parseWhen(text, now = Date.now() / 1000) {
  const raw = String(text ?? '').trim();
  const s = raw.toLowerCase().replace(/^\+|^in\s+/, '').replace(/\s+/g, '');
  if (/^\d+(\.\d+)?$/.test(s)) return now + Number(s);
  const d = s.match(/^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s)?$/);
  if (d && (d[1] || d[2] || d[3])) return now + (+d[1] || 0) * 3600 + (+d[2] || 0) * 60 + (+d[3] || 0);
  const c = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (c) {
    const [h, m, sec] = [+c[1], +c[2], +(c[3] ?? 0)];
    if (h > 23 || m > 59 || sec > 59) return null;
    const day = new Date(now * 1000);
    day.setHours(h, m, sec, 0);
    if (day.getTime() / 1000 <= now) day.setDate(day.getDate() + 1);
    return day.getTime() / 1000;
  }
  if (/^\d{4}-\d{2}-\d{2}[ t]\d{1,2}:\d{2}/i.test(raw)) {
    const t = Date.parse(raw.replace(/[ t]/i, 'T'));
    return Number.isFinite(t) ? t / 1000 : null;
  }
  return null;
}

/** "in 2 min 13 s", "in 1 h 05 min", "now". */
export function fromNow(t, now = Date.now() / 1000) {
  const s = Math.round(t - now);
  if (s <= 0) return 'now';
  if (s < 60) return `in ${s} s`;
  if (s < 3600) return `in ${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  const m = Math.round(s / 60);
  return `in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
