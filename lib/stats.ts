import { prisma } from "./db";
import { DATE_DIMS, TERMINAL, type Dimension } from "./constants";
import { buildWhere, type Filters } from "./filters";

export interface Bucket { key: string; count: number }
export type Breakdowns = Record<Dimension, Bucket[]>;
export interface Progress { key: string; total: number; notCalled: number; notPicked: number; connected: number; attempts: number }

const ymdIST = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const dateKey = (d: Date, dim: Dimension) => (dim === "month" ? ymdIST(d).slice(0, 7) : ymdIST(d));
const isDateDim = (d: Dimension) => DATE_DIMS.includes(d);

interface Row { key: string; status: string; count: number; attempts: number }

/** One row per (dimension value, status). Date dimensions are bucketed in IST from the enquiry date. */
async function rows(orgId: string, f: Filters, dim: Dimension): Promise<Row[]> {
  const where = buildWhere(orgId, f);
  if (isDateDim(dim)) {
    const g = await prisma.lead.groupBy({ by: ["queryDate", "status"], where: { AND: [where, { queryDate: { not: null } }] }, _count: { _all: true }, _sum: { callAttempts: true } });
    return g.map((r) => ({ key: dateKey(r.queryDate!, dim), status: r.status, count: r._count._all, attempts: r._sum.callAttempts ?? 0 }));
  }
  const g = (await prisma.lead.groupBy({ by: [dim, "status"] as never, where, _count: { _all: true }, _sum: { callAttempts: true } } as never)) as unknown as Array<
    Record<string, string | null> & { status: string; _count: { _all: number }; _sum: { callAttempts: number | null } }
  >;
  return g.filter((r) => r[dim]).map((r) => ({ key: r[dim] as string, status: r.status, count: r._count._all, attempts: r._sum.callAttempts ?? 0 }));
}

const order = (dim: Dimension) => (isDateDim(dim) ? (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key) : null);

async function breakdown(orgId: string, f: Filters, dim: Dimension, top: number): Promise<Bucket[]> {
  const m = new Map<string, number>();
  for (const r of await rows(orgId, f, dim)) m.set(r.key, (m.get(r.key) ?? 0) + r.count);
  const out = [...m].map(([key, count]) => ({ key, count }));
  const chrono = order(dim);
  return (chrono ? out.sort(chrono) : out.sort((a, b) => b.count - a.count)).slice(0, top);
}

/** Call progress split by any dimension. Not called = still NEW; Not picked = last outcome NOT_PICKED; Connected = everything else called. */
export async function callProgress(orgId: string, f: Filters, by: Dimension): Promise<Progress[]> {
  const map = new Map<string, Progress>();
  for (const r of await rows(orgId, f, by)) {
    const p = map.get(r.key) ?? { key: r.key, total: 0, notCalled: 0, notPicked: 0, connected: 0, attempts: 0 };
    p.total += r.count;
    p.attempts += r.attempts;
    if (r.status === "NEW") p.notCalled += r.count;
    else if (r.status === "NOT_PICKED") p.notPicked += r.count;
    else p.connected += r.count;
    map.set(r.key, p);
  }
  const out = [...map.values()];
  const chrono = order(by);
  return (chrono ? out.sort(chrono) : out.sort((a, b) => b.total - a.total)).slice(0, 60);
}

export async function getStats(orgId: string, f: Filters, by: Dimension = "source") {
  const where = buildWhere(orgId, f);
  const now = new Date();
  // Day-level view only makes sense once the range is narrowed to about a month.
  const showDay = !!(f.month || f.from || f.day);
  const [total, contacted, interested, won, dueToday, hot, progress, source, status, state, city, requirement, month, day] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { AND: [where, { status: { not: "NEW" } }] } }),
    prisma.lead.count({ where: { AND: [where, { status: "INTERESTED" }] } }),
    prisma.lead.count({ where: { AND: [where, { status: "WON" }] } }),
    prisma.lead.count({ where: { AND: [where, { nextFollowUp: { lte: now }, status: { notIn: TERMINAL } }] } }),
    prisma.lead.count({ where: { AND: [where, { score: { gte: 70 }, status: "NEW" }] } }),
    callProgress(orgId, f, by),
    breakdown(orgId, f, "source", 12),
    breakdown(orgId, f, "status", 12),
    breakdown(orgId, f, "state", 12),
    breakdown(orgId, f, "city", 12),
    breakdown(orgId, f, "requirement", 10),
    breakdown(orgId, f, "month", 36),
    showDay ? breakdown(orgId, f, "day", 62) : Promise.resolve([] as Bucket[]),
  ]);
  return {
    kpis: { total, contacted, interested, won, dueToday, hotUntouched: hot },
    breakdowns: { source, status, state, city, requirement, month, day } as Breakdowns,
    progress,
    progressBy: by,
  };
}
