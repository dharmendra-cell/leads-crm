import type { Prisma } from "@prisma/client";
import { OTHER_SOURCE, SOURCE_GROUPS, TERMINAL, knownSourceNames } from "./constants";

export interface Filters {
  source?: string;
  status?: string;
  city?: string;
  state?: string;
  requirement?: string;
  q?: string;
  due?: boolean;
  /** Enquiry-date filters (IST): YYYY-MM, YYYY-MM-DD, inclusive range. */
  month?: string;
  day?: string;
  from?: string;
  to?: string;
}

export function filtersFromParams(sp: URLSearchParams): Filters {
  const g = (k: string) => sp.get(k) || undefined;
  return {
    source: g("source"), status: g("status"), city: g("city"), state: g("state"),
    requirement: g("requirement"), q: g("q"), due: sp.get("due") === "1",
    month: g("month"), day: g("day"), from: g("from"), to: g("to"),
  };
}

const IST = "+05:30";
const istStart = (ymd: string) => new Date(`${ymd}T00:00:00${IST}`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);
const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(istStart(v).getTime());

/** Enquiry-date window from month/day/from/to (all intersected). Returns undefined when no date filter is set. */
export function dateRange(f: Filters): { gte?: Date; lt?: Date } | undefined {
  let gte: Date | undefined;
  let lt: Date | undefined;
  const tighten = (a?: Date, b?: Date) => {
    if (a && (!gte || a > gte)) gte = a;
    if (b && (!lt || b < lt)) lt = b;
  };
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    const [y, m] = f.month.split("-").map(Number);
    if (m >= 1 && m <= 12) tighten(istStart(`${f.month}-01`), istStart(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`));
  }
  if (isDay(f.day)) tighten(istStart(f.day!), addDays(istStart(f.day!), 1));
  if (isDay(f.from)) tighten(istStart(f.from!), undefined);
  if (isDay(f.to)) tighten(undefined, addDays(istStart(f.to!), 1));
  return gte || lt ? { ...(gte && { gte }), ...(lt && { lt }) } : undefined;
}

export function buildWhere(orgId: string, f: Filters): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { orgId };
  if (f.source === OTHER_SOURCE) where.source = { notIn: knownSourceNames() };
  else if (f.source) {
    const group = SOURCE_GROUPS.find((g) => g.key === f.source);
    where.source = group ? { in: [...group.match] } : f.source;
  }
  if (f.status) where.status = f.status;
  if (f.city) where.city = f.city;
  if (f.state) where.state = f.state;
  if (f.requirement) where.requirement = f.requirement;
  const range = dateRange(f);
  if (range) where.queryDate = range;
  if (f.due) {
    where.nextFollowUp = { lte: new Date() };
    where.status = f.status ?? { notIn: TERMINAL };
  }
  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { company: { contains: q, mode: "insensitive" } },
      { phone: { contains: q.replace(/\D/g, "") || q } },
      { email: { contains: q, mode: "insensitive" } },
      { requirement: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}
