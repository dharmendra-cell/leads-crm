import { prisma } from "./db";

export type Period = "day" | "week" | "month";

const ymdIST = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Bucket key in IST: day = YYYY-MM-DD, week = the Monday of that week, month = YYYY-MM. */
export function bucketKey(d: Date, period: Period): string {
  const day = ymdIST(d);
  if (period === "day") return day;
  if (period === "month") return day.slice(0, 7);
  const [y, m, dd] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  const back = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
}

export interface Bucket {
  key: string;
  calls: number;
  uniqueLeads: number;
  firstCalls: number;
  followUpCalls: number;
  notPicked: number;
  connected: number;
  interested: number;
  won: number;
  lostOrNotInterested: number;
}
const emptyBucket = (key: string): Bucket => ({ key, calls: 0, uniqueLeads: 0, firstCalls: 0, followUpCalls: 0, notPicked: 0, connected: 0, interested: 0, won: 0, lostOrNotInterested: 0 });

/**
 * Calling activity from calls logged in the app (Interaction type STATUS).
 * One logged outcome = one call. A call on a lead that was already called before (in the app, or in the imported
 * remarks) is a follow-up call; it still counts +1 call, but the lead counts once per bucket in `uniqueLeads`.
 * Imported remarks carry no call date, so they are not part of the timeline (they are in each lead's total calls).
 */
export async function callActivity(orgId: string, opts: { period: Period; from: Date; to: Date; user?: string }) {
  const rows = await prisma.interaction.findMany({
    where: { orgId, type: "STATUS", createdAt: { gte: opts.from, lt: opts.to }, ...(opts.user ? { userName: opts.user } : {}) },
    select: { id: true, leadId: true, createdAt: true, outcome: true, userName: true },
    orderBy: { createdAt: "asc" },
    take: 100000,
  });
  const leadIds = [...new Set(rows.map((r) => r.leadId))];
  const [firsts, imported] = await Promise.all([
    prisma.interaction.groupBy({ by: ["leadId"], where: { orgId, type: "STATUS", leadId: { in: leadIds } }, _min: { createdAt: true } }),
    prisma.interaction.findMany({ where: { orgId, userName: "imported", leadId: { in: leadIds } }, distinct: ["leadId"], select: { leadId: true } }),
  ]);
  const firstAt = new Map(firsts.map((f) => [f.leadId, f._min.createdAt?.getTime() ?? 0]));
  const hadImported = new Set(imported.map((i) => i.leadId));

  const buckets = new Map<string, Bucket & { _leads: Set<string> }>();
  const agents = new Map<string, { user: string; calls: number; connected: number; notPicked: number; interested: number; leads: Set<string> }>();
  const totalLeads = new Set<string>();
  const total = emptyBucket("total");

  for (const r of rows) {
    const key = bucketKey(r.createdAt, opts.period);
    const b = buckets.get(key) ?? Object.assign(emptyBucket(key), { _leads: new Set<string>() });
    const isFirst = r.createdAt.getTime() === firstAt.get(r.leadId) && !hadImported.has(r.leadId);
    for (const t of [b, total]) {
      t.calls++;
      isFirst ? t.firstCalls++ : t.followUpCalls++;
      if (r.outcome === "NOT_PICKED") t.notPicked++;
      else t.connected++;
      if (r.outcome === "INTERESTED") t.interested++;
      if (r.outcome === "WON") t.won++;
      if (r.outcome === "LOST" || r.outcome === "NOT_INTERESTED") t.lostOrNotInterested++;
    }
    b._leads.add(r.leadId);
    totalLeads.add(r.leadId);
    buckets.set(key, b);

    const who = r.userName ?? "unknown";
    const a = agents.get(who) ?? { user: who, calls: 0, connected: 0, notPicked: 0, interested: 0, leads: new Set<string>() };
    a.calls++;
    r.outcome === "NOT_PICKED" ? a.notPicked++ : a.connected++;
    if (r.outcome === "INTERESTED") a.interested++;
    a.leads.add(r.leadId);
    agents.set(who, a);
  }
  total.uniqueLeads = totalLeads.size;

  return {
    total,
    buckets: [...buckets.values()].map(({ _leads, ...b }) => ({ ...b, uniqueLeads: _leads.size })).sort((a, b) => a.key.localeCompare(b.key)),
    agents: [...agents.values()].map((a) => ({ user: a.user, calls: a.calls, connected: a.connected, notPicked: a.notPicked, interested: a.interested, uniqueLeads: a.leads.size })).sort((a, b) => b.calls - a.calls),
  };
}

/** Default window per period, ending tomorrow 00:00 IST so today is included. */
export function defaultRange(period: Period, now = new Date()): { from: Date; to: Date } {
  const today = ymdIST(now);
  const to = new Date(new Date(`${today}T00:00:00+05:30`).getTime() + 86400_000);
  const days = period === "day" ? 30 : period === "week" ? 84 : 365;
  return { from: new Date(to.getTime() - days * 86400_000), to };
}
