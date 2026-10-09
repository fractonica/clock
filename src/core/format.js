/**
 * Time-zone aware formatting and Gregorian <-> Unix conversion.
 * All functions take Unix seconds (Number) and an IANA zone name; the zone is
 * bound once with createFormatter(() => currentZone) so views never touch Intl
 * directly. Nothing here knows about the Fractonica clock.
 */

export const SYSTEM_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

const dtfCache = new Map();
function dtf(zone, key, opts) {
  const k = zone + '|' + key;
  let f = dtfCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...opts });
    dtfCache.set(k, f);
  }
  return f;
}

const PARTS_OPTS = {
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  weekday: 'short',
};
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Civil fields of a Unix time in a zone.
 * @returns {{year:number, month:number, day:number, hour:number, minute:number,
 *   second:number, ms:number, weekday:number, offset:number}} month 1..12, weekday 0=Sun,
 *   offset = UTC offset in seconds (local - UTC)
 */
export function zonedParts(t, zone = 'UTC') {
  const totalMs = Math.round(t * 1000); // round first: the fractional part can then never reach 1000 ms
  const whole = Math.floor(totalMs / 1000);
  const date = new Date(whole * 1000);
  const out = {};
  for (const p of dtf(zone, 'parts', PARTS_OPTS).formatToParts(date)) {
    if (p.type === 'weekday') out.weekday = WEEKDAYS[p.value];
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  out.ms = totalMs - whole * 1000;
  out.offset = Date.UTC(out.year, out.month - 1, out.day, out.hour, out.minute, out.second) / 1000 - whole;
  return out;
}

/**
 * Inverse of zonedParts: civil fields in `zone` -> Unix seconds.
 * A local time that happens twice (clocks went back) resolves to the earlier instant; a skipped one
 * (clocks went forward) resolves forward by the length of the gap. `ms` is optional.
 */
export function zonedToUnix({ year, month, day, hour = 0, minute = 0, second = 0, ms = 0 }, zone = 'UTC') {
  const d = new Date(0); // not Date.UTC: it would shift years 0..99 into the 1900s
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, 0);
  const g = d.getTime() / 1000; // the fields read as UTC
  // candidate offsets: the ones in force a day before, at, and a day after the guess
  const offsets = new Set([zonedParts(g - 86400, zone).offset, zonedParts(g, zone).offset, zonedParts(g + 86400, zone).offset]);
  let best = null;
  for (const o of offsets) {
    const t = g - o;
    if (zonedParts(t, zone).offset === o && (best === null || t < best)) best = t;
  }
  if (best === null) best = g - zonedParts(g - 86400, zone).offset; // gap: the offset in force before the change
  return best + ms / 1000;
}

const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');

/** Offset like "+03:00"; local-mean-time offsets keep their seconds ("+00:53:28"). */
export function offsetLabel(offsetSeconds) {
  const sign = offsetSeconds < 0 ? '-' : '+';
  const a = Math.abs(Math.round(offsetSeconds));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = a % 60;
  return `${sign}${pad(h)}:${pad(m)}${sec ? ':' + pad(sec) : ''}`;
}

/** Days from civil date, proleptic Gregorian (Howard Hinnant's algorithm). */
export function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Bind formatting helpers to a zone getter.
 * @param {() => string} getZone  returns an IANA zone (never 'local')
 */
