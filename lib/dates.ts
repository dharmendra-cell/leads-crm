const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

/** Reject garbage (serial numbers, typos) that parse to absurd years - Postgres and Prisma choke on them. */
const sane = (d: Date | null): Date | null => (d && d.getFullYear() >= 2000 && d.getFullYear() <= 2100 ? d : null);

export function parseDate(v: unknown): Date | null {
  return sane(parseDateRaw(v));
}

function parseDateRaw(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim().replace(/(\d)(st|nd|rd|th)\b/i, "$1").replace(/\s*\|.*$/, (m) => (/\d{1,2}:\d{2}/.test(m) ? m.replace("|", " ") : ""));
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
  }
  // ISO-like: 2025-09-12 14:32:10
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return mk(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  // Indian style dd-mm-yyyy / dd/mm/yyyy [hh:mm[:ss]]
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return mk(y, +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  // 12 Sep 2025 / 12-Sep-25 / Sep 12, 2025
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{2,4})/);
  if (m) {
    const mo = MONTHS.indexOf(m[2].toLowerCase());
    if (mo >= 0) return mk(+m[3] < 100 ? 2000 + +m[3] : +m[3], mo + 1, +m[1], 0, 0, 0);
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

function mk(y: number, mo: number, d: number, h: number, mi: number, se: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d, h, mi, se);
  return isNaN(dt.getTime()) ? null : dt;
}