export function createFormatter(getZone) {
  const valid = new Map();
  const zone = () => {
    const z = getZone();
    if (!z) return SYSTEM_ZONE;
    let ok = valid.get(z);
    if (ok === undefined) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: z });
        ok = true;
      } catch {
        ok = false;
      }
      valid.set(z, ok);
    }
    return ok ? z : SYSTEM_ZONE;
  };
  const api = {
    zone,
    parts: (t) => zonedParts(t, zone()),
    toUnix: (fields) => zonedToUnix(fields, zone()),
    /** "2026-10-09" */
    date(t) {
      const p = zonedParts(t, zone());
      return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    },
    /** "14:23" or "14:23:07" / "14:23:07.123" */
    time(t, { seconds = true, ms = false } = {}) {
      const p = zonedParts(t, zone());
      let s = `${pad(p.hour)}:${pad(p.minute)}`;
      if (seconds) s += `:${pad(p.second)}`;
      if (ms) s += `.${pad(p.ms, 3)}`;
      return s;
    },
    /** "2026-10-09 14:23:07" */
    dateTime(t, o) {
      return `${api.date(t)} ${api.time(t, o)}`;
    },
    /** "Fri 9 Oct 2026, 14:23:07" */
    long(t, { seconds = true } = {}) {
      const p = zonedParts(t, zone());
      return `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}, ${api.time(t, { seconds })}`;
    },
    /** "Oct 9 14:23" – compact, omits year when it equals `refYear` */
    short(t, refYear) {
      const p = zonedParts(t, zone());
      const y = refYear === undefined || refYear !== p.year ? ` ${p.year}` : '';
      return `${MONTHS_SHORT[p.month - 1]} ${p.day}${y} ${pad(p.hour)}:${pad(p.minute)}`;
    },
    /**
     * Spec §8 label: local time with seconds, or `Mon D HH:MM` when the time
     * falls on another local day than `ref`.
     */
    label(t, ref) {
      const a = zonedParts(t, zone());
      const b = zonedParts(ref, zone());
      if (a.year === b.year && a.month === b.month && a.day === b.day) return api.time(t, { seconds: true });
      return `${MONTHS_SHORT[a.month - 1]} ${a.day} ${pad(a.hour)}:${pad(a.minute)}`;
    },
    /** "UTC+03:00" style zone tag at time t */
    tag(t) {
      const z = zone();
      if (z === 'UTC') return 'UTC';
      return `UTC${offsetLabel(zonedParts(t, z).offset)}`;
    },
    /** ISO-8601 with offset: "2026-10-09T14:23:07+03:00" */
    iso(t) {
      return `${api.date(t)}T${api.time(t)}${offsetLabel(zonedParts(t, zone()).offset)}`;
    },
    /** Value for <input type="datetime-local"> ("2026-10-09T14:23:07") */
    inputValue(t) {
      return `${api.date(t)}T${api.time(t)}`;
    },
    /** Parse an <input type="datetime-local"> value in the bound zone -> Unix seconds or null. */
    parseInput(value) {
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(String(value).trim());
      if (!m) return null;
      const f = {
        year: +m[1],
        month: +m[2],
        day: +m[3],
        hour: +(m[4] ?? 0),
        minute: +(m[5] ?? 0),
        second: +(m[6] ?? 0),
        ms: m[7] ? +m[7].padEnd(3, '0') : 0,
      };
      if (f.month < 1 || f.month > 12 || f.day < 1 || f.day > daysInMonth(f.year, f.month) || f.hour > 23 || f.minute > 59 || f.second > 59) return null;
      return zonedToUnix(f, zone());
    },
    duration,
    countdown,
    relative,
  };
  return api;
}

const MIXED_UNITS = [
  ['d', 86400],
  ['h', 3600],
  ['min', 60],
  ['s', 1],
];

/**
 * Compact duration: "72.12 y", "3 d 4 h", "5 h 3 min", "7.8 s", "310 ms".
 * `parts` is the number of consecutive units shown for mixed output (default 2).
 */
export function duration(seconds, { parts = 2 } = {}) {
  const neg = seconds < 0;
  let s = Math.abs(seconds);
  let out;
  if (s < 1) out = `${Math.round(s * 1000)} ms`;
  else if (s < 10) out = `${s.toFixed(1)} s`;
  else if (s >= 31557600 * 2) out = `${(s / 31557600).toFixed(1)} y`;
  else if (s >= 31557600) out = `${(s / 31557600).toFixed(2)} y`;
  else {
    const first = MIXED_UNITS.findIndex(([, size]) => s >= size);
    out = MIXED_UNITS.slice(first, first + parts)
      .map(([name, size]) => {
        const n = Math.floor(s / size);
        s -= n * size;
        return `${n} ${name}`;
      })
      .join(' ');
  }
  return neg ? '−' + out : out;
}

/** Live countdown "in 3 d 04 h 12 min" / "in 12 min 04 s"; negative = "3 min ago". */
export function countdown(seconds) {
  const past = seconds < 0;
  const s = Math.abs(seconds);
  let out;
  if (s < 60) out = `${s < 10 ? (Math.floor(s * 10) / 10).toFixed(1) : Math.floor(s)} s`;
  else if (s < 3600) out = `${Math.floor(s / 60)} min ${pad(s % 60)} s`;
  else if (s < 86400) out = `${Math.floor(s / 3600)} h ${pad((s % 3600) / 60)} min`;
  else if (s < 31557600) out = `${Math.floor(s / 86400)} d ${pad((s % 86400) / 3600)} h`;
  else out = `${Math.floor(s / 31557600)} y ${Math.floor((s % 31557600) / 86400)} d`;
  return past ? `${out} ago` : `in ${out}`;
}

/** Relative description between two times ("in 3 d 04 h"). */
export function relative(t, ref) {
  return countdown(t - ref);
}
